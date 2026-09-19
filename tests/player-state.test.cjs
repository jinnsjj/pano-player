const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function setup(saved = {}) {
  let persisted, onMap, onError;
  const elements = new Map(), messages = [], listeners = {};
  const get = id => {
    if (!elements.has(id)) elements.set(id, {
      value: '.75', checked: true, paused: true, currentTime: 0, duration: 10, readyState: 4,
      videoWidth: 960, videoHeight: 480, dataset: {}, style: { setProperty(k, v) { this[k] = v; } },
      listeners: {}, addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
      fire(type) { for (const fn of this.listeners[type] || []) fn(); },
      getContext: () => ({ clearRect() {}, putImageData() {} }), setAttribute() {}, removeAttribute() {}, load() {},
      pause() { this.paused = true; }, play() { this.paused = false; return Promise.resolve(); },
    });
    return elements.get(id);
  };
  const window = { addEventListener(type, fn) { listeners[type] = fn; } };
  window.StreamPlayer = class { constructor(element) { return element; } };
  window.FoaMonitor = class {
    generation = 0; ready = false;
    constructor(video, error, map) { onError = error; onMap = map; }
    prepare() { return new Promise(() => {}); }
    resume() { return this.prepare(); }
    reset() { this.generation++; }
    setOrder(order) { this.order = order; this.reset(); }
    setNormalization(value) { this.normalization = value; this.reset(); }
    setEnabled(value) { this.enabled = value; this.reset(); }
    setVolume() {} setMode() {} dispose() {} getState() { return { ready: false }; }
  };
  window.FoaView = class {
    configure(active) { this.active = active; } mapChanged() {} sourceChanged() {} render() {} dispose() {} reset() {}
    getState() { return { active: this.active }; }
  };
  window.PanoProjection = class {
    configure(projection, layout) { get('projected').configuration = { projection, layout }; }
    render() { return false; } dispose() {}
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../media/player.js'), 'utf8'), {
    window, document: { getElementById: get }, performance,
    acquireVsCodeApi: () => ({ getState: () => saved, setState(value) { persisted = value; }, postMessage: m => messages.push(m) }),
    lucide: { createIcons() {} }, requestAnimationFrame() {}, Uint8ClampedArray, ImageData: class {},
  });
  return { get, messages, onMap, onError, persisted: () => persisted, state: () => window.__FOA_POWERMAP__.getState() };
}
test('native controls and playback do not await a stalled DSP initializer', () => {
  const s = setup(), video = s.get('video');
  assert.equal(s.state().ready, true); assert.equal(s.state().listening.ready, false);
  assert.equal(s.get('play').disabled, false);
  s.get('play').fire('click'); assert.equal(video.paused, false);
  s.onError(new Error('Worker unavailable'));
  assert.equal(video.paused, false); assert.equal(s.get('empty').hidden, true);
  assert.match(s.get('detail').textContent, /Worker unavailable/);
  assert.ok(s.messages.every(message => message.type === 'diagnostic'));
});
test('level readouts follow persisted opacity and native slider input', () => {
  const s = setup({ opacity: .42 });
  assert.equal(s.get('opacity-value').textContent, '42%');
  s.get('opacity').value = '1'; s.get('opacity').fire('input');
  assert.equal(s.get('opacity-value').textContent, '100%');
  assert.equal(s.persisted().opacity, 1);
  s.get('volume').value = '.25'; s.get('volume').fire('input');
  assert.equal(s.get('volume-value').textContent, '25%');
});
test('spatial tabs and 180 ERP preserve the clock and full map domain', () => {
  const s = setup(), v = s.get('video'); v.currentTime = 4; v.paused = false;
  const before = s.state().generation;
  s.get('view-spatial').fire('click');
  assert.equal(s.state().view.active, true); assert.equal(v.hidden, true);
  assert.equal(s.get('view-spatial').tabIndex, 0); assert.equal(s.get('view-flat').tabIndex, -1);
  s.get('view-flat').fire('click'); assert.equal(v.hidden, false);
  v.videoWidth = v.videoHeight = 480; v.fire('loadedmetadata');
  assert.equal(s.get('projection').value, '180');
  assert.equal(s.get('stage').style['--video-aspect'], '2');
  assert.equal(s.get('stage').style['--video-left'], '25%');
  assert.equal(s.get('stage').style['--video-width'], '50%');
  assert.equal(v.currentTime, 4); assert.equal(v.paused, false); assert.equal(s.state().generation, before);
});
test('native metadata infers projection and preserves WAV and arbitrary aspect ratios', () => {
  for (const [width, height, projection] of [[900, 1000, '180'], [1100, 1000, '180'], [1120, 1000, '360'], [1920, 1080, '360'], [270, 480, '360'], [0, 0, '360']]) {
    const s = setup({ projection: '180' }), v = s.get('video');
    v.videoWidth = width; v.videoHeight = height; v.fire('loadedmetadata');
    assert.equal(s.get('projection').value, projection);
    assert.equal(s.get('projection').disabled, width === 0);
    assert.equal(s.get('stage').style['--video-aspect'], String(width ? width / height * (projection === '180' ? 2 : 1) : 2));
    if (!width) { assert.equal(v.hidden, true); assert.match(s.get('detail').textContent, /Audio/); }
    s.get('opacity').fire('input'); assert.equal(s.persisted().projection, undefined);
  }
});
test('mono/stereo disable FOA controls while retaining Spatial view and transport', () => {
  for (const channels of [1, 2]) {
    const s = setup(), video = s.get('video');
    video.channels = channels; video.currentTime = 4; video.paused = false;
    video.fire('loadedmetadata');
    for (const id of ['enabled', 'opacity', 'order', 'normalization', 'listening']) assert.equal(s.get(id).disabled, true);
    assert.equal(s.get('listening').value, 'bypass');
    assert.equal(s.get('music-badge').hidden, true);
    assert.match(s.get('detail').textContent, /Bypass/);
    assert.equal(s.get('enabled').checked, false);
    s.get('view-spatial').fire('click');
    assert.equal(s.state().view.active, true);
    assert.equal(video.currentTime, 4); assert.equal(video.paused, false);
    assert.equal(s.get('play').disabled, false);
    video.videoWidth = video.videoHeight = 0; video.fire('loadedmetadata');
    assert.equal(s.get('audio-poster').hidden, false);
    assert.equal(s.get('audio-format').textContent, channels === 1 ? 'Mono audio' : 'Stereo audio');
  }
});
test('EAC and single-eye ERP layouts preserve audio clock, full overlay and Spatial tabs', () => {
  const s = setup(), video = s.get('video');
  video.currentTime = 4; video.paused = false;
  const generation = s.state().generation;
  for (const [projection, layout, width, height, aspect] of [
    ['360', 'sbs', 1920, 480, 2], ['360', 'tb', 960, 960, 2],
    ['180', 'sbs', 960, 480, 2], ['180', 'tb', 480, 960, 2],
    ['eac', 'mono', 960, 540, 2], ['eac', 'sbs', 1920, 540, 2],
  ]) {
    video.videoWidth = width; video.videoHeight = height; video.fire('loadedmetadata');
    s.get('projection').value = projection; s.get('layout').value = layout; s.get('layout').fire('change');
    assert.deepEqual(s.get('projected').configuration, { projection, layout });
    assert.equal(s.get('stage').style['--video-aspect'], String(aspect));
    assert.equal(video.hidden, true); assert.equal(s.get('projected').hidden, false);
    assert.equal(s.get('overlay').hidden, false);
    s.get('view-spatial').fire('click');
    assert.equal(s.get('projected').hidden, true); assert.equal(s.state().view.active, true);
    s.get('view-flat').fire('click');
    assert.equal(video.currentTime, 4); assert.equal(video.paused, false); assert.equal(s.state().generation, generation);
  }
  s.get('projection').value = '360'; s.get('layout').value = 'mono'; s.get('layout').fire('change');
  assert.equal(video.hidden, false); assert.equal(s.get('projected').hidden, true);
});
test('seek, order change and overlay disable reject stale maps without reopening media', () => {
  const s = setup(), v = s.get('video');
  const map = { generation: 0, time: 0, rgba: new Uint8ClampedArray(39200), computeMs: 1 };
  s.onMap(map); assert.equal(s.state().received, 1);
  v.fire('seeking'); s.onMap(map); assert.equal(s.state().received, 1);
  v.paused = false; v.currentTime = 4;
  s.get('order').value = 'WXYZ'; s.get('order').fire('change');
  assert.equal(v.paused, false); assert.equal(v.currentTime, 4);
  s.get('normalization').value = 'N3D'; s.get('normalization').fire('change');
  s.onMap({ ...map, generation: s.state().generation - 1 });
  assert.equal(s.state().mappedAt, null);
  assert.equal(v.paused, false); assert.equal(v.currentTime, 4);
  s.get('enabled').checked = false; s.get('enabled').fire('change');
  s.onMap({ ...map, generation: s.state().generation, time: 4 });
  assert.equal(s.state().mappedAt, null);
});
