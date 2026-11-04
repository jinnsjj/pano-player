const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const flush = () => new Promise(setImmediate);
const session = 'json-picker-host-session';
const file = name => ({ name, size: 32, text: '{"version":1,"annotations":[]}' });

async function setup({ remote = false, choose, load = async () => file('labels.json') } = {}) {
  const calls = [], dialogs = [], replies = [], disposeListeners = new Set();
  let provider, receive;
  const disposable = { dispose() {} };
  const uri = (filePath, scheme = remote ? 'vscode-remote' : 'file', authority = remote ? 'ssh-remote+example' : '') => ({
    scheme, authority, fsPath: filePath, path: filePath, query: '', fragment: '',
    toString: () => `${scheme}://${authority}${filePath.split('/').map(encodeURIComponent).join('/')}`,
    with: () => uri(filePath, scheme, authority),
  });
  const Uri = { joinPath: (base, ...parts) => uri(path.posix.join(base.path, ...parts), base.scheme, base.authority) };
  const selectedUri = uri('/outside workspace/labels # \u6807\u6ce8.json');
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/extension.cjs'), 'utf8'), {
    module, require(name) {
      if (name === 'vscode') return {
        env: { remoteName: remote ? 'ssh-remote' : undefined }, Uri,
        window: {
          createOutputChannel: () => ({ ...disposable, appendLine() {} }),
          registerCustomEditorProvider: (id, value) => { provider = value; return disposable; },
          showOpenDialog(options) { dialogs.push(options); return choose ? choose(options, selectedUri) : Promise.resolve([selectedUri]); },
        },
        commands: { registerTextEditorCommand: () => disposable, registerCommand: () => disposable },
      };
      if (name === './host-file.cjs') return { hostFile: () => ({ read() {}, dispose() {} }) };
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
    calls, dialogs, replies, selectedUri, documentUri, Uri, panel,
    receive: message => receive({ type: 'select-json-file', session, ...message }),
    dispose() { for (const callback of disposeListeners) callback(); },
  };
}

test('annotation picker opens on the current local or remote host and reads the selected URI without widening roots', async () => {
  for (const remote of [false, true]) {
    const expected = file('selected.json');
    const s = await setup({ remote, load: async () => expected });
    const roots = s.panel.webview.options.localResourceRoots;
    s.receive({ id: 1 }); await flush();
    assert.equal(s.dialogs.length, 1);
    const options = s.dialogs[0];
    assert.equal(options.canSelectMany, false); assert.equal(options.title, 'Open annotation JSON');
    assert.deepEqual(JSON.parse(JSON.stringify(options.filters)), { 'Annotation JSON': ['json'] });
    assert.equal(options.defaultUri.fsPath, '/workspace');
    assert.equal(options.defaultUri.scheme, s.documentUri.scheme); assert.equal(options.defaultUri.authority, s.documentUri.authority);
    assert.equal(s.calls.length, 1); assert.equal(s.calls[0].resource, s.selectedUri.toString());
    assert.equal(s.calls[0].options.Uri, s.Uri); assert.equal(s.calls[0].options.documentUri, s.documentUri);
    assert.equal(s.replies.length, 1); assert.equal(s.replies[0].type, 'selected-json');
    assert.equal(s.replies[0].id, 1); assert.equal(s.replies[0].session, session); assert.equal(s.replies[0].file, expected);
    assert.equal(s.panel.webview.options.localResourceRoots, roots); assert.equal(roots.length, 2);
    s.dispose();
  }
});

test('cancelling the picker returns a correlated null file and releases its dialog guard', async () => {
  let attempt = 0;
  const s = await setup({ choose: async (options, selected) => attempt++ ? [selected] : undefined });
  s.receive({ id: 1 }); await flush();
  assert.equal(s.calls.length, 0); assert.equal(s.replies[0].file, null);
  assert.equal(s.replies[0].type, 'selected-json'); assert.equal(s.replies[0].session, session); assert.equal(s.replies[0].id, 1);
  s.receive({ id: 2 }); await flush();
  assert.equal(s.dialogs.length, 2); assert.equal(s.calls.length, 1); assert.equal(s.replies[1].file.name, 'labels.json');
  s.dispose();
});

test('invalid picker IDs and sessions never open a dialog or read a file', async () => {
  const s = await setup();
  for (const id of [undefined, null, 0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '1']) s.receive({ id });
  for (const value of [undefined, null, 1, {}, '', 'x'.repeat(65)]) s.receive({ id: 1, session: value });
  await flush();
  assert.deepEqual(s.dialogs, []); assert.deepEqual(s.calls, []); assert.deepEqual(s.replies, []);
  s.dispose();
});

test('repeated requests receive a correlated busy error until selection and loading finish', async () => {
  let resolveDialog, resolveRead;
  const s = await setup({ choose: () => new Promise(resolve => { resolveDialog = resolve; }),
    load: () => new Promise(resolve => { resolveRead = resolve; }) });
  s.receive({ id: 1 }); s.receive({ id: 2, session: 'another-session' });
  assert.equal(s.dialogs.length, 1); assert.equal(s.calls.length, 0);
  assert.equal(s.replies[0].id, 2); assert.equal(s.replies[0].session, 'another-session');
  assert.match(s.replies[0].error, /already in progress/);
  resolveDialog([s.selectedUri]); await flush();
  s.receive({ id: 3 });
  assert.equal(s.dialogs.length, 1); assert.equal(s.calls.length, 1); assert.match(s.replies[1].error, /already in progress/);
  resolveRead(file('first.json')); await flush();
  s.receive({ id: 4 }); assert.equal(s.dialogs.length, 2);
  resolveDialog(undefined); await flush();
  assert.equal(s.replies.at(-1).id, 4); assert.equal(s.replies.at(-1).file, null);
  s.dispose();
});

test('dialog and file-read failures produce correlated errors and release the picker guard', async () => {
  for (const phase of ['dialog', 'read']) {
    let attempt = 0;
    const s = await setup({
      choose: async (options, selected) => { if (phase === 'dialog' && !attempt++) throw new Error('Picker failed.'); return [selected]; },
      load: async () => { if (phase === 'read' && !attempt++) throw new Error('Annotation read denied.'); return file('recovered.json'); },
    });
    s.receive({ id: 1 }); await flush();
    assert.equal(s.replies[0].type, 'selected-json'); assert.equal(s.replies[0].id, 1); assert.equal(s.replies[0].session, session);
    assert.match(s.replies[0].error, phase === 'dialog' ? /Picker failed/ : /read denied/);
    s.receive({ id: 2 }); await flush();
    assert.equal(s.replies[1].file.name, 'recovered.json'); assert.equal(s.dialogs.length, 2);
    s.dispose();
  }
});

test('waiting on a picker does not consume a read slot and selection shares the four-read limit with drops', async () => {
  let resolveDialog;
  const pending = [];
  const s = await setup({ choose: () => new Promise(resolve => { resolveDialog = resolve; }),
    load: () => new Promise(resolve => pending.push(resolve)) });
  s.receive({ id: 1 });
  for (let id = 2; id <= 5; id++) s.receive({ type: 'read-dropped-json', id, resource: { uri: 'file:///labels.json' } });
  assert.equal(s.calls.length, 4); assert.equal(s.replies.length, 0, 'All four slots remain available while dialog is pending');
  resolveDialog([s.selectedUri]); await flush();
  assert.equal(s.calls.length, 4); assert.equal(s.replies[0].type, 'selected-json'); assert.equal(s.replies[0].id, 1);
  assert.equal(s.replies[0].session, session); assert.match(s.replies[0].error, /Too many annotation files/);
  pending[0](file('drop.json')); await flush();
  s.receive({ id: 6 }); resolveDialog([s.selectedUri]); await flush();
  assert.equal(s.calls.length, 5, 'Read capacity and picker guard recover after saturation');
  for (const resolve of pending.slice(1)) resolve(file('finished.json'));
  await flush();
  assert.equal(s.replies.find(reply => reply.id === 6).file.name, 'finished.json');
  s.dispose();
});

test('disposing a panel while its picker is open prevents reads, replies and further dialogs', async () => {
  let resolveDialog;
  const s = await setup({ choose: () => new Promise(resolve => { resolveDialog = resolve; }) });
  s.receive({ id: 1 }); s.dispose(); resolveDialog([s.selectedUri]);
  s.receive({ id: 2 }); await flush();
  assert.equal(s.dialogs.length, 1); assert.deepEqual(s.calls, []); assert.deepEqual(s.replies, []);
});

test('disposing a panel during an annotation read suppresses late success and error replies', async () => {
  for (const failure of [false, true]) {
    let resolveRead, rejectRead;
    const s = await setup({ load: () => new Promise((resolve, reject) => { resolveRead = resolve; rejectRead = reject; }) });
    s.receive({ id: 1 }); await flush();
    assert.equal(s.calls.length, 1); s.dispose();
    if (failure) rejectRead(new Error('Late read failure.')); else resolveRead(file('late.json'));
    s.receive({ id: 2 }); await flush();
    assert.equal(s.dialogs.length, 1); assert.deepEqual(s.replies, []);
  }
});
