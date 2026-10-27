const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { hostFile } = require('../src/host-file.cjs');
const vm = require('node:vm');
const { buildSync } = require('esbuild');

test('host media reads exact bounded offsets from only its owned file', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pano-player-range-'));
  const file = path.join(dir, 'source');
  const bytes = Buffer.alloc(600000);
  for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
  await fs.writeFile(file, bytes);
  const replies = [], media = hostFile(file, reply => replies.push(reply));
  try {
    await media.read({ id: 1, offset: 123457, length: 262144, path: '/not-allowed' });
    assert.equal(replies[0].size, bytes.length);
    assert.deepEqual(Buffer.from(replies[0].data), bytes.subarray(123457, 123457 + 262144));
    await media.read({ id: 2, offset: -1, length: 1 });
    await media.read({ id: 3, offset: 0, length: 262145 });
    assert.ok(replies.slice(1).every(reply => /Invalid/.test(reply.error)));
    await media.read({ id: 4, offset: 599998, length: 8 });
    assert.equal(replies.at(-1).data.byteLength, 2);
  } finally { media.dispose(); await fs.rm(dir, { recursive: true, force: true }); }
});

test('concurrent host fetchers route original and external audio without request-ID collisions', async () => {
  const bundle = buildSync({ entryPoints: [path.join(__dirname, '../src/host-fetch.js')],
    bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text;
  const window = new EventTarget();
  const context = { module: { exports: {} }, exports: {}, window, ReadableStream, Response,
    Headers, Uint8Array, DOMException, fetch: () => { throw new Error('Unselected network resource'); } };
  vm.runInNewContext(bundle, context);
  const messages = [], abort = new AbortController();
  const api = { mediaSourceId: url => url === 'pano-audio:external' ? 'external' : undefined,
    postMessage(message) {
      messages.push(message);
      queueMicrotask(() => window.dispatchEvent(new MessageEvent('message', { data: {
        type: 'media-range', id: message.id, size: 1, data: Uint8Array.of(message.sourceId === 'primary' ? 1 : 2).buffer,
      } })));
    } };
  const primary = context.module.exports.createHostFetch(api, 'media:original', abort.signal);
  const external = context.module.exports.createHostFetch(api, 'media:original', abort.signal);
  const [a, b] = await Promise.all([primary('media:original'), external('pano-audio:external')]);
  assert.equal(new Uint8Array(await a.arrayBuffer())[0], 1);
  assert.equal(new Uint8Array(await b.arrayBuffer())[0], 2);
  assert.equal(new Set(messages.map(message => message.id)).size, 2);
  abort.abort();
});

test('host fetch streams exact bytes across successive blocks and cancels without reading the whole file', async () => {
  const bundle = buildSync({ entryPoints: [path.join(__dirname, '../src/host-fetch.js')],
    bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text;
  const window = new EventTarget();
  const context = { module: { exports: {} }, exports: {}, window, ReadableStream, Response,
    Headers, Uint8Array, DOMException, fetch };
  vm.runInNewContext(bundle, context);
  const offsets = [], abort = new AbortController();
  const api = { postMessage(message) {
    offsets.push(message.offset);
    const data = new Uint8Array(262144).fill(message.offset / 262144);
    queueMicrotask(() => window.dispatchEvent(new MessageEvent('message', { data: {
      type: 'media-range', id: message.id, size: 10000000, data: data.buffer,
    } })));
  } };
  const fetchMedia = context.module.exports.createHostFetch(api, 'media:test', abort.signal);
  try {
    const response = await fetchMedia('media:test', { headers: { Range: 'bytes=262144-' } });
    assert.equal(response.headers.get('Content-Range'), 'bytes 262144-9999999/10000000');
    const reader = response.body.getReader();
    assert.equal((await reader.read()).value[0], 1);
    assert.equal((await reader.read()).value[0], 2);
    await reader.cancel();
    assert.deepEqual(offsets, [262144, 524288]);
  } finally { abort.abort(); }
});
