const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { buildSync } = require('esbuild');
const { defaults, normalize } = require('../src/preferences.cjs');
function setup(saved = {}) {
  let persisted, onMap, onError, frame;
  const elements = new Map(), messages = [], listeners = {};
  const get = id => {
    if (!elements.has(id)) elements.set(id, {
      value: '.75', checked: true, paused: true, currentTime: 0, duration: 10, readyState: 4,
      audioTracks: [], selectedOptions: [], replaceChildren(...options) { this.options = options; },
      videoWidth: 960, videoHeight: 480, dataset: { defaults: JSON.stringify(defaults), preferences: JSON.stringify(normalize(saved)) }, style: { setProperty(k, v) { this[k] = v; } },
      listeners: {}, addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
      fire(type, event = {}) { for (const fn of this.listeners[type] || []) fn(event); },
      width: 2048, height: 1024,
      getContext: () => ({ clearRect() {}, putImageData() {}, save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, strokeText() {}, fillText() {} }),
      attributes: {}, setAttribute(name, value) { this.attributes[name] = value; }, removeAttribute() {}, load() {}, render() {},
      querySelectorAll() { return []; }, focus() {},
      showPopover() { this.popoverOpen = true; this.fire('toggle'); }, hidePopover() { this.popoverOpen = false; this.fire('toggle'); },
      matches(selector) { return selector === ':popover-open' && Boolean(this.popoverOpen); },
      contains(target) { return target === this; },
      getBoundingClientRect() { return { x: 100, y: 76, top: 76, bottom: 224, right: 340, width: 240, height: 148 }; },
      pause() { this.paused = true; }, play() { this.paused = false; return Promise.resolve(); },
    });
    return elements.get(id);
  };
  const window = { innerWidth: 1280, innerHeight: 800, addEventListener(type, fn) { listeners[type] = fn; } };
  window.StreamPlayer = class { constructor(element) { return element; } };
  window.FoaMonitor = class {
    generation = 0; ready = false;
    constructor(video, error, map) { onError = error; onMap = map; }
    prepare() { return new Promise(() => {}); }
    resume() { return this.prepare(); }
    reset() { this.generation++; }
    async selectAudioTrack(index) { get('video').audioTrackIndex = index; }
    setOrder(order) { this.order = order; this.reset(); }
    setNormalization(value) { this.normalization = value; this.reset(); }
    setEnabled(value) { this.enabled = value; this.reset(); }
    setPowermap(algorithm, sources) { this.mapAlgorithm = algorithm; this.mapSources = sources; this.reset(); }
    setVolume(value) { this.volume = value; } setMode(value) { this.mode = value; }
    setMuted(value) { this.muted = value; } dispose() {} getState() { return { ready: false, mode: this.mode, volume: this.volume, muted: this.muted }; }
    setMeterEnabled(enabled) { this.meterEnabled = enabled; }
    resetMeter() { this.meterData = null; }
    getMeterState() { return { data: this.meterData, active: true, status: 'ready' }; }
  };
  window.FoaView = class {
    setGridEnabled(enabled) { this.grid = enabled; }
    setOverviewEnabled(enabled) { this.overview = enabled; }
    configure(active) { this.active = active; } mapChanged() {} sourceChanged() {} render() {} dispose() {} reset() {}
    restore({ yaw, pitch, fov }) { this.camera = { yaw, pitch, fov }; }
    getState() { return { active: this.active, grid: this.grid, overview: this.overview, ...this.camera }; }
  };
  window.PanoProjection = class {
    configure(projection, layout, rotation) { get('projected').configuration = { projection, layout, rotation }; }
    render() { return false; } dispose() {}
  };
  vm.runInNewContext(buildSync({ entryPoints: [require.resolve('../media/player.js')], bundle: true, write: false }).outputFiles[0].text, {
    window, document: { getElementById: get }, performance,
    Option: class { constructor(text, value) { this.textContent = text; this.value = value; } },
    acquireVsCodeApi: () => ({ getState: () => saved, setState(value) { persisted = value; }, postMessage: m => messages.push(m) }),
    lucide: { createIcons() {} }, requestAnimationFrame(fn) { frame = fn; }, Uint8ClampedArray, ImageData: class {},
  });
  return { get, messages, onMap, onError, tick: now => frame(now), monitor: window.__PANO_PLAYER__.monitor,
    persisted: () => persisted, state: () => window.__PANO_PLAYER__.getState() };
}
test('audio track selector lists metadata safely, hides for single tracks and does not persist selection', async () => {
  const s = setup(), video = s.get('video');
  assert.equal(s.get('audio-track-control').hidden, true);
  video.audioTracks = [
    { index: 0, name: '<Stereo>', language: 'eng', channels: 2, codec: 'aac', supported: true },
    { index: 1, name: 'FOA', language: 'und', channels: 4, codec: 'opus', supported: true },
    { index: 2, name: 'Surround', channels: 6, supported: false },
  ];
  video.audioTrackIndex = 0; video.fire('loadedmetadata');
  assert.equal(s.get('audio-track-control').hidden, false);
  assert.match(s.get('audio-track').options[0].textContent, /<Stereo>.*eng.*2ch.*aac/);
  assert.equal(s.get('audio-track').options[2].disabled, true);
  s.get('audio-track').value = '1';
  await s.get('audio-track').listeners.change[0]();
  assert.equal(video.audioTrackIndex, 1); assert.equal(s.get('audio-track').disabled, false);
  assert.equal(s.messages.some(message => message.type === 'preferences'), false);
});
test('meter overlay independently persists, closes, resets, and displays held peaks separately from RMS', () => {
  const s = setup();
  assert.equal(s.get('meter-overlay').hidden, true);
  assert.equal(s.monitor.meterEnabled, false);
  s.get('meter').checked = true; s.get('meter').fire('change');
  assert.equal(s.persisted().meter, true); assert.equal(s.get('meter-overlay').hidden, false);
  s.monitor.meterData = { duration: 5, channels: [{ peak: -24, heldPeak: -6, truePeak: -23, heldTruePeak: 1, clips: 0, trueClips: 3 },
    { peak: -24, heldPeak: -6, truePeak: -23, heldTruePeak: -5, clips: 0, trueClips: 0 }],
    rmsMomentary: -30, rmsIntegrated: -32, lufsMomentary: -29, lufsShort: -28, lufsIntegrated: -31,
    lra: 4, lraLow: -32, lraHigh: -28 };
  s.tick(0);
  assert.equal(s.get('meter-peak-0-value').textContent, '-24.0');
  assert.equal(s.get('meter-peak-0-max').textContent, '-6.0');
  assert.equal(s.get('meter-rms-m-value').textContent, '-30.0');
  assert.equal(s.get('meter-true-0').dataset.clipping, 'true');
  assert.equal(s.get('meter-true-0-clips').textContent, '3');
  assert.equal(s.get('meter-true-0-value').title, '-23.0 dBTP, maximum 1.0 dBTP, 3 clipped samples');
  assert.equal(s.get('meter-lra-value').textContent, '4.0');
  assert.ok(parseFloat(s.get('meter-peak-0').style['--peak']) > parseFloat(s.get('meter-peak-0').style['--level']));
  s.get('meter-reset').fire('click'); s.tick(50);
  assert.equal(s.get('meter-peak-0-hold').hidden, true);
  assert.equal(s.get('meter-rms-m-value').textContent, '--');
  assert.equal(s.get('video').paused, true);
  s.get('video').channels = 0; s.get('video').fire('loadedmetadata');
  assert.equal(s.get('meter-overlay').hidden, true); assert.equal(s.get('meter').disabled, true);
  assert.equal(s.persisted().meter, true);
  s.get('video').channels = 2; s.get('video').fire('loadedmetadata');
  assert.equal(s.get('meter-overlay').hidden, false);
  s.get('meter-close').fire('click');
  assert.equal(s.get('meter-overlay').hidden, true); assert.equal(s.persisted().meter, false);
  assert.equal(s.monitor.meterEnabled, false);
  assert.equal(setup({ meter: true }).get('meter-overlay').hidden, false);
});
test('native meter help never opens on hover or focus and dismisses without closing meters', () => {
  const s = setup({ meter: true }), button = s.get('meter-help-button'), help = s.get('meter-help');
  button.fire('pointerenter'); button.fire('focus');
  assert.equal(help.matches(':popover-open'), false);
  help.showPopover();
  assert.equal(help.style.left, '100px'); assert.equal(help.style.top, '228px');
  button.fire('pointerleave'); button.fire('blur'); help.fire('pointerleave');
  assert.equal(help.popoverOpen, true);
  let prevented = false, stopped = false;
  s.get('meter-overlay').listeners.keydown.at(-1)({ key: 'Escape', preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
  assert.equal(prevented && stopped, true); assert.equal(help.popoverOpen, false);
  assert.equal(s.get('meter-overlay').hidden, false);
  help.showPopover();
  s.get('meter-close').fire('click'); assert.equal(help.popoverOpen, false);
  assert.equal(s.get('video').paused, true);
});
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
test('all sliders suppress pointer focus rings and restore keyboard focus without blurring', () => {
  const s = setup();
  for (const id of ['seek', 'volume', 'opacity', 'gridOpacity']) {
    const slider = s.get(id);
    slider.blur = () => { throw new Error('Pointer interaction must retain slider focus'); };
    slider.fire('pointerdown'); assert.equal(slider.dataset.pointerFocus, '');
    slider.fire('keydown'); assert.equal(slider.dataset.pointerFocus, undefined);
    slider.fire('pointerdown'); slider.fire('blur');
    assert.equal(slider.dataset.pointerFocus, undefined);
  }
});
test('panorama overview is an independent persisted overlay available in Perspective', () => {
  const s = setup({ meter: true });
  assert.equal(s.get('overview').checked, true);
  assert.equal(s.get('overview').disabled, true);
  assert.equal(s.get('overview-overlay').hidden, true);
  s.get('view-spatial').fire('click');
  assert.equal(s.get('overview').disabled, false);
  assert.equal(s.get('overview-overlay').hidden, false);
  assert.equal(s.state().view.overview, true);
  s.get('overview-close').fire('click');
  assert.equal(s.persisted().overview, false);
  assert.equal(s.get('overview').checked, false);
  assert.equal(s.state().view.overview, false);
  assert.equal(s.get('meter-overlay').hidden, false);
  assert.equal(setup(s.persisted()).get('overview-overlay').hidden, true);
  s.get('overview').checked = true; s.get('overview').fire('change');
  assert.equal(s.get('overview-overlay').hidden, false);
  s.get('view-flat').fire('click');
  assert.equal(s.get('overview-overlay').hidden, true);
  assert.equal(s.persisted().overview, true, 'View switches must not erase the toggle');
  s.get('view-spatial').fire('click');
  assert.equal(s.get('overview-overlay').hidden, false);
  const restored = setup(s.persisted());
  assert.equal(restored.get('overview-overlay').hidden, false);
  assert.equal(restored.state().view.overview, true);
  s.get('reset-settings').fire('click');
  assert.equal(s.get('overview').checked, true);
  assert.equal(s.get('overview-overlay').hidden, true, 'Default view is Panorama');
});
test('direction grid is independent of audio and PowerMap, remembered and reset in both views', () => {
  const s = setup(), video = s.get('video');
  assert.equal(s.get('grid').checked, false); assert.equal(s.get('direction-grid').hidden, true);
  video.channels = 0; video.fire('loadedmetadata');
  s.get('grid').checked = true; s.get('grid').fire('change');
  assert.equal(s.persisted().grid, true); assert.equal(s.get('direction-grid').hidden, false);
  assert.equal(s.get('enabled').checked, false);
  s.get('view-spatial').fire('click');
  assert.equal(s.get('direction-grid').hidden, true); assert.equal(s.state().view.grid, true);
  const next = setup(s.persisted());
  assert.equal(next.get('grid').checked, true); assert.equal(next.state().view.grid, true);
  next.get('view-flat').fire('click'); assert.equal(next.get('direction-grid').hidden, false);
  next.get('reset-settings').fire('click');
  assert.equal(next.get('grid').checked, false); assert.equal(next.get('direction-grid').hidden, true);
  assert.equal(next.state().view.grid, false);
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
  assert.equal(s.get('projection').value, 'auto'); assert.equal(s.state().projection, '180');
  assert.equal(s.get('stage').style['--video-aspect'], '2');
  assert.equal(s.get('stage').style['--video-left'], '25%');
  assert.equal(s.get('stage').style['--video-width'], '50%');
  assert.equal(v.currentTime, 4); assert.equal(v.paused, false); assert.equal(s.state().generation, before);
});
test('native metadata infers projection and preserves WAV and arbitrary aspect ratios', () => {
  for (const [width, height, projection] of [[900, 1000, '180'], [1100, 1000, '180'], [1120, 1000, '360'], [1920, 1080, '360'], [270, 480, '360'], [0, 0, '360']]) {
    const s = setup(), v = s.get('video');
    v.videoWidth = width; v.videoHeight = height; v.fire('loadedmetadata');
    assert.equal(s.get('projection').value, 'auto'); assert.equal(s.state().projection, width ? projection : 'audio');
    assert.equal(s.get('projection').disabled, width === 0);
    assert.equal(s.get('stage').style['--video-aspect'], String(width ? width / height * (projection === '180' ? 2 : 1) : 2));
    if (!width) { assert.equal(v.hidden, true); assert.match(s.get('detail').textContent, /Audio/); }
    s.get('opacity').fire('input'); assert.equal(s.persisted().projection, 'auto');
  }
});
test('mono/stereo disable FOA controls while retaining Spatial view and transport', () => {
  for (const channels of [1, 2]) {
    const s = setup(), video = s.get('video');
    video.channels = channels; video.currentTime = 4; video.paused = false;
    video.fire('loadedmetadata');
    for (const id of ['enabled', 'opacity', 'order', 'normalization', 'listening']) assert.equal(s.get(id).disabled, true);
    assert.equal(s.get('listening').value, 'bypass');
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
test('grid and PowerMap have independent persisted opacities and toggles', () => {
  const s = setup({ grid: true, gridOpacity: .4, opacity: .8 });
  assert.equal(s.get('gridOpacity-value').textContent, '40%');
  assert.equal(s.get('opacity-value').textContent, '80%');
  s.get('gridOpacity').value = '.2'; s.get('gridOpacity').fire('input');
  assert.equal(s.persisted().gridOpacity, .2); assert.equal(s.persisted().opacity, .8);
  s.get('enabled').checked = false; s.get('enabled').fire('change');
  assert.equal(s.get('grid').checked, true); assert.equal(s.get('direction-grid').hidden, false);
  const next = setup(s.persisted());
  assert.equal(next.get('gridOpacity-value').textContent, '20%');
  assert.equal(next.get('enabled').checked, false); assert.equal(next.get('grid').checked, true);
  next.get('reset-settings').fire('click');
  assert.equal(next.get('gridOpacity-value').textContent, '100%');
  assert.equal(next.get('opacity-value').textContent, '75%');
});
test('PowerMap method and MUSIC source count persist, reset stale maps, and keep playback and bypass settings', () => {
  const s = setup({ enabled: true }), video = s.get('video');
  video.channels = 4; video.paused = false; video.currentTime = 4; video.fire('loadedmetadata');
  const map = { generation: s.state().generation, time: 4, rgba: new Uint8ClampedArray(39200), computeMs: 1 };
  s.onMap(map);
  s.get('mapSources').value = '2'; s.get('mapSources').fire('change');
  assert.equal(s.monitor.mapSources, 2); assert.match(s.get('detail').textContent, /MUSIC.*2 sources/);
  assert.equal(s.state().mappedAt, null); s.onMap(map); assert.equal(s.state().received, 1);
  s.get('mapAlgorithm').value = 'pwd'; s.get('mapAlgorithm').fire('change');
  assert.equal(s.monitor.mapAlgorithm, 'pwd'); assert.equal(s.get('mapSources').disabled, true);
  assert.match(s.get('detail').textContent, /PWD/); assert.doesNotMatch(s.get('detail').textContent, /sources/);
  assert.equal(setup(s.persisted()).get('mapAlgorithm').value, 'pwd');
  s.get('mapAlgorithm').value = 'music'; s.get('mapAlgorithm').fire('change');
  assert.equal(s.get('mapSources').disabled, false); assert.equal(s.persisted().mapSources, 2);
  for (const channels of [0, 1, 2]) {
    video.channels = channels; video.fire('loadedmetadata');
    assert.equal(s.get('mapAlgorithm').disabled, true); assert.equal(s.get('mapSources').disabled, true);
    assert.equal(s.persisted().mapSources, 2); assert.equal(s.persisted().enabled, true);
  }
  video.channels = 4; video.fire('loadedmetadata');
  assert.equal(s.get('mapSources').disabled, false); assert.equal(s.get('enabled').checked, true);
  assert.equal(video.currentTime, 4); assert.equal(video.paused, false);
  s.get('reset-settings').fire('click');
  assert.equal(s.monitor.mapAlgorithm, 'music'); assert.equal(s.monitor.mapSources, 1);
});
test('footer combines source dimensions, channels, source sample rate and PowerMap parameters', () => {
  const s = setup(), v = s.get('video');
  v.channels = 4; v.sampleRate = 44100; v.fire('loadedmetadata');
  for (const text of ['960 × 480', '4ch', '44.1 kHz', 'MUSIC', '1 source', '140 × 70', '140 ms interval']) {
    assert.ok(s.get('detail').textContent.includes(text), text);
  }
  v.channels = 2; v.sampleRate = 48000; v.fire('loadedmetadata');
  assert.match(s.get('detail').textContent, /2ch · 48 kHz · Bypass/);
  assert.doesNotMatch(s.get('detail').textContent, /MUSIC/);
  v.channels = 0; v.sampleRate = 0; v.fire('loadedmetadata');
  assert.match(s.get('detail').textContent, /960 × 480 · No audio/);
  assert.doesNotMatch(s.get('detail').textContent, /kHz|MUSIC/);
});
test('video-only media keeps transport and Perspective, disables audio and preserves FOA preferences', () => {
  const s = setup({ listening: 'stereo', enabled: true }), video = s.get('video');
  video.channels = 0; video.fire('loadedmetadata'); video.fire('canplay');
  for (const id of ['enabled', 'opacity', 'order', 'normalization', 'listening', 'volume', 'mute']) assert.equal(s.get(id).disabled, true, id);
  assert.equal(s.get('listening').value, 'none');
  assert.equal(s.get('enabled').checked, false);
  assert.equal(s.get('play').disabled, false); assert.equal(s.get('seek').disabled, false);
  assert.match(s.get('detail').textContent, /No audio/);
  s.get('view-spatial').fire('click'); assert.equal(s.state().view.active, true);
  assert.equal(s.persisted().listening, 'stereo'); assert.equal(s.persisted().enabled, true);
  s.get('reset-settings').fire('click');
  assert.equal(s.get('listening').value, 'none'); assert.equal(s.get('mute').disabled, true);
  video.channels = 4; video.fire('loadedmetadata');
  assert.equal(s.get('listening').value, defaults.listening);
  assert.equal(s.get('enabled').checked, defaults.enabled);
  assert.equal(s.get('volume').disabled, false); assert.equal(s.get('mute').disabled, false);
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
    assert.deepEqual(s.get('projected').configuration, { projection, layout, rotation: 0 });
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
  const s = setup({ enabled: true }), v = s.get('video');
  const map = { generation: s.state().generation, time: 0, rgba: new Uint8ClampedArray(39200), computeMs: 1 };
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
test('source rotation changes aspect before eye selection, persists and resets without touching audio or time', () => {
  const s = setup(), video = s.get('video');
  video.currentTime = 4; video.paused = false;
  const generation = s.state().generation;
  for (const rotation of ['90', '180', '270', '0']) {
    s.get('rotation').value = rotation; s.get('rotation').fire('change');
    assert.equal(s.persisted().rotation, rotation);
    assert.equal(s.get('stage').style['--video-aspect'], Number(rotation) % 180 ? '0.5' : '2');
    assert.equal(!!video.displayElement, rotation !== '0');
    if (rotation !== '0') assert.equal(s.get('projected').configuration.rotation, Number(rotation));
    assert.equal(video.currentTime, 4); assert.equal(video.paused, false);
    assert.equal(s.state().generation, generation);
  }
  s.get('rotation').value = '90'; s.get('rotation').fire('change');
  video.videoWidth = 480; video.videoHeight = 960; video.fire('loadedmetadata');
  s.get('layout').value = 'sbs'; s.get('layout').fire('change');
  assert.equal(s.state().projection, '180');
  s.get('view-spatial').fire('click');
  const next = setup(s.persisted());
  assert.equal(next.get('rotation').value, '90');
  assert.equal(next.state().view.active, true);
  next.get('video').videoWidth = next.get('video').videoHeight = 0;
  next.get('video').fire('loadedmetadata');
  assert.equal(next.get('rotation').disabled, true);
  assert.equal(next.state().preferences.rotation, '90');
  next.get('reset-settings').fire('click');
  assert.equal(next.get('rotation').value, '0');
});
test('all preferences restore across media and resetting defaults preserves the playback clock', () => {
  const chosen = { projection: '180', layout: 'tb', view: 'spatial', listening: 'stereo', order: 'WXYZ',
    normalization: 'N3D', enabled: false, opacity: .42, volume: .25, muted: true, yaw: .5, pitch: .2, fov: 90 };
  const s = setup(chosen), video = s.get('video');
  for (const key of ['projection', 'layout', 'listening', 'order', 'normalization']) assert.equal(s.get(key).value, chosen[key]);
  assert.equal(s.get('enabled').checked, false); assert.equal(s.get('opacity-value').textContent, '42%');
  assert.equal(s.get('volume-value').textContent, '25%'); assert.equal(s.state().listening.muted, true);
  assert.equal(s.state().view.yaw, .5); assert.equal(s.state().view.fov, 90);
  video.currentTime = 4; video.paused = false; video.fire('loadedmetadata');
  assert.equal(s.get('projection').value, '180');
  s.get('reset-settings').fire('click');
  assert.deepEqual(JSON.parse(JSON.stringify(s.persisted())), defaults);
  assert.equal(s.get('projection').value, 'auto'); assert.equal(s.state().projection, '360');
  assert.equal(s.state().view.active, false); assert.equal(s.state().listening.muted, false);
  assert.equal(video.currentTime, 4); assert.equal(video.paused, false);
  assert.equal(s.messages.filter(m => m.type === 'preferences').at(-1).patch.projection, 'auto');
});
test('Auto uses single-eye aspect and bypass never overwrites remembered FOA preferences', () => {
  const s = setup({ layout: 'sbs', listening: 'stereo', enabled: true }), v = s.get('video');
  assert.equal(s.state().projection, '180');
  v.channels = 2; v.fire('loadedmetadata');
  s.get('volume').value = '.2'; s.get('volume').fire('input');
  assert.equal(s.persisted().listening, 'stereo'); assert.equal(s.persisted().enabled, true);
  assert.equal(s.messages.filter(m => m.type === 'preferences').at(-1).patch.listening, undefined);
  v.channels = 4; v.fire('loadedmetadata');
  assert.equal(s.get('listening').value, 'stereo'); assert.equal(s.get('enabled').checked, true);
  s.get('layout').value = 'mono'; s.get('layout').fire('change'); assert.equal(s.state().projection, '360');
  s.get('projection').value = 'eac'; s.get('projection').fire('change');
  v.videoWidth = v.videoHeight = 480; v.fire('loadedmetadata'); assert.equal(s.state().projection, 'eac');
  s.get('projection').value = 'auto'; s.get('projection').fire('change'); assert.equal(s.state().projection, '180');
});
test('every settings control persists its change for the next media', () => {
  const s = setup();
  for (const [id, value] of Object.entries({ projection: 'eac', layout: 'tb', listening: 'stereo', order: 'WXYZ', normalization: 'N3D' })) {
    s.get(id).value = value; s.get(id).fire('change'); assert.equal(s.persisted()[id], value);
  }
  for (const [id, value] of [['opacity', .32], ['volume', .18]]) {
    s.get(id).value = String(value); s.get(id).fire('input'); assert.equal(s.persisted()[id], value);
  }
  s.get('enabled').checked = false; s.get('enabled').fire('change');
  s.get('mute').fire('click'); s.get('view-spatial').fire('click');
  const next = setup(s.persisted());
  assert.deepEqual(JSON.parse(JSON.stringify(next.state().preferences)), JSON.parse(JSON.stringify(s.persisted())));
  assert.equal(next.state().listening.muted, true); assert.equal(next.state().view.active, true);
  assert.equal(next.get('enabled').checked, false); assert.equal(next.get('projection').value, 'eac');
  next.get('video').channels = 1; next.get('video').fire('loadedmetadata'); next.get('reset-settings').fire('click');
  assert.deepEqual(JSON.parse(JSON.stringify(next.persisted())), defaults);
  assert.equal(next.get('listening').value, 'bypass'); assert.equal(next.get('listening').disabled, true);
});
