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
    await media.read({ id: 3, offset: 0, length: 1048577 });
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

test('host fetch streams exact bytes across ramped blocks, prefetches one block and stops on cancel', async () => {
  const bundle = buildSync({ entryPoints: [path.join(__dirname, '../src/host-fetch.js')],
    bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text;
  const window = new EventTarget();
  const context = { module: { exports: {} }, exports: {}, window, ReadableStream, Response,
    Headers, Uint8Array, DOMException, fetch };
  vm.runInNewContext(bundle, context);
  const requests = [], abort = new AbortController();
  const size = 10000000, byteAt = offset => Math.floor(offset / 65536) % 256;
  const api = { postMessage(message) {
    requests.push([message.offset, message.length]);
    const data = new Uint8Array(Math.min(message.length, size - message.offset));
    for (let i = 0; i < data.length; i += 65536) data.fill(byteAt(message.offset + i), i, i + 65536);
    queueMicrotask(() => window.dispatchEvent(new MessageEvent('message', { data: {
      type: 'media-range', id: message.id, size, data: data.buffer,
    } })));
  } };
  const fetchMedia = context.module.exports.createHostFetch(api, 'media:test', abort.signal);
  try {
    const response = await fetchMedia('media:test', { headers: { Range: 'bytes=262144-' } });
    assert.equal(response.headers.get('Content-Range'), 'bytes 262144-9999999/10000000');
    const reader = response.body.getReader();
    let position = 262144;
    for (const expected of [262144, 524288, 1048576]) {
      const { value } = await reader.read();
      assert.equal(value.length, expected);
      assert.equal(value[0], byteAt(position)); assert.equal(value.at(-1), byteAt(position + expected - 1));
      position += expected;
    }
    await reader.cancel();
    // Three consumed blocks plus exactly one prefetched block; nothing more after cancel.
    assert.deepEqual(requests, [[262144, 262144], [524288, 524288], [1048576, 1048576], [2097152, 1048576]]);
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(requests.length, 4);
  } finally { abort.abort(); }
});

test('host fetch rejects short host reads instead of silently shifting media bytes', async () => {
  const bundle = buildSync({ entryPoints: [path.join(__dirname, '../src/host-fetch.js')],
    bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text;
  const window = new EventTarget();
  const context = { module: { exports: {} }, exports: {}, window, ReadableStream, Response,
    Headers, Uint8Array, DOMException, fetch };
  vm.runInNewContext(bundle, context);
  const abort = new AbortController();
  const api = { postMessage(message) {
    const data = new Uint8Array(message.offset ? 10 : message.length);
    queueMicrotask(() => window.dispatchEvent(new MessageEvent('message', { data: {
      type: 'media-range', id: message.id, size: 4000000, data: data.buffer } })));
  } };
  const fetchMedia = context.module.exports.createHostFetch(api, 'media:test', abort.signal);
  try {
    const reader = (await fetchMedia('media:test')).body.getReader();
    await reader.read();
    await assert.rejects(reader.read(), /truncated/);
  } finally { abort.abort(); }
});

test('pipelined host reads sustain high-bitrate playback over a high-latency Remote link', async () => {
  const bundle = buildSync({ entryPoints: [path.join(__dirname, '../src/host-fetch.js')],
    bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text;
  const window = new EventTarget();
  const context = { module: { exports: {} }, exports: {}, window, ReadableStream, Response,
    Headers, Uint8Array, DOMException, fetch };
  vm.runInNewContext(bundle, context);
  const abort = new AbortController(), size = 64 * 1048576, roundTripMs = 40;
  const api = { postMessage(message) {
    const data = new Uint8Array(Math.min(message.length, size - message.offset));
    setTimeout(() => window.dispatchEvent(new MessageEvent('message', { data: {
      type: 'media-range', id: message.id, size, data: data.buffer } })), roundTripMs);
  } };
  const fetchMedia = context.module.exports.createHostFetch(api, 'media:test', abort.signal);
  try {
    const started = performance.now();
    const reader = (await fetchMedia('media:test')).body.getReader();
    let received = 0;
    while (received < 16 * 1048576) received += (await reader.read()).value.length;
    await reader.cancel();
    const mbps = received * 8 / 1e6 / ((performance.now() - started) / 1000);
    // 256 KiB per serial 40 ms round trip was ~52 Mbit/s; 8K/60 HEVC needs ~150 Mbit/s.
    assert.ok(mbps > 150, `Remote-latency throughput ${mbps.toFixed(0)} Mbit/s`);
  } finally { abort.abort(); }
});
