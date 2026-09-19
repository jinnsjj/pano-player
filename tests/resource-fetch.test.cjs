const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { buildSync } = require('esbuild');
const path = require('node:path');

test('webview resource bridge preserves ranges, streams with backpressure and cancels', async () => {
  const bundle = buildSync({ entryPoints: [path.join(__dirname, '../src/resource-fetch.js')],
    bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text;
  let reads = 0, cancelled = false, api;
  const context = { exports: {}, module: { exports: {} }, MessageChannel, ReadableStream,
    Response, Headers, AbortController, DOMException,
    fetch: async (url, init) => {
      assert.equal(url, 'https://media.test/video');
      assert.equal(new Headers(init.headers).get('range'), 'bytes=10-');
      return new Response(new ReadableStream({
        pull(controller) { reads++; controller.enqueue(new Uint8Array([reads])); },
        cancel() { cancelled = true; },
      }, { highWaterMark: 0 }), { status: 206, headers: { 'Content-Range': 'bytes 10-99/100' } });
    },
    postMessage: message => { void api.serveResource(message.port, message.url, message.init); },
  };
  vm.runInNewContext(bundle, context); api = context.module.exports;
  const response = await api.resourceFetch('https://media.test/video', { headers: { Range: 'bytes=10-' } });
  assert.equal(response.status, 206); assert.equal(response.headers.get('Content-Range'), 'bytes 10-99/100');
  assert.equal(reads, 0);
  const reader = response.body.getReader();
  assert.deepEqual([...(await reader.read()).value], [1]);
  assert.equal(reads, 1);
  await reader.cancel();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(cancelled, true);
});
