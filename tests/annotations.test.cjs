const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { buildSync } = require('esbuild');

function loadModule(file, globals = {}) {
  const module = { exports: {} };
  const code = buildSync({ entryPoints: [require.resolve(file)], bundle: true, format: 'cjs', write: false }).outputFiles[0].text;
  vm.runInNewContext(code, { module, exports: module.exports, ...globals });
  return module.exports;
}
const { validateAnnotations, AnnotationTimeline, directionToPoint } = loadModule('../plugins/annotations/annotation-data.js');
const box = (patch = {}) => ({ start: 0, end: .2, label: 'Person', source: 'model', bbox: [.1, .2, .3, .4], ...patch });
const point = (patch = {}) => ({ start: .2, end: .4, label: 'speech', source: 'audio', point: [.5, .4], ...patch });

test('inline format help includes a parser-valid bbox/point example and starts collapsed', () => {
  const { annotationExample, annotationFormatHelp } = loadModule('../plugins/annotations/annotation-format.js');
  const data = validateAnnotations(JSON.parse(annotationExample));
  assert.equal(data.annotations.length, 3);
  assert.ok(data.annotations[0].bbox); assert.ok(data.annotations[1].point);
  assert.equal(data.annotations[1].label, undefined); assert.equal(data.annotations[1].source, undefined);
  assert.equal(data.annotations[2].bbox, undefined); assert.equal(data.annotations[2].point, undefined);
  assert.match(annotationFormatHelp, /<details id="annotation-format">/);
  assert.match(annotationFormatHelp, /aria-label="Annotation JSON format"/);
  assert.match(annotationFormatHelp, /\[start, end\)/);
  assert.match(annotationFormatHelp, /200,000/);
  assert.match(annotationFormatHelp, /20 MiB/);
});

test('v1 accepts missing, null or blank metadata and optional positions without inventing values', () => {
  const bare = { start: 0, end: 1, bbox: [.1, .2, .3, .4] };
  for (const metadata of [{}, { label: null, source: null }, { label: '', source: '  ' }]) {
    const result = validateAnnotations({ version: 1, annotations: [{ ...bare, ...metadata }] }).annotations[0];
    assert.equal(Object.hasOwn(result, 'label'), false); assert.equal(Object.hasOwn(result, 'source'), false);
    assert.deepEqual(Array.from(result.bbox), bare.bbox);
  }
  for (const geometry of [{}, { bbox: null }, { point: null }, { bbox: null, point: null }]) {
    const result = validateAnnotations({ version: 1, annotations: [{ start: 0, end: 1, ...geometry }] }).annotations[0];
    assert.equal(Object.hasOwn(result, 'bbox'), false); assert.equal(Object.hasOwn(result, 'point'), false);
  }
  const pointOnly = validateAnnotations({ version: 1, annotations: [{ start: 0, end: 1, bbox: null, point: [.5, .5] }] }).annotations[0];
  assert.deepEqual(Array.from(pointOnly.point), [.5, .5]);
  const text = validateAnnotations({ version: 1, annotations: [{ ...bare, label: '  person ', source: 'method' }] }).annotations[0];
  assert.equal(text.label, '  person ', 'Nonblank metadata is not silently rewritten');
});

test('v1 accepts bbox and point and copies only supported annotation fields', () => {
  const data = { version: 1, annotations: [box(), point()] };
  const result = validateAnnotations(data);
  assert.equal(result.annotations.length, 2);
  data.annotations[0].bbox[0] = .9;
  assert.equal(result.annotations[0].bbox[0], .1);
  assert.equal(validateAnnotations({ version: 1, annotations: [] }).annotations.length, 0);
});

test('v1 rejects invalid schema, times, geometry, labels and sources with row context', () => {
  for (const data of [null, [], {}, { version: 2, annotations: [] }, { version: 1, annotations: {} }]) {
    assert.throws(() => validateAnnotations(data), /Expected/);
  }
  for (const item of [null, [], box({ start: -1 }), box({ end: 0 }), box({ start: NaN }), box({ end: Infinity }),
    box({ start: '0' }), box({ label: true }), box({ source: 2 }), box({ point: [.5, .5] }), box({ bbox: [] }),
    box({ bbox: [0, 0, 1] }), box({ bbox: [0, 0, 2, 1] }), box({ bbox: [.8, 0, .2, 1] }),
    box({ bbox: [0, .5, 1, .5] }), point({ point: [null, .5] }), point({ point: [.5, false] }),
    box({ label: 'x'.repeat(2001) }), box({ source: ' '.repeat(2001) }), { end: 1 }]) {
    assert.throws(() => validateAnnotations({ version: 1, annotations: [item] }), /Annotation 1:/);
  }
  assert.throws(() => validateAnnotations({ version: 1, annotations: Array(200001).fill(box()) }), /Too many/);
});

test('timeline excludes positionless items from drawing and filters but retains the imported total and original indices', () => {
  const data = validateAnnotations({ version: 1, annotations: [
    { start: 0, end: 10, label: 'not positioned', source: 'hidden-source' },
    { start: 0, end: 1, point: [.5, .5] }, box(),
    { start: 0, end: 2, bbox: null, point: null },
  ] });
  const timeline = new AnnotationTimeline(data.annotations);
  assert.equal(timeline.total, 4); assert.equal(timeline.items.length, 2);
  assert.deepEqual(Array.from(timeline.sources), ['model']);
  assert.deepEqual(Array.from(timeline.at(.1), item => item.index).sort(), [1, 2]);
  assert.equal(timeline.at(1).length, 0, 'An unpositioned long event never becomes active');
});

test('timeline is half-open, handles unsorted overlapping intervals and arbitrary backward seeks', () => {
  const timeline = new AnnotationTimeline([box({ start: 3, end: 4 }), point(), box({ start: 0, end: 10 }), box()]);
  for (const time of [0, .1, .2, .4, 3, 4, 9.9, 10, 20, .15, -1]) {
    const expected = timeline.items.filter(item => item.start <= time && time < item.end).map(item => item.index);
    assert.deepEqual(Array.from(timeline.at(time), item => item.index), Array.from(expected));
  }
  assert.deepEqual(Array.from(timeline.at(NaN)), []);
  assert.deepEqual(Array.from(timeline.sources), ['audio', 'model']);
});

test('FOA directions map left-positive to image-left without reflecting elevation', () => {
  for (const [xyz, expected] of [[[1, 0, 0], [.5, .5]], [[0, 1, 0], [.25, .5]],
    [[0, -1, 0], [.75, .5]], [[0, 0, 1], [.5, 0]], [[0, 0, -1], [.5, 1]]]) {
    assert.deepEqual(Array.from(directionToPoint(xyz)), expected);
  }
  assert.deepEqual(Array.from(directionToPoint([0, 1, 0], 180)), [0, .5]);
  assert.deepEqual(Array.from(directionToPoint([0, -1, 0], 180)), [1, .5]);
  assert.deepEqual(Array.from(directionToPoint([2, 0, 2], 180)), [.5, .25]);
  assert.equal(directionToPoint([-1, 1, 0], 180), null);
  assert.throws(() => directionToPoint([0, 0, 0]), /nonzero/);
  assert.throws(() => directionToPoint([NaN, 0, 0]), /finite/);
  assert.throws(() => directionToPoint([1, 0, 0], 90), /180 or 360/);
});

function setupOverlay() {
  function element() {
    const context = { draws: [], boxes: [], texts: [], backgrounds: [], clears: 0, arcs: [],
      clearRect() { this.clears++; this.draws = []; this.boxes = []; this.texts = []; this.backgrounds = []; this.arcs = []; },
      beginPath() {}, rect(...args) { this.boxes.push(args); }, arc(...args) { this.arcs.push(args); },
      stroke() {}, fill() {}, fillRect(...args) { this.backgrounds.push(args); }, fillText(text) { this.texts.push(text); },
      measureText(text) { return { width: text.length * 8 }; }, drawImage(...args) { this.draws.push(args); } };
    return Object.assign(new EventTarget(), { width: 2048, height: 1024, clientWidth: 1000, checked: true,
      dataset: {}, style: {}, children: [], getContext: () => context, focus() {},
      setAttribute(key, value) { this[key] = value; }, removeAttribute(key) { delete this[key]; },
      replaceChildren(...items) { this.children = items; }, append(...items) { this.children.push(...items); } });
  }
  const elements = new Map();
  const get = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  const video = Object.assign(new EventTarget(), { videoWidth: 720, videoHeight: 720, currentTime: 0, dataset: {} });
  const layer = { canvas: element(), update({ visible }) { this.visible = visible; }, dispose() { this.disposed = true; } };
  let callback;
  const state = () => ({ time: video.currentTime, width: video.videoWidth, height: video.videoHeight, hasVideo: video.videoWidth > 0, sourceDisplayWidth: 500 });
  const api = { getState: state, createPanel: options => {
    elements.set(options.toggle.id, options.toggle);
    return { querySelector: selector => get(selector.slice(1)), removeAttribute() {}, setAttribute() {} };
  },
    createLayer: () => layer, refreshIcons() {}, onFrame(fn) { callback = fn; return { dispose() { callback = undefined; } }; } };
  const { AnnotationOverlay } = loadModule('../plugins/annotations/annotation-overlay.js', {
    document: { createElement: element }, AbortController,
  });
  const overlay = new AnnotationOverlay(api);
  const file = (annotations, name = 'labels.json') => ({ name, size: 100, async text() { return JSON.stringify({ version: 1, annotations }); } });
  const change = id => get(id).dispatchEvent(new Event('change'));
  return { overlay, video, get, file, change, layer, frame: () => callback?.(state()) };
}

test('file import, visibility, labels and source filtering update a paused overlay without touching playback', async () => {
  const s = setupOverlay();
  assert.equal(s.get('annotation-enabled').disabled, true);
  await s.overlay.load(s.file([box(), point({ start: 0 })]));
  assert.equal(s.overlay.getState().total, 2); assert.equal(s.overlay.getState().active, 2);
  assert.equal(s.layer.visible, true);
  const raw = s.overlay.raw.getContext('2d');
  assert.equal(raw.boxes.length, 1); assert.equal(raw.arcs.length, 1); assert.equal(raw.texts.length, 2);
  s.get('annotation-labels').checked = false; s.change('annotation-labels');
  assert.equal(raw.texts.length, 0); assert.equal(raw.boxes.length, 1);
  const event = new Event('change'); Object.defineProperty(event, 'target', { value: { dataset: { source: 'audio' }, checked: false } });
  s.get('annotation-sources').dispatchEvent(event);
  assert.equal(s.overlay.getState().active, 1); assert.equal(raw.arcs.length, 0);
  s.get('annotation-enabled').checked = false; s.change('annotation-enabled');
  assert.equal(s.layer.visible, false);
  s.get('annotation-enabled').checked = true; s.change('annotation-enabled');
  assert.equal(s.overlay.getState().active, 1);
  const paints = raw.clears; s.overlay.update(); assert.equal(raw.clears, paints, 'Unchanged time bucket skips rasterization');
  s.video.currentTime = .3; s.frame();
  assert.equal(s.overlay.getState().active, 0); assert.equal(s.layer.visible, false);
  s.video.currentTime = 0; s.frame();
  assert.equal(s.overlay.getState().active, 1);
  s.video.videoWidth = 0; s.frame(); assert.equal(s.layer.visible, false);
  s.overlay.clear(); assert.equal(s.overlay.getState().total, 0); assert.equal(s.get('annotation-clear').disabled, true);
  s.overlay.dispose();
});

test('optional captions display only provided text and unnamed shapes do not depend on named source filters', async () => {
  const s = setupOverlay();
  await s.overlay.load(s.file([
    { start: 0, end: 1, label: 'Person', bbox: [.1, .1, .3, .3] },
    { start: 0, end: 1, source: 'method', point: [.4, .4] },
    { start: 0, end: 1, point: [.6, .6] },
    { start: 0, end: 1, label: 'Named', source: 'method', bbox: [.6, .6, .8, .8] },
    { start: 0, end: 1, label: 'Not drawn', source: 'positionless' },
    { start: 0, end: 1, bbox: null, point: null },
  ]));
  const raw = s.overlay.raw.getContext('2d');
  assert.equal(s.overlay.getState().total, 6); assert.equal(s.overlay.getState().active, 4);
  assert.deepEqual(Array.from(raw.texts).sort(), ['Named [method]', 'Person', '[method]'].sort());
  assert.equal(raw.backgrounds.length, 3, 'No empty caption box is drawn');
  assert.deepEqual(Array.from(s.overlay.getState().sources), ['method']);
  assert.equal(s.get('annotation-sources').children.length, 1, 'No synthetic group or positionless source is listed');
  const event = new Event('change'); Object.defineProperty(event, 'target', { value: { dataset: { source: 'method' }, checked: false } });
  s.get('annotation-sources').dispatchEvent(event);
  assert.equal(s.overlay.getState().active, 2);
  assert.deepEqual(Array.from(raw.texts), ['Person']);
  s.get('annotation-labels').checked = false; s.change('annotation-labels');
  assert.equal(raw.texts.length, 0); assert.equal(raw.backgrounds.length, 0);
  s.overlay.dispose();
});

test('geometry-only and positionless files load without placeholder text or invisible items becoming active', async () => {
  const s = setupOverlay();
  await s.overlay.load(s.file([
    { start: 0, end: 1, bbox: [.1, .2, .3, .4] },
    { start: 0, end: 1, label: null, source: '', point: [.5, .5] },
  ]));
  const raw = s.overlay.raw.getContext('2d');
  assert.equal(s.overlay.getState().active, 2); assert.equal(s.layer.visible, true);
  assert.equal(raw.texts.length, 0); assert.equal(raw.backgrounds.length, 0);
  assert.match(raw.strokeStyle, /^#/);
  assert.equal(s.get('annotation-sources').children.length, 0);
  await s.overlay.load(s.file([{ start: 0, end: 1 }, { start: 0, end: 2, source: 'not positioned', bbox: null }]));
  assert.equal(s.overlay.getState().total, 2); assert.equal(s.overlay.getState().active, 0);
  assert.equal(s.layer.visible, false); assert.equal(s.get('annotation-status').textContent, '');
  assert.equal(s.get('annotation-count').textContent, '0 active / 2');
  assert.equal(s.get('annotation-sources').children.length, 0);
  s.overlay.dispose();
});

test('bad, empty and oversized annotation files leave the previous dataset intact', async () => {
  const s = setupOverlay(); await s.overlay.load(s.file([box()]));
  for (const file of [{ name: 'broken.json', size: 1, text: async () => '{' }, s.file([box({ bbox: [0, 0, 0, 0] })]),
    { name: 'empty.json', size: 0 }, { name: 'huge.json', size: 21 * 1024 * 1024 }]) {
    await s.overlay.load(file);
    assert.equal(s.overlay.getState().total, 1);
    assert.match(s.get('annotation-status').textContent, /unchanged/);
  }
  s.overlay.dispose();
});

test('a newer import, clear or dispose prevents a slow old file read from winning', async () => {
  for (const action of ['replace', 'clear', 'dispose']) {
    const s = setupOverlay(); let resolve;
    const pending = s.overlay.load({ name: 'slow.json', size: 100, text: () => new Promise(r => { resolve = r; }) });
    if (action === 'replace') await s.overlay.load(s.file([point()], 'new.json'));
    else s.overlay[action]();
    resolve(JSON.stringify({ version: 1, annotations: [box()] })); await pending;
    assert.equal(s.overlay.getState().name, action === 'replace' ? 'new.json' : null);
    if (action !== 'dispose') s.overlay.dispose();
  }
});

test('annotation plugin owns only its panel, frame subscription and a generic layer', async () => {
  const s = setupOverlay();
  await s.overlay.load(s.file([box()])); assert.equal(s.layer.visible, true);
  assert.equal(s.overlay.raw, s.layer.canvas);
  s.overlay.dispose(); assert.equal(s.layer.disposed, true);
  s.video.currentTime = .3; s.frame(); assert.equal(s.overlay.getState().active, 1);
});
