'use strict';
const vscode = require('vscode');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { renderHtml } = require('./webview.cjs');
const { hostFile } = require('./host-file.cjs');
const { normalize } = require('./preferences.cjs');

function activate(context) {
  const log = vscode.window.createOutputChannel('PanoPlayer');
  let preferences = normalize(context.globalState.get('playerPreferences'));
  const provider = {
    openCustomDocument(uri) {
      if (uri.scheme !== 'file' && !(uri.scheme === 'vscode-remote' && vscode.env.remoteName)) {
        throw new Error('Open a media file stored on the workspace host. URL streams and virtual documents are not supported.');
      }
      if (!path.isAbsolute(uri.fsPath)) throw new Error('Media must have an absolute path on the workspace host.');
      return { uri, dispose() {} };
    },
    resolveCustomEditor(document, panel) {
      const assets = vscode.Uri.joinPath(context.extensionUri, 'media');
      // Set once: changing resource roots reloads the iframe on VS Code 1.84.
      // VS Code rejects equality with a resource root; it must be a parent directory.
      panel.webview.options = { enableScripts: true, localResourceRoots: [assets, vscode.Uri.joinPath(document.uri, '..')] };
      const asset = name => panel.webview.asWebviewUri(vscode.Uri.joinPath(assets, name)).toString();
      const original = panel.webview.asWebviewUri(document.uri);
      // Match the native preview's cache busting when a recording is overwritten.
      const source = document.uri.query ? original : original.with({ query: `version=${Date.now()}` });
      panel.webview.html = renderHtml({
        title: path.basename(document.uri.fsPath), cspSource: panel.webview.cspSource,
        nonce: randomBytes(24).toString('hex'), source: source.toString(), hostMedia: true, preferences,
        script: asset('player.js'), style: asset('player.css'), omnitone: asset('omnitone.min.js'),
        monitor: asset('monitor.js'), view: asset('view.js'), icons: asset('lucide.min.js'), logo: asset('icon.png'),
        worker: asset('powermap-worker.js'), worklet: asset('foa-capture-processor.js'),
        decoder: asset('stream-worker.js'), pcm: asset('pcm-processor.js'), stream: asset('stream-player.js'),
      });
      const media = hostFile(document.uri.fsPath, message => panel.webview.postMessage(message));
      const receive = panel.webview.onDidReceiveMessage(message => {
        if (message?.type === 'preferences' && message.patch && typeof message.patch === 'object') {
          preferences = normalize({ ...preferences, ...message.patch });
          void context.globalState.update('playerPreferences', preferences).then(undefined, error => {
            log.appendLine('Cannot save preferences: ' + error.message);
          });
          return;
        }
        if (message?.type === 'read-media') { void media.read(message); return; }
        if (message?.type === 'diagnostic' && typeof message.text === 'string') {
          log.appendLine(path.basename(document.uri.fsPath) + ': ' + message.text.slice(0, 2000));
        }
      });
      const visibility = panel.onDidChangeViewState(() => {
        if (!panel.visible) void panel.webview.postMessage({ type: 'suspend' });
      });
      panel.onDidDispose(() => { media.dispose(); receive.dispose(); visibility.dispose(); });
    },
  };
  context.subscriptions.push(log,
    vscode.window.registerCustomEditorProvider('panoPlayer.player', provider, {
      supportsMultipleEditorsPerDocument: false, webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand('panoPlayer.open', async uri => {
      const selected = uri || (await vscode.window.showOpenDialog({ canSelectMany: false,
        filters: { 'Panorama media': ['mp4', 'webm', 'wav', 'flac', 'mov', 'mkv'] } }))?.[0];
      if (selected) await vscode.commands.executeCommand('vscode.openWith', selected, 'panoPlayer.player');
    }));
}
module.exports = { activate };
