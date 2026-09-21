const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { buildSync } = require('esbuild');

const bundle = buildSync({ entryPoints: [require.resolve('../media/view.js')], bundle: true,
  external: ['./three.module.js'], write: false, format: 'cjs' }).outputFiles[0].text;
async function setup() {
  const three = await import('../media/three.module.js');
  let now = 200;
  function canvas() {
    const context = { draws: [], paints: 0, fillRect() { this.draws = []; this.paints++; },
      drawImage(image) { this.draws.push(image); }, putImageData(image) { this.image = image; } };
    return { width: 240, height: 120, getContext: () => context, setAttribute() {}, remove() {} };
  }
  const host = { clientWidth: 640, clientHeight: 360, append() {}, addEventListener() {} };
  const source = canvas(), map = canvas(), grid = canvas();
  const video = { element: source, readyState: 0, paused: true, currentTime: 0 };
  const window = {};
  vm.runInNewContext(bundle, {
    window, require: () => ({ ...three, WebGLRenderer: class {
      domElement = canvas(); setPixelRatio() {} setSize() {} render() {} dispose() {}
    } }), document: { createElement: canvas }, devicePixelRatio: 1,
    ResizeObserver: class { observe() {} disconnect() {} }, AbortController,
    performance: { now: () => now }, ImageData: class { constructor(data) { this.data = data; } },
  });
  const overviewHost = { children: [], append(child) { this.children.push(child); } };
  const view = new window.FoaView(host, video, map, { setOrientation() {} }, grid, overviewHost);
  return { view, video, source, overviewHost, advance(ms) { now += ms; } };
}

test('floating overview owns the thumbnail and reopens fresh while playback is paused', async () => {
  const { view, video, source, overviewHost, advance } = await setup();
  assert.equal(overviewHost.children[0], view.thumbnail);
  video.readyState = 3; view.configure(true, true, '360');
  const paints = view.thumbContext.paints, footprint = view.footprintKey;
  view.setOverviewEnabled(false);
  advance(200); video.currentTime = 5; view.sourceChanged(); view.orient(1, .2);
  assert.equal(view.thumbContext.paints, paints, 'Hidden overview must skip drawing');
  view.setOverviewEnabled(true);
  assert.equal(view.thumbContext.paints, paints + 1);
  assert.ok(view.thumbContext.draws.includes(source));
  assert.notEqual(view.footprintKey, footprint);
  view.dispose();
});

test('paused first frame immediately replaces the blank thumbnail inside the refresh interval', async () => {
  const { view, video, source, advance } = await setup();
  view.configure(true, true, '360');
  assert.ok(!view.thumbContext.draws.includes(source));
  advance(5); video.readyState = 3;
  view.sourceChanged();
  assert.ok(view.thumbContext.draws.includes(source), 'first decoded frame must appear without play or camera input');
  const paints = view.thumbContext.paints;
  advance(5); video.currentTime = 4; view.sourceChanged();
  assert.equal(view.thumbContext.paints, paints + 1, 'paused seeks must also bypass the thumbnail throttle');
  view.dispose();
});

test('playing source updates remain throttled while camera movement is immediate', async () => {
  const { view, video, advance } = await setup(); video.readyState = 3;
  view.configure(true, true, '360'); video.paused = false;
  const paints = view.thumbContext.paints;
  advance(5); view.sourceChanged(); view.render();
  assert.equal(view.thumbContext.paints, paints);
  advance(100); view.sourceChanged(); view.render();
  assert.equal(view.thumbContext.paints, paints + 1);
  view.orient(.5, .1);
  assert.equal(view.thumbContext.paints, paints + 2);
  view.dispose();
});

test('new Perspective view restores the same footprint as the remembered camera', async () => {
  const first = await setup(); first.video.readyState = 3;
  first.view.configure(true, true, '360');
  first.view.zoom(85); first.view.orient(1.2, .3);
  const saved = first.view.getState();
  const expected = Array.from(first.view.footprint.getContext('2d').image.data);
  const next = await setup(); next.video.readyState = 3;
  // The player restores preferences before making a newly created view active.
  next.view.restore(saved); next.view.configure(true, true, '360');
  assert.deepEqual(Array.from(next.view.camera.matrixWorld.elements), Array.from(first.view.camera.matrixWorld.elements));
  assert.ok(next.view.footprint.getContext('2d').image.data.every((value, index) => value === expected[index]),
    'overview footprint must match restored yaw, pitch and FOV, not the forward camera');
  first.view.dispose(); next.view.dispose();
});

test('Panorama to Perspective round trip preserves the turned footprint', async () => {
  const { view, video } = await setup(); video.readyState = 3;
  view.configure(true, true, '360'); view.orient(-1, -.2);
  const expected = Array.from(view.footprint.getContext('2d').image.data);
  view.configure(false, true, '360'); view.configure(true, true, '360');
  assert.ok(view.footprint.getContext('2d').image.data.every((value, index) => value === expected[index]));
  view.dispose();
});
