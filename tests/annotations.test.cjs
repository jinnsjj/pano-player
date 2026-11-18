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
const { validateAnnotations, AnnotationTimeline, directionToPoint, annotationLimits } = loadModule('../plugins/annotations/annotation-data.js');
const box = (patch = {}) => ({ start: 0, end: .2, label: 'Person', source: 'model', bbox: [.1, .2, .3, .4], ...patch });
const point = (patch = {}) => ({ start: .2, end: .4, label: 'speech', source: 'audio', point: [.5, .4], ...patch });

test('inline format help includes a parser-valid bbox/point example and starts collapsed', () => {
  const { annotationExample, annotationFormatHelp } = loadModule('../plugins/annotations/annotation-format.js');
  const data = validateAnnotations(JSON.parse(annotationExample));
  assert.equal(Object.hasOwn(JSON.parse(annotationExample), 'version'), false);
  assert.equal(data.version, 1);
  assert.equal(data.annotations.length, 5);
  assert.ok(data.annotations[0].bbox); assert.ok(data.annotations[1].point);
  assert.equal(data.annotations[1].label, undefined); assert.equal(data.annotations[1].source, undefined);
  assert.equal(data.annotations[2].bbox, undefined); assert.equal(data.annotations[2].point, undefined);
  assert.equal(data.annotations[2].label, 'Scene note');
  assert.equal(data.annotations[3].start, .1); assert.equal(data.annotations[3].end, .1 + .04);
  assert.equal(data.annotations[4].start, .2); assert.equal(data.annotations[4].end, .24);
  assert.match(annotationFormatHelp, /<details id="annotation-format">/);
  assert.match(annotationFormatHelp, /aria-label="Annotation JSON format"/);
  assert.match(annotationFormatHelp, /\[start, end\)/);
  assert.match(annotationFormatHelp, /200,000/);
  assert.match(annotationFormatHelp, /20 MiB/);
  assert.match(annotationFormatHelp, /时间片段文本/);
  assert.match(annotationFormatHelp, /version<\/code> 可省略/);
  assert.match(annotationFormatHelp, /timestamp/); assert.doesNotMatch(annotationFormatHelp, /duration/);
  assert.match(annotationFormatHelp, /frame/); assert.match(annotationFormatHelp, /fps/);
  assert.match(annotationFormatHelp, /从 0 开始/); assert.match(annotationFormatHelp, /不会自动采用视频 FPS/);
  assert.doesNotMatch(annotationFormatHelp, /global|全局/i);
  assert.doesNotMatch(annotationFormatHelp, /对象或|部位|物理声源/);
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

test('v1 accepts bbox and point and copies geometry', () => {
  const data = { version: 1, annotations: [box(), point()] };
  const result = validateAnnotations(data);
  assert.equal(result.annotations.length, 2);
  data.annotations[0].bbox[0] = .9;
  assert.equal(result.annotations[0].bbox[0], .1);
  assert.equal(validateAnnotations({ version: 1, annotations: [] }).annotations.length, 0);
});

test('custom annotation fields preserve JSON values without replacing standard or internal fields', () => {
  const item = { ...box(), active: false, confidence: .88, count: 0, empty: '', missing: null,
    tags: ['speech', 2], details: { visible: true }, index: 'external-index', customFields: 'external-field' };
  Object.defineProperty(item, '__proto__', { value: { polluted: true }, enumerable: true });
  const before = JSON.stringify(item);
  const result = validateAnnotations({ annotations: [item] }).annotations[0];
  assert.equal(result.start, 0); assert.equal(result.label, 'Person');
  assert.equal(result.index, undefined);
  assert.equal(result.customFields.active, false); assert.equal(result.customFields.confidence, .88);
  assert.equal(result.customFields.count, 0); assert.equal(result.customFields.empty, '');
  assert.equal(result.customFields.missing, null);
  assert.equal(JSON.stringify(result.customFields.tags), '["speech",2]');
  assert.equal(JSON.stringify(result.customFields.details), '{"visible":true}');
  assert.equal(result.customFields.customFields, 'external-field');
  assert.equal(Object.hasOwn(result.customFields, '__proto__'), true);
  assert.equal(result.customFields.polluted, undefined);
  assert.equal(JSON.stringify(item), before, 'Import does not rewrite custom metadata');
  const timeline = new AnnotationTimeline([result]);
  assert.equal(timeline.items[0].index, 0);
  assert.deepEqual(Array.from(timeline.fields), ['__proto__', 'active', 'confidence', 'count', 'customFields', 'details', 'empty', 'index', 'missing', 'tags']);
});

test('custom caption formatting includes only selected fields present on that row, including falsy values', () => {
  const { annotationLabel } = loadModule('../plugins/annotations/annotation-overlay.js');
  const item = { label: 'AC153', customFields: { active: false, confidence: .88, zero: 0, empty: '',
    value: null, tags: ['a', 2], details: { visible: true }, text: '<img src=x>' } };
  assert.equal(annotationLabel(item), 'AC153');
  assert.equal(annotationLabel(item, ['active', 'confidence', 'absent']), 'AC153 | active: false | confidence: 0.88');
  assert.equal(annotationLabel(item, ['zero', 'empty', 'value']), 'AC153 | zero: 0 | empty: "" | value: null');
  assert.equal(annotationLabel(item, ['tags', 'details', 'text']), 'AC153 | tags: ["a",2] | details: {"visible":true} | text: "<img src=x>"');
  assert.equal(annotationLabel({ customFields: { active: false } }, ['active']), 'active: false');
  const nested = JSON.parse('['.repeat(10000) + '0' + ']'.repeat(10000));
  assert.match(annotationLabel({ label: 'Safe', customFields: { nested } }, ['nested']), /^Safe \| nested: \[/);
});

test('omitted annotation version defaults to v1 without changing timing, validation or input data', () => {
  for (const annotations of [[box()], [{ timestamp: 1, label: 'Timestamp' }], [{ frame: 25, point: [.5, .5] }], []]) {
    const input = { fps: 25, annotations };
    for (const options of [{}, { skipInvalid: true }]) {
      const result = validateAnnotations(input, options);
      assert.equal(result.version, 1);
      assert.equal(JSON.stringify(result), JSON.stringify(validateAnnotations({ version: 1, ...input }, options)));
    }
    assert.equal(Object.hasOwn(input, 'version'), false, 'The input file is not rewritten');
  }
  for (const version of [null, undefined, 0, 2, '1', true, {}, [], NaN, Infinity]) {
    for (const options of [{}, { skipInvalid: true }]) {
      assert.throws(() => validateAnnotations({ version, annotations: [box()] }, options), /Expected/);
    }
  }
});

test('timestamp samples use seconds and explicit fps, without filling gaps', () => {
  const input = { version: 1, annotations: [
    { timestamp: 1, fps: 4, label: 'Face A', bbox: [.1, .2, .3, .4] },
    { timestamp: 1, fps: 4, label: 'Face B', point: [.5, .5] },
    { timestamp: 2, fps: 4, label: 'Later' },
  ] };
  const data = validateAnnotations(input), timeline = new AnnotationTimeline(data.annotations);
  assert.deepEqual(Array.from(data.annotations, item => [item.start, item.end]), [[1, 1.25], [1, 1.25], [2, 2.25]]);
  assert.equal(Object.hasOwn(data.annotations[0], 'timestamp'), false, 'Samples normalize to the existing interval representation');
  assert.equal(input.annotations[0].timestamp, 1, 'Input is unchanged');
  for (const [time, labels] of [[1, ['Face A', 'Face B']], [1.25, []], [1.5, []], [2, ['Later']], [2.25, []], [1, ['Face A', 'Face B']]]) {
    assert.deepEqual(Array.from(timeline.at(time), item => item.label), labels);
  }
});

test('duration is unrelated metadata, never a substitute for fps or a sample-period override', () => {
  assert.throws(() => validateAnnotations({ version: 1, annotations: [{ timestamp: 1, duration: 3 }] }), /Annotation 1:.*fps/);
  const data = validateAnnotations({ version: 1, fps: 4, annotations: [
    { timestamp: 1, duration: 3 }, { frame: 4, duration: 3 }, { start: 1, end: 2, duration: 3 },
  ] });
  assert.deepEqual(Array.from(data.annotations, item => [item.start, item.end]), [[1, 1.25], [1, 1.25], [1, 2]]);
  assert.ok(data.annotations.every(item => !Object.hasOwn(item, 'duration')));
});

test('frame samples require their own fps and support root defaults and per-item overrides', () => {
  const data = validateAnnotations({ version: 1, fps: 25, annotations: [
    { frame: 0, label: 'First frame' },
    { frame: 250, label: 'Face' },
    { frame: 100, fps: 10, label: 'SELD' },
    { timestamp: 10, label: 'Timestamp default' },
    { timestamp: 10, fps: 10, label: 'Timestamp override' },
    { timestamp: 10, fps: 2, label: 'Slower timestamp' },
    { start: 10, end: 11, label: 'Legacy interval' },
  ] });
  assert.deepEqual(Array.from(data.annotations, item => [item.start, item.end]),
    [[0, .04], [10, 10.04], [10, 10.1], [10, 10.04], [10, 10.1], [10, 10.5], [10, 11]]);
  const standalone = validateAnnotations({ version: 1, annotations: [{ frame: 30, fps: 29.97, label: 'Fractional fps' }] });
  assert.equal(standalone.annotations[0].start, 30 / 29.97);
  assert.equal(standalone.annotations[0].end, 31 / 29.97);
  const timeline = new AnnotationTimeline(validateAnnotations({ version: 1, fps: 10, annotations: [
    { frame: 7, label: 'A' }, { frame: 8, label: 'B' }, { frame: 10, label: 'After gap' },
  ] }).annotations);
  for (const [time, labels] of [[.7, ['A']], [.8, ['B']], [.9, []], [1, ['After gap']], [1.1, []], [.7, ['A']]]) {
    assert.deepEqual(Array.from(timeline.at(time), item => item.label), labels);
  }
});

test('sample validation rejects missing, conflicting, invalid or unrepresentable timing with row context', () => {
  for (const fps of [null, '25', 0, -1, NaN, Infinity, {}, true]) {
    assert.throws(() => validateAnnotations({ version: 1, fps, annotations: [] }), /Annotation JSON:.*fps/);
    for (const sample of [{ frame: 0 }, { timestamp: 0 }]) {
      assert.throws(() => validateAnnotations({ version: 1, fps: 25, annotations: [{ ...sample, fps }] }), /Annotation 1:.*fps/);
    }
  }
  for (const item of [
    {}, { frame: 0 }, { timestamp: 0 }, { timestamp: 0, duration: 1 },
    { frame: -1, fps: 25 }, { frame: .5, fps: 25 }, { frame: '0', fps: 25 },
    { frame: null, fps: 25 }, { frame: Number.MAX_SAFE_INTEGER + 1, fps: 25 },
    { frame: 1, fps: Number.MIN_VALUE }, { frame: Number.MAX_SAFE_INTEGER, fps: 1e-300 },
    { timestamp: -1, fps: 25 }, { timestamp: '1', fps: 25 }, { timestamp: null, fps: 25 },
    { timestamp: Infinity, fps: 25 }, { timestamp: NaN, fps: 25 }, { timestamp: true, fps: 25 },
    { timestamp: 1e20, fps: 25 }, { timestamp: 1, fps: Number.MIN_VALUE },
    { frame: 0, fps: 25, timestamp: 0 }, { frame: 0, fps: 25, start: 0, end: 1 },
    { timestamp: 0, fps: 25, start: 0, end: 1 }, { timestamp: 0, fps: 25, end: 1 },
  ]) {
    assert.throws(() => validateAnnotations({ version: 1, annotations: [box(), item] }), /Annotation 2:/);
  }
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

test('tolerant validation skips only invalid rows and preserves original row numbers without weakening strict validation', () => {
  const invalid = [null, box({ end: 0 }), { timestamp: 0, fps: 0 }, { frame: 0 },
    box({ bbox: [0, 0, 2, 1] }), point({ bbox: [.1, .1, .3, .3] }), box({ label: true })];
  const input = { version: 1, annotations: [box(), ...invalid, point()] };
  const result = validateAnnotations(input, { skipInvalid: true });
  assert.equal(result.annotations.length, 2); assert.equal(result.skipped, invalid.length);
  assert.ok(result.annotations[0].bbox); assert.ok(result.annotations[1].point);
  assert.equal(result.issues.length, invalid.length);
  result.issues.forEach((issue, index) => assert.ok(issue.startsWith(`Annotation ${index + 2}:`)));
  assert.throws(() => validateAnnotations(input), /Annotation 2:/, 'Converters keep all-or-nothing validation by default');
  assert.equal(Object.hasOwn(validateAnnotations({ version: 1, annotations: [box()] }), 'skipped'), false);
  assert.equal(input.annotations.length, invalid.length + 2); assert.equal(input.annotations[1], null);
});

test('tolerant validation bounds diagnostics, handles all-invalid/empty files and retains file-level guards', () => {
  const count = annotationLimits.issues + 5;
  const result = validateAnnotations({ version: 1, annotations: [...Array(count).fill({ start: 1, end: 1 }), point()] }, { skipInvalid: true });
  assert.equal(result.skipped, count); assert.equal(result.issues.length, annotationLimits.issues);
  assert.ok(result.issues[0].startsWith('Annotation 1:'));
  assert.ok(result.issues.at(-1).startsWith(`Annotation ${annotationLimits.issues}:`));
  assert.equal(result.annotations.length, 1); assert.ok(result.annotations[0].point);
  const allInvalid = validateAnnotations({ version: 1, annotations: [null, {}] }, { skipInvalid: true });
  assert.equal(allInvalid.annotations.length, 0); assert.equal(allInvalid.skipped, 2);
  const empty = validateAnnotations({ version: 1, annotations: [] }, { skipInvalid: true });
  assert.equal(empty.annotations.length, 0); assert.equal(empty.skipped, 0); assert.equal(empty.issues.length, 0);
  for (const value of [null, {}, { version: 2, annotations: [box()] }, { version: 1, annotations: null },
    { version: 1, fps: 0, annotations: [box()] }, { version: 1, annotations: Array(200001).fill(null) }]) {
    assert.throws(() => validateAnnotations(value, { skipInvalid: true }));
  }
  assert.throws(() => validateAnnotations({ version: 1, annotations: [{ start: 0, end: 1,
    get label() { throw new Error('Unexpected failure'); } }] }, { skipInvalid: true }), /Unexpected failure/);
});

test('timeline includes global labels and their sources but excludes entries without text or geometry', () => {
  const data = validateAnnotations({ version: 1, annotations: [
    { start: 0, end: 10, label: 'Scene note', source: 'global-source' },
    { start: 0, end: 1, point: [.5, .5] }, box(),
    { start: 0, end: 2, bbox: null, point: null },
  ] });
  const timeline = new AnnotationTimeline(data.annotations);
  assert.equal(timeline.total, 4); assert.equal(timeline.items.length, 3);
  assert.deepEqual(Array.from(timeline.sources), ['global-source', 'model']);
  assert.deepEqual(Array.from(timeline.at(.1), item => item.index).sort(), [0, 1, 2]);
  assert.deepEqual(Array.from(timeline.at(1), item => item.index), [0]);
  assert.equal(timeline.at(10).length, 0, 'Global intervals are half-open too');
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

function setupOverlay(options = {}) {
  function element() {
    const context = { draws: [], boxes: [], texts: [], backgrounds: [], clears: 0, arcs: [],
      clearRect() { this.clears++; this.draws = []; this.boxes = []; this.texts = []; this.backgrounds = []; this.arcs = []; },
      beginPath() {}, rect(...args) { this.boxes.push(args); }, arc(...args) { this.arcs.push(args); },
      stroke() {}, fill() {}, fillRect(...args) { this.backgrounds.push(args); }, fillText(text) { this.texts.push(text); },
      measureText(text) { return { width: text.length * 8 }; }, drawImage(...args) { this.draws.push(args); } };
    return Object.assign(new EventTarget(), { width: 2048, height: 1024, clientWidth: 1000, checked: true,
      dataset: {}, style: {}, children: [], getContext: () => context, focus() {},
      click() { this.clicks = (this.clicks || 0) + 1; this.dispatchEvent(new Event('click')); },
      setAttribute(key, value) { this[key] = value; }, removeAttribute(key) { delete this[key]; },
      replaceChildren(...items) { this.children = items; }, append(...items) { this.children.push(...items); } });
  }
  const elements = new Map();
  const get = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  const video = Object.assign(new EventTarget(), { videoWidth: 720, videoHeight: 720, currentTime: 0, dataset: {} });
  const layer = { canvas: element(), update({ visible }) { this.visible = visible; }, dispose() { this.disposed = true; } };
  let callback, dropCallback;
  const state = () => ({ time: video.currentTime, width: video.videoWidth, height: video.videoHeight, hasVideo: video.videoWidth > 0, sourceDisplayWidth: 500 });
  const api = { getState: state, createPanel: options => {
    if (options.placement === 'sidebar') return element();
    elements.set(options.toggle.id, options.toggle);
    for (const action of options.actions || []) elements.set(action.id, action);
    return { querySelector: selector => get(selector.slice(1)), removeAttribute() {}, setAttribute() {} };
  },
    showPanel(panel) { panel.hidden = false; },
    createLayer: () => layer, refreshIcons() {}, onFrame(fn) { callback = fn; return { dispose() { callback = undefined; } }; },
    onFileDrop(fn) { dropCallback = fn; return { dispose() { dropCallback = undefined; } }; }, ...options };
  const { AnnotationOverlay } = loadModule('../plugins/annotations/annotation-overlay.js', {
    document: { createElement: element }, AbortController,
  });
  const overlay = new AnnotationOverlay(api);
  const file = (annotations, name = 'labels.json') => ({ name, size: 100, async text() { return JSON.stringify({ version: 1, annotations }); } });
  const change = id => get(id).dispatchEvent(new Event('change'));
  return { overlay, video, get, file, change, layer, frame: () => callback?.(state()), drop: files => dropCallback?.(files) ?? false };
}

function selectField(s, field, checked = true) {
  const event = new Event('change');
  Object.defineProperty(event, 'target', { value: { dataset: { field }, checked } });
  s.get('annotation-field-options').dispatchEvent(event);
}

test('custom fields are individually selectable across boxes, points and sidebar labels while paused', async () => {
  const s = setupOverlay(); s.video.currentTime = .3;
  assert.equal(s.get('annotation-fields').hidden, true);
  await s.overlay.load(s.file([
    box({ start: .2, end: .4, label: 'AC153', source: null, active: false, confidence: .88 }),
    point({ start: .2, end: .4, confidence: 0 }),
    { start: .2, end: .4, label: 'Note', active: true },
    { start: 1, end: 2, label: 'Later', later: 'future' },
    box({ end: 0, invalidOnly: true }),
  ]));
  const raw = s.overlay.raw.getContext('2d');
  const labels = () => Array.from(raw.texts);
  const sidebar = () => s.overlay.globalList.children[0].children[1].children[0].textContent;
  assert.deepEqual(Array.from(s.overlay.getState().fields), ['active', 'confidence', 'later']);
  assert.equal(s.get('annotation-fields').hidden, false);
  assert.deepEqual(s.get('annotation-field-options').children.map(label => label.children[1].textContent), ['active', 'confidence', 'later']);
  assert.ok(s.get('annotation-field-options').children.every(label => label.children[0].checked === false));
  assert.deepEqual(labels(), ['AC153', 'speech [audio]']);
  selectField(s, 'confidence'); selectField(s, 'active');
  assert.deepEqual(labels(), ['AC153 | active: false | confidence: 0.88', 'speech | confidence: 0 [audio]']);
  assert.equal(sidebar(), 'Note | active: true');
  assert.deepEqual(Array.from(s.overlay.getState().selectedFields), ['active', 'confidence'], 'Caption order follows the field list, not click order');
  selectField(s, 'confidence', false);
  assert.deepEqual(labels(), ['AC153 | active: false', 'speech [audio]']);
  assert.equal(sidebar(), 'Note | active: true');
  assert.equal(s.overlay.getState().active, 3, 'Fields affect captions, never visibility or filtering');
  assert.equal(s.video.currentTime, .3);
  const paints = raw.clears; s.frame(); assert.equal(raw.clears, paints, 'Unchanged frames still skip rasterization');
  s.get('annotation-labels').checked = false; s.change('annotation-labels');
  assert.equal(raw.texts.length, 0); assert.equal(raw.boxes.length, 1);
  assert.equal(s.overlay.globals.hidden, true); assert.equal(s.get('annotation-fields').disabled, true);
  s.get('annotation-labels').checked = true; s.change('annotation-labels');
  assert.equal(s.get('annotation-fields').disabled, false);
  assert.deepEqual(labels(), ['AC153 | active: false', 'speech [audio]']);
  assert.equal(sidebar(), 'Note | active: true');
  s.video.currentTime = 1; s.frame(); selectField(s, 'later');
  assert.equal(sidebar(), 'Later | later: "future"');
  s.video.currentTime = .3; s.frame();
  assert.equal(sidebar(), 'Note | active: true', 'Missing fields never add placeholders');
  s.overlay.dispose();
});

test('custom field controls render literal keys, preserve selection on failed imports and reset on replacement or clear', async () => {
  const s = setupOverlay(), field = '<img src=x onerror=alert(1)>';
  await s.overlay.load(s.file([box({ [field]: false, confidence: .88 })]));
  assert.equal(s.get('annotation-field-options').children[0].children[1].textContent, field);
  selectField(s, 'confidence');
  const previous = JSON.stringify(s.overlay.getState());
  await s.overlay.load(s.file([box({ end: 0, rejected: true })], 'invalid.json'));
  assert.equal(JSON.stringify(s.overlay.getState()), previous);
  assert.equal(s.get('annotation-field-options').children.length, 2);
  await s.overlay.load(s.file([box({ confidence: .5, newField: 1 })], 'replacement.json'));
  assert.deepEqual(Array.from(s.overlay.getState().selectedFields), []);
  assert.deepEqual(Array.from(s.overlay.raw.getContext('2d').texts), ['Person [model]']);
  selectField(s, 'newField'); s.overlay.clear();
  assert.equal(s.get('annotation-fields').hidden, true);
  assert.equal(s.get('annotation-field-options').children.length, 0);
  assert.deepEqual(Array.from(s.overlay.getState().fields), []);
  assert.deepEqual(Array.from(s.overlay.getState().selectedFields), []);
  await s.overlay.load(s.file([box()])); assert.equal(s.get('annotation-fields').hidden, true);
  s.overlay.dispose();
});

test('Open uses the host JSON picker when available and browser input otherwise', async () => {
  let selected, calls = 0;
  const s = setupOverlay({ selectJsonFile: async () => { calls++; return selected; } });
  selected = s.file([box()], 'remote.json');
  s.get('annotation-open').click(); await new Promise(setImmediate);
  assert.equal(calls, 1); assert.equal(s.get('annotation-file').clicks, undefined);
  assert.equal(s.overlay.getState().name, 'remote.json'); assert.equal(s.get('annotation-open').disabled, false);
  s.overlay.dispose();
  const web = setupOverlay(); web.get('annotation-open').click();
  assert.equal(web.get('annotation-file').clicks, 1); web.overlay.dispose();
});

test('picker cancellation and errors preserve the previous annotations and visibility settings', async () => {
  let error;
  const s = setupOverlay({ selectJsonFile: async () => { if (error) throw error; return null; } });
  await s.overlay.load(s.file([box()])); s.get('annotation-enabled').checked = false; s.change('annotation-enabled');
  const previous = JSON.stringify(s.overlay.getState());
  s.overlay.controls.options.hidden = true;
  s.overlay.message('Previous status'); await s.overlay.selectFile();
  assert.equal(JSON.stringify(s.overlay.getState()), previous); assert.equal(s.get('annotation-status').textContent, 'Previous status');
  assert.equal(s.overlay.controls.options.hidden, true, 'Cancel does not expand settings');
  error = new Error('Host cannot read annotation'); await s.overlay.selectFile();
  assert.equal(JSON.stringify(s.overlay.getState()), previous);
  assert.match(s.get('annotation-status').textContent, /unchanged.*Host cannot read/);
  assert.equal(s.overlay.controls.options.hidden, false, 'A host picker error is visible even when opened from the toolbar');
  assert.equal(s.get('annotation-open').disabled, false); s.overlay.dispose();
});

test('a pending host picker cannot overwrite a newer import, clear or disposed session', async () => {
  for (const action of ['replace', 'clear', 'dispose']) {
    let resolve;
    const s = setupOverlay({ selectJsonFile: () => new Promise(r => { resolve = r; }) });
    await s.overlay.load(s.file([box()]));
    const pending = s.overlay.selectFile(); assert.equal(s.get('annotation-open').disabled, true);
    if (action === 'replace') s.drop([s.file([point()], 'new.json')]);
    else s.overlay[action]();
    resolve(s.file([box()], 'old-picker.json')); await pending; await new Promise(setImmediate);
    assert.equal(s.overlay.getState().name, action === 'replace' ? 'new.json' : action === 'dispose' ? 'labels.json' : null);
    if (action !== 'dispose') { assert.equal(s.get('annotation-open').disabled, false); s.overlay.dispose(); }
  }
});

test('dropping a single JSON imports annotations without changing playback and unrelated files are ignored', async () => {
  const s = setupOverlay(); s.video.currentTime = .1;
  assert.equal(s.drop([s.file([box()], 'labels.JSON')]), true);
  await new Promise(setImmediate);
  assert.equal(s.overlay.getState().name, 'labels.JSON');
  assert.equal(s.overlay.controls.options.hidden, false);
  assert.equal(s.overlay.getState().active, 1); assert.equal(s.layer.visible, true);
  assert.equal(s.video.currentTime, .1);
  assert.equal(s.drop([{ name: 'video.mp4' }]), false);
  assert.equal(s.drop([]), false);
  s.overlay.dispose(); assert.equal(s.drop([s.file([point()])]), false);
});

test('invalid JSON and multi-file drops remain claimed without replacing existing annotations', async () => {
  const s = setupOverlay(); await s.overlay.load(s.file([box()]));
  for (const files of [
    [{ name: 'broken.json', size: 1, text: async () => '{' }],
    [s.file([point()]), s.file([box()])],
    [{ name: 'video.mp4' }, s.file([point()])],
    [{ name: 'empty.json', size: 0 }],
    [{ name: 'huge.json', size: 21 * 1024 * 1024 }],
  ]) {
    assert.equal(s.drop(files), true);
    await new Promise(setImmediate);
    assert.equal(s.overlay.getState().name, 'labels.json');
    assert.equal(s.overlay.getState().total, 1);
    assert.equal(s.overlay.controls.options.hidden, false);
    assert.match(s.get('annotation-status').textContent, /unchanged/);
  }
  s.overlay.dispose();
});

test('partial annotation import skips a bad interval and retains valid rows before and after it', async () => {
  for (const invalidIndex of [287, 1]) {
    const s = setupOverlay(); s.video.currentTime = .1;
    await s.overlay.load(s.file([point()], 'previous.json'));
    s.get('annotation-labels').checked = false;
    const annotations = [
      ...Array.from({ length: invalidIndex }, () => box({ source: 'valid' })),
      box({ start: 1, end: 1, source: 'invalid' }),
      point({ start: 0, source: 'after' }),
    ];
    await s.overlay.load(s.file(annotations, 'partial.json'));
    assert.equal(s.overlay.getState().name, 'partial.json', 'A bad row must not reject the entire incoming file: ' + s.get('annotation-status').textContent);
    assert.equal(s.overlay.getState().total, invalidIndex + 1);
    assert.equal(s.overlay.getState().active, invalidIndex + 1);
    assert.equal(s.overlay.getState().skipped, 1);
    assert.deepEqual(Array.from(s.overlay.getState().sources), ['after', 'valid']);
    assert.match(s.get('annotation-status').textContent, /skipped 1 invalid annotation/i);
    assert.ok(s.get('annotation-status').textContent.includes(`Annotation ${invalidIndex + 1}:`));
    assert.equal(s.get('annotation-status').hidden, false);
    assert.equal(s.overlay.raw.getContext('2d').boxes.length, invalidIndex);
    assert.equal(s.overlay.raw.getContext('2d').arcs.length, 1);
    assert.equal(s.video.currentTime, .1);
    assert.equal(annotations[invalidIndex].end, 1, 'Import does not repair or rewrite the source data');
    s.overlay.dispose();
  }
});

test('partial import warnings are bounded, all-invalid files preserve prior state, and clean imports/clear reset warnings', async () => {
  const s = setupOverlay(); s.video.currentTime = .1;
  const partial = s.file([box(), ...Array(15).fill(box({ end: 0 })), { start: 0, end: 1, label: 'Valid note' }], 'partial.json');
  await s.overlay.load(partial);
  assert.equal(s.overlay.getState().total, 2); assert.equal(s.overlay.getState().active, 2);
  assert.equal(s.overlay.getState().skipped, 15);
  assert.equal(s.overlay.globalList.children.length, 1);
  const warning = s.get('annotation-status').textContent;
  assert.match(warning, /Loaded 2 annotations.*Skipped 15 invalid annotations/);
  assert.match(warning, /Only the first 10 errors are shown/); assert.ok(warning.length < 2000);
  assert.ok(warning.includes('Annotation 2:')); assert.ok(warning.includes('Annotation 11:'));
  assert.equal(warning.includes('Annotation 12:'), false);
  s.get('annotation-enabled').checked = false; s.change('annotation-enabled');
  const previous = JSON.stringify(s.overlay.getState());
  for (const file of [s.file([{ start: 0, end: 0 }, { timestamp: 1 }], 'all-invalid.json'),
    { name: 'bad-root.json', size: 100, text: async () => JSON.stringify({ version: 1, fps: 0, annotations: [box()] }) }]) {
    await s.overlay.load(file);
    assert.equal(JSON.stringify(s.overlay.getState()), previous);
    assert.match(s.get('annotation-status').textContent, /Annotations unchanged:/);
  }
  await s.overlay.load(s.file([box()], 'clean.json'));
  assert.equal(s.overlay.getState().skipped, 0); assert.equal(s.get('annotation-status').hidden, true);
  await s.overlay.load(partial); s.overlay.clear();
  assert.equal(s.overlay.getState().skipped, 0); assert.equal(s.get('annotation-status').hidden, true);
  assert.equal(s.overlay.getState().name, null);
  s.overlay.dispose();
});

test('sample imports render, filter and seek like intervals, and missing fps preserves the previous file', async () => {
  const s = setupOverlay(); s.video.currentTime = 10;
  await s.overlay.load({ name: 'samples.json', size: 100, text: async () => JSON.stringify({ version: 1, fps: 25, annotations: [
    { frame: 250, source: 'face', bbox: [.1, .2, .3, .4] },
    { frame: 100, fps: 10, source: 'audio', point: [.5, .5] },
    { timestamp: 10, label: 'Sample note' },
    { start: 10, end: 11, label: 'Interval note' },
  ] }) });
  const raw = s.overlay.raw.getContext('2d');
  assert.equal(s.overlay.getState().active, 4); assert.equal(raw.boxes.length, 1); assert.equal(raw.arcs.length, 1);
  assert.equal(s.overlay.globalList.children.length, 2);
  s.video.currentTime = 10.04; s.frame();
  assert.equal(s.overlay.getState().active, 2); assert.equal(raw.boxes.length, 0); assert.equal(raw.arcs.length, 1);
  const event = new Event('change'); Object.defineProperty(event, 'target', { value: { dataset: { source: 'audio' }, checked: false } });
  s.get('annotation-sources').dispatchEvent(event);
  assert.equal(s.overlay.getState().active, 1); assert.equal(s.layer.visible, false);
  const previous = JSON.stringify(s.overlay.getState());
  for (const sample of [{ frame: 250 }, { timestamp: 10 }]) {
    await s.overlay.load(s.file([{ ...sample, label: 'Missing fps' }], 'bad-sample.json'));
    assert.equal(JSON.stringify(s.overlay.getState()), previous, 'FPS is not inherited from a previous file');
    assert.match(s.get('annotation-status').textContent, /Annotation 1:.*fps/);
  }
  assert.equal(s.video.currentTime, 10.04);
  s.video.currentTime = 10; s.frame();
  assert.equal(s.overlay.getState().active, 3, 'Backward seek restores samples while retaining the source filter');
  assert.equal(raw.boxes.length, 1); assert.equal(raw.arcs.length, 0);
  s.overlay.dispose();
});

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
    { start: 0, end: 1, label: 'Global note', source: 'positionless' },
    { start: 0, end: 1, bbox: null, point: null },
  ]));
  const raw = s.overlay.raw.getContext('2d');
  assert.equal(s.overlay.getState().total, 6); assert.equal(s.overlay.getState().active, 5);
  assert.deepEqual(Array.from(raw.texts).sort(), ['Named [method]', 'Person', '[method]'].sort());
  assert.equal(raw.backgrounds.length, 3, 'No empty caption box is drawn');
  assert.deepEqual(Array.from(s.overlay.getState().sources), ['method', 'positionless']);
  assert.equal(s.get('annotation-sources').children.length, 2, 'Global sources are listed without a synthetic group');
  const event = new Event('change'); Object.defineProperty(event, 'target', { value: { dataset: { source: 'method' }, checked: false } });
  s.get('annotation-sources').dispatchEvent(event);
  assert.equal(s.overlay.getState().active, 3);
  assert.deepEqual(Array.from(raw.texts), ['Person']);
  s.get('annotation-labels').checked = false; s.change('annotation-labels');
  assert.equal(raw.texts.length, 0); assert.equal(raw.backgrounds.length, 0);
  s.overlay.dispose();
});

test('sidebar annotations render literal labels and follow time, filters and visibility', async () => {
  const s = setupOverlay();
  const labels = () => s.overlay.globalList.children.map(row => row.children[1].children[0].textContent);
  const filter = (source, checked) => {
    const event = new Event('change'); Object.defineProperty(event, 'target', { value: { dataset: { source }, checked } });
    s.get('annotation-sources').dispatchEvent(event);
  };
  assert.equal(s.overlay.globals.hidden, true);
  assert.equal(s.overlay.globals.children[0].textContent, 'Annotations');
  await s.overlay.load(s.file([
    { start: 1, end: 3, label: '<img src=x onerror=alert(1)>', source: 'notes' },
    { start: 2, end: 4, label: 'Second note', bbox: null, point: null },
    { start: 0, end: 9, label: ' ', source: 'not displayed' },
  ]));
  assert.equal(s.overlay.globals.hidden, true);
  s.video.currentTime = 1; s.frame();
  assert.equal(s.overlay.getState().active, 1); assert.equal(s.layer.visible, false);
  assert.equal(s.overlay.globals.hidden, false);
  assert.deepEqual(labels(), ['<img src=x onerror=alert(1)>']);
  assert.equal(s.overlay.globalList.children[0].children[1].children[1].textContent, 'notes');
  s.video.currentTime = 2; s.frame(); assert.equal(labels().length, 2);
  filter('notes', false); assert.deepEqual(labels(), ['Second note']);
  assert.equal(s.overlay.getState().active, 1);
  s.get('annotation-labels').checked = false; s.change('annotation-labels');
  assert.equal(s.overlay.globals.hidden, true); assert.equal(labels().length, 0);
  s.get('annotation-labels').checked = true; s.change('annotation-labels');
  assert.deepEqual(labels(), ['Second note']);
  s.get('annotation-enabled').checked = false; s.change('annotation-enabled');
  assert.equal(s.overlay.globals.hidden, true); assert.equal(s.overlay.getState().active, 0);
  s.get('annotation-enabled').checked = true; s.change('annotation-enabled');
  assert.deepEqual(labels(), ['Second note']);
  filter('notes', true);
  s.video.currentTime = 3; s.frame(); assert.deepEqual(labels(), ['Second note']);
  s.video.currentTime = 4; s.frame(); assert.equal(s.overlay.globals.hidden, true);
  s.video.currentTime = 1; s.frame(); assert.equal(labels().length, 1, 'Backward seek restores a global label');
  s.video.videoWidth = 0; s.frame(); assert.equal(s.overlay.globals.hidden, true);
  s.video.videoWidth = 720; s.frame(); assert.equal(s.overlay.globals.hidden, false);
  s.overlay.clear(); assert.equal(s.overlay.globals.hidden, true); assert.equal(labels().length, 0);
  assert.equal(s.overlay.getState().total, 0); s.overlay.dispose();
});

test('regions, points and sidebar text share overlap handling and a single source filter', async () => {
  const s = setupOverlay();
  await s.overlay.load(s.file([
    box({ end: 1, source: 'shared' }), point({ start: 0, end: 1, source: 'shared' }),
    { start: 0, end: 1, label: 'Interval note', source: 'shared' },
    { start: 0, end: 1, label: 'Independent note' },
  ]));
  assert.equal(s.overlay.getState().active, 4);
  assert.equal(s.overlay.globalList.children.length, 2);
  assert.equal(s.get('annotation-sources').children.length, 1);
  const filter = checked => {
    const event = new Event('change'); Object.defineProperty(event, 'target', { value: { dataset: { source: 'shared' }, checked } });
    s.get('annotation-sources').dispatchEvent(event);
  };
  filter(false);
  assert.equal(s.overlay.getState().active, 1); assert.equal(s.layer.visible, false);
  assert.equal(s.overlay.globalList.children.length, 1);
  assert.equal(s.overlay.globalList.children[0].children[1].children[0].textContent, 'Independent note');
  filter(true);
  assert.equal(s.overlay.getState().active, 4); assert.equal(s.layer.visible, true);
  s.video.currentTime = 1; s.frame();
  assert.equal(s.overlay.getState().active, 0); assert.equal(s.layer.visible, false);
  assert.equal(s.overlay.globals.hidden, true); s.overlay.dispose();
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

test('changing shapes or display scale does not replace unchanged global text nodes', async () => {
  const s = setupOverlay();
  await s.overlay.load(s.file([{ start: 0, end: 10, label: 'Persistent note' }, box(), point()]));
  const row = s.overlay.globalList.children[0];
  s.video.currentTime = .3; s.frame();
  assert.equal(s.overlay.globalList.children[0], row);
  s.overlay.update({ time: .3, hasVideo: true, width: 720, height: 720, sourceDisplayWidth: 800 });
  assert.equal(s.overlay.globalList.children[0], row);
  await s.overlay.load(s.file([{ start: 0, end: 10, label: 'Replacement note' }]));
  assert.notEqual(s.overlay.globalList.children[0], row);
  assert.equal(s.overlay.globalList.children[0].children[1].children[0].textContent, 'Replacement note');
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

test('URI-backed handles reserve import order immediately and validate the resolved file', async () => {
  for (const action of ['replace', 'clear', 'dispose']) {
    const s = setupOverlay(); let resolve;
    assert.equal(s.drop([{ name: 'slow.json', getFile: () => new Promise(r => { resolve = r; }) }]), true);
    if (action === 'replace') await s.overlay.load(s.file([point()], 'new.json'));
    else s.overlay[action]();
    resolve(s.file([box()], 'slow.json')); await new Promise(setImmediate);
    assert.equal(s.overlay.getState().name, action === 'replace' ? 'new.json' : null);
    if (action !== 'dispose') s.overlay.dispose();
  }
  const s = setupOverlay(); await s.overlay.load(s.file([box()]));
  for (const getFile of [async () => ({ name: 'empty.json', size: 0 }),
    async () => ({ name: 'huge.json', size: 21 * 1024 * 1024 }),
    async () => { throw new Error('Cannot read dropped URI'); }]) {
    assert.equal(s.drop([{ name: 'uri.json', getFile }]), true); await new Promise(setImmediate);
    assert.equal(s.overlay.getState().name, 'labels.json'); assert.match(s.get('annotation-status').textContent, /unchanged/);
  }
  s.overlay.dispose();
});

test('annotation plugin owns only its panel, frame subscription and a generic layer', async () => {
  const s = setupOverlay();
  await s.overlay.load(s.file([box()])); assert.equal(s.layer.visible, true);
  assert.equal(s.overlay.raw, s.layer.canvas);
  s.overlay.dispose(); assert.equal(s.layer.disposed, true);
  s.video.currentTime = .3; s.frame(); assert.equal(s.overlay.getState().active, 1);
});
