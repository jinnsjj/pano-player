const test = require('node:test');
const assert = require('node:assert/strict');
const { defaults, normalize } = require('../src/preferences.cjs');
test('preferences validate persisted or webview values and never retain transient media state', () => {
  assert.deepEqual(normalize(null), defaults);
  assert.equal(defaults.volume, 1);
  assert.equal(defaults.enabled, false);
  assert.equal(normalize({ enabled: true }).enabled, true);
  assert.equal(normalize({ volume: .3 }).volume, .3);
  const actual = normalize({ projection: '<script>', listening: 'bypass', volume: 8, opacity: -1,
    fov: Infinity, enabled: 'false', muted: true, yaw: 99, currentTime: 42, paused: false });
  assert.deepEqual(actual, { ...defaults, volume: 1, opacity: 0, muted: true, yaw: Math.PI });
  assert.equal(normalize({ gridOpacity: 8 }).gridOpacity, 1);
  assert.equal(normalize({ gridOpacity: -.1 }).gridOpacity, 0);
  assert.equal(normalize({ gridOpacity: .3 }).gridOpacity, .3);
});
