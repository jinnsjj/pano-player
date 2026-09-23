const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const path = require('node:path');
const { buildSync } = require('esbuild');

test('track reload preserves time, releases old PCM and ignores stale worker messages', async () => {
  const bundle = buildSync({ entryPoints: [path.join(__dirname, '../src/stream-player.js')],
    bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text;
  const context = { module: { exports: {} }, exports: {}, window: {}, EventTarget, Event, AbortController, fetch };
  vm.runInNewContext(bundle, context);
  const { StreamPlayer } = context.module.exports;
  StreamPlayer.prototype.load = () => {};
  StreamPlayer.prototype.startEnvelope = () => {};
  const player = new StreamPlayer({ dataset: {} });
  let terminated = 0, disconnected = 0, closed = 0;
  player.worker = { terminate() { terminated++; } };
  player.node = { disconnect() { disconnected++; }, port: { postMessage() {} } };
  player.audioTracks = [{ supported: true }, { supported: true }, { supported: false }];
  player.audioTrackIndex = 0; player.time = 7; player.paused = false;
  player.channels = 2; player.sampleRate = 44100;
  player.nextFrame = { frame: { close() { closed++; } } };
  player.load = async () => {
    player.receive({ type: 'metadata', epoch: player.epoch, channels: 4, sampleRate: 48000,
      width: 0, height: 0, duration: 20, audioTracks: player.audioTracks, audioTrackIndex: 1 });
  };
  await assert.rejects(player.selectAudioTrack(2), /Unsupported/);
  assert.equal(terminated, 0);
  await player.selectAudioTrack(1);
  assert.equal(terminated, 1); assert.equal(disconnected, 1); assert.equal(closed, 1);
  assert.equal(player.time, 7); assert.equal(player.paused, true);
  assert.equal(player.sampleRate, 48000); assert.equal(player.channels, 4);
  assert.equal(player.node, undefined); assert.equal(player.epoch, 1);
  player.receive({ type: 'error', epoch: 0, message: 'old decoder' });
  player.receive({ type: 'audio', epoch: 0, channels: [] });
  assert.equal(player.error, undefined);
  player.ended = true;
  await player.selectAudioTrack(0);
  assert.equal(player.ended, true, 'Changing tracks at EOF must preserve replay-on-play');
});

test('stream player closes stale frames, preserves seek epochs and bounds PCM prefetch', async () => {
  const bundle = buildSync({ entryPoints: [path.join(__dirname, '../src/stream-player.js')],
    bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text;
  const context = { module: { exports: {} }, exports: {}, window: {}, EventTarget, Event,
    AbortController, fetch, Number };
  vm.runInNewContext(bundle, context);
  const { StreamPlayer } = context.module.exports;
  StreamPlayer.prototype.load = () => {};
  StreamPlayer.prototype.startEnvelope = () => {};
  let drawn = 0, closed = 0;
  const player = new StreamPlayer({ dataset: {}, getContext: () => ({ drawImage() { drawn++; } }) });
  const messages = [];
  player.worker = { postMessage: data => messages.push(data) };
  player.node = { port: { postMessage: data => messages.push(data) } };
  let loadedState, canPlay = 0;
  player.addEventListener('loadeddata', () => { loadedState = player.readyState; });
  player.addEventListener('canplay', () => { canPlay++; });
  player.receive({ type: 'metadata', epoch: 0, channels: 4, sampleRate: 48000, width: 640, height: 640, duration: 20 });
  player.receive({ type: 'video', epoch: 0, time: 8, frame: { close() { closed++; } } });
  assert.equal(drawn, 1, 'Show the first source frame while waiting for its presentation timestamp');
  assert.equal(loadedState, 2, 'Thumbnail consumers must see decoded video before audio becomes ready');
  assert.equal(canPlay, 0, 'Video readiness must not claim audio is ready');
  await player.seek(10);
  player.receive({ type: 'video', epoch: 0, time: 1, frame: { close() { closed++; } } });
  assert.equal(closed, 2); assert.equal(drawn, 1); assert.equal(player.currentTime, 10);
  assert.equal(player.epoch, 1);
  player.receive({ type: 'audio', epoch: 0, channels: [] });
  assert.equal(player.eof, false);
  player.audioPending = false; player.endFrame = 13 * 48000;
  const count = messages.length; player.refill();
  assert.equal(messages.length, count);
  player.endFrame = 11 * 48000; player.refill(); player.refill();
  assert.equal(messages.length, count + 1, 'Only one audio request may be in flight');
});

test('video-only clock supports delayed startup, pause, seek, EOF and replay without PCM', async () => {
  const bundle = buildSync({ entryPoints: [path.join(__dirname, '../src/stream-player.js')],
    bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text;
  let now = 0, drawn = 0;
  const context = { module: { exports: {} }, exports: {}, window: {}, EventTarget, Event,
    AbortController, fetch, performance: { now: () => now } };
  vm.runInNewContext(bundle, context);
  const { StreamPlayer } = context.module.exports;
  StreamPlayer.prototype.load = () => {};
  const player = new StreamPlayer({ dataset: {}, getContext: () => ({ drawImage() { drawn++; } }) });
  const messages = [], events = [];
  player.worker = { postMessage: data => messages.push(data) };
  for (const type of ['canplay', 'seeked', 'ended']) player.addEventListener(type, () => events.push(type));
  const frame = (time, epoch = player.epoch) => player.receive({ type: 'video', epoch, time, duration: .04, frame: { close() {} } });
  await player.play();
  now = 3000; player.render();
  player.receive({ type: 'metadata', epoch: 0, sampleRate: 0, channels: 0, width: 640, height: 320, duration: 2 });
  now = 5000; player.render();
  assert.equal(player.currentTime, 0, 'Wait for the first decoded frame, not metadata or the play gesture');
  frame(0);
  assert.equal(player.readyState, 3);
  assert.ok(events.includes('canplay'));
  frame(.5); now = 5500; player.render();
  assert.equal(player.currentTime, .5); assert.equal(drawn, 2);
  now = 5600; player.pause();
  assert.equal(player.currentTime, .6);
  now = 9000; player.render();
  assert.equal(player.currentTime, .6);
  await player.play(); now = 9200; player.render();
  assert.equal(player.currentTime, .8);
  await player.seek(1);
  now = 15000; player.render();
  assert.equal(player.currentTime, 1, 'Seek decode latency must not advance the clock');
  frame(1); assert.equal(player.seeking, false);
  now = 15400; player.pause();
  assert.equal(player.currentTime, 1.4);
  await player.seek(.5); frame(.5);
  assert.equal(player.paused, true); assert.equal(player.seeking, false);
  await player.play(); frame(1.96);
  now = 16900; player.render();
  player.receive({ type: 'video-end', epoch: player.epoch }); player.render();
  assert.equal(player.ended, true); assert.equal(player.paused, true);
  assert.equal(player.currentTime, 2); assert.equal(events.filter(e => e === 'ended').length, 1);
  await player.play(); frame(0);
  assert.equal(player.ended, false); assert.equal(player.currentTime, 0);
  assert.equal(player.paused, false);
  assert.equal(messages.some(m => m.type === 'audio'), false);
  assert.equal(player.node, undefined);
  // Unknown duration is learned from the final frame, without an extra full-file scan.
  player.duration = NaN;
  frame(.04); now += 40; player.render();
  player.receive({ type: 'video-end', epoch: player.epoch });
  now += 40; player.render();
  assert.equal(player.duration, .08); assert.equal(player.ended, true);
});
