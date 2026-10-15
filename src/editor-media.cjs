'use strict';
const path = require('node:path');
const fs = require('node:fs/promises');

function parseMediaPath(text, paths = path) {
  let file = text.trim();
  if (/\r|\n|\0/.test(file)) throw new Error('Select a single media file path.');
  if (file.length >= 2 && ['"', "'", '`'].includes(file[0]) && file.at(-1) === file[0]) {
    file = file.slice(1, -1);
  }
  if (!paths.isAbsolute(file)) throw new Error('Use an absolute file path on the workspace host, not a URL or relative path.');
  if (!/\.(mp4|webm|mov|mkv|wav|flac)$/i.test(file)) throw new Error('Supported media: MP4, WebM, MOV, MKV, WAV and FLAC.');
  return file;
}

async function openEditorMedia(vscode, editor, extensionUri) {
  try {
    if (editor.selections.length !== 1) throw new Error('Select only one media file path.');
    const text = editor.selection.isEmpty
      ? editor.document.lineAt(editor.selection.active.line).text
      : editor.document.getText(editor.selection);
    const file = parseMediaPath(text);
    // Match hostFile's native filesystem access, including mounted network files.
    if (!(await fs.stat(file)).isFile()) throw new Error('The path is not a regular file.');
    const handle = await fs.open(file, 'r');
    try {
      if (!(await handle.stat()).isFile()) throw new Error('The path is not a regular file.');
    } finally { await handle.close(); }
    let uri = vscode.Uri.file(file);
    if (vscode.env.remoteName) {
      const remote = editor.document.uri.scheme === 'vscode-remote' ? editor.document.uri : extensionUri;
      // Remote extension hosts can expose native file: URIs. VS Code handles
      // their transport to the client; no remote authority needs to be invented.
      if (remote.scheme === 'vscode-remote') {
        uri = uri.with({ scheme: remote.scheme, authority: remote.authority });
      }
    }
    await vscode.commands.executeCommand('vscode.openWith', uri, 'panoPlayer.player');
  } catch (error) {
    await vscode.window.showErrorMessage('PanoPlayer: ' + error.message);
  }
}

module.exports = { parseMediaPath, openEditorMedia };
