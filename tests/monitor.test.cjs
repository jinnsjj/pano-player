const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { buildSync } = require('esbuild');
function monitor(globals = {}) {
  const module = { exports: {} };
  const built = buildSync({ entryPoints: [require.resolve('../src/browser-monitor.js')], bundle: true, write: false, format: 'cjs', logLevel: 'silent' });
  vm.runInNewContext(built.outputFiles[0].text, { module, exports: module.exports, AbortController, performance, console, URL, Float32Array, ...globals });
  const video = { paused: false, seeking: false, readyState: 4, currentTime: 2, listeners: {},
    addEventListener(type, fn) { this.listeners[type] = fn; } };
  const errors = [], maps = [];
  const m = new module.exports.FoaMonitor(video, error => errors.push(error.message), map => maps.push(map));
  return { m, video, errors, maps };
}
test('track switching rebuilds audio routes, clears analysis and preserves preferences and play state', async () => {
  for (const paused of [false, true]) {
    const { m, video } = monitor();
    let closed = 0, released = 0, initialized = 0;
    video.paused = paused; video.audioTrackIndex = 0;
    video.audioTracks = [{ supported: true }, { supported: true }];
    video.pause = () => { video.paused = true; };
    video.play = async () => { video.paused = false; };
    video.selectAudioTrack = async index => { video.audioTrackIndex = index; video.channels = 4; };
    m.context = { close: async () => { closed++; } };
    m.service = { dispose() { released++; }, reset() {} };
    m.bypass = true; m.ready = true; m.meterData = { duration: 9 }; m.headlocked = {};
    m.volume = .4; m.muted = true; m.order = 'WXYZ'; m.normalization = 'N3D';
    m.initialize = async () => {
      assert.equal(m.bypass, false); assert.equal(m.source, undefined); assert.equal(m.service, undefined);
      assert.equal(m.headlocked, undefined);
      initialized++; m.ready = true; m.channelCount = video.channels;
    };
    await m.selectAudioTrack(1);
    assert.equal(closed, 1); assert.equal(released, 1); assert.equal(initialized, 1);
    assert.equal(video.paused, paused); assert.equal(video.currentTime, 2);
    assert.equal(m.channelCount, 4); assert.equal(m.meterData, null);
    assert.equal(m.volume, .4); assert.equal(m.muted, true);
    assert.equal(m.order, 'WXYZ'); assert.equal(m.normalization, 'N3D');
    await m.selectAudioTrack(1); assert.equal(initialized, 1);
    await assert.rejects(m.selectAudioTrack(-1), /Unsupported/);
  }
});
test('non-FOA channel counts attach straight to gain without initializing FOA DSP and remain camera-independent', async () => {
  for (const channels of [1, 2, 3, 8, 16, 32]) {
    const { m, video, errors } = monitor({ AudioContext: class {
      createGain() { return { gain: {}, connections: [], connect(node) { this.connections.push(node); } }; }
      async resume() {} async suspend() {}
    } });
    video.metadata = Promise.resolve(); video.channels = channels;
    let attached;
    video.attach = async (context, destination) => { attached = destination; video.node = {}; };
    await m.prepare();
    assert.deepEqual(errors, []);
    const gain = m.fallback;
    assert.equal(attached, gain);
    assert.ok(gain.connections.includes(m.meterInput));
    assert.equal(m.meterInput.channelCount, 2);
    assert.equal(m.meterInput.channelCountMode, 'explicit');
    assert.equal(m.meterNode, undefined, 'A closed overlay must not load the meter worklet');
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
test('FOA+HL routes stereo output separately from rotation and follows volume, mute and meter', async () => {
  class Node {
    gain = {}; connections = []; port = { postMessage() {} };
    connect(...args) { this.connections.push(args); }
    addEventListener() {}
  }
  for (const channels of [4, 6]) {
    const renderer = { input: new Node(), output: new Node(), async initialize() {}, setRotationMatrixFromCamera() {} };
    const { m, video, errors } = monitor({ Blob, fetch: async () => ({ ok: true, text: async () => '' }),
      AudioContext: class {
        destination = new Node(); audioWorklet = { async addModule() {} }; sampleRate = 48000;
        createGain() { return new Node(); }
        createChannelSplitter() { return new Node(); }
        createChannelMerger() { return new Node(); }
        async resume() {} async suspend() {}
      },
      AudioWorkletNode: class extends Node { constructor(context, name, options) { super(); this.options = options; } },
      Omnitone: { createFOARenderer: () => renderer },
    });
    video.channels = channels; video.metadata = Promise.resolve(); video.dataset = { worklet: 'test' };
    video.attach = async (_, destination) => { assert.equal(destination, m.capture); video.node = new Node(); };
    m.initializeMap = async () => {};
    await m.prepare();
    assert.deepEqual(errors, []);
    assert.equal(m.bypass, undefined);
    assert.deepEqual(Array.from(m.capture.options.outputChannelCount), [4, 2]);
    assert.ok(m.capture.connections.some(([node, output]) => node === m.headlocked && output === 1));
    assert.ok(m.headlocked.connections.some(([node]) => node === m.context.destination));
    assert.ok(m.headlocked.connections.some(([node]) => node === m.meterInput));
    assert.ok(!m.headlocked.connections.some(([node]) => node === renderer.input));
    assert.equal(m.headlocked.gain.value, 0);
    await m.frame({ type: 'frame', channelCount: channels, channels: [], epoch: m.generation });
    assert.equal(m.getState().channels, channels);
    m.setVolume(.4);
    for (const mode of ['binaural', 'stereo']) {
      m.setMode(mode); m.setOrientation({}); m.setNormalization('N3D'); m.setOrder('WXYZ');
      assert.equal(m.headlocked.gain.value, channels === 6 ? .4 : 0);
      m.setMuted(true); assert.equal(m.headlocked.gain.value, 0);
      m.setMuted(false); assert.equal(m.headlocked.gain.value, channels === 6 ? .4 : 0);
    }
    await m.frame({ type: 'error', channelCount: 2, epoch: m.generation });
    assert.equal(m.headlocked.gain.value, 0);
  }
});
test('meter statistics reset on discontinuities, not gain changes, and disable when closed', () => {
  const { m, video } = monitor();
  const messages = []; let preparations = 0;
  m.prepareMeter = () => { preparations++; };
  m.context = { state: 'running', resume: async () => {} };
  m.meterNode = { port: { postMessage: value => messages.push(value) } };
  m.setMeterEnabled(true);
  assert.equal(preparations, 1); assert.equal(messages.at(-1).enabled, true);
  const data = { duration: 5 }; m.meterData = data;
  m.setVolume(.5); m.setMuted(true);
  assert.equal(m.getMeterState().data, data, 'Historical maxima survive volume/mute changes');
  video.paused = true; assert.equal(m.getMeterState().active, false); video.paused = false;
  for (const reset of [() => video.listeners.seeking(), () => video.listeners.play(),
    () => m.setMode('stereo'), () => m.setOrder('WXYZ'), () => m.setNormalization('N3D')]) {
    m.meterData = data; const epoch = m.meterEpoch; reset();
    assert.equal(m.meterData, null); assert.equal(m.meterEpoch, epoch + 1);
  }
  m.setMeterEnabled(false);
  assert.equal(messages.at(-1).enabled, false); assert.equal(m.meterData, null);
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
test('PowerMap changes forward the method/source count and discard old results without resetting audio meters', async () => {
  const { m, video, maps } = monitor();
  const requests = []; let finish;
  m.context = { sampleRate: 48000 };
  m.service = { reset() {}, requestMap(session, time, options) {
    requests.push(options); return new Promise(resolve => { finish = resolve; });
  } };
  m.setEnabled(true); m.meterData = { duration: 3 };
  const before = m.generation;
  m.setPowermap('invalid', 1); m.setPowermap('music', 3);
  assert.equal(m.generation, before);
  const pending = m.frame({ type: 'frame', epoch: m.generation, channels: [] });
  assert.equal(requests.at(-1).algorithm, 'music'); assert.equal(requests.at(-1).numSources, 1);
  m.setPowermap('pwd', 2); finish({ map: new Float32Array(9800) }); await pending;
  assert.equal(maps.length, 0);
  const next = m.frame({ type: 'frame', epoch: m.generation, channels: [] });
  assert.equal(requests.at(-1).algorithm, 'pwd'); assert.equal(requests.at(-1).numSources, 2);
  finish({ map: new Float32Array(9800) }); await next; assert.equal(maps.length, 1);
  assert.equal(m.meterData.duration, 3); assert.equal(video.currentTime, 2); assert.equal(video.paused, false);
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
