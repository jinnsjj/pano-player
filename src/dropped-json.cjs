'use strict';
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');

const droppedJsonLimit = 20 * 1024 * 1024;

async function readDroppedJson(rawUri, { Uri, documentUri, fs: fileSystem = fs }) {
  if (typeof rawUri !== 'string' || !rawUri || rawUri.length > 32768) {
    throw new Error('Invalid dropped annotation URI.');
  }
  let uri;
  try { uri = Uri.parse(rawUri, true); }
  catch { throw new Error('Invalid dropped annotation URI.'); }
  const local = documentUri?.scheme === 'file' && uri.scheme === 'file' &&
    (!uri.authority || uri.authority.toLowerCase() === 'localhost');
  const remote = documentUri?.scheme === 'vscode-remote' && uri.scheme === 'vscode-remote' &&
    uri.authority === documentUri.authority;
  if (!local && !remote) throw new Error('Drop an annotation file stored on the current workspace host.');
  if (uri.query || uri.fragment || !path.isAbsolute(uri.fsPath)) throw new Error('Invalid dropped annotation file path.');
  if (path.extname(uri.fsPath).toLowerCase() !== '.json') throw new Error('Drop an annotation JSON file.');

  // Do not block on special files before checking that the opened target is regular.
  const handle = await fileSystem.open(uri.fsPath, constants.O_RDONLY | (constants.O_NONBLOCK || 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('The dropped annotation must be a regular file.');
    if (!Number.isSafeInteger(stat.size) || stat.size < 0 || stat.size > droppedJsonLimit) {
      throw new Error('Annotation files must be 20 MB or smaller.');
    }
    const chunks = [];
    let size = 0;
    while (true) {
      const buffer = Buffer.alloc(Math.min(65536, droppedJsonLimit + 1 - size));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, size);
      if (!bytesRead) break;
      size += bytesRead;
      if (size > droppedJsonLimit) throw new Error('Annotation files must be 20 MB or smaller.');
      chunks.push(buffer.subarray(0, bytesRead));
    }
    return { name: path.basename(uri.fsPath), size, text: Buffer.concat(chunks, size).toString('utf8') };
  } finally { await handle.close(); }
}

module.exports = { readDroppedJson, droppedJsonLimit };
