const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { buildSync } = require('esbuild');

test('loading a second FFmpeg variant preserves the first factory and shares each immutable binary across seeks', async () => {
  const source = buildSync({ entryPoints: [require.resolve('../src/libav-loader.js')],
    bundle: true, format: 'cjs', write: false }).outputFiles[0].text;
  const requests = [];
  let imported = 0;
  const context = { module: { exports: {} }, exports: {}, Blob, URL, Uint8Array,
    fetch: async url => {
      requests.push(url);
      return { ok: true, text: async () => '', arrayBuffer: async () => Uint8Array.of(0, 97, 115, 109).buffer };
    },
    importScripts() {
      const variant = ++imported;
      context.LibAV = { variant }; context.LibAVFactory = options => ({ variant, ...options });
    },
  };
  vm.runInNewContext(source, context);
  const { loadLibav } = context.module.exports;
  const aac = await loadLibav('aac.js');
  const hevc = await loadLibav('hevc.js');
  assert.equal(aac.wrapper.variant, 2); assert.equal(aac.factory({}).variant, 2);
  assert.equal(hevc.wrapper.variant, 4); assert.equal(hevc.factory({}).variant, 4);
  assert.notEqual(aac.factory, hevc.factory, 'AAC cannot accidentally instantiate the last-loaded HEVC-only build');
  assert.equal(await loadLibav('aac.js'), aac);
  assert.equal(await loadLibav('hevc.js'), hevc);
  assert.equal(requests.length, 6);
  assert.deepEqual([...hevc.factory({}).wasmBinary], [0, 97, 115, 109]);
});
