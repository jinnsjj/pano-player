'use strict';
const vscode = require('vscode');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { renderHtml } = require('./webview.cjs');
const { hostFile } = require('./host-file.cjs');
const { readDroppedJson } = require('./dropped-json.cjs');
const { readMediaManifest } = require('./media-manifest.cjs');
const { normalize } = require('./preferences.cjs');
const { openEditorMedia, mediaEditorType } = require('./editor-media.cjs');
const { createPluginRegistry } = require('./plugin-registry.cjs');
const bundledPlugins = require('../plugins/catalog.cjs');

function activate(context) {
  const log = vscode.window.createOutputChannel('PanoPlayer');
  const plugins = createPluginRegistry(vscode, log, bundledPlugins.map(plugin => ({ ...plugin, extensionUri: context.extensionUri })));
  let preferences = normalize(context.globalState.get('playerPreferences'));
  const provider = {
    openCustomDocument(uri) {
      if (uri.scheme !== 'file' && !(uri.scheme === 'vscode-remote' && vscode.env.remoteName)) {
        throw new Error('Open a media file stored on the workspace host. URL streams and virtual documents are not supported.');
      }
      if (!path.isAbsolute(uri.fsPath)) throw new Error('Media must have an absolute path on the workspace host.');
      if (/\.(json|jsonpp)$/i.test(uri.fsPath)) {
        return readMediaManifest(uri.fsPath).then(manifest => ({ uri, manifest, dispose() {} }));
      }
      return { uri, dispose() {} };
    },
    async resolveCustomEditor(document, panel) {
      let closed = false;
      const opening = panel.onDidDispose(() => { closed = true; });
      await plugins.discover();
      opening?.dispose();
      if (closed) return;
      const resourceUri = filename => vscode.Uri.file(filename).with({ scheme: document.uri.scheme, authority: document.uri.authority });
      const mediaUri = document.manifest ? resourceUri(document.manifest.videoPath) : document.uri;
      const assets = vscode.Uri.joinPath(context.extensionUri, 'media');
      // Set once: changing resource roots reloads the iframe on VS Code 1.84.
      // VS Code rejects equality with a resource root; it must be a parent directory.
      panel.webview.options = { enableScripts: true, localResourceRoots: [assets, vscode.Uri.joinPath(mediaUri, '..'), ...plugins.roots()] };
      const asset = name => panel.webview.asWebviewUri(vscode.Uri.joinPath(assets, name)).toString();
      const original = panel.webview.asWebviewUri(mediaUri);
      // Match the native preview's cache busting when a recording is overwritten.
      const source = mediaUri.query ? original : original.with({ query: `version=${Date.now()}` });
      panel.webview.html = renderHtml({
        title: path.basename(mediaUri.fsPath), cspSource: panel.webview.cspSource,
        nonce: randomBytes(24).toString('hex'), source: source.toString(), hostMedia: true, mediaSession: !!document.manifest, preferences,
        script: asset('player.js'), style: asset('player.css'), omnitone: asset('omnitone.min.js'),
        monitor: asset('monitor.js'), view: asset('view.js'), icons: asset('lucide.min.js'), logo: asset('icon.png'),
        worker: asset('powermap-worker.js'), worklet: asset('foa-capture-processor.js'),
        decoder: asset('stream-worker.js'), pcm: asset('pcm-processor.js'), stream: asset('stream-player.js'),
        plugins: plugins.descriptors(panel.webview),
      });
      const media = hostFile(mediaUri.fsPath, message => panel.webview.postMessage(message));
      const audioFiles = new Map();
      const addAudio = uri => {
        let entry = [...audioFiles.values()].find(item => item.uri.toString() === uri.toString());
        if (!entry) {
          const id = randomBytes(16).toString('hex');
          entry = { uri, id, file: hostFile(uri.fsPath, reply => panel.webview.postMessage(reply)) };
          audioFiles.set(id, entry);
        }
        return { id: entry.id, name: path.basename(uri.fsPath), url: 'pano-audio:' + entry.id };
      };
      const sessionSources = document.manifest?.audioPaths.map(filename => addAudio(resourceUri(filename))) || [];
      let disposed = false, selectingAudio = false, selectingJson = false, readingDrops = 0, playerSession;
      const receive = panel.webview.onDidReceiveMessage(message => {
        if (message?.type === 'player-ready' && document.manifest && !disposed) {
          if (typeof message.session !== 'string' || !message.session || message.session.length > 64 || message.session === playerSession) return;
          const session = playerSession = message.session;
          void panel.webview.postMessage({ type: 'media-session', session, sources: sessionSources });
          if (document.manifest.annotationPath) void (async () => {
            if (readingDrops >= 4) {
              void panel.webview.postMessage({ type: 'session-annotation', session, error: 'Too many annotation files are being read.' });
              return;
            }
            readingDrops++;
            try {
              const file = await readDroppedJson(resourceUri(document.manifest.annotationPath).toString(), {
                Uri: vscode.Uri, documentUri: document.uri,
              });
              if (!disposed && session === playerSession) await panel.webview.postMessage({ type: 'session-annotation', session, file });
            } catch (error) {
              if (!disposed && session === playerSession) void panel.webview.postMessage({ type: 'session-annotation', session, error: error.message });
            } finally { readingDrops--; }
          })();
          return;
        }
        if (message?.type === 'read-dropped-json') {
          if (disposed || !Number.isSafeInteger(message.id) || message.id < 1 ||
            typeof message.session !== 'string' || !message.session || message.session.length > 64) return;
          const response = { type: 'dropped-json', session: message.session, id: message.id };
          if (readingDrops >= 4) {
            void panel.webview.postMessage({ ...response, error: 'Too many annotation files are being read.' });
            return;
          }
          readingDrops++;
          void (async () => {
            try {
              const resource = message.resource;
              let uri;
              if (typeof resource?.uri === 'string' && resource.path === undefined) uri = resource.uri;
              else if (typeof resource?.path === 'string' && resource.uri === undefined &&
                resource.path.length <= 32768 && path.isAbsolute(resource.path)) uri = vscode.Uri.file(resource.path).toString();
              else throw new Error('Invalid dropped annotation resource.');
              const file = await readDroppedJson(uri, { Uri: vscode.Uri, documentUri: document.uri });
              if (!disposed) await panel.webview.postMessage({ ...response, file });
            } catch (error) {
              if (!disposed) void panel.webview.postMessage({ ...response, error: error?.message || String(error) });
            } finally { readingDrops--; }
          })();
          return;
        }
        if (message?.type === 'select-json-file') {
          if (disposed || !Number.isSafeInteger(message.id) || message.id < 1 ||
            typeof message.session !== 'string' || !message.session || message.session.length > 64) return;
          const response = { type: 'selected-json', session: message.session, id: message.id };
          if (selectingJson) {
            void panel.webview.postMessage({ ...response, error: 'An annotation file selection is already in progress.' });
            return;
          }
          selectingJson = true;
          void (async () => {
            let reading = false;
            try {
              const selected = (await vscode.window.showOpenDialog({ canSelectMany: false, title: 'Open annotation JSON',
                filters: { 'Annotation JSON': ['json'] }, defaultUri: vscode.Uri.joinPath(document.uri, '..') }))?.[0];
              if (disposed) return;
              if (!selected) { await panel.webview.postMessage({ ...response, file: null }); return; }
              if (readingDrops >= 4) throw new Error('Too many annotation files are being read.');
              readingDrops++; reading = true;
              const file = await readDroppedJson(selected.toString(), { Uri: vscode.Uri, documentUri: document.uri });
              if (!disposed) await panel.webview.postMessage({ ...response, file });
            } catch (error) {
              if (!disposed) void panel.webview.postMessage({ ...response, error: error?.message || String(error) });
            } finally {
              if (reading) readingDrops--;
              selectingJson = false;
            }
          })();
          return;
        }
        if (message?.type === 'preferences' && message.patch && typeof message.patch === 'object') {
          preferences = normalize({ ...preferences, ...message.patch });
          void context.globalState.update('playerPreferences', preferences).then(undefined, error => {
            log.appendLine('Cannot save preferences: ' + error.message);
          });
          return;
        }
        if (message?.type === 'select-audio' && !selectingAudio) {
          selectingAudio = true;
          void (async () => {
            try {
              const selected = (await vscode.window.showOpenDialog({ canSelectMany: false, title: 'Open external audio',
                filters: { 'Audio or video': ['wav', 'flac', 'mp4', 'webm', 'mov', 'mkv'] } }))?.[0];
              if (!selected || disposed) return;
              if (/\.(json|jsonpp)$/i.test(selected.fsPath)) throw new Error('Select an audio or video file, not a media configuration.');
              await provider.openCustomDocument(selected);
              await panel.webview.postMessage({ type: 'audio-source', source: addAudio(selected) });
            } catch (error) {
              if (!disposed) void panel.webview.postMessage({ type: 'audio-source-error', message: error.message });
            } finally { selectingAudio = false; }
          })();
          return;
        }
        if (message?.type === 'read-media') {
          const owned = !message.sourceId || message.sourceId === 'primary' ? media : audioFiles.get(message.sourceId)?.file;
          if (owned) void owned.read(message);
          else void panel.webview.postMessage({ type: 'media-range', id: message.id, error: 'Unknown audio source.' });
          return;
        }
        if (message?.type === 'diagnostic' && typeof message.text === 'string') {
          log.appendLine(path.basename(document.uri.fsPath) + ': ' + message.text.slice(0, 2000));
        }
      });
      const visibility = panel.onDidChangeViewState(() => {
        if (!panel.visible) void panel.webview.postMessage({ type: 'suspend' });
      });
      panel.onDidDispose(() => {
        disposed = true; selectingJson = false; media.dispose();
        for (const entry of audioFiles.values()) entry.file.dispose();
        audioFiles.clear(); receive.dispose(); visibility.dispose();
      });
    },
  };
  context.subscriptions.push(log, plugins,
    vscode.commands.registerTextEditorCommand('panoPlayer.openPath', editor =>
      openEditorMedia(vscode, editor, context.extensionUri)),
    ...['panoPlayer.player', 'panoPlayer.mediaConfig'].map(viewType => vscode.window.registerCustomEditorProvider(viewType, provider, {
      supportsMultipleEditorsPerDocument: false, webviewOptions: { retainContextWhenHidden: true },
    })),
    vscode.commands.registerCommand('panoPlayer.open', async uri => {
      const selected = uri || (await vscode.window.showOpenDialog({ canSelectMany: false,
        filters: { 'Panorama media': ['mp4', 'webm', 'wav', 'flac', 'mov', 'mkv', 'json', 'jsonpp'] } }))?.[0];
      if (selected) {
        try { await vscode.commands.executeCommand('vscode.openWith', selected, mediaEditorType(selected.fsPath)); }
        catch (error) { await vscode.window.showErrorMessage('PanoPlayer: ' + error.message); }
      }
    }));
  return Object.freeze({ apiVersion: 1, registerPlugin: (id, descriptor) => plugins.register(id, descriptor) });
}
module.exports = { activate };
