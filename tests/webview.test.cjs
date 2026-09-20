const test = require('node:test');
const assert = require('node:assert/strict');
const { renderHtml } = require('../src/webview.cjs');
const manifest = require('../package.json');
test('extension manifest accepts VS Code 1.84 releases', () => {
  assert.equal(manifest.engines.vscode, '^1.84.0');
});
test('webview uses restrictive CSP and escapes input-derived title', () => {
  const html = renderHtml({ title: '<img onerror="bad">', cspSource: 'vscode-resource:', script: 'https://local/player.js', style: 'https://local/player.css', icons: 'https://local/lucide.js', nonce: 'safeNonce' });
  assert.match(html, /default-src 'none'/);
  assert.match(html, /nonce-safeNonce/);
  assert.ok(!html.includes('<img onerror='));
  assert.match(html, /&lt;img/);
  assert.match(html, /width="140" height="70"/);
  assert.ok(!html.includes('unsafe-inline'));
});
test('native custom editor is opt-in and needs no workspace executable trust', () => {
  assert.equal(manifest.contributes.customEditors[0].priority, 'option');
  assert.equal(manifest.capabilities.untrustedWorkspaces.supported, true);
  assert.deepEqual(manifest.extensionKind, ['workspace']);
  assert.match(manifest.contributes.menus['explorer/context'][0].when, /vscode-remote/);
});
test('review UI keeps direct view tabs, labeled setting groups and accessible transport', () => {
  const html = renderHtml({ title: 'review.webm' });
  assert.ok(html.indexOf('id="stage"') < html.indexOf('id="transport"'));
  assert.ok(html.indexOf('id="transport"') < html.indexOf('id="options"'));
  const settings = html.slice(html.indexOf('id="options"'), html.indexOf('<footer>'));
  for (const id of ['projection-options', 'projection', 'layout', 'grid', 'gridOpacity', 'enabled', 'opacity', 'listening', 'order', 'normalization']) {
    assert.ok(settings.includes('id="' + id + '"'), id + ' belongs in the shared settings region');
  }
  assert.match(html, /role="group" aria-label="Playback controls"/);
  for (const [id, label, icon] of [['view-flat', 'Panorama', 'rectangle-horizontal'], ['view-spatial', 'Perspective', 'view']]) {
    const tab = html.match(new RegExp(`<button id="${id}"[^>]*>.*?<\\/button>`))[0];
    assert.ok(tab.includes(`title="${label}"`)); assert.ok(tab.includes(`aria-label="${label}"`));
    assert.ok(tab.includes(`data-lucide="${icon}"`)); assert.match(tab, /<\/i><\/button>$/);
  }
  assert.match(html, /aria-label="Perspective view;/);
  assert.doesNotMatch(html, />Spatial<\/button>/);
  const transport = html.slice(html.indexOf('id="transport"'), html.indexOf('id="options"'));
  for (const id of ['view-flat', 'view-spatial', 'reset-view']) assert.ok(transport.includes('id="' + id + '"'));
  assert.doesNotMatch(html, /id="fullscreen"/);
  for (const group of ['projection', 'overlay', 'audio']) assert.match(settings, new RegExp(`id="${group}-heading">`));
  for (const [group, icon] of [['projection', 'globe'], ['overlay', 'layers'], ['audio', 'audio-lines']]) {
    assert.ok(settings.includes(`id="${group}-heading"><i data-lucide="${icon}" aria-hidden="true">`));
  }
  assert.match(settings, />Channel <select id="order"/);
  assert.match(html, /<option value="auto">Auto<\/option>/);
  assert.match(html, /id="reset-settings"[^>]*aria-label="Restore default settings"/);
  for (const label of ['Grid opacity', 'PowerMap opacity']) assert.ok(html.includes('aria-label="' + label + '"'));
  assert.equal((settings.match(/class="overlay-control"/g) || []).length, 2);
  assert.equal((settings.match(/class="overlay-opacity"/g) || []).length, 2);
  for (const id of ['volume-value', 'opacity-value', 'gridOpacity-value']) assert.match(html, new RegExp('id="' + id + '" aria-hidden="true"'));
});
test('all webview icons are included in the selective Lucide registry', () => {
  const source = require('node:fs').readFileSync(require.resolve('../src/icons.js'), 'utf8');
  const registered = new Set(source.match(/icons: \{([^}]+)\}/)[1].split(',').map(name => name.trim()));
  for (const [, name] of renderHtml({ title: 'icons.webm' }).matchAll(/data-lucide="([^"]+)"/g)) {
    const exportName = name.replace(/(^|-)([a-z0-9])/g, (_, prefix, letter) => letter.toUpperCase());
    assert.ok(registered.has(exportName), name + ' must be bundled');
  }
});
test('header leaves filenames to the editor tab and metadata belongs to the footer', () => {
  const html = renderHtml({ title: 'review.webm', logo: 'https://local/icon.png' });
  const header = html.match(/<header>[\s\S]*?<\/header>/)[0];
  assert.match(header, /<img src="https:\/\/local\/icon.png" width="32" height="32"/);
  assert.doesNotMatch(header, /data-lucide="scan"/);
  assert.match(header, /<strong>PanoPlayer<\/strong>/);
  assert.doesNotMatch(header, /review\.webm|music-badge/);
  assert.doesNotMatch(html, /id="filename"/);
  assert.doesNotMatch(html, /id="music-badge"|id="metrics"/);
  assert.match(html, /<footer><span id="detail" role="status">/);
});
test('WAV is registered in the editor selector and open command', () => {
  assert.ok(manifest.contributes.customEditors[0].selector.some(s => s.filenamePattern === '*.wav'));
  assert.match(manifest.contributes.menus['explorer/context'][0].when, /wav/);
  assert.equal(manifest.name, 'pano-player');
  assert.equal(manifest.displayName, 'PanoPlayer');
  assert.equal(manifest.publisher, 'shijunjie');
  assert.equal(manifest.author, 'Junjie Shi');
  assert.equal(manifest.icon, 'media/icon.png');
  const icon = require('node:fs').readFileSync(require.resolve('../' + manifest.icon));
  assert.equal(icon.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(manifest.contributes.commands[0].title, 'PanoPlayer: Open Media');
  assert.equal(manifest.contributes.customEditors[0].displayName, 'PanoPlayer');
  assert.match(renderHtml({ title: 'review.webm' }), /<title>review.webm - PanoPlayer<\/title>/);
});
test('MOV and MKV are offered by the editor, context menu and file picker', () => {
  const extension = require('node:fs').readFileSync(require.resolve('../src/extension.cjs'), 'utf8');
  for (const ext of ['mov', 'mkv']) {
    for (const spelling of [ext, ext.toUpperCase()]) {
      assert.ok(manifest.contributes.customEditors[0].selector.some(s => s.filenamePattern === '*.' + spelling));
    }
    assert.ok(manifest.contributes.menus['explorer/context'][0].when.includes(ext));
    assert.match(extension, new RegExp("'Panorama media': \\[.*'" + ext + "'.*\\]"));
  }
});
test('feature overview packages with GitHub HTTPS image rewriting', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const source = read('README.md');
  assert.match(source, /^# PanoPlayer$/m);
  assert.match(source, /<img src="media\/icon\.png" width="128" height="128" alt="PanoPlayer logo">/);
  for (const badge of ['badgen.net/vs-marketplace/v/shijunjie.pano-player', 'badgen.net/vs-marketplace/i/shijunjie.pano-player', 'img.shields.io/github/license/jinnsjj/pano-player', 'img.shields.io/badge/VS%20Code-1.84%2B']) {
    assert.ok(source.includes('https://' + badge));
  }
  assert.match(source, /## Explore The Scene/);
  assert.doesNotMatch(source, /\p{Script=Han}/u);
  assert.doesNotMatch(source, /data:image\//);
  assert.doesNotMatch(source, /作者：|Junjie Shi|Junjie SHI/);
  for (const name of ['panorama', 'spatial', 'wav']) {
    const file = `docs/images/${name}.jpg`;
    assert.ok(source.includes(`(${file})`));
    const image = fs.readFileSync(path.join(__dirname, '..', file));
    assert.equal(image.readUInt16BE(0), 0xffd8);
  }
  assert.equal(manifest.repository.url, 'https://github.com/jinnsjj/pano-player.git');
  assert.match(manifest.scripts.package, /--githubBranch main/);
  assert.doesNotMatch(manifest.scripts.package, /--no-rewrite-relative-links|--readme-path/);
  assert.doesNotMatch(read('build.cjs'), /data:image\//);
});
