const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { parseMediaPath, openEditorMedia } = require('../src/editor-media.cjs');

test('media paths preserve spaces and special characters and accept optional wrapping', () => {
  for (const wrap of ['', '"', "'", '`']) {
    assert.equal(parseMediaPath(`  ${wrap}/media/a b #1.WAV${wrap}  `), '/media/a b #1.WAV');
  }
  assert.equal(parseMediaPath('C:\\Media\\a b.mp4', path.win32), 'C:\\Media\\a b.mp4');
  assert.equal(parseMediaPath('/media/\u4e2d\u6587.wav'), '/media/\u4e2d\u6587.wav');
  assert.equal(parseMediaPath('\\\\nas\\share\\a.flac', path.win32), '\\\\nas\\share\\a.flac');
  for (const invalid of ['', 'clip.mp4', '~/clip.mp4', 'https://host/a.mp4', 'sftp://host/a.wav',
    '/a.txt', '/a.mp4\n/b.mp4', '/a\0.mp4']) {
    assert.throws(() => parseMediaPath(invalid));
  }
});

function harness(text, { selected = false, remote = false, untitled = false, hostFileUris = false } = {}) {
  const opened = [], errors = [];
  const makeUri = values => ({ ...values, with(patch) { return makeUri({ ...values, ...patch }); } });
  const selection = { isEmpty: !selected, active: { line: 3 } };
  const editor = { selection, selections: [selection], document: {
    uri: makeUri({ scheme: untitled ? 'untitled' : remote && !hostFileUris ? 'vscode-remote' : 'file', authority: remote && !hostFileUris ? 'ssh-remote+test' : '' }),
    getText: () => { assert.ok(selected); return text; },
    lineAt: line => { assert.equal(line, 3); assert.ok(!selected); return { text }; },
  } };
  const vscode = { Uri: { file: file => makeUri({ scheme: 'file', authority: '', fsPath: file }) },
    env: { remoteName: remote ? 'ssh-remote' : undefined },
    commands: { executeCommand: async (...args) => opened.push(args) },
    window: { showErrorMessage: async message => errors.push(message) },
  };
  const extensionUri = makeUri({ scheme: remote && !hostFileUris ? 'vscode-remote' : 'file', authority: remote && !hostFileUris ? 'ssh-remote+test' : '' });
  return { editor, vscode, extensionUri, opened, errors, run: () => openEditorMedia(vscode, editor, extensionUri) };
}

test('editor command opens selected paths and whole lines outside the workspace', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pano-editor-'));
  const file = path.join(dir, 'a b #1.WAV');
  try {
    await fs.writeFile(file, 'fixture');
    for (const options of [{}, { selected: true }, { remote: true }, { remote: true, untitled: true },
      { remote: true, hostFileUris: true }, { remote: true, hostFileUris: true, untitled: true }]) {
      const h = harness(`"${file}"`, options);
      await h.run();
      assert.deepEqual(h.errors, []);
      assert.equal(h.opened.length, 1);
      const [command, uri, viewType] = h.opened[0];
      assert.equal(command, 'vscode.openWith');
      assert.equal(viewType, 'panoPlayer.player');
      assert.equal(uri.fsPath, file);
      assert.equal(uri.scheme, options.remote && !options.hostFileUris ? 'vscode-remote' : 'file');
      assert.equal(uri.authority, options.remote && !options.hostFileUris ? 'ssh-remote+test' : '');
    }
    const directory = path.join(dir, 'directory.mp4');
    await fs.mkdir(directory);
    for (const text of [directory, path.join(dir, 'missing.mp4'), '/a.txt', '/a.mp4\n/b.mp4']) {
      const h = harness(text, { selected: true });
      await h.run();
      assert.equal(h.opened.length, 0);
      assert.equal(h.errors.length, 1);
    }
    const h = harness(file);
    h.editor.selections.push(h.editor.selection);
    await h.run();
    assert.equal(h.opened.length, 0);
    assert.match(h.errors[0], /only one/);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('manifest contributes a text editor context command with automatic command activation', () => {
  const manifest = require('../package.json');
  assert.ok(manifest.contributes.commands.some(command => command.command === 'panoPlayer.openPath'));
  assert.ok(manifest.contributes.menus['editor/context'].some(item => item.command === 'panoPlayer.openPath'));
});
