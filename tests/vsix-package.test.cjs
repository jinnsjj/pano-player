const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const sources = [
  'codec-sources/README.md',
  'codec-sources/ffmpeg-7.1.5.tar.xz',
  'codec-sources/libav.js.tar.gz',
  'codec-sources/emfiberthreads-1.3.tar.gz',
  'codec-sources/mediabunny-1.56.2.tar.gz',
  'meter-sources/loudness_meter',
  'src/loudness-meter.js',
  'src/level-meter-processor.js',
];
const host = ['extension', 'webview', 'host-file', 'preferences', 'editor-media', 'plugin-registry']
  .map(name => `src/${name}.cjs`);
const docs = ['REFERENCE.md', 'PLUGINS.md', 'ANNOTATIONS.md', 'annotation.schema.json', 'WEB.md']
  .map(name => `docs/${name}`);
const images = ['panorama', 'spatial', 'wav', 'sample-erp', 'sample-eac', 'erp-perspective', 'eac-perspective']
  .map(name => `docs/images/${name}.jpg`);
const media = require('../public-assets.cjs').media.map(name => `media/${name}`);
const artifact = process.env.PANO_PLAYER_VSIX;
const lfsHeader = Buffer.from('version https://git-lfs.github.com/spec/v1');

test('extension allowlist retains the promised codec and loudness-meter sources', () => {
  const rules = new Set(fs.readFileSync(path.join(root, '.vscodeignore'), 'utf8').split(/\r?\n/));
  assert.deepEqual(sources.filter(file => !rules.has('!' + file)), [], 'Missing corresponding-source allowlist entries');
  for (const file of sources) {
    const bytes = fs.readFileSync(path.join(root, file));
    assert.ok(bytes.length > 0, file);
    assert.ok(!bytes.subarray(0, lfsHeader.length).equals(lfsHeader), `${file} must be hydrated, not an LFS pointer`);
  }
});

test('actual VSIX contains the complete public distribution with intact source and runtime assets', {
  skip: !artifact && 'Set PANO_PLAYER_VSIX to a built VSIX; archive checks require unzip',
}, () => {
  const filename = path.resolve(artifact);
  const files = execFileSync('unzip', ['-Z', '-1', filename], { encoding: 'utf8' })
    .split(/\r?\n/).filter(file => file && !file.endsWith('/'));
  const read = file => execFileSync('unzip', ['-p', filename, `extension/${file}`], { maxBuffer: 32 * 1024 * 1024 });
  const metadata = ['package.json', 'readme.md', 'changelog.md', 'LICENSE.txt', 'THIRD_PARTY_NOTICES.md'];
  const publicFiles = [...metadata, ...host, ...docs, ...images, ...media, ...sources, 'plugins/catalog.cjs'];
  const expected = ['[Content_Types].xml', 'extension.vsixmanifest', ...publicFiles.map(file => `extension/${file}`)];

  assert.deepEqual(sources.filter(file => !files.includes(`extension/${file}`)), [], 'VSIX is missing promised corresponding sources');
  assert.deepEqual([...files].sort(), expected.sort(), 'VSIX must contain only the complete, explicitly allowed public distribution');
  assert.equal(JSON.parse(read('package.json')).version, require('../package.json').version);
  for (const file of [...host, ...docs, ...images, ...media, ...sources, 'plugins/catalog.cjs']) {
    const bytes = read(file);
    assert.ok(bytes.length > 0, file);
    assert.ok(!bytes.subarray(0, lfsHeader.length).equals(lfsHeader), `${file} is an LFS pointer`);
    assert.ok(bytes.equals(fs.readFileSync(path.join(root, file))), `${file} differs from the audited source asset`);
    if (file.endsWith('.wasm')) assert.ok(WebAssembly.validate(bytes), `${file} is not a valid WASM module`);
  }
});
