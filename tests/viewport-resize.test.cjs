const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { buildSync } = require('esbuild');
const bundle = buildSync({ entryPoints: [require.resolve('../media/viewport-resize.js')], bundle: true,
  format: 'cjs', write: false }).outputFiles[0].text;
function setup() {
  const handlers = {}, attributes = {}, values = {};
  let captured, sync, disconnected = false, aspect = 16 / 9;
  const layout = { clientHeight: 1100 }, transport = { getBoundingClientRect: () => ({ height: 65 }) };
  const stage = { parentElement: { clientWidth: 1008 },
    style: { setProperty: (key, value) => { values[key] = value; }, removeProperty: key => { delete values[key]; } },
    getBoundingClientRect: () => ({ height: Math.min(parseFloat(values['--stage-height']) || 400,
      parseFloat(values['--stage-max-height']) || Infinity, 960 / aspect) }) };
  const handle = { addEventListener: (name, fn) => { handlers[name] = fn; },
    setAttribute: (key, value) => { attributes[key] = value; }, focus() {}, getBoundingClientRect: () => ({ height: 24 }),
    setPointerCapture: id => { captured = id; }, hasPointerCapture: id => captured === id,
    releasePointerCapture: () => { captured = undefined; } };
  const context = { module: { exports: {} }, exports: {}, AbortController,
    window: { innerHeight: 900, addEventListener() {} },
    getComputedStyle: () => ({ paddingLeft: '24', paddingRight: '24', paddingTop: '16', paddingBottom: '16',
      borderTopWidth: '1', borderBottomWidth: '1', getPropertyValue: () => String(aspect) }),
    ResizeObserver: class { constructor(fn) { sync = fn; } observe() {} disconnect() { disconnected = true; } } };
  vm.runInNewContext(bundle, context);
  const dispose = context.module.exports.attachViewportResize(stage, handle, layout, transport);
  const fire = (name, overrides = {}) => handlers[name]({ button: 0, isPrimary: true, pointerId: 1, clientY: 500,
    preventDefault() {}, stopPropagation() {}, ...overrides });
  return { stage, layout, transport, attributes, values, fire, sync, dispose, captured: () => captured,
    disconnected: () => disconnected, setAspect: value => { aspect = value; } };
}
test('drag resizes from actual height, clamps to available width, and releases capture', () => {
  const s = setup();
  s.fire('pointerdown', { button: 2 }); assert.equal(s.captured(), undefined);
  s.fire('pointerdown'); assert.equal(s.captured(), 1);
  s.fire('pointermove', { clientY: 560, pointerId: 2 }); assert.equal(s.values['--stage-height'], undefined);
  s.fire('pointermove', { clientY: 560 }); assert.equal(s.values['--stage-height'], '460px');
  s.fire('pointermove', { clientY: 1000 }); assert.equal(s.values['--stage-height'], '540px');
  s.fire('pointermove', { clientY: 980 }); assert.equal(s.values['--stage-height'], '520px');
  s.fire('pointermove', { clientY: 0 }); assert.equal(s.values['--stage-height'], '120px');
  s.fire('pointerup'); assert.equal(s.captured(), undefined);
  s.fire('pointermove', { clientY: 500 }); assert.equal(s.values['--stage-height'], '120px');
  s.dispose(); assert.equal(s.disconnected(), true);
});
test('short windows and wrapped transport reserve scrollable settings without losing manual height', () => {
  const s = setup();
  s.fire('keydown', { key: 'End' });
  s.layout.clientHeight = 360; s.sync();
  assert.equal(s.values['--stage-max-height'], '117px');
  assert.equal(s.attributes['aria-valuemin'], 117);
  assert.equal(s.attributes['aria-valuemax'], 117);
  assert.equal(s.attributes['aria-valuenow'], 117);
  assert.equal(s.values['--stage-height'], '540px');
  s.transport.getBoundingClientRect = () => ({ height: 109 }); s.sync();
  assert.equal(s.values['--stage-max-height'], '73px');
  s.fire('keydown', { key: 'End' }); assert.equal(s.values['--stage-height'], '73px');
  s.layout.clientHeight = 1000; s.sync();
  assert.equal(s.values['--stage-max-height'], '540px');
  s.fire('dblclick'); assert.equal(s.values['--stage-height'], undefined);
  assert.equal(s.stage.getBoundingClientRect().height, 400);
  s.dispose();
});
test('keyboard, reset, ratio changes and pointer cancellation remain usable', () => {
  const s = setup();
  s.fire('keydown', { key: 'ArrowUp' }); assert.equal(s.values['--stage-height'], '380px');
  s.fire('keydown', { key: 'ArrowDown' }); assert.equal(s.values['--stage-height'], '400px');
  s.fire('keydown', { key: 'End' }); assert.equal(s.values['--stage-height'], '540px');
  s.setAspect(4 / 3); s.fire('keydown', { key: 'End' }); assert.equal(s.values['--stage-height'], '720px');
  s.sync(); assert.equal(s.attributes['aria-valuenow'], 720); assert.equal(s.attributes['aria-valuemax'], 720);
  s.fire('keydown', { key: 'Home' }); assert.equal(s.values['--stage-height'], '120px');
  s.fire('dblclick'); assert.equal(s.values['--stage-height'], undefined);
  s.fire('pointerdown'); s.fire('pointercancel'); assert.equal(s.captured(), undefined);
  s.fire('pointermove', { clientY: 600 }); assert.equal(s.values['--stage-height'], undefined);
  s.fire('pointerdown'); s.fire('lostpointercapture'); s.fire('pointermove', { clientY: 600 });
  assert.equal(s.values['--stage-height'], undefined);
  s.dispose();
});
