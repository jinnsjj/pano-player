const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const path = require('node:path');
const { buildSync } = require('esbuild');
const bundle = buildSync({ entryPoints: [path.join(__dirname, '../web/host.js')],
  bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text;
const context = { module: { exports: {} }, exports: {} };
vm.runInNewContext(bundle, context);
const { createPreferences, validateFile, capabilityError, preferencesKey } = context.module.exports;

test('web preferences normalize persisted values and save no file data', () => {
  const storage = new Map([[preferencesKey, JSON.stringify({ volume: 7, order: 'WXYZ', name: 'private.wav' })]]);
  const prefs = createPreferences(() => ({ getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) }));
  assert.equal(prefs.read().volume, 1); assert.equal(prefs.read().order, 'WXYZ');
  assert.equal(prefs.read().name, undefined);
  prefs.save({ volume: .4, file: { name: 'private.wav' }, projection: 'eac' });
  const saved = JSON.parse(storage.get(preferencesKey));
  assert.equal(saved.volume, .4); assert.equal(saved.projection, 'eac'); assert.equal(saved.file, undefined);
  const copy = prefs.read(); copy.volume = 0; assert.equal(prefs.read().volume, .4);
});

test('web preferences survive invalid JSON and denied localStorage', () => {
  for (const getStorage of [() => { throw new Error('SecurityError'); }, () => ({ getItem: () => '{broken', setItem: () => { throw new Error('QuotaExceeded'); } })]) {
    const prefs = createPreferences(getStorage);
    assert.equal(prefs.read().volume, 1);
    prefs.save({ volume: .2 }); assert.equal(prefs.read().volume, .2);
  }
});

test('web file validation checks extensions and empty files without reading contents', () => {
  const file = name => ({ name, size: 1024, slice() { throw new Error('Must not read during validation'); } });
  for (const ext of ['MP4', 'webm', 'WAV', 'flac', 'mov', 'mkv']) assert.equal(validateFile(file(`local.${ext}`)), null);
  assert.match(validateFile(file('report.txt')), /Unsupported/);
  assert.match(validateFile({ ...file('empty.wav'), size: 0 }), /empty/);
  assert.match(validateFile(null), /Select/);
});

test('web entry reports missing secure context and media APIs', () => {
  const browser = { isSecureContext: true, Worker() {}, AudioContext() {}, AudioWorkletNode() {}, VideoDecoder() {} };
  assert.equal(capabilityError(browser), null);
  assert.match(capabilityError({ ...browser, isSecureContext: false }), /HTTPS/);
  assert.match(capabilityError({ ...browser, VideoDecoder: undefined }), /media APIs/);
});
