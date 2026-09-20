const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { buildSync } = require('esbuild');

test('grid uses full-sphere FOA axes and clears completely when disabled', () => {
  const code = buildSync({ entryPoints: [require.resolve('../media/direction-grid.js')],
    bundle: true, format: 'cjs', write: false }).outputFiles[0].text;
  const context = { module: { exports: {} } }; vm.runInNewContext(code, context);
  const { drawDirectionGrid } = context.module.exports;
  const labels = [], lines = []; let cleared = 0;
  const ctx = { clearRect() { cleared++; }, save() {}, restore() {}, beginPath() {},
    moveTo(x, y) { lines.push([x, y]); }, lineTo() {}, stroke() {}, strokeText() {},
    fillText(text, x, y) { labels.push({ text, x, y }); } };
  const canvas = { width: 2048, height: 1024, getContext: () => ctx };
  drawDirectionGrid(canvas, true);
  assert.equal(ctx.globalAlpha, 1);
  assert.equal(lines.length, 18, '30-degree meridians and elevation lines');
  for (const [text, x] of [['Front 0\u00b0', 1024], ['Left +90\u00b0', 512], ['Right -90\u00b0', 1536]]) {
    assert.equal(labels.find(label => label.text === text).x, x);
  }
  assert.ok(labels.find(label => label.text === '+60\u00b0' && label.y < 512));
  assert.ok(labels.find(label => label.text === '-60\u00b0' && label.y > 512));
  labels.length = 0; lines.length = 0;
  drawDirectionGrid(canvas, false);
  assert.equal(cleared, 2); assert.equal(labels.length, 0); assert.equal(lines.length, 0);
  drawDirectionGrid(canvas, true, .25); assert.equal(ctx.globalAlpha, .25);
});
