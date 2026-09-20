const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { buildSync } = require('esbuild');
function monitor(globals = {}) {
  const module = { exports: {} };
  const built = buildSync({ entryPoints: [require.resolve('../src/browser-monitor.js')], bundle: true, write: false, format: 'cjs', logLevel: 'silent' });
  vm.runInNewContext(built.outputFiles[0].text, { module, exports: module.exports, AbortController, performance, console, URL, ...globals });
  const video = { paused: false, seeking: false, readyState: 4, currentTime: 2, listeners: {},
    addEventListener(type, fn) { this.listeners[type] = fn; } };
  const errors = [], maps = [];
  const m = new module.exports.FoaMonitor(video, error => errors.push(error.message), map => maps.push(map));
  return { m, video, errors, maps };
}
test('mono/stereo attach straight to gain without initializing FOA DSP and remain camera-independent', async () => {
  for (const channels of [1, 2]) {
    const gain = { gain: {}, connect() {} };
    const { m, video, errors } = monitor({ AudioContext: class {
      createGain() { return gain; }
      async resume() {} async suspend() {}
    } });
    video.metadata = Promise.resolve(); video.channels = channels;
    let attached;
    video.attach = async (context, destination) => { attached = destination; video.node = {}; };
    await m.prepare();
    assert.deepEqual(errors, []);
    assert.equal(attached, gain);
    assert.equal(m.getState().mode, 'bypass');
    assert.equal(m.getState().channels, channels);
    assert.equal(m.renderer, undefined); assert.equal(m.capture, undefined); assert.equal(m.service, undefined);
    m.setVolume(.4); assert.equal(gain.gain.value, .4);
    m.setOrientation({ elements: [1, 0, 0, 1] });
    m.setMode('binaural'); m.setOrder('WXYZ'); m.setNormalization('N3D');
    assert.equal(gain.gain.value, .4);
    m.setMuted(true); assert.equal(gain.gain.value, 0);
    m.setMuted(false); assert.equal(gain.gain.value, .4);
    assert.equal(video.currentTime, 2); assert.equal(video.paused, false);
  }
});
test('normalization changes reset stale frames without reopening media', async () => {
  const { m, video } = monitor();
  const messages = [];
  m.capture = { port: { postMessage: value => messages.push(value) } };
  assert.equal(m.normalization, 'SN3D');
  m.setNormalization('N3D');
  assert.equal(messages.at(-1).normalization, 'N3D');
  assert.equal(m.getState().normalization, 'N3D');
  await m.frame({ type: 'frame', epoch: 0, channels: [] });
  assert.equal(m.ready, false);
  assert.equal(video.paused, false);
  assert.equal(video.currentTime, 2);
  m.setNormalization('FuMa');
  assert.equal(m.normalization, 'N3D');
  assert.equal(m.generation, 1);
});
test('video without audio never initializes AudioContext, worklets or spatial DSP', async () => {
  let contexts = 0;
  const { m, video, errors } = monitor({ AudioContext: class { constructor() { contexts++; throw new Error('Audio unavailable'); } } });
  video.metadata = Promise.resolve(); video.channels = 0;
  video.attach = () => { throw new Error('Unexpected audio attach'); };
  video.fail = error => errors.push(error.message);
  await m.prepare(); await m.resume();
  assert.equal(contexts, 0); assert.deepEqual(errors, []);
  assert.equal(m.getState().state, 'no-audio'); assert.equal(m.getState().clock, 'video');
  assert.equal(m.renderer, undefined); assert.equal(m.ready, true);
});
test('single native clock routes exactly one monitor and honors volume, mute and rotation', () => {
  const { m, video } = monitor();
  m.source = {}; m.output = { gain: {} }; m.fallback = { gain: {} }; m.stereo = { gain: {} };
  m.setVolume(.4);
  assert.equal(m.fallback.gain.value, .4); assert.equal(m.output.gain.value, 0);
  m.ready = true; m.applyGain();
  assert.equal(m.output.gain.value, .4); assert.equal(m.fallback.gain.value, 0); assert.equal(video.volume, 1);
  m.setMode('stereo');
  assert.equal(m.output.gain.value, 0); assert.equal(m.stereo.gain.value, .4);
  m.setMuted(true); assert.equal(m.stereo.gain.value, 0);
  m.setMuted(false); assert.equal(m.stereo.gain.value, .4);
  const matrix = { elements: [1, 0, 0, 1] }; let rotated;
  m.renderer = { setRotationMatrixFromCamera(value) { rotated = value; } };
  m.setOrientation(matrix); assert.equal(rotated, matrix);
  assert.equal(m.getState().clock, 'native-media'); assert.equal(m.audio, undefined);
  assert.equal(m.getState().time, video.currentTime);
});
test('paused and hidden tabs suspend the audio thread rather than accumulating idle work', async () => {
  const { m, video } = monitor(); let resumes = 0, suspends = 0;
  m.context = { resume: async () => resumes++, suspend: async () => suspends++ };
  video.listeners.pause(); video.listeners.play(); video.listeners.ended();
  assert.equal(resumes, 1); assert.equal(suspends, 2);
});
test('playback restarts channel validation after ignoring a paused decoder error', async () => {
  const { m, video, errors } = monitor(); const messages = [];
  m.capture = { port: { postMessage: value => messages.push(value) } };
  video.paused = true;
  await m.frame({ type: 'error', epoch: 0, channelCount: 2 });
  assert.equal(errors.length, 0);
  video.paused = false; video.listeners.playing();
  assert.equal(messages.at(-1)?.type, 'reset');
  await m.frame({ type: 'error', epoch: m.generation, channelCount: 2 });
  assert.match(errors[0], /2 channels/);
});
test('channel errors distinguish captured channels from codec support without promising audible fallback', async () => {
  const { m, video, errors } = monitor();
  video.currentSrc = 'https://file.example/target_foa.mp4?version=1';
  video.canPlayType = () => '';
  await m.frame({ type: 'error', epoch: 0, channelCount: 2 });
  assert.match(errors[0], /Web Audio exposes 2 channels/);
  assert.match(errors[0], /does not support AAC/);
  assert.doesNotMatch(errors[0], /decoded|audio remains available/);
  video.canPlayType = () => 'probably';
  await m.frame({ type: 'error', epoch: 0, channelCount: 2 });
  assert.doesNotMatch(errors[1], /does not support AAC/);
  video.currentSrc = 'https://file.example/stereo.wav';
  video.canPlayType = () => '';
  await m.frame({ type: 'error', epoch: 0, channelCount: 2 });
  assert.doesNotMatch(errors[2], /does not support AAC/);
  assert.equal(video.paused, false);
});
test('non-FOA channels retain fallback playback; old worklet frames cannot cross seeks or order changes', async () => {
  const { m, video, errors, maps } = monitor();
  m.source = {}; m.output = { gain: {} }; m.fallback = { gain: {} }; m.stereo = { gain: {} };
  await m.frame({ type: 'error', epoch: 0, channelCount: 2 });
  assert.equal(m.ready, false); assert.equal(m.fallback.gain.value, 1);
  assert.match(errors[0], /2 channels/); assert.equal(video.paused, false);
  const messages = []; m.capture = { port: { postMessage: value => messages.push(value) } };
  m.setOrder('WXYZ');
  assert.deepEqual(Array.from(messages.at(-1).channelMap), [0, 2, 3, 1]);
  assert.equal(messages.at(-1).epoch, 1);
  await m.frame({ type: 'frame', epoch: 0, channels: [] });
  assert.equal(m.ready, false);
  await m.frame({ type: 'frame', epoch: 1, channels: [] });
  assert.equal(m.ready, true);
  let finish; m.context = { sampleRate: 48000 };
  m.service = { requestMap: () => new Promise(resolve => { finish = resolve; }), reset() {} };
  assert.equal(m.enabled, false);
  await m.frame({ type: 'frame', epoch: 1, channels: [] });
  assert.equal(finish, undefined);
  m.setEnabled(true);
  const pending = m.frame({ type: 'frame', epoch: m.generation, channels: [] });
  m.reset(); finish({ map: new Float32Array(9800) }); await pending;
  assert.equal(maps.length, 0);
});
