const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

test('external audio is selected by the host and read by opaque ID without widening resource roots', async () => {
  for (const remote of [false, true]) {
    const files = [], replies = [];
    let provider, receive, dispose;
    const uri = file => ({ scheme: remote ? 'vscode-remote' : 'file', fsPath: file, path: file,
      toString: () => `${remote ? 'vscode-remote://host' : 'file://'}${file}`, with: () => uri(file) });
    const disposable = { dispose() {} };
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(require.resolve('../src/extension.cjs'), 'utf8'), {
      module, require(name) {
        if (name === 'vscode') return {
          env: { remoteName: remote ? 'ssh-remote' : undefined },
          Uri: { joinPath: (base, ...parts) => uri(path.posix.join(base.path, ...parts)) },
          window: { createOutputChannel: () => ({ ...disposable, appendLine() {} }),
            registerCustomEditorProvider: (id, value) => { provider = value; return disposable; },
            showOpenDialog: async () => [uri('/outside workspace/external & track.wav')] },
          commands: { registerTextEditorCommand: () => disposable, registerCommand: () => disposable },
        };
        if (name === './host-file.cjs') return { hostFile(file, reply) {
          const owned = { file, disposed: false, read(message) { this.lastRead = message; reply({ type: 'media-range', id: message.id }); },
            dispose() { this.disposed = true; } };
          files.push(owned); return owned;
        } };
        return name.startsWith('./') ? require('../src/' + name.slice(2)) : require(name);
      },
    });
    module.exports.activate({ subscriptions: [], extensionUri: uri('/extension'), globalState: { get() {} } });
    const panel = { onDidDispose: fn => { dispose = fn; }, onDidChangeViewState: () => disposable,
      webview: { cspSource: 'self', asWebviewUri: value => value,
        onDidReceiveMessage: fn => { receive = fn; return disposable; }, postMessage: message => replies.push(message) } };
    provider.resolveCustomEditor(provider.openCustomDocument(uri('/workspace/video.mp4')), panel);
    const roots = panel.webview.options.localResourceRoots;
    receive({ type: 'select-audio' }); await new Promise(setImmediate);
    const source = replies.find(reply => reply.type === 'audio-source').source;
    assert.match(source.id, /^[a-f0-9]{32}$/);
    assert.equal(source.url, 'pano-audio:' + source.id);
    assert.equal(source.name, 'external & track.wav');
    assert.equal(panel.webview.options.localResourceRoots, roots);
    assert.equal(roots.length, 2); assert.equal(roots[1].fsPath, '/workspace');
    receive({ type: 'read-media', sourceId: source.id, id: 1, offset: 9, length: 4, path: '/not-allowed' });
    assert.equal(files[1].file, '/outside workspace/external & track.wav');
    assert.equal(files[1].lastRead.offset, 9);
    receive({ type: 'read-media', sourceId: 'unselected', id: 2, path: '/etc/passwd' });
    assert.match(replies.at(-1).error, /Unknown/);
    receive({ type: 'select-audio' }); await new Promise(setImmediate);
    assert.equal(files.length, 2, 'Selecting the same path reuses its host handle');
    dispose(); assert.ok(files.every(file => file.disposed));
  }
});
