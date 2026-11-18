const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

async function setup({ directory, remote = false, hostFileUris = false, readAnnotation, writeClipboard, configurationName = 'session.json' } = {}) {
  const files = [], replies = [], rootsSeen = [], commands = new Map(), opened = [], dialogs = [], errors = [];
  const disposals = new Set();
  const clipboard = [];
  let provider, receive;
  const disposable = { dispose() {} };
  const makeUri = (filename, scheme = remote && !hostFileUris ? 'vscode-remote' : 'file', authority = scheme === 'vscode-remote' ? 'ssh-remote+test' : '', query = '') => ({
    scheme, authority, path: filename, fsPath: filename, query, fragment: '',
    toString: () => `${scheme}://${authority}${filename.split('/').map(encodeURIComponent).join('/')}${query ? '?' + query : ''}`,
    with: patch => makeUri(filename, patch.scheme ?? scheme, patch.authority ?? authority, patch.query ?? query),
  });
  const Uri = {
    file: filename => makeUri(filename, 'file', ''),
    joinPath: (base, ...parts) => makeUri(path.posix.join(base.path, ...parts), base.scheme, base.authority),
    parse: value => { const u = new URL(value); return makeUri(decodeURIComponent(u.pathname), u.protocol.slice(0, -1), u.host, u.search.slice(1)); },
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/extension.cjs'), 'utf8'), {
    module, require(name) {
      if (name === 'vscode') return {
        env: { remoteName: remote ? 'ssh-remote' : undefined, clipboard: { async writeText(text) {
          if (writeClipboard) await writeClipboard(text);
          clipboard.push(text);
        } } }, Uri,
        window: {
          createOutputChannel: () => ({ ...disposable, appendLine() {} }),
          registerCustomEditorProvider: (id, value) => { provider = value; return disposable; },
          async showOpenDialog(options) { dialogs.push(options); return [makeUri(path.join(directory, configurationName))]; },
          async showErrorMessage(error) { errors.push(error); },
        },
        commands: {
          registerTextEditorCommand: () => disposable,
          registerCommand(id, fn) { commands.set(id, fn); return disposable; },
          async executeCommand(...args) { opened.push(args); },
        },
      };
      if (name === './host-file.cjs') return { hostFile(filename, reply) {
        const owned = { filename, read(message) { owned.lastRead = message; reply({ type: 'media-range', id: message.id }); }, dispose() { owned.disposed = true; } };
        files.push(owned); return owned;
      } };
      if (name === './dropped-json.cjs' && readAnnotation) return { readDroppedJson: readAnnotation };
      return name.startsWith('./') ? require('../src/' + name.slice(2)) : require(name);
    },
  });
  module.exports.activate({ subscriptions: [], extensionUri: makeUri('/extension'), globalState: { get() {} } });
  const panel = {
    onDidDispose(callback) { disposals.add(callback); return { dispose: () => disposals.delete(callback) }; },
    onDidChangeViewState: () => disposable,
    webview: {
      cspSource: 'self', asWebviewUri(value) { rootsSeen.push(value); return value; },
      onDidReceiveMessage(callback) { receive = callback; return disposable; },
      postMessage(message) { replies.push(message); return true; },
    },
  };
  const document = await provider.openCustomDocument(makeUri(path.join(directory, configurationName)));
  await provider.resolveCustomEditor(document, panel);
  return { document, files, replies, rootsSeen, panel, commands, opened, dialogs, errors, clipboard,
    send: message => receive({ session: 'manifest-host-session', ...message }), dispose() { for (const fn of disposals) fn(); } };
}

async function fixture(run) {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'pano-session-host-'));
  try {
    await fsp.mkdir(path.join(directory, 'media'));
    await fsp.writeFile(path.join(directory, 'media', 'video # %.mp4'), 'fixture');
    await fsp.writeFile(path.join(directory, 'labels # \u6807\u6ce8.json'), '{"version":1,"annotations":[]}');
    await fsp.writeFile(path.join(directory, 'session.json'), JSON.stringify({ version: 1, video_path: './media/video # %.mp4',
      audio_path: ['./audio/a.wav', '../outside/b.flac'], annotation: './labels # \u6807\u6ce8.json' }));
    await run(directory);
  } finally { await fsp.rm(directory, { recursive: true, force: true }); }
}
async function until(check) {
  for (let attempt = 0; attempt < 100; attempt++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
  assert.fail('Host response timed out.');
}

test('local and Remote JSON editors host the referenced video, opaque audio IDs and bounded annotation import', async () => {
  await fixture(async directory => {
    for (const options of [{}, { remote: true }, { remote: true, hostFileUris: true }]) {
      const s = await setup({ directory, ...options });
      assert.deepEqual(s.files.map(file => file.filename), [path.join(directory, 'media/video # %.mp4'), path.join(directory, 'audio/a.wav'), path.resolve(directory, '../outside/b.flac')]);
      assert.match(s.panel.webview.html, /data-title="video # %\.mp4"/);
      const roots = s.panel.webview.options.localResourceRoots;
      assert.equal(roots.length, 2); assert.equal(roots[1].fsPath, path.join(directory, 'media'));
      assert.equal(roots[1].scheme, options.remote && !options.hostFileUris ? 'vscode-remote' : 'file');
      assert.equal(roots[1].authority, s.document.uri.authority);
      s.send({ type: 'player-ready' }); s.send({ type: 'player-ready' });
      const sessions = s.replies.filter(reply => reply.type === 'media-session');
      assert.equal(sessions.length, 1); assert.equal(sessions[0].sources.length, 2);
      for (const [index, source] of sessions[0].sources.entries()) {
        assert.match(source.id, /^[a-f0-9]{32}$/); assert.equal(source.url, 'pano-audio:' + source.id);
        assert.equal(source.path, undefined); assert.equal(source.uri, undefined);
        s.send({ type: 'read-media', sourceId: source.id, id: index + 1, offset: 16, length: 4, path: '/not-owned' });
        assert.equal(s.files[index + 1].lastRead.offset, 16);
      }
      s.send({ type: 'read-media', id: 3, offset: 0, length: 4 }); assert.equal(s.files[0].lastRead.id, 3);
      s.send({ type: 'read-media', sourceId: 'unknown', id: 4, path: '/etc/passwd' }); assert.match(s.replies.at(-1).error, /Unknown/);
      await until(() => s.replies.some(reply => reply.type === 'session-annotation'));
      const annotation = s.replies.find(reply => reply.type === 'session-annotation');
      assert.equal(annotation.file.name, 'labels # \u6807\u6ce8.json'); assert.match(annotation.file.text, /annotations/);
      assert.equal(s.panel.webview.options.localResourceRoots, roots);
      await s.commands.get('panoPlayer.open')();
      assert.ok(s.dialogs[0].filters['Panorama media'].includes('json')); assert.equal(s.opened[0][2], 'panoPlayer.player');
      s.dispose(); assert.ok(s.files.every(file => file.disposed));
      const count = s.replies.length; s.send({ type: 'player-ready' }); assert.equal(s.replies.length, count);
    }
  });
});

test('optional annotation errors do not remove media and disposal suppresses pending imports', async () => {
  await fixture(async directory => {
    for (const dispose of [false, true]) {
      let reject;
      const s = await setup({ directory, remote: true, readAnnotation: () => new Promise((resolve, fail) => { reject = fail; }) });
      s.send({ type: 'player-ready' }); assert.equal(s.replies[0].sources.length, 2);
      if (dispose) s.dispose();
      reject(new Error('Annotation unavailable.')); await new Promise(setImmediate);
      assert.equal(s.replies.length, dispose ? 1 : 2);
      if (!dispose) assert.match(s.replies[1].error, /Annotation unavailable/);
      s.dispose();
    }
  });
});

test('a single audio path reaches local and Remote host sessions as one opaque audio source', async () => {
  await fixture(async directory => {
    await fsp.writeFile(path.join(directory, 'session.json'), JSON.stringify({ version: 1,
      video_path: './media/video # %.mp4', audio_path: '../outside/single.wav' }));
    for (const options of [{}, { remote: true }, { remote: true, hostFileUris: true }]) {
      const s = await setup({ directory, ...options });
      assert.deepEqual(s.files.map(file => file.filename), [path.join(directory, 'media/video # %.mp4'), path.resolve(directory, '../outside/single.wav')]);
      s.send({ type: 'player-ready' });
      assert.equal(s.replies.length, 1); assert.equal(s.replies[0].sources.length, 1);
      const source = s.replies[0].sources[0];
      assert.equal(source.name, 'single.wav'); assert.equal(source.url, 'pano-audio:' + source.id);
      s.send({ type: 'read-media', sourceId: source.id, id: 1, offset: 0, length: 4 });
      assert.equal(s.files[1].lastRead.id, 1); s.dispose();
    }
  });
});

test('JSONPP configurations use the same local and Remote media loader and file picker', async () => {
  await fixture(async directory => {
    for (const configurationName of ['session.jsonpp', 'session.JSONPP']) {
      await fsp.copyFile(path.join(directory, 'session.json'), path.join(directory, configurationName));
      for (const remote of [false, true]) {
        const s = await setup({ directory, remote, configurationName });
        assert.equal(s.files.length, 3); assert.equal(s.document.manifest.videoPath, path.join(directory, 'media/video # %.mp4'));
        s.send({ type: 'player-ready' }); assert.equal(s.replies[0].sources.length, 2);
        await until(() => s.replies.some(reply => reply.type === 'session-annotation'));
        assert.equal(s.replies.find(reply => reply.type === 'session-annotation').file.name, 'labels # \u6807\u6ce8.json');
        await s.commands.get('panoPlayer.open')(); assert.ok(s.dialogs[0].filters['Panorama media'].includes('jsonpp'));
        assert.ok(s.opened[0][1].fsPath.endsWith(configurationName)); assert.equal(s.opened[0][2], 'panoPlayer.mediaConfig'); s.dispose();
      }
    }
  });
});

test('webview reload reapplies JSON sources while rejecting old annotation results and duplicate handshakes', async () => {
  await fixture(async directory => {
    const pending = [];
    const s = await setup({ directory, readAnnotation: () => new Promise(resolve => pending.push(resolve)) });
    for (const session of [undefined, '', 1, 'x'.repeat(65)]) s.send({ type: 'player-ready', session });
    assert.equal(s.replies.length, 0);
    s.send({ type: 'player-ready', session: 'old' }); s.send({ type: 'player-ready', session: 'old' });
    s.send({ type: 'player-ready', session: 'reloaded' });
    assert.equal(s.replies.length, 2); assert.equal(pending.length, 2);
    assert.equal(s.replies[0].sources[0].id, s.replies[1].sources[0].id);
    pending[0]({ name: 'old.json', text: '{}' }); pending[1]({ name: 'new.json', text: '{}' });
    await new Promise(setImmediate);
    assert.equal(s.replies.length, 3); assert.equal(s.replies[2].session, 'reloaded');
    assert.equal(s.replies[2].file.name, 'new.json'); s.dispose();
  });
});

test('copy uses the opened JSONPP or video path on local and Remote hosts, never a webview-supplied path', async () => {
  await fixture(async directory => {
    await fsp.copyFile(path.join(directory, 'session.json'), path.join(directory, 'session.jsonpp'));
    for (const configurationName of ['session.jsonpp', 'media/video # %.mp4']) {
      for (const remote of [false, true]) {
        const s = await setup({ directory, remote, configurationName });
        s.send({ type: 'copy-media-time', id: 1, path: '/wrong.mp4', playback: { time: 3.125 } });
        await until(() => s.replies.some(reply => reply.type === 'media-time-copied'));
        assert.equal(s.clipboard[0], path.join(directory, configurationName) + '\ntime: 3.125 s');
        assert.equal(s.replies.at(-1).error, undefined);
        assert.equal(s.replies.at(-1).session, 'manifest-host-session');
        s.send({ type: 'copy-media-time', id: 2, playback: { loop: { start: 2, end: 5.5 } } });
        await until(() => s.replies.at(-1).id === 2);
        assert.equal(s.clipboard[1], path.join(directory, configurationName) + '\nrange: 2.000 - 5.500 s');
        const count = s.clipboard.length;
        s.dispose(); s.send({ type: 'copy-media-time', id: 3, playback: { time: 0 } });
        await new Promise(setImmediate); assert.equal(s.clipboard.length, count);
      }
    }
  });
});

test('copy validates request identity and timing, and reports clipboard failures without success', async () => {
  await fixture(async directory => {
    const s = await setup({ directory });
    for (const extra of [{ id: 0 }, { id: 1.5 }, { id: 1, session: '' }, { id: 1, session: 'x'.repeat(65) }]) {
      s.send({ type: 'copy-media-time', playback: { time: 1 }, ...extra });
    }
    assert.equal(s.replies.length, 0); assert.equal(s.clipboard.length, 0);
    s.send({ type: 'copy-media-time', id: 1, playback: { time: '1' } });
    await until(() => s.replies.length === 1);
    assert.match(s.replies[0].error, /Invalid/); assert.equal(s.clipboard.length, 0); s.dispose();
    const failing = await setup({ directory, writeClipboard: async () => { throw new Error('Clipboard unavailable'); } });
    failing.send({ type: 'copy-media-time', id: 2, playback: { time: 1 } });
    await until(() => failing.replies.length === 1);
    assert.match(failing.replies[0].error, /Clipboard unavailable/); assert.equal(failing.clipboard.length, 0); failing.dispose();
  });
});

test('pending copies are bounded and editor disposal suppresses late results', async () => {
  await fixture(async directory => {
    let finish;
    const s = await setup({ directory, writeClipboard: () => new Promise(resolve => { finish = resolve; }) });
    s.send({ type: 'copy-media-time', id: 1, playback: { time: 1 } });
    s.send({ type: 'copy-media-time', id: 2, playback: { time: 2 } });
    assert.equal(s.replies.length, 1); assert.match(s.replies[0].error, /in progress/);
    s.dispose(); finish(); await new Promise(setImmediate);
    assert.equal(s.replies.length, 1);
  });
});
