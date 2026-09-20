const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { renderHtml } = require('../src/webview.cjs');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const { directionWav, checkAudio } = require('./native-audio.cjs');

async function main() {
  const source = process.argv[2];
  if (!source || !path.isAbsolute(source)) throw new Error('Provide an absolute FOA media path.');
  let origin;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, origin);
    if (url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    if (url.pathname === '/') {
      const html = renderHtml({ title: path.basename(source), cspSource: origin, nonce: 'qa', source: `${origin}/${url.searchParams.has('direction') ? 'direction.wav' : 'source'}`,
        ...Object.fromEntries(Object.entries({ script: 'player.js', style: 'player.css', icons: 'lucide.min.js',
          monitor: 'monitor.js', omnitone: 'omnitone.min.js', view: 'view.js', worker: 'powermap-worker.js',
          worklet: 'foa-capture-processor.js' }).map(([key, value]) => [key, `${origin}/${value}`])) });
      res.setHeader('Content-Type', 'text/html');
      res.end(html.replace('<body>', `<body><script nonce="qa">window.acquireVsCodeApi=()=>({getState:()=>null,setState:()=>{},postMessage:()=>{}});</script>`));
      return;
    }
    if (url.pathname === '/native') {
      res.setHeader('Content-Type', 'text/html');
      res.end('<video controls preload="auto" onloadeddata="window.nativeFrame=performance.now()" oncanplay="window.nativeReady=performance.now()" src="/source"></video>'); return;
    }
    if (url.pathname === '/direction.wav') {
      res.setHeader('Content-Type', 'audio/wav'); res.end(directionWav()); return;
    }
    const file = url.pathname === '/source' ? source : path.join(__dirname, '../media', path.basename(url.pathname));
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
    const size = fs.statSync(file).size;
    const type = { '.js': 'text/javascript', '.css': 'text/css', '.webm': 'video/webm', '.wav': 'audio/wav', '.mp4': 'video/mp4' }[path.extname(file)];
    res.setHeader('Content-Type', type || 'application/octet-stream'); res.setHeader('Accept-Ranges', 'bytes');
    const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Math.min(size - 1, Number(range[2])) : size - 1;
    if (start > end || start >= size) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); res.end(); return; }
    if (range) res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
    else res.writeHead(200, { 'Content-Length': size });
    const stream = fs.createReadStream(file, { start, end });
    res.on('close', () => stream.destroy()); stream.pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
  try {
    const startupSamples = [];
    for (const route of ['/native', '/', '/', '/native']) {
      const sampleContext = await browser.newContext();
      const samplePage = await sampleContext.newPage();
      await samplePage.goto(origin + route);
      await samplePage.waitForFunction(() => document.querySelector('video').readyState >= 3);
      const timing = await samplePage.evaluate(() => window.__PANO_PLAYER__?.getState().canPlayMs ?? window.nativeReady);
      startupSamples.push({ route, canPlayMs: timing });
      await sampleContext.close();
    }
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(`${origin}/native`);
    await page.waitForFunction(() => document.querySelector('video').readyState >= 3);
    const native = await page.evaluate(() => ({ firstFrameMs: window.nativeFrame, canPlayMs: window.nativeReady, width: document.querySelector('video').videoWidth }));
    if (process.env.PANO_PLAYER_PLAYBACK_MS) {
      await page.locator('video').evaluate(video => video.play());
      await page.waitForTimeout(Number(process.env.PANO_PLAYER_PLAYBACK_MS) + 3000);
      native.playback = await page.locator('video').evaluate(video => {
        const q = video.getVideoPlaybackQuality();
        return { time: video.currentTime, paused: video.paused, total: q.totalVideoFrames, dropped: q.droppedVideoFrames };
      });
      assert.ok(native.playback.time >= Number(process.env.PANO_PLAYER_PLAYBACK_MS) / 1000, 'Native baseline was interrupted');
    }
    await page.goto(origin);
    await page.evaluate(() => {
      window.mediaEvents = [];
      const video = document.querySelector('video');
      for (const event of ['play', 'playing', 'pause', 'ended', 'waiting', 'error']) video.addEventListener(event,
        () => window.mediaEvents.push({ event, time: video.currentTime, at: performance.now(), duration: video.duration, ended: video.ended }));
    });
    await page.waitForFunction(() => window.__PANO_PLAYER__?.getState().ready);
    const startup = await page.evaluate(() => window.__PANO_PLAYER__.getState());
    await page.locator('#play').click();
    await page.waitForFunction(() => document.querySelector('video').currentTime > 3);
    await page.waitForTimeout(Number(process.env.PANO_PLAYER_PLAYBACK_MS || 8000));
    const playing = await page.evaluate(() => window.__PANO_PLAYER__.getState());
    await page.locator('#view-spatial').click();
    await page.waitForFunction(() => window.__PANO_PLAYER__.view?.active);
    const viewBefore = await page.evaluate(() => window.__PANO_PLAYER__.view.getState());
    const box = await page.locator('#spatial').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2 + 20, { steps: 5 });
    await page.mouse.up();
    const spatial = await page.evaluate(() => {
      const view = window.__PANO_PLAYER__.view;
      view.render();
      const gl = view.gpu.getContext(), pixels = new Uint8Array(64 * 64 * 4);
      gl.readPixels(0, 0, 64, 64, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      return { ...view.getState(), nonzero: pixels.filter((v, i) => i % 4 !== 3 && v > 0).length };
    });
    await page.screenshot({ path: path.join(__dirname, '../output/native-preview.png') });
    const audio = await checkAudio(browser, origin);
    const events = await page.evaluate(() => window.mediaEvents);
    const report = { source, startupSamples, native, startup, playing, spatial, audio, events, errors };
    fs.writeFileSync(path.join(__dirname, '../output', path.basename(source) + '.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    assert.equal(errors.length, 0, errors.join('\n'));
    assert.equal(playing.listening.channels, 4);
    assert.ok(playing.received > 5, 'Expected live PowerMap updates');
    assert.ok(playing.currentTime > 3);
    if (process.env.PANO_PLAYER_PLAYBACK_MS) assert.ok(playing.currentTime >= Number(process.env.PANO_PLAYER_PLAYBACK_MS) / 1000,
      'Sustained playback must advance for the requested duration');
    assert.notEqual(spatial.yaw, viewBefore.yaw);
    if (native.width) assert.ok(spatial.nonzero > 64, 'Spatial video canvas must not be blank');
  } finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
fs.mkdirSync(path.join(__dirname, '../output'), { recursive: true });
main().catch(error => { console.error(error); process.exitCode = 1; });
