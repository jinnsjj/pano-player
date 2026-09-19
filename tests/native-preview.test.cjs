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
    let provider;
    const vscode = {
      env: { remoteName: remote ? 'cloud-ide' : undefined },
      Uri: { joinPath: (base, ...parts) => uri(path.posix.join(base.path, ...parts)) },
      workspace: { isTrusted: false },
      window: {
        createOutputChannel: () => ({ ...disposable, appendLine() {} }),
        registerCustomEditorProvider: (_, value) => { provider = value; return disposable; },
      },
      commands: { registerCommand: () => disposable },
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
