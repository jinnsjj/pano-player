'use strict';
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');

const manifestLimit = 64 * 1024;
const mediaExtensions = /\.(mp4|webm|mov|mkv|wav|flac)$/i;

function parseMediaManifest(data, filename, paths = path) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.version !== 1) {
    throw new Error('Media configuration must be an object with version: 1.');
  }
  const allowed = new Set(['version', 'video_path', 'audio_path', 'annotation']);
  for (const key of Object.keys(data)) if (!allowed.has(key)) throw new Error('Unknown media configuration field: ' + key);
  const resolve = (value, field, extensions) => {
    if (typeof value !== 'string' || !value.trim() || value.length > 32768 || /[\0\r\n]/.test(value) ||
        /^~(?:[\\/]|$)/.test(value) || (!paths.isAbsolute(value) && /^[a-z][a-z\d+.-]*:/i.test(value))) {
      throw new Error(field + ' must be a file path on the workspace host, not a URL.');
    }
    const resolved = paths.resolve(paths.dirname(filename), value);
    if (!extensions.test(resolved)) throw new Error('Unsupported file extension in ' + field + '.');
    return resolved;
  };
  const videoPath = resolve(data.video_path, 'video_path', /\.(mp4|webm|mov|mkv)$/i);
  const audioReferences = data.audio_path === undefined ? [] : typeof data.audio_path === 'string' ? [data.audio_path] : data.audio_path;
  if (!Array.isArray(audioReferences) || audioReferences.length > 32) {
    throw new Error('audio_path must be a file path or an array of at most 32 file paths.');
  }
  const audioPaths = [...new Set(audioReferences.map(value => resolve(value, 'audio_path', mediaExtensions)))];
  const annotationPath = data.annotation === undefined ? undefined : resolve(data.annotation, 'annotation', /\.json$/i);
  return { videoPath, audioPaths, annotationPath };
}

async function readMediaManifest(filename, fileSystem = fs) {
  const flags = constants.O_RDONLY | (constants.O_NONBLOCK || 0);
  const handle = await fileSystem.open(filename, flags);
  let data;
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('Media configuration must be a regular file.');
    if (stat.size > manifestLimit) throw new Error('Media configuration must be 64 KB or smaller.');
    // Read one extra byte so an overwriting producer cannot bypass the size limit.
    const bytes = Buffer.alloc(manifestLimit + 1);
    let size = 0;
    while (size < bytes.length) {
      const { bytesRead } = await handle.read(bytes, size, bytes.length - size, size);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size > manifestLimit) throw new Error('Media configuration must be 64 KB or smaller.');
    try { data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size))); }
    catch { throw new Error('Media configuration is not valid JSON.'); }
  } finally { await handle.close(); }
  const result = parseMediaManifest(data, filename);
  const video = await fileSystem.open(result.videoPath, flags);
  try {
    if (!(await video.stat()).isFile()) throw new Error('video_path must refer to a regular file.');
  } finally { await video.close(); }
  return result;
}

module.exports = { parseMediaManifest, readMediaManifest, manifestLimit };
