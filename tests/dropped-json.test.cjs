const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { readDroppedJson, droppedJsonLimit } = require('../src/dropped-json.cjs');

const Uri = { parse(value, strict) {
  assert.equal(strict, true);
  const parsed = new URL(value);
  return { scheme: parsed.protocol.slice(0, -1), authority: parsed.host,
    fsPath: decodeURIComponent(parsed.pathname), query: parsed.search.slice(1), fragment: parsed.hash.slice(1) };
} };
const local = { scheme: 'file', authority: '' };
const remote = { scheme: 'vscode-remote', authority: 'ssh-remote+workspace' };
const fileUri = file => pathToFileURL(file).href;
const read = (value, documentUri = local, fileSystem) => readDroppedJson(value, { Uri, documentUri, fs: fileSystem });

test('URI imports decode local and current-remote JSON paths without changing their contents', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pano-dropped-json-'));
  const filename = path.join(directory, 'labels space % \u4e2d\u6587.JSON');
  const text = '\uFEFF{"version":1,"annotations":[]}';
  try {
    await fs.writeFile(filename, text);
    const encoded = fileUri(filename);
    for (const [uri, document] of [[encoded, local],
      [encoded.replace('file:///', 'vscode-remote://ssh-remote+workspace/'), remote]]) {
      const result = await read(uri, document);
      assert.deepEqual(result, { name: path.basename(filename), size: Buffer.byteLength(text), text });
    }
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('URI validation rejects untrusted hosts, schemes, URI metadata and unsupported paths before opening files', async () => {
  const fileSystem = { open() { assert.fail('Rejected URI must not reach the filesystem'); } };
  for (const value of [null, {}, '', 'not a URI', 'file:///tmp/' + 'x'.repeat(32768) + '.json']) {
    await assert.rejects(read(value, local, fileSystem), /Invalid dropped annotation URI/);
  }
  for (const [value, document, message] of [
    ['https://example.com/labels.json', local, /current workspace host/],
    ['file://other-host/tmp/labels.json', local, /current workspace host/],
    ['vscode-remote://ssh-remote+workspace/tmp/labels.json', local, /current workspace host/],
    ['file:///tmp/labels.json', remote, /current workspace host/],
    ['vscode-remote://ssh-remote+elsewhere/tmp/labels.json', remote, /current workspace host/],
    ['file:///tmp/labels.json?token=1', local, /Invalid dropped annotation file path/],
    ['file:///tmp/labels.json#part', local, /Invalid dropped annotation file path/],
    ['file:///tmp/labels.txt', local, /annotation JSON file/],
  ]) await assert.rejects(read(value, document, fileSystem), message);
  await assert.rejects(readDroppedJson('file:relative.json', {
    Uri: { parse: () => ({ scheme: 'file', authority: '', fsPath: 'relative.json' }) }, documentUri: local, fs: fileSystem,
  }), /Invalid dropped annotation file path/);
});

test('empty JSON returns zero bytes while directories, missing files and oversized files are rejected', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pano-dropped-json-'));
  const empty = path.join(directory, 'empty.json'), huge = path.join(directory, 'huge.json');
  const folder = path.join(directory, 'folder.json');
  try {
    await fs.writeFile(empty, ''); await fs.mkdir(folder);
    const handle = await fs.open(huge, 'w');
    try { await handle.truncate(droppedJsonLimit + 1); } finally { await handle.close(); }
    assert.deepEqual(await read(fileUri(empty)), { name: 'empty.json', size: 0, text: '' });
    await assert.rejects(read(fileUri(folder)), /regular file/);
    await assert.rejects(read(fileUri(huge)), /20 MB/);
    await assert.rejects(read(fileUri(path.join(directory, 'missing.json'))), /ENOENT/);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('the opened descriptor is always closed and concurrent file growth remains bounded', async () => {
  let closed = 0, totalRead = 0, largestRead = 0;
  const fileSystem = { async open() {
    return {
      async stat() { return { size: 1, isFile: () => true }; },
      async read(buffer, offset, length, position) {
        assert.equal(position, totalRead); largestRead = Math.max(largestRead, length);
        totalRead += length; buffer.fill(32);
        return { bytesRead: length };
      },
      async close() { closed++; },
    };
  } };
  await assert.rejects(read('file:///tmp/growing.json', local, fileSystem), /20 MB/);
  assert.equal(totalRead, droppedJsonLimit + 1); assert.equal(largestRead, 65536); assert.equal(closed, 1);
  for (const phase of ['stat', 'read']) {
    let closedAfterError = false;
    const broken = { async open() { return {
      async stat() { if (phase === 'stat') throw new Error('stat failed'); return { size: 1, isFile: () => true }; },
      async read() { throw new Error('read failed'); },
      async close() { closedAfterError = true; },
    }; } };
    await assert.rejects(read('file:///tmp/broken.json', local, broken), new RegExp(phase + ' failed'));
    assert.equal(closedAfterError, true);
  }
});
