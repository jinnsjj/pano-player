const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { buildSync } = require('esbuild');

const bundle = buildSync({ entryPoints: [require.resolve('../src/video-proxy.js')],
  bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text;
const streamId = 'a'.repeat(32), config = { codedWidth: 4096, codedHeight: 4096 };

function bridge() {
  const module = { exports: {} }, listeners = new Set(), timers = new Map(), requests = [];
  let timerId = 0, sessions = 0;
  const window = {
    addEventListener(type, listener) { assert.equal(type, 'message'); listeners.add(listener); },
    removeEventListener(type, listener) { assert.equal(type, 'message'); listeners.delete(listener); },
  };
  vm.runInNewContext(bundle, { module, exports: module.exports, window, ArrayBuffer, Uint8Array,
    ReadableStream, Response, DOMException,
    crypto: { randomUUID: () => `11111111-2222-4333-8444-${String(++sessions).padStart(12, '0')}` },
    setTimeout(callback, delay) { timers.set(++timerId, { callback, delay }); return timerId; },
    clearTimeout(id) { timers.delete(id); },
  });
  const api = { postMessage: data => requests.push(data) };
  const reply = (request, data) => {
    for (const listener of [...listeners]) listener({ data: { type: 'video-stream', session: request.session,
      id: request.id, streamId, ...data } });
  };
  const open = async (data = {}, abort = new AbortController()) => {
    const response = module.exports.fetchVideoStream(api, 7.5, config, abort.signal);
    const request = requests.at(-1);
    reply(request, { backend: 'VideoToolbox', ...data });
    return { response: await response, request, abort };
  };
  return { api, open, reply, requests, timers, listeners, fetch: module.exports.fetchVideoStream };
}
const tick = () => new Promise(setImmediate);

test('native stream opens without media paths and reads one bounded chunk per pull', async () => {
  const b = bridge(), { response, request } = await b.open({ timeOrigin: 7.5 });
  assert.equal(request.type, 'open-video-stream'); assert.equal(request.id, 1); assert.equal(request.time, 7.5);
  assert.equal(request.width, 4096); assert.equal(request.height, 4096);
  assert.equal(response.headers.get('X-Pano-Backend'), 'VideoToolbox');
  assert.equal(response.headers.get('X-Pano-Time-Origin'), '7.5');
  assert.equal(response.headers.get('Content-Length'), null);
  assert.equal(b.requests.length, 1, 'No eager reads before a consumer requests data');
  const reader = response.body.getReader(), first = reader.read();
  await tick();
  const read = b.requests.at(-1);
  assert.equal(read.type, 'read-video-stream'); assert.equal(read.streamId, streamId);
  assert.equal(read.id, 2); assert.equal(read.session, request.session);
  b.reply(read, { data: Uint8Array.from([1, 2, 3]).buffer });
  assert.deepEqual([...(await first).value], [1, 2, 3]);
  await tick(); assert.equal(b.requests.length, 2, 'ReadableStream highWaterMark zero preserves backpressure');
  const final = reader.read(); await tick();
  b.reply(b.requests.at(-1), { data: Uint8Array.from([4]).buffer, eof: true });
  assert.deepEqual([...(await final).value], [4]); assert.equal((await reader.read()).done, true);
  assert.equal(b.requests.at(-1).type, 'close-video-stream');
  assert.equal(b.requests.at(-1).streamId, streamId);
  assert.equal(b.listeners.size, 0); assert.equal(b.timers.size, 0);
});

test('native stream matches session and request ids and gives each open a unique session', async () => {
  const b = bridge(), abort = new AbortController();
  let resolved = false;
  const pending = b.fetch(b.api, 0, config, abort.signal).then(value => { resolved = true; return value; });
  const request = b.requests[0];
  b.reply(request, { session: 'another', backend: 'VideoToolbox' });
  b.reply(request, { id: request.id + 1, backend: 'VideoToolbox' });
  b.reply(request, { type: 'other', backend: 'VideoToolbox' });
  await tick(); assert.equal(resolved, false);
  b.reply(request, { backend: 'VideoToolbox' });
  const response = await pending;
  b.reply(request, { id: undefined, backend: 'VideoToolbox' });
  await response.body.cancel();
  const second = await b.open();
  assert.notEqual(second.request.session, request.session); assert.ok(second.request.id > request.id);
  await second.response.body.cancel();
  assert.equal(b.listeners.size, 0); assert.equal(b.timers.size, 0);
});

test('native stream rejects path-like stream ids and malformed backend or timestamp metadata', async () => {
  for (const data of [{ streamId: '/private/tmp/video.mp4' }, { streamId: 'https://example.test/video.mp4' },
    { streamId: 'A'.repeat(32) }, { backend: '' }, { backend: 'x'.repeat(81) }, { backend: 'Native\nVideo' },
    { timeOrigin: Infinity }, { timeOrigin: '7.5' }]) {
    const b = bridge();
    await assert.rejects(b.open(data), /Invalid video stream response/);
    assert.equal(b.requests.at(-1).type, 'close-video-stream');
    assert.equal(b.listeners.size, 0); assert.equal(b.timers.size, 0);
  }
});

test('native stream rejects malformed chunks and closes its host stream', async () => {
  for (const data of [{ data: new ArrayBuffer(262145) }, { data: new Uint8Array(4) },
    { data: 'bytes' }, { data: new ArrayBuffer(0) }, {}, { streamId: 'b'.repeat(32), eof: true },
    { data: new ArrayBuffer(1), eof: 'true' }, { error: '' }, { error: 'x'.repeat(2001) }]) {
    const b = bridge(), { response } = await b.open();
    const read = response.body.getReader().read(); await tick();
    b.reply(b.requests.at(-1), data);
    await assert.rejects(read, /Invalid video stream response/);
    assert.equal(b.requests.at(-1).type, 'close-video-stream');
    assert.equal(b.listeners.size, 0); assert.equal(b.timers.size, 0);
  }
});

test('native stream aborts pending open and pending reads, times out each request and cleans listeners', async () => {
  for (const phase of ['open', 'read']) for (const reason of ['abort', 'timeout']) {
    const b = bridge(), abort = new AbortController();
    let pending;
    if (phase === 'open') pending = b.fetch(b.api, 0, config, abort.signal);
    else {
      const { response } = await b.open({}, abort);
      pending = response.body.getReader().read(); await tick();
    }
    assert.equal(b.timers.values().next().value.delay, 30000);
    const rejected = assert.rejects(pending, reason === 'abort' ? /cancelled/ : /timed out/);
    if (reason === 'abort') abort.abort(); else b.timers.values().next().value.callback();
    await rejected;
    assert.equal(b.requests.at(-1).type, 'close-video-stream');
    if (phase === 'open') assert.equal(b.requests.at(-1).streamId, undefined, 'Open cancellation uses its owned session');
    assert.equal(b.listeners.size, 0); assert.equal(b.timers.size, 0);
  }
});

test('native stream body cancellation settles pending pulls and host errors remain visible', async () => {
  const b = bridge(), { response } = await b.open();
  const reader = response.body.getReader(), pending = reader.read(); await tick();
  await reader.cancel(); assert.equal((await pending).done, true);
  assert.equal(b.requests.filter(request => request.type === 'close-video-stream').length, 1);
  assert.equal(b.listeners.size, 0); assert.equal(b.timers.size, 0);
  const failed = bridge(), next = await failed.open();
  const read = next.response.body.getReader().read(); await tick();
  failed.reply(failed.requests.at(-1), { error: 'Native decoder unavailable.' });
  await assert.rejects(read, /Native decoder unavailable/);
  assert.equal(failed.listeners.size, 0); assert.equal(failed.timers.size, 0);
});

test('native stream rejects aborts between host open acknowledgement and response creation', async () => {
  const b = bridge(), abort = new AbortController();
  const pending = b.fetch(b.api, 0, config, abort.signal);
  b.reply(b.requests[0], { backend: 'VideoToolbox' });
  abort.abort();
  await assert.rejects(pending, /cancelled/);
  assert.equal(b.listeners.size, 0); assert.equal(b.timers.size, 0);
  assert.equal(b.requests.filter(request => request.type === 'close-video-stream').length, 1);
});

test('native stream validates inputs before contacting the host and handles synchronous host failure', async () => {
  for (const [time, dimensions] of [[-1, config], [NaN, config], [0, {}], [0, { codedWidth: 0, codedHeight: 1 }]]) {
    const b = bridge(); await assert.rejects(b.fetch(b.api, time, dimensions), /Invalid video stream request/);
    assert.equal(b.requests.length, 0); assert.equal(b.listeners.size, 0); assert.equal(b.timers.size, 0);
  }
  const b = bridge(), abort = new AbortController(); abort.abort();
  await assert.rejects(b.fetch(b.api, 0, config, abort.signal), /cancelled/);
  assert.equal(b.requests.length, 0);
  await assert.rejects(b.fetch({ postMessage() { throw new Error('Host closed.'); } }, 0, config), /Host closed/);
  assert.equal(b.listeners.size, 0); assert.equal(b.timers.size, 0);
});
