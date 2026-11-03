const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const path = require('node:path');
const { buildSync } = require('esbuild');

test('local File reaches decoder, envelope and independent audio replacement without replacing video', async () => {
  const bundle = buildSync({ entryPoints: [path.join(__dirname, '../src/stream-player.js')],
    bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text;
  const workers = [];
  const context = { module: { exports: {} }, exports: {}, window: {}, EventTarget, Event, AbortController, Blob, URL,
    fetch: async () => ({ ok: true, text: async () => '' }),
    Worker: class {
      constructor() { this.messages = []; workers.push(this); }
      postMessage(data) { this.messages.push(data); }
      terminate() { this.terminated = true; }
    },
  };
  vm.runInNewContext(bundle, context);
  const file = new Blob(['local bytes']);
  const player = new context.module.exports.StreamPlayer({ dataset: { decoder: 'https://example.test/stream-worker.js' } }, { file });
  await new Promise(setImmediate);
  const metadata = { type: 'metadata', epoch: 0, channels: 4, sampleRate: 48000, duration: 2,
    width: 0, height: 0, audioTracks: [{ supported: true }, { supported: true }], audioTrackIndex: 0 };
  player.receive(metadata);
  assert.equal(workers.length, 2);
  for (const worker of workers) assert.equal(worker.messages[0].file, file);
  const replacement = new context.module.exports.StreamPlayer({ dataset: player.dataset },
    { file, audioOnly: true, deferEnvelope: true, audioTrackIndex: 1, time: 1 });
  await new Promise(setImmediate);
  replacement.receive({ ...metadata, audioTrackIndex: 1 });
  assert.equal(workers[2].messages[0].audioOnly, true);
  assert.equal(workers[2].messages[0].time, 1);
  assert.equal(workers[2].messages[0].audioTrackIndex, 1);
  assert.equal(workers[0].terminated, undefined);
  assert.equal(workers[1].terminated, undefined);
  for (const worker of workers) assert.equal(worker.messages[0].file, file);
  player.dispose(); replacement.dispose();
  assert.ok(workers.every(worker => worker.terminated));
});

test('audio handoff retains video worker, pending frame and seek epoch while forwarding the new audio clock', async () => {
  const bundle = buildSync({ entryPoints: [path.join(__dirname, '../src/stream-player.js')],
    bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text;
  const context = { module: { exports: {} }, exports: {}, window: {}, EventTarget, Event, AbortController, fetch, setTimeout };
  vm.runInNewContext(bundle, context);
  const { StreamPlayer } = context.module.exports;
  StreamPlayer.prototype.load = () => {};
  StreamPlayer.prototype.startEnvelope = () => {};
  const player = new StreamPlayer({ dataset: {} });
  let disconnected = 0, closed = 0;
  const messages = [];
  const worker = player.worker = { postMessage(data) { messages.push(data); } };
  player.node = { disconnect() { disconnected++; }, port: { postMessage() {} } };
  player.audioTracks = [{ supported: true }, { supported: true }, { supported: false }];
  player.audioTrackIndex = 0; player.time = 7; player.paused = false; player.duration = 20;
  player.channels = 2; player.sampleRate = 44100;
  player.nextFrame = { frame: { close() { closed++; } } };
  const replacement = new StreamPlayer({ dataset: {} });
  Object.assign(replacement, { time: 7, paused: false, sampleRate: 48000, channels: 4,
    duration: 30, audioTracks: player.audioTracks, audioTrackIndex: 1 });
  player.useAudioSession(replacement);
  assert.equal(player.worker, worker); assert.equal(closed, 0);
  assert.equal(player.time, 7); assert.equal(player.paused, false);
  assert.equal(player.sampleRate, 48000); assert.equal(player.channels, 4);
  assert.equal(player.node, undefined); assert.equal(player.epoch, 0);
  assert.equal(messages[0].type, 'drop-audio'); assert.equal(player.duration, 20);
  player.receive({ type: 'audio', epoch: 0, channels: [] });
  replacement.time = 8; replacement.emit('timeupdate');
  assert.equal(player.currentTime, 8);
  await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(disconnected, 1);
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
  const routing = { channels: 4, enabled: true, matrix: [[0, 1, 0, 0], [1, 0, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]] };
  const countBeforeRouting = messages.length;
  assert.equal(player.setChannelRouting(routing), true);
  assert.equal(messages.length, countBeforeRouting + 1);
  assert.equal(messages.at(-1).type, 'routing');
  assert.equal(player.epoch, 1); assert.equal(player.currentTime, 10);
  assert.equal(player.setChannelRouting({ ...routing, channels: 6 }), false);
  player.receive({ type: 'audio', epoch: 0, channels: [] });
  assert.equal(player.eof, false);
  player.audioPending = false; player.endFrame = 13 * 48000;
  const count = messages.length; player.refill();
  assert.equal(messages.length, count);
  player.endFrame = 11 * 48000; player.refill(); player.refill();
  assert.equal(messages.length, count + 1, 'Only one audio request may be in flight');
});

test('an ended audio handoff cannot overfill the paused PCM ring and replay resets its clock', async () => {
  const bundle = buildSync({ stdin: { contents: `
    export { StreamPlayer } from './src/stream-player.js';
    import './src/powermap/wav-stream-processor.js';`, resolveDir: path.resolve(__dirname, '..') },
    bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text;
  let Processor;
  const notices = [], requests = [];
  const rate = 48000, channels = 6, packetFrames = rate * .4;
  const context = { module: { exports: {} }, exports: {}, window: {}, EventTarget, Event, AbortController,
    fetch, Float32Array, setTimeout, performance, sampleRate: rate,
    AudioWorkletProcessor: class { port = { postMessage(message) { notices.push(message); } }; },
    registerProcessor(name, type) { Processor = type; },
  };
  vm.runInNewContext(bundle, context);
  const { StreamPlayer } = context.module.exports;
  StreamPlayer.prototype.load = () => {};
  StreamPlayer.prototype.startEnvelope = () => {};
  const player = new StreamPlayer({ dataset: {} }, { audioOnly: true });
  const processor = new Processor({ processorOptions: { channels, sourceSampleRate: rate,
    capacityFrames: rate * 4, lowWatermarkFrames: rate } });
  player.node = { port: { postMessage(message) { processor.handleMessage(message); } } };
  let cursor = packetFrames;
  player.worker = { postMessage(message) {
    if (message.type === 'audio') requests.push(message);
    if (message.type === 'seek') cursor = Math.round(message.time * rate);
  } };
  player.receive({ type: 'metadata', epoch: 0, sampleRate: rate, channels, width: 0, height: 0, duration: 5 });
  const chunk = length => Array.from({ length: channels }, (_, channel) => new Float32Array(length).fill((channel + 1) / 10));
  player.receive({ type: 'audio', epoch: 0, channels: chunk(packetFrames), endFrame: cursor, eof: false });
  assert.equal(requests.length, 1, 'A decode request is already in flight when the handoff commits');
  // EOF switching primes the replacement at zero but preserves the visible end position.
  player.time = 5; player.ended = true;
  const drain = () => {
    let delivered = 0;
    while (requests.length && delivered++ < 30) {
      const request = requests.shift();
      const length = Math.min(packetFrames, rate * 5 - cursor);
      cursor += length;
      player.receive({ type: 'audio', epoch: request.epoch, channels: chunk(length), endFrame: cursor, eof: cursor === rate * 5 });
    }
    assert.equal(requests.length, 0, 'Prefetch must become idle without consuming paused audio');
  };
  drain();
  assert.deepEqual(notices.filter(message => message.type === 'error'), [], 'EOF handoff must not overflow the real PCM worklet');
  assert.ok(cursor <= rate * 1.2, 'Only the in-flight decode may complete after EOF');
  assert.equal(player.currentTime, 5);
  assert.equal(player.ended, true);
  assert.equal(processor.playing, false);
  await player.play();
  drain();
  assert.equal(player.currentTime, 0);
  assert.equal(player.epoch, 1);
  assert.equal(player.ended, false);
  assert.equal(processor.epoch, 1);
  const output = Array.from({ length: channels }, () => new Float32Array(128));
  processor.process([], [output]);
  for (let channel = 0; channel < channels; channel++) assert.equal(output[channel][0], Math.fround((channel + 1) / 10));
  assert.equal(processor.sourceFrame, 128);
  assert.deepEqual(notices.filter(message => message.type === 'error'), []);
});

test('software video buffers the consumed-PCM clock, including initial playback, pause and seek', async () => {
  const bundle = buildSync({ entryPoints: [path.join(__dirname, '../src/stream-player.js')],
    bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text;
  const context = { module: { exports: {} }, exports: {}, window: {}, EventTarget, Event,
    AbortController, fetch, performance };
  vm.runInNewContext(bundle, context);
  const { StreamPlayer } = context.module.exports;
  StreamPlayer.prototype.load = StreamPlayer.prototype.startEnvelope = () => {};
  const player = new StreamPlayer({ dataset: {}, getContext: () => ({ drawImage() {} }) });
  const messages = [];
  player.worker = { postMessage() {} };
  player.node = { port: { postMessage: message => messages.push(message) } };
  player.receive({ type: 'metadata', epoch: 0, channels: 6, sampleRate: 48000, duration: 5,
    width: 640, height: 320, videoCodec: 'hevc', videoDecoder: 'FFmpeg/WASM' });
  await player.play();
  assert.equal(player.paused, false, 'Buffering is not a user pause');
  assert.equal(player.videoBlocked, true);
  assert.equal(messages.at(-1).type, 'pause', 'PCM cannot start before the first software picture');
  const picture = (time, epoch = player.epoch) => player.receive({ type: 'video', epoch, time, duration: .04,
    frame: { close() {} } });
  picture(0);
  assert.equal(player.videoBlocked, false);
  assert.equal(messages.at(-1).type, 'play');
  player.time = .16; player.render();
  assert.equal(player.videoBlocked, true);
  assert.equal(messages.at(-1).type, 'pause', 'Slow video holds the audio clock instead of losing sync');
  picture(.12);
  assert.equal(player.videoBlocked, false);
  assert.equal(messages.at(-1).type, 'play');
  player.pause();
  const count = messages.length;
  picture(.16);
  assert.equal(messages.length, count, 'A late picture never resumes user-paused audio');
  await player.play();
  await player.seek(1);
  assert.equal(player.videoBlocked, true);
  assert.notEqual(messages.at(-1).type, 'play');
  picture(.9, 0);
  assert.equal(player.videoBlocked, true, 'Stale seek pictures cannot resume PCM');
  picture(1);
  assert.equal(player.videoBlocked, false);
  assert.equal(messages.at(-1).epoch, 1);
  assert.equal(messages.at(-1).type, 'play');
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
