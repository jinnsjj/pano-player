const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { File } = require('node:buffer');
const { webcrypto: crypto } = require('node:crypto');
const { buildSync } = require('esbuild');

const moduleObject = { exports: {} };
vm.runInNewContext(buildSync({ entryPoints: [require.resolve('../media/file-drop.js')], bundle: true,
  format: 'cjs', write: false }).outputFiles[0].text, {
  module: moduleObject, exports: moduleObject.exports, AbortController, File, URL, TextEncoder, crypto, setTimeout, clearTimeout,
});
const { attachFileDrop } = moduleObject.exports;
function setup(options = {}) {
  const target = new EventTarget(), opened = [], messages = [], errors = [];
  const inputs = attachFileDrop(target, { openFiles: files => opened.push(files), postMessage: message => messages.push(message),
    onError: error => errors.push(error), ...options });
  return { opened, messages, errors, dispose: inputs.dispose, selectJsonFile: inputs.selectJsonFile,
    drop(files = [], formats = {}) {
      const event = new Event('drop', { cancelable: true });
      event.preventDefault();
      Object.defineProperty(event, 'dataTransfer', { value: { files, types: Object.keys(formats), getData: type => formats[type] } });
      target.dispatchEvent(event); return event;
    },
    reply(data) { const event = new Event('message'); Object.defineProperty(event, 'data', { value: { session: messages.at(-1)?.session, ...data } }); target.dispatchEvent(event); },
  };
}

test('native file drops keep the original File objects and work after the webview wrapper prevents default', () => {
  const s = setup(), file = new File(['{}'], 'labels.json');
  assert.equal(s.drop([file], { 'text/uri-list': 'file:///tmp/labels.json' }).defaultPrevented, true);
  assert.equal(s.opened[0][0], file); assert.equal(s.messages.length, 0);
  s.dispose(); s.drop([file]); assert.equal(s.opened.length, 1);
});

test('richer multi-resource transfers cannot be reduced to a single native file or standard URI', () => {
  const s = setup(), file = new File(['{}'], 'first.json');
  s.drop([file], { 'application/vnd.code.uri-list': 'file:///tmp/first.json\r\nfile:///tmp/second.json',
    'text/uri-list': 'file:///tmp/first.json' });
  assert.equal(s.opened[0].length, 2); assert.equal(s.opened[0][1].name, 'second.json');
  assert.equal(s.messages.length, 0, 'Unclaimed handles never read host files'); s.dispose();
});

test('URI-only drops expose lazy handles and correlate host replies without decoding the source URI', async () => {
  const s = setup(), uri = 'vscode-remote://ssh-remote+box/tmp/labels%20%25%20%E4%B8%AD.JSON';
  s.drop([], { ResourceURLs: JSON.stringify([uri]) });
  const handle = s.opened[0][0]; assert.equal(handle.name, 'labels % \u4e2d.JSON'); assert.equal(handle.kind, 'file');
  const pending = handle.getFile(), request = s.messages[0];
  assert.equal(request.type, 'read-dropped-json'); assert.equal(request.resource.uri, uri);
  s.reply({ type: 'dropped-json', session: 'old-webview-session', id: request.id, error: 'stale response' });
  s.reply({ type: 'dropped-json', id: request.id + 1, error: 'unrelated' });
  s.reply({ type: 'dropped-json', id: request.id, file: { name: handle.name, size: 2, text: '{}' } });
  const file = await pending; assert.ok(file instanceof File); assert.equal(await file.text(), '{}'); s.dispose();
});

test('new webview sessions use distinct tokens even when their request ids restart', async () => {
  const first = setup(), second = setup();
  for (const s of [first, second]) s.drop([], { 'text/uri-list': 'file:///tmp/labels.json' });
  const a = first.opened[0][0].getFile(), b = second.opened[0][0].getFile();
  assert.equal(first.messages[0].id, second.messages[0].id);
  assert.notEqual(first.messages[0].session, second.messages[0].session);
  second.reply({ type: 'dropped-json', session: first.messages[0].session, id: first.messages[0].id, error: 'stale' });
  first.dispose(); second.dispose(); await assert.rejects(a, /Media closed/); await assert.rejects(b, /Media closed/);
});

test('CodeFiles stays a native path descriptor for host-side Uri.file conversion', async () => {
  const s = setup(), path = '/tmp/labels % # \u4e2d.json';
  s.drop([], { CodeFiles: JSON.stringify([path]) });
  const handle = s.opened[0][0], pending = handle.getFile();
  assert.equal(handle.name, 'labels % # \u4e2d.json'); assert.equal(s.messages[0].resource.path, path);
  s.reply({ type: 'dropped-json', id: s.messages[0].id, error: 'Cannot read annotation' });
  await assert.rejects(pending, /Cannot read annotation/); s.dispose();
});

test('malformed URI payloads and unsupported web URI drops report errors without opening files', () => {
  for (const [options, formats, expected] of [[{}, { ResourceURLs: '{' }, /Invalid/],
    [{ postMessage: undefined }, { 'text/uri-list': 'file:///tmp/labels.json' }, /require VS Code/]]) {
    const s = setup(options); s.drop([], formats);
    assert.match(s.errors[0], expected); assert.equal(s.opened.length, 0); assert.equal(s.messages.length, 0); s.dispose();
  }
});

test('media disposal cancels URI reads and late replies cannot revive a session', async () => {
  const s = setup(); s.drop([], { 'text/uri-list': 'file:///tmp/labels.json' });
  const handle = s.opened[0][0], pending = handle.getFile(); s.dispose();
  await assert.rejects(pending, /Media closed/);
  s.reply({ type: 'dropped-json', id: s.messages[0].id, file: { name: handle.name, text: '{}' } });
  await assert.rejects(handle.getFile(), /Media closed/); assert.equal(s.messages.length, 1);
});

test('missing replies and postMessage failures reject handles rather than leaving imports busy forever', async () => {
  const s = setup({ timeoutMs: 5 }); s.drop([], { 'text/uri-list': 'file:///tmp/labels.json' });
  const rejected = assert.rejects(s.opened[0][0].getFile(), /timed out/);
  await new Promise(resolve => setTimeout(resolve, 20)); await rejected; s.dispose();
  const broken = setup({ postMessage() { throw new Error('Host closed'); } });
  broken.drop([], { 'text/uri-list': 'file:///tmp/labels.json' });
  await assert.rejects(broken.opened[0][0].getFile(), /Host closed/); broken.dispose();
});

test('host JSON selection has a separate response type and no human-dialog read timeout', async () => {
  const s = setup({ timeoutMs: 5 });
  const selected = s.selectJsonFile(), request = s.messages[0];
  assert.equal(request.type, 'select-json-file'); assert.equal(request.resource, undefined);
  s.reply({ type: 'dropped-json', id: request.id, error: 'wrong response type' });
  await new Promise(resolve => setTimeout(resolve, 20));
  s.reply({ type: 'selected-json', id: request.id, file: { name: 'host.json', text: '{}' } });
  assert.equal((await selected).name, 'host.json');
  const cancelled = s.selectJsonFile(); s.reply({ type: 'selected-json', id: s.messages.at(-1).id, file: null });
  assert.equal(await cancelled, null); s.dispose();
  const web = setup({ postMessage: undefined }); assert.equal(web.selectJsonFile, undefined); web.dispose();
});

test('picker failures and media close settle pending host selections', async () => {
  const s = setup(), failed = s.selectJsonFile();
  s.reply({ type: 'selected-json', id: s.messages.at(-1).id, error: 'Host selection failed' });
  await assert.rejects(failed, /Host selection failed/);
  const closing = s.selectJsonFile(); s.dispose(); await assert.rejects(closing, /Media closed/);
});
