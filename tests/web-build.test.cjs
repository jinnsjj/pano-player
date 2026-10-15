const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createServer } = require('../web/serve.cjs');
const root = path.resolve(__dirname, '../output/web');
const built = fs.existsSync(path.join(root, 'index.html'));

test('web build ships a self-contained static player and decoder assets', { skip: !built }, () => {
  for (const file of ['index.html', 'player.html', 'app.js', 'bootstrap.js', '_headers', '404.html', 'LICENSE.txt',
    'media/player.js', 'media/view.js', 'media/stream-worker.js', 'media/pcm-processor.js', 'media/monitor.js',
    'media/libav-6.10.7.1.5-decoder-aac.wasm.wasm', 'media/LICENSE-ffmpeg.txt']) {
    assert.ok(fs.statSync(path.join(root, file)).size > 0, file);
  }
  for (const file of ['index.html', 'player.html']) {
    const html = fs.readFileSync(path.join(root, file), 'utf8');
    assert.match(html, /default-src 'none'/);
    assert.doesNotMatch(html, /unsafe-inline/);
    assert.doesNotMatch(html, /<(?:script|link|img|iframe)\b[^>]*(?:src|href)="https?:\/\//);
    for (const [, asset] of html.matchAll(/(?:src|href)="(\.\/[^\"]+)"/g)) {
      assert.ok(fs.existsSync(path.resolve(root, asset)), asset);
    }
  }
  const player = fs.readFileSync(path.join(root, 'player.html'), 'utf8');
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(index, /id="project-link" href="https:\/\/github.com\/jinnsjj\/pano-player" target="_blank" rel="noopener noreferrer"/);
  assert.match(index, /<dialog id="help-dialog" lang="zh-CN" aria-labelledby="help-title">/);
  for (const section of ['help-start', 'help-video', 'help-audio', 'help-privacy']) assert.ok(index.includes(`id="${section}"`));
  assert.match(player, /data-host="0"/); assert.match(player, /bootstrap.js/);
  assert.ok(player.indexOf('bootstrap.js') < player.indexOf('src="./media/player.js"'));
  assert.match(fs.readFileSync(path.join(root, '_headers'), 'utf8'), /frame-ancestors 'self'/);
});

test('static preview serves WASM and rejects uploads and repository access', { skip: !built }, async t => {
  const server = createServer(root);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const index = await fetch(origin);
  assert.equal(index.status, 200); assert.match(await index.text(), /PanoPlayer/);
  assert.equal(index.headers.get('referrer-policy'), 'no-referrer');
  const wasm = await fetch(origin + '/media/libav-6.10.7.1.5-decoder-aac.wasm.wasm', { method: 'HEAD' });
  assert.equal(wasm.headers.get('content-type'), 'application/wasm');
  assert.equal((await fetch(origin, { method: 'POST', body: 'private data' })).status, 405);
  for (const url of ['/package.json', '/.git/config', '/_headers', '/%2e%2e%2fpackage.json']) {
    assert.ok([403, 404].includes((await fetch(origin + url)).status), url);
  }
});
