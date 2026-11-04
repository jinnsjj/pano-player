const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { parseMediaManifest, readMediaManifest, manifestLimit } = require('../src/media-manifest.cjs');

const minimal = { version: 1, video_path: './video.mp4' };
const parse = data => parseMediaManifest(data, '/configs/session.json');

test('media configuration resolves paths beside the JSON and deduplicates external audio in order', () => {
  assert.deepEqual(parse(minimal), { videoPath: '/configs/video.mp4', audioPaths: [], annotationPath: undefined });
  assert.deepEqual(parse({ ...minimal, video_path: '../media/video # %.MP4',
    audio_path: ['./audio/a.wav', '/outside/b.FLAC', 'audio/../audio/a.wav'], annotation: '../labels/\u6807\u6ce8.json' }), {
    videoPath: '/media/video # %.MP4', audioPaths: ['/configs/audio/a.wav', '/outside/b.FLAC'], annotationPath: '/labels/\u6807\u6ce8.json',
  });
  assert.deepEqual(parse({ ...minimal, audio_path: [] }).audioPaths, []);
  assert.equal(parse({ ...minimal, audio_path: Array(32).fill('./a.wav') }).audioPaths.length, 1);
  assert.deepEqual(parseMediaManifest({ ...minimal, video_path: '..\\video.MKV',
    audio_path: ['D:\\tracks\\foa.wav', '.\\second.wav'], annotation: '.\\labels.json' }, 'C:\\configs\\session.json', path.win32), {
    videoPath: 'C:\\video.MKV', audioPaths: ['D:\\tracks\\foa.wav', 'C:\\configs\\second.wav'], annotationPath: 'C:\\configs\\labels.json',
  });
});

test('a single audio path normalizes exactly like a one-element array on POSIX and Windows hosts', () => {
  for (const value of ['./audio/a.wav', '/outside/foa # % \u6807\u6ce8.FLAC']) {
    assert.deepEqual(parse({ ...minimal, audio_path: value }), parse({ ...minimal, audio_path: [value] }));
  }
  const data = { ...minimal, audio_path: 'D:\\tracks\\foa.wav' };
  assert.deepEqual(parseMediaManifest(data, 'C:\\configs\\session.json', path.win32),
    parseMediaManifest({ ...data, audio_path: [data.audio_path] }, 'C:\\configs\\session.json', path.win32));
});

test('media configuration rejects ambiguous types, unknown keys, unsupported versions and non-file paths', () => {
  for (const data of [undefined, null, [], 'text', {}, { ...minimal, version: '1' }, { ...minimal, version: 2 },
    { ...minimal, videoPath: './wrong.mp4' }, { ...minimal, audio_path: null }, { ...minimal, audio_path: false },
    { ...minimal, audio_path: 1 }, { ...minimal, audio_path: { path: './a.wav' } },
    { ...minimal, audio_path: Array(33).fill('./a.wav') }, { ...minimal, annotation: { annotations: [] } }]) assert.throws(() => parse(data));
  for (const value of [undefined, null, 1, {}, [], '', ' ', './audio.wav', 'https://host/a.mp4', 'file:///a.mp4',
    '~/video.mp4', '/a\0.mp4', '/a\n.mp4', 'x'.repeat(32769) + '.mp4']) assert.throws(() => parse({ ...minimal, video_path: value }));
  for (const value of [null, 1, '', ' ', '/a.txt', 'sftp://host/a.wav', 'file:///a.wav', '~/audio.wav', '/a\0.wav', '/a\n.wav']) {
    assert.throws(() => parse({ ...minimal, audio_path: value }));
    assert.throws(() => parse({ ...minimal, audio_path: [value] }));
  }
  for (const value of [null, [], '', '/a.txt', 'https://host/a.json']) assert.throws(() => parse({ ...minimal, annotation: value }));
});

test('configuration reads BOM JSON on the host and validates the video without requiring optional files to exist', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pano-manifest-'));
  const config = path.join(directory, 'session.JSON');
  try {
    await fs.writeFile(path.join(directory, 'video.mp4'), 'video fixture');
    await fs.writeFile(config, '\uFEFF' + JSON.stringify({ ...minimal, audio_path: ['./missing.wav'], annotation: './missing.json' }));
    assert.deepEqual(await readMediaManifest(config), {
      videoPath: path.join(directory, 'video.mp4'), audioPaths: [path.join(directory, 'missing.wav')], annotationPath: path.join(directory, 'missing.json'),
    });
    await fs.rm(path.join(directory, 'video.mp4'));
    await assert.rejects(readMediaManifest(config), /ENOENT/);
    await fs.mkdir(path.join(directory, 'video.mp4'));
    await assert.rejects(readMediaManifest(config), /regular file/);
    await assert.rejects(readMediaManifest(directory), /regular file/);
    for (const content of ['', '{', Buffer.from([0xff]), ' '.repeat(manifestLimit + 1)]) {
      await fs.writeFile(config, content);
      await assert.rejects(readMediaManifest(config), /valid JSON|64 KB/);
    }
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('growing configuration files cannot exceed the read limit and descriptors close on errors', async () => {
  let closed = 0, total = 0;
  const fileSystem = { async open() { return {
    async stat() { return { size: 1, isFile: () => true }; },
    async read(buffer, offset, length, position) { assert.equal(position, total); total += length; return { bytesRead: length }; },
    async close() { closed++; },
  }; } };
  await assert.rejects(readMediaManifest('/config.json', fileSystem), /64 KB/);
  assert.equal(total, manifestLimit + 1); assert.equal(closed, 1);
});

test('JSON media configurations are opt-in editors and appear in the local and Remote explorer menu', () => {
  const manifest = require('../package.json');
  assert.equal(manifest.contributes.customEditors[0].priority, 'option');
  for (const ext of ['json', 'JSON']) assert.ok(manifest.contributes.customEditors[0].selector.some(item => item.filenamePattern === '*.' + ext));
  const configurationEditor = manifest.contributes.customEditors.find(editor => editor.viewType === 'panoPlayer.mediaConfig');
  assert.equal(configurationEditor.priority, 'default');
  assert.deepEqual(configurationEditor.selector.map(item => item.filenamePattern), ['*.jsonpp', '*.JSONPP']);
  assert.ok(manifest.activationEvents.includes('onCustomEditor:panoPlayer.mediaConfig'));
  assert.match(manifest.contributes.menus['explorer/context'][0].when, /vscode-remote.*json/);
  assert.match(manifest.contributes.menus['explorer/context'][0].when, /jsonpp/);
  assert.ok(manifest.contributes.languages.some(language => language.id === 'json' && language.extensions.includes('.jsonpp')));
  assert.equal(manifest.contributes.configurationDefaults?.['workbench.editorAssociations'], undefined, 'Do not override user editor choices');
});
