const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

test('local and cloud editors expose the original media immediately without host processing', async () => {
  for (const remote of [false, true]) {
    const scheme = remote ? 'vscode-remote' : 'file';
    const authority = remote ? 'icube+workspace' : '';
    const uri = (p, query = '') => ({ scheme, authority, path: p, fsPath: p, query,
      with(changes) { return uri(p, changes.query ?? query); },
      toString() { return `${scheme}://${authority}${p}${query ? '?' + query : ''}`; } });
    const disposable = { dispose() {} };
    const commands = new Map(), opened = [];
    const selected = uri('/workspace/selected.webm');
    let provider, editorId;
    const vscode = {
      env: { remoteName: remote ? 'cloud-ide' : undefined },
      Uri: { joinPath: (base, ...parts) => uri(path.posix.join(base.path, ...parts)) },
      workspace: { isTrusted: false },
      window: {
        createOutputChannel: () => ({ ...disposable, appendLine() {} }),
        showOpenDialog: async () => [selected],
        registerCustomEditorProvider: (id, value) => { editorId = id; provider = value; return disposable; },
      },
      commands: {
        registerCommand: (id, handler) => { commands.set(id, handler); return disposable; },
        executeCommand: async (...args) => { opened.push(args); },
      },
    };
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(require.resolve('../src/extension.cjs'), 'utf8'), {
      module,
      require(name) {
        if (name === 'vscode') return vscode;
        if (/runtime|media\.cjs|child_process/.test(name)) throw new Error(`Startup must not import ${name}`);
        return name.startsWith('./') ? require(`../src/${name.slice(2)}`) : require(name);
      },
    });
    const storage = new Map();
    module.exports.activate({ subscriptions: [], extensionUri: uri('/extension'), globalStorageUri: uri('/cache'),
      globalState: { get: key => storage.get(key), update: async (key, value) => { storage.set(key, value); } } });
    const manifest = require('../package.json');
    assert.equal(editorId, 'panoPlayer.player');
    assert.equal(manifest.contributes.customEditors[0].viewType, editorId);
    assert.deepEqual(manifest.activationEvents, ['onCustomEditor:' + editorId]);
    assert.deepEqual([...commands.keys()], ['panoPlayer.open']);
    assert.deepEqual(manifest.contributes.commands.map(c => c.command), [...commands.keys()]);
    const reference = fs.readFileSync(path.join(__dirname, '../docs/REFERENCE.md'), 'utf8');
    for (const { command, title } of manifest.contributes.commands) {
      assert.ok(reference.includes('| ' + title + ' | `' + command + '` |'));
    }
    assert.ok(reference.includes('version ' + manifest.version));
    const associations = JSON.parse(reference.match(/```json\n([\s\S]*?)\n```/)[1]);
    assert.deepEqual(associations['workbench.editorAssociations'], { '*.mp4': editorId, '*.webm': editorId });
    assert.equal(manifest.contributes.menus['explorer/context'][0].command, 'panoPlayer.open');
    await commands.get('panoPlayer.open')(selected);
    await commands.get('panoPlayer.open')();
    assert.deepEqual(opened, Array.from({ length: 2 }, () => ['vscode.openWith', selected, manifest.contributes.customEditors[0].viewType]));
    let writes = 0, options, receive;
    const panel = {
      onDidDispose() {}, onDidChangeViewState: () => disposable,
      webview: {
        cspSource: 'https://resource.test', asWebviewUri: value => value,
        set options(value) { writes++; options = value; },
        onDidReceiveMessage: handler => { receive = handler; return disposable; }, postMessage() {},
      },
    };
    const document = provider.openCustomDocument(uri('/workspace/FOA clip.webm'));
    await provider.resolveCustomEditor(document, panel, { onCancellationRequested: () => disposable });
    assert.match(panel.webview.html, /data-source="(?:file|vscode-remote):\/\/[^"<>]*FOA clip\.webm\?version=\d+"/);
    assert.match(panel.webview.html, /data-decoder="[^"<>]*stream-worker.js"/);
    assert.equal(writes, 1);
    assert.equal(options.localResourceRoots[1].path, '/workspace');
    assert.equal(options.localResourceRoots[1].authority, authority);
    assert.doesNotMatch(panel.webview.html, /Inspecting media|Preparing media/);
    receive({ type: 'preferences', patch: { projection: '180', volume: .2, enabled: false } });
    receive({ type: 'preferences', patch: { order: 'WXYZ', normalization: 'N3D', listening: 'stereo' } });
    await provider.resolveCustomEditor(provider.openCustomDocument(uri('/workspace/next.mp4')), panel);
    const saved = JSON.parse(panel.webview.html.match(/data-preferences="([^"]+)"/)[1].replaceAll('&quot;', '"'));
    assert.equal(saved.projection, '180'); assert.equal(saved.volume, .2); assert.equal(saved.enabled, false);
    assert.equal(saved.order, 'WXYZ'); assert.equal(saved.normalization, 'N3D'); assert.equal(saved.listening, 'stereo');
    assert.deepEqual(saved, storage.get('playerPreferences'));
  }
});
