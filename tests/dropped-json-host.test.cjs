const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const flush = () => new Promise(setImmediate);
const file = name => ({ name, size: 32, text: '{"version":1,"annotations":[]}' });
const session = 'drop-host-test-session';

async function setup({ remote = false, load = async () => file('labels.json') } = {}) {
  const calls = [], replies = [], filePaths = [], disposeListeners = new Set();
  let provider, receive, mediaDisposed = false;
  const disposable = { dispose() {} };
  const uri = (filePath, scheme = remote ? 'vscode-remote' : 'file', authority = remote ? 'ssh-remote+example' : '') => ({
    scheme, authority, fsPath: filePath, path: filePath, query: '', fragment: '',
    toString: () => `${scheme}://${authority}${filePath.split('/').map(encodeURIComponent).join('/')}`,
    with: () => uri(filePath, scheme, authority),
  });
  const Uri = {
    joinPath: (base, ...parts) => uri(path.posix.join(base.path, ...parts), base.scheme, base.authority),
    file(value) { filePaths.push(value); return uri(value, 'file', ''); },
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/extension.cjs'), 'utf8'), {
    module, require(name) {
      if (name === 'vscode') return {
        env: { remoteName: remote ? 'ssh-remote' : undefined }, Uri,
        window: {
          createOutputChannel: () => ({ ...disposable, appendLine() {} }),
          registerCustomEditorProvider: (id, value) => { provider = value; return disposable; },
        },
        commands: { registerTextEditorCommand: () => disposable, registerCommand: () => disposable },
      };
      if (name === './host-file.cjs') return { hostFile: () => ({
        read() {}, dispose() { mediaDisposed = true; },
      }) };
      if (name === './dropped-json.cjs') return { readDroppedJson(resource, options) {
        calls.push({ resource, options }); return load(resource, options);
      } };
      return name.startsWith('./') ? require('../src/' + name.slice(2)) : require(name);
    },
  });
  module.exports.activate({ subscriptions: [], extensionUri: uri('/extension'), globalState: { get() {} } });
  const panel = {
    onDidDispose(callback) { disposeListeners.add(callback); return { dispose: () => disposeListeners.delete(callback) }; },
    onDidChangeViewState: () => disposable,
    webview: {
      cspSource: 'self', asWebviewUri: value => value,
      onDidReceiveMessage(callback) { receive = callback; return disposable; },
      postMessage(message) { replies.push(message); return true; },
    },
  };
  const documentUri = uri('/workspace/video.mp4');
  await provider.resolveCustomEditor(provider.openCustomDocument(documentUri), panel);
  return {
    calls, replies, filePaths, Uri, documentUri, panel,
    receive: message => receive({ session, ...message }),
    dispose() { for (const callback of disposeListeners) callback(); },
    get mediaDisposed() { return mediaDisposed; },
  };
}

test('annotation URI requests forward local and current-remote document context without widening resource roots', async () => {
  for (const remote of [false, true]) {
    const expected = file('outside labels.json');
    const s = await setup({ remote, load: async () => expected });
    const roots = s.panel.webview.options.localResourceRoots;
    const resource = remote ? 'vscode-remote://ssh-remote+example/outside/labels%20one.json' : 'file:///outside/labels%20one.json';
    s.receive({ type: 'read-dropped-json', id: 1, resource: { uri: resource } }); await flush();
    assert.equal(s.calls.length, 1); assert.equal(s.calls[0].resource, resource);
    assert.equal(s.calls[0].options.Uri, s.Uri); assert.equal(s.calls[0].options.documentUri, s.documentUri);
    assert.equal(s.replies.length, 1); assert.equal(s.replies[0].type, 'dropped-json');
    assert.equal(s.replies[0].id, 1); assert.equal(s.replies[0].session, session); assert.equal(s.replies[0].file, expected);
    assert.equal(s.panel.webview.options.localResourceRoots, roots);
    assert.equal(roots.length, 2); assert.equal(roots[1].fsPath, '/workspace');
    s.dispose();
  }
});

test('native absolute annotation paths are converted with Uri.file before loading', async () => {
  const s = await setup();
  const nativePath = '/outside workspace/labels # mix.json';
  s.receive({ type: 'read-dropped-json', id: 7, resource: { path: nativePath } }); await flush();
  assert.deepEqual(s.filePaths, [nativePath]);
  assert.equal(s.calls.length, 1); assert.equal(s.calls[0].resource, 'file:///outside%20workspace/labels%20%23%20mix.json');
  assert.equal(s.replies[0].id, 7); assert.equal(s.replies[0].session, session); assert.equal(s.replies[0].file.name, 'labels.json');
  s.dispose();
});

test('invalid request IDs, sessions and malformed resources never call the annotation loader', async () => {
  const s = await setup();
  for (const id of [undefined, null, 0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '1']) {
    s.receive({ type: 'read-dropped-json', id, resource: { uri: 'file:///labels.json' } });
  }
  for (const invalid of [undefined, null, 1, {}, '', 'x'.repeat(65)]) {
    s.receive({ type: 'read-dropped-json', session: invalid, id: 1, resource: { uri: 'file:///labels.json' } });
  }
  assert.equal(s.calls.length, 0); assert.equal(s.replies.length, 0);
  const resources = [undefined, null, {}, 'file:///labels.json', { uri: 1 }, { path: 1 },
    { path: 'relative/labels.json' }, { path: '/' + 'x'.repeat(32768) },
    { uri: 'file:///labels.json', path: '/labels.json' }];
  for (const [index, resource] of resources.entries()) {
    s.receive({ type: 'read-dropped-json', id: index + 1, resource });
  }
  await flush();
  assert.equal(s.calls.length, 0); assert.deepEqual(s.filePaths, []);
  assert.equal(s.replies.length, resources.length);
  for (const [index, reply] of s.replies.entries()) {
    assert.equal(reply.type, 'dropped-json'); assert.equal(reply.id, index + 1); assert.equal(reply.session, session);
    assert.match(reply.error, /Invalid dropped annotation resource/); assert.equal(reply.file, undefined);
  }
  s.dispose();
});

test('annotation loader failures produce correlated errors and release their read slot', async () => {
  let attempt = 0;
  const failures = [new Error('Annotation read denied.'), 'Annotation read failed.', null];
  const s = await setup({ load: async () => {
    const index = attempt++;
    if (index < failures.length) throw failures[index];
    return file('recovered.json');
  } });
  for (let id = 1; id <= failures.length + 1; id++) {
    s.receive({ type: 'read-dropped-json', id, resource: { uri: 'file:///labels.json' } }); await flush();
  }
  assert.equal(s.calls.length, 4);
  assert.deepEqual(s.replies.map(reply => reply.id), [1, 2, 3, 4]);
  assert.ok(s.replies.every(reply => reply.session === session));
  assert.deepEqual(s.replies.slice(0, 3).map(reply => reply.error), ['Annotation read denied.', 'Annotation read failed.', 'null']);
  assert.equal(s.replies[3].file.name, 'recovered.json');
  s.dispose();
});

test('a panel permits four concurrent annotation reads and rejects the fifth without calling the loader', async () => {
  const pending = [];
  const s = await setup({ load: () => new Promise(resolve => pending.push(resolve)) });
  for (let id = 1; id <= 5; id++) s.receive({ type: 'read-dropped-json', id, resource: { uri: `file:///labels-${id}.json` } });
  assert.equal(s.calls.length, 4); assert.equal(pending.length, 4);
  assert.equal(s.replies.length, 1); assert.equal(s.replies[0].id, 5); assert.equal(s.replies[0].session, session);
  assert.match(s.replies[0].error, /Too many annotation files/);
  pending[0](file('first.json')); await flush();
  s.receive({ type: 'read-dropped-json', id: 6, resource: { uri: 'file:///sixth.json' } });
  assert.equal(s.calls.length, 5); assert.equal(pending.length, 5);
  for (const resolve of pending.slice(1)) resolve(file('finished.json'));
  await flush();
  assert.deepEqual(s.replies.filter(reply => reply.file).map(reply => reply.id).sort((a, b) => a - b), [1, 2, 3, 4, 6]);
  assert.ok(s.replies.every(reply => reply.session === session));
  s.dispose();
});

test('disposing the panel suppresses late annotation results, errors and new read requests', async () => {
  const pending = [];
  const s = await setup({ load: () => new Promise((resolve, reject) => pending.push({ resolve, reject })) });
  for (const id of [1, 2]) s.receive({ type: 'read-dropped-json', id, resource: { uri: 'file:///labels.json' } });
  assert.equal(s.calls.length, 2);
  const roots = s.panel.webview.options.localResourceRoots;
  s.dispose(); assert.equal(s.mediaDisposed, true);
  pending[0].resolve(file('late.json')); pending[1].reject(new Error('Late failure.'));
  s.receive({ type: 'read-dropped-json', id: 3, resource: { uri: 'file:///ignored.json' } });
  await flush();
  assert.equal(s.calls.length, 2); assert.deepEqual(s.replies, []);
  assert.equal(s.panel.webview.options.localResourceRoots, roots);
});
