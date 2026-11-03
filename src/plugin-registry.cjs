'use strict';

function assetPath(value) {
  if (typeof value !== 'string' || !/^media\/[a-zA-Z0-9_./-]+$/.test(value)
      || value.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('Plugin resources must be relative files inside the extension media directory.');
  }
  return value;
}

function createPluginRegistry(vscode, log, bundled = []) {
  const bundledIds = new Set(bundled.map(entry => entry.id));
  const plugins = new Map(bundled.map(entry => [entry.id, { ...entry,
    script: assetPath(entry.script), style: entry.style ? assetPath(entry.style) : undefined,
  }]));
  return {
    register(id, descriptor) {
      const extension = vscode.extensions?.getExtension(id);
      if (!extension || extension.packageJSON?.panoPlayerPlugin?.apiVersion !== 1 || descriptor?.apiVersion !== 1) {
        throw new Error('Only installed extensions declaring panoPlayerPlugin API 1 can register.');
      }
      if (bundledIds.has(id)) {
        log.appendLine('Using bundled plugin instead of companion extension: ' + id);
        return { dispose() {} };
      }
      if (plugins.has(id)) throw new Error('Plugin is already registered: ' + id);
      const script = assetPath(descriptor.script), style = descriptor.style ? assetPath(descriptor.style) : undefined;
      const entry = { id, apiVersion: 1, extensionUri: extension.extensionUri, script, style,
        name: extension.packageJSON.displayName || id, version: extension.packageJSON.version };
      plugins.set(id, entry);
      return { dispose() { if (plugins.get(id) === entry) plugins.delete(id); } };
    },
    async discover() {
      const extensions = (vscode.extensions?.all || []).filter(extension => extension.packageJSON?.panoPlayerPlugin?.apiVersion === 1 && !bundledIds.has(extension.id));
      await Promise.all(extensions.map(extension => new Promise(resolve => {
        const timer = setTimeout(() => { log.appendLine('Plugin activation timed out: ' + extension.id); resolve(); }, 1500);
        Promise.resolve().then(() => extension.activate()).catch(error => log.appendLine('Plugin activation failed: ' + error.message))
          .finally(() => { clearTimeout(timer); resolve(); });
      })));
    },
    roots() { return [...plugins.values()].filter(entry => !bundledIds.has(entry.id)).map(entry => vscode.Uri.joinPath(entry.extensionUri, 'media')); },
    descriptors(webview) {
      return [...plugins.values()].map(entry => ({ id: entry.id, name: entry.name, version: entry.version, apiVersion: 1,
        script: webview.asWebviewUri(vscode.Uri.joinPath(entry.extensionUri, entry.script)).toString(),
        ...(entry.style ? { style: webview.asWebviewUri(vscode.Uri.joinPath(entry.extensionUri, entry.style)).toString() } : {}) }));
    },
    dispose() { plugins.clear(); },
  };
}
module.exports = { createPluginRegistry };
