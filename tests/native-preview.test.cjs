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
    let provider;
    const vscode = {
      env: { remoteName: remote ? 'cloud-ide' : undefined },
      Uri: { joinPath: (base, ...parts) => uri(path.posix.join(base.path, ...parts)) },
      workspace: { isTrusted: false },
      window: {
        createOutputChannel: () => ({ ...disposable, appendLine() {} }),
        showOpenDialog: async () => [selected],
        registerCustomEditorProvider: (_, value) => { provider = value; return disposable; },
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
    module.exports.activate({ subscriptions: [], extensionUri: uri('/extension'), globalStorageUri: uri('/cache') });
    const manifest = require('../package.json');
    assert.deepEqual([...commands.keys()], ['panoPlayer.open', 'panoPlayer.clearCache']);
    assert.deepEqual(manifest.contributes.commands.map(c => c.command), [...commands.keys()]);
    const reference = fs.readFileSync(path.join(__dirname, '../docs/REFERENCE.md'), 'utf8');
    for (const { command, title } of manifest.contributes.commands) {
      assert.ok(reference.includes('| ' + title + ' | `' + command + '` |'));
    }
    assert.ok(reference.includes('version ' + manifest.version));
    assert.equal(manifest.contributes.menus['explorer/context'][0].command, 'panoPlayer.open');
    await commands.get('panoPlayer.open')(selected);
    await commands.get('panoPlayer.open')();
    assert.deepEqual(opened, Array.from({ length: 2 }, () => ['vscode.openWith', selected, manifest.contributes.customEditors[0].viewType]));
    let writes = 0, options;
    const panel = {
      onDidDispose() {}, onDidChangeViewState: () => disposable,
      webview: {
        cspSource: 'https://resource.test', asWebviewUri: value => value,
        set options(value) { writes++; options = value; },
        onDidReceiveMessage: () => disposable, postMessage() {},
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
  }
});
