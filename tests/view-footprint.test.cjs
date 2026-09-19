const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
test('overview footprint tracks FOV, yaw wraparound, and upward view', async () => {
  const source = fs.readFileSync(require.resolve('../media/view-footprint.js'), 'utf8');
  const { viewFootprint } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const mask = (m, fov = 72) => viewFootprint(m, fov, 16 / 9, 240, 120);
  const at = (data, x, y) => data[(y * 240 + x) * 4 + 3];
  const front = mask(identity);
  assert.equal(at(front, 120, 60), 0); assert.equal(at(front, 0, 60), 145);
  const count = data => data.filter((v, i) => i % 4 === 3 && v === 0).length;
  assert.ok(count(mask(identity, 100)) > count(front));
  const back = mask([-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1]);
  assert.equal(at(back, 0, 60), 0); assert.equal(at(back, 239, 60), 0); assert.equal(at(back, 120, 60), 145);
  const up = mask([1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1]);
  assert.equal(at(up, 120, 0), 0); assert.equal(at(up, 120, 119), 145);
  assert.ok(front.some((v, i) => i % 4 === 0 && v === 80));
});
