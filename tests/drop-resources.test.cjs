const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { buildSync } = require('esbuild');
const moduleContext = { exports: {} };
vm.runInNewContext(buildSync({ entryPoints: [require.resolve('../media/drop-resources.js')],
  bundle: true, format: 'cjs', write: false }).outputFiles[0].text,
{ module: moduleContext, exports: moduleContext.exports, URL, TextEncoder });
const { parseDropResources } = moduleContext.exports;
const transfer = entries => ({ types: Object.keys(entries), getData: type => entries[type] });
const parse = entries => {
  const result = parseDropResources(transfer(entries));
  return result === null ? null : Array.from(result, item => ({ ...item }));
};
const first = 'file:///workspace/one.json', second = 'file:///workspace/two.json';

test('full internal URI lists take precedence over all truncated or duplicate representations', () => {
  assert.deepEqual(parse({
    'text/uri-list': first,
    CodeFiles: JSON.stringify(['/workspace/one.json']),
    ResourceURLs: JSON.stringify([first]),
    'application/vnd.code.uri-list': `${first}\r\n${second}`,
  }), [{ uri: first }, { uri: second }]);
  assert.deepEqual(parse({ ResourceURLs: JSON.stringify([first, second]), 'text/uri-list': first }),
    [{ uri: first }, { uri: second }]);
  assert.deepEqual(parse({ CodeFiles: JSON.stringify(['/workspace/one.json', '/workspace/two.json']), 'text/uri-list': first }),
    [{ path: '/workspace/one.json' }, { path: '/workspace/two.json' }]);
});

test('MIME matching is case insensitive and getData receives the original advertised type', () => {
  const reads = [];
  const result = parseDropResources({ types: ['RESOURCEURLS'], getData(type) { reads.push(type); return JSON.stringify([first]); } });
  assert.deepEqual(Array.from(result, item => ({ ...item })), [{ uri: first }]);
  assert.deepEqual(reads, ['RESOURCEURLS']);
  assert.deepEqual(parse({ 'Application/Vnd.Code.Uri-List': first }), [{ uri: first }]);
  assert.deepEqual(parse({ 'TEXT/URI-LIST': first }), [{ uri: first }]);
  assert.deepEqual(parse({ codefiles: JSON.stringify(['/workspace/one.json']) }), [{ path: '/workspace/one.json' }]);
});

test('URI lists ignore comments and blank lines and retain encoded, Unicode and remote resource identity', () => {
  const unicode = 'file:///workspace/\u6807\u6ce8.json';
  const encoded = 'file:///workspace/a%20b%23c%0Ad.JSON';
  const remote = 'vscode-remote://ssh-remote+host/workspace/labels.json#L2';
  assert.deepEqual(parse({ 'text/uri-list': `# comment\r\n\r\n ${unicode} \n${encoded}\r${remote}\n` }),
    [{ uri: unicode }, { uri: encoded }, { uri: remote }]);
});

test('directory and non-JSON resources remain in the list for downstream multi-file rejection', () => {
  assert.deepEqual(parse({
    'application/vnd.code.uri-list': `file:///workspace/folder/\r\n${first}\r\nfile:///workspace/video.mp4`,
    ResourceURLs: JSON.stringify([first, 'file:///workspace/video.mp4']),
  }), [{ uri: 'file:///workspace/folder/' }, { uri: first }, { uri: 'file:///workspace/video.mp4' }]);
});

test('resource deduplication uses exact strings without URL normalization or decoding', () => {
  assert.deepEqual(parse({ ResourceURLs: JSON.stringify([first, first, 'file:///workspace/./one.json', 'file:///workspace/%6Fne.json']) }),
    [{ uri: first }, { uri: 'file:///workspace/./one.json' }, { uri: 'file:///workspace/%6Fne.json' }]);
  assert.deepEqual(parse({ CodeFiles: JSON.stringify(['/workspace/one.json', '/workspace/one.json']) }), [{ path: '/workspace/one.json' }]);
  assert.deepEqual(parse({ 'text/uri-list': `${first}\n${first}` }), [{ uri: first }]);
});

test('native absolute POSIX and drive-letter paths are preserved for host-side Uri.file conversion', () => {
  const paths = ['/workspace/a b#\u6807\u6ce8.json', 'C:\\Users\\Example\\labels.json', 'd:/work/labels.JSON'];
  assert.deepEqual(parse({ CodeFiles: JSON.stringify(paths) }), paths.map(path => ({ path })));
  for (const value of ['relative.json', './relative.json', 'C:relative.json', '\\relative.json', 'file:///workspace/labels.json']) {
    assert.throws(() => parse({ CodeFiles: JSON.stringify([value]) }), /absolute/);
  }
});

test('unrecognized transfers return null and recognized empty transfers never fall through', () => {
  assert.equal(parseDropResources(undefined), null);
  assert.equal(parse({ Files: '', 'text/plain': first, CodeEditors: '[{}]' }), null);
  for (const value of ['', ' \r\n ', '# comments only\n']) {
    assert.deepEqual(parse({ 'application/vnd.code.uri-list': value, ResourceURLs: JSON.stringify([first]) }), []);
  }
  for (const format of ['ResourceURLs', 'CodeFiles']) {
    for (const value of ['', '  ', '[]']) assert.deepEqual(parse({ [format]: value, 'text/uri-list': first }), []);
  }
});

test('malformed recognized payloads fail clearly without falling through to a valid lower-priority transfer', () => {
  for (const value of ['{', '{}', 'null', '42', '"file:///workspace/one.json"', '[null]', '[42]', '[{}]', '[""]', '["   "]']) {
    assert.throws(() => parse({ ResourceURLs: value, 'text/uri-list': first }), /resource|strings/i);
    assert.throws(() => parse({ CodeFiles: value, 'text/uri-list': first }), /resource|strings/i);
  }
  assert.throws(() => parse({ ResourceURLs: JSON.stringify([first, 42]), 'text/uri-list': first }), /strings/);
  assert.throws(() => parse({ 'application/vnd.code.uri-list': 'relative.json', ResourceURLs: JSON.stringify([first]) }), /absolute URLs/);
  assert.throws(() => parse({ ResourceURLs: JSON.stringify(['/workspace/labels.json']) }), /absolute URLs/);
  assert.throws(() => parseDropResources({ types: ['ResourceURLs'], getData: () => null }), /payload/);
});

test('URI schemes remain host-validated and parsing never fetches resource content', () => {
  const uris = ['https://example.test/labels.json', 'command:workbench.action.files.openFile', 'custom:labels.json'];
  assert.deepEqual(parse({ ResourceURLs: JSON.stringify(uris) }), uris.map(uri => ({ uri })));
});

test('payload byte size, per-resource length and supplied count are bounded before deduplication', () => {
  const maxPayload = 1024 * 1024;
  assert.deepEqual(parse({ 'text/uri-list': '#' + 'x'.repeat(maxPayload - 1) }), []);
  assert.throws(() => parse({ 'text/uri-list': '#' + 'x'.repeat(maxPayload) }), /1 MiB/);
  assert.throws(() => parse({ 'text/uri-list': '#' + '\u4e00'.repeat(Math.floor(maxPayload / 3) + 1) }), /1 MiB/);
  const uri = 'custom:' + 'x'.repeat(32768 - 'custom:'.length);
  assert.deepEqual(parse({ ResourceURLs: JSON.stringify([uri]) }), [{ uri }]);
  assert.throws(() => parse({ ResourceURLs: JSON.stringify([uri + 'x']) }), /32,768/);
  const entries = Array(1024).fill(first);
  assert.deepEqual(parse({ ResourceURLs: JSON.stringify(entries) }), [{ uri: first }]);
  entries.push(first);
  assert.throws(() => parse({ ResourceURLs: JSON.stringify(entries) }), /1,024/);
  assert.throws(() => parse({ 'text/uri-list': entries.join('\n') }), /1,024/);
});
