const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

async function setup({ trusted = true, open, manifest = false, read } = {}) {
  const files = [], replies = [], calls = [];
  let provider, receive, dispose, closed = 0;
  const uri = file => ({ scheme: 'file', fsPath: file, path: file,
    toString: () => 'file://' + file, with: () => uri(file) });
  const disposable = { dispose() {} }, module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/extension.cjs'), 'utf8'), {
    module, AbortController, require(name) {
      if (name === 'vscode') return {
        env: {}, workspace: { isTrusted: trusted },
        Uri: { file: uri, joinPath: (base, ...parts) => uri(path.posix.join(base.path, ...parts)) },
        window: { createOutputChannel: () => ({ ...disposable, appendLine() {} }),
          registerCustomEditorProvider: (id, value) => { provider = value; return disposable; } },
        commands: { registerTextEditorCommand: () => disposable, registerCommand: () => disposable },
      };
      if (name === './video-proxy.cjs') return { async openVideoStream(input, options) {
        calls.push({ input, options }); if (open) await open(options);
        return { backend: 'FFmpeg/VideoToolbox',
          read: read || (async () => ({ data: new Uint8Array([1, 2]).buffer, eof: false })),
          dispose() { closed++; } };
      } };
      if (name === './host-file.cjs') return { hostFile(filename) {
        const file = { filename, read(message) { file.lastRead = message; }, dispose() { file.disposed = true; } };
        files.push(file); return file;
      } };
      return name.startsWith('./') ? require('../src/' + name.slice(2)) : require(name);
    },
  });
  module.exports.activate({ subscriptions: [], extensionUri: uri('/extension'), globalState: { get() {} } });
  const panel = { onDidDispose: fn => { dispose = fn; }, onDidChangeViewState: () => disposable,
    webview: { cspSource: 'self', asWebviewUri: value => value,
      onDidReceiveMessage: fn => { receive = fn; return disposable; }, postMessage: message => replies.push(message) } };
  await provider.resolveCustomEditor({ uri: uri(manifest ? '/workspace/session.jsonpp' : '/workspace/video.mp4'),
    ...(manifest ? { manifest: { videoPath: '/outside/original.mp4', audioPaths: [] } } : {}) }, panel);
  return { files, replies, calls, panel, send(message = {}) {
    receive({ type: 'open-video-stream', session: 'stream-session', id: 1, time: 0, width: 4096, height: 4096, ...message });
  }, dispose: () => dispose(), get closed() { return closed; } };
}
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(setImmediate); };

test('system video owns the original host path and exposes only scoped stream ids without cache storage', async () => {
  for (const manifest of [false, true]) {
    const s = await setup({ manifest });
    const roots = s.panel.webview.options.localResourceRoots;
    assert.equal(s.calls.length, 0, 'Opening ordinary media must not launch executables');
    s.send({ path: '/etc/passwd', output: '/tmp/not-owned', time: 20 }); await flush();
    assert.equal(s.calls[0].input, manifest ? '/outside/original.mp4' : '/workspace/video.mp4');
    assert.equal(s.calls[0].options.time, 20);
    const reply = s.replies[0];
    assert.equal(reply.type, 'video-stream'); assert.match(reply.streamId, /^[a-f0-9]{32}$/);
    assert.equal(reply.path, undefined); assert.equal(reply.url, undefined);
    s.send({ type: 'read-video-stream', id: 2, streamId: reply.streamId }); await flush();
    assert.deepEqual([...new Uint8Array(s.replies.at(-1).data)], [1, 2]);
    s.send({ type: 'read-media', id: 3, sourceId: 'primary', offset: 1, length: 4 });
    assert.equal(s.files[0].lastRead.offset, 1);
    assert.equal(s.files.length, 1, 'No additional filesystem media/cache handle is created');
    assert.equal(s.panel.webview.options.localResourceRoots, roots);
    s.dispose(); assert.equal(s.closed, 1); assert.equal(s.calls[0].options.signal.aborted, true);
  }
});

test('untrusted workspaces and invalid request ids cannot launch native decoding', async () => {
  const s = await setup({ trusted: false });
  for (const extra of [{ id: 0 }, { id: 1.5 }, { session: '' }, { session: 'x'.repeat(65) }]) s.send(extra);
  await flush(); assert.equal(s.replies.length, 0);
  s.send(); await flush(); assert.match(s.replies[0].error, /trusted/); assert.equal(s.calls.length, 0);
  s.dispose();
});

test('native reads reject wrong sessions, wrong ids and overlapping pulls; EOF closes the decoder', async () => {
  let finish;
  const s = await setup({ read: () => new Promise(resolve => { finish = resolve; }) });
  s.send(); await flush(); const id = s.replies[0].streamId;
  s.send({ type: 'read-video-stream', id: 2, streamId: id, session: 'wrong' });
  s.send({ type: 'read-video-stream', id: 3, streamId: 'wrong' });
  s.send({ type: 'read-video-stream', id: 4, streamId: id });
  s.send({ type: 'read-video-stream', id: 5, streamId: id });
  assert.equal(s.replies.filter(reply => reply.error).length, 3);
  finish({ data: new ArrayBuffer(0), eof: true }); await flush();
  assert.equal(s.replies.at(-1).eof, true); assert.equal(s.closed, 1);
  s.dispose(); assert.equal(s.closed, 1);
});

test('closing a pending open by session cancels it and late completion cannot resurrect a stream', async () => {
  let finish;
  const s = await setup({ open: () => new Promise(resolve => { finish = resolve; }) });
  s.send(); await flush();
  s.send({ type: 'close-video-stream' }); assert.equal(s.calls[0].options.signal.aborted, true);
  finish(); await flush(); assert.equal(s.closed, 1); assert.equal(s.replies.length, 0);
  s.dispose();
});

test('decoder opens are bounded and editor disposal cancels all pending sessions', async () => {
  const finish = [];
  const s = await setup({ open: () => new Promise(resolve => finish.push(resolve)) });
  for (let id = 1; id <= 5; id++) s.send({ id, session: 'session-' + id });
  await flush(); assert.equal(s.calls.length, 4); assert.match(s.replies[0].error, /available/);
  s.dispose(); assert.ok(s.calls.every(call => call.options.signal.aborted));
  finish.forEach(resolve => resolve()); await flush();
  assert.equal(s.closed, 4); assert.equal(s.replies.length, 1);
});

test('failed native opens return a correlated fallback error without affecting original audio reads', async () => {
  const s = await setup({ open: async () => { throw new Error('VideoToolbox unavailable'); } });
  s.send(); await flush(); assert.equal(s.replies[0].id, 1); assert.match(s.replies[0].error, /VideoToolbox/);
  s.send({ type: 'read-media', id: 2, sourceId: 'primary', offset: 12, length: 4 });
  assert.equal(s.files[0].lastRead.offset, 12); s.dispose();
});
