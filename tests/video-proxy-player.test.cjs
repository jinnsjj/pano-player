const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { buildSync } = require('esbuild');

test('live render dimensions remain independent of raw video geometry across audio handoffs', async () => {
  const bundle = buildSync({ entryPoints: [require.resolve('../src/stream-player.js')],
    bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text;
  const module = { exports: {} };
  vm.runInNewContext(bundle, { module, exports: module.exports, window: {}, EventTarget, Event, AbortController,
    fetch, performance, setTimeout });
  const { StreamPlayer } = module.exports;
  StreamPlayer.prototype.load = StreamPlayer.prototype.startEnvelope = () => {};
  const drawn = [], messages = [];
  const element = { dataset: { source: 'original.mp4' }, getContext: () => ({ drawImage: (...args) => drawn.push(args) }) };
  const player = new StreamPlayer(element, { time: 7 });
  const originalWorker = player.worker = { postMessage: message => messages.push(message), terminate() {} };
  player.receive({ type: 'metadata', epoch: 0, channels: 6, sampleRate: 48000, duration: 20,
    width: 4096, height: 4096, renderWidth: 2048, renderHeight: 2048,
    videoCodec: 'hevc', videoCodecString: 'hev1.1.6.H183.90', videoDecoder: 'FFmpeg/VideoToolbox live + WebCodecs', videoLive: true,
    codec: 'aac', audioCodecString: 'mp4a.40.2', audioTrackIndex: 1, audioTracks: [{ index: 1, channels: 6 }] });
  assert.equal(player.videoWidth, 4096); assert.equal(player.videoHeight, 4096);
  assert.equal(element.width, 2048); assert.equal(element.height, 2048);
  const frame = { close() {} };
  player.receive({ type: 'video', epoch: 0, time: 7, duration: .033366, frame });
  assert.equal(drawn[0][0], frame); assert.deepEqual(drawn[0].slice(1), [0, 0, 2048, 2048]);
  const pendingFrame = { close() { throw new Error('Audio handoff must retain pending video'); } };
  player.receive({ type: 'video', epoch: 0, time: 7.2, duration: .033366, frame: pendingFrame });
  const replacement = new StreamPlayer({ dataset: { source: 'external.wav' } }, { audioOnly: true, time: 7 });
  Object.assign(replacement, { channels: 4, sampleRate: 44100, duration: 30, audioTrackIndex: 0,
    audioTracks: [{ index: 0, channels: 4 }], codec: 'flac', audioCodecString: 'flac' });
  player.useAudioSession(replacement);
  assert.equal(player.worker, originalWorker); assert.equal(player.element, element);
  assert.equal(player.dataset.source, 'original.mp4'); assert.equal(player.nextFrame.frame, pendingFrame);
  assert.equal(player.videoDecoder, 'FFmpeg/VideoToolbox live + WebCodecs'); assert.equal(player.videoCodec, 'hevc');
  assert.equal(player.videoLive, true);
  assert.equal(player.videoCodecString, 'hev1.1.6.H183.90');
  assert.equal(player.videoWidth, 4096); assert.equal(player.videoHeight, 4096);
  assert.equal(element.width, 2048); assert.equal(element.height, 2048);
  assert.equal(player.channels, 4); assert.equal(player.sampleRate, 44100); assert.equal(player.codec, 'flac');
  assert.equal(player.currentTime, 7); assert.equal(player.duration, 20); assert.equal(player.epoch, 0);
  assert.equal(messages.at(-1).type, 'drop-audio');
});

test('live stream startup and seek hold consumed PCM until the matching video frame arrives', async () => {
  const bundle = buildSync({ entryPoints: [require.resolve('../src/stream-player.js')],
    bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text;
  const module = { exports: {} };
  vm.runInNewContext(bundle, { module, exports: module.exports, window: {}, EventTarget, Event, AbortController,
    fetch, performance });
  const { StreamPlayer } = module.exports;
  StreamPlayer.prototype.load = StreamPlayer.prototype.startEnvelope = () => {};
  const player = new StreamPlayer({ dataset: {}, getContext: () => ({ drawImage() {} }) });
  const messages = [];
  player.worker = { postMessage() {} };
  player.node = { port: { postMessage: message => messages.push(message) } };
  player.receive({ type: 'metadata', epoch: 0, sampleRate: 48000, channels: 6, duration: 30,
    width: 4096, height: 4096, videoLive: true, videoDecoder: 'FFmpeg/VideoToolbox live + WebCodecs' });
  const picture = (time, epoch = player.epoch) => player.receive({ type: 'video', epoch,
    time, duration: 1 / 30, frame: { close() {} } });
  await player.play(); assert.equal(player.videoBlocked, true); assert.equal(messages.at(-1).type, 'pause');
  picture(0); assert.equal(player.videoBlocked, false); assert.equal(messages.at(-1).type, 'play');
  player.time = .2; player.render(); assert.equal(player.videoBlocked, true);
  picture(.167); assert.equal(player.videoBlocked, false);
  await player.seek(20); assert.equal(player.videoBlocked, true);
  picture(10, 0); assert.equal(player.videoBlocked, true, 'Cancelled stream frames cannot resume the new seek');
  picture(20); assert.equal(player.videoBlocked, false); assert.equal(messages.at(-1).epoch, 1);
  player.pause(); const count = messages.length;
  picture(20.033); assert.equal(messages.length, count, 'Native output cannot resume user-paused audio');
});
