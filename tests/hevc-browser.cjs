// NODE_PATH=<playwright packages> node tests/hevc-browser.cjs [origin] [HEVC file] [output directory]
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

(async () => {
  const origin = process.argv[2] || 'http://127.0.0.1:4173';
  const files = process.argv[3] ? [path.resolve(process.argv[3])] : ['main.mp4', 'main10.mp4']
    .map(file => path.resolve(__dirname, '../output/playwright/hevc', file));
  const output = path.resolve(process.argv[4] || path.join(__dirname, '../output/playwright/hevc-browser'));
  await fs.mkdir(output, { recursive: true });
  const report = { cases: [], errors: [] };
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const [index, file] of files.entries()) for (const forceWasm of [true, false]) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      const requests = [];
      page.on('pageerror', error => report.errors.push(error.message));
      page.on('request', request => requests.push(request.url()));
      if (forceWasm) await page.route('**/media/stream-worker.js', async route => {
        const response = await route.fetch();
        const prefix = `if (globalThis.VideoDecoder) {
          const check = VideoDecoder.isConfigSupported.bind(VideoDecoder);
          VideoDecoder.isConfigSupported = config => /^(hvc1|hev1)/.test(config.codec)
            ? Promise.resolve({ supported: false, config }) : check(config);
        }\n`;
        await route.fulfill({ response, body: prefix + await response.text() });
      });
      const entry = { file, forceWasm, checkpoints: [] };
      report.cases.push(entry);
      let frame;
      const snapshot = async name => {
        const state = await frame.evaluate(() => {
          const video = window.hevcVideo;
          const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 16;
          const ctx = canvas.getContext('2d'); ctx.drawImage(video.element, 0, 0, 32, 16);
          const pixels = [...ctx.getImageData(0, 0, 32, 16).data].filter((_, i) => i % 4 !== 3);
          return { ...__PANO_PLAYER__.getState(), backend: video.videoDecoder, codec: video.videoCodec,
            codecString: video.videoCodecString, width: video.videoWidth, height: video.videoHeight,
            frames: video.frames, error: video.error?.message, videoEndTime: video.videoEndTime,
            videoBlocked: video.videoBlocked, pixelRange: Math.max(...pixels) - Math.min(...pixels),
            detail: document.querySelector('#detail').textContent,
            empty: !document.querySelector('#empty').hidden };
        });
        entry.checkpoints.push({ name, ...state });
        assert.equal(state.error, undefined, state.error);
        assert.equal(state.empty, false, 'Decoded video must not be hidden by an error banner');
        assert.ok(state.pixelRange > 20, 'Decoded HEVC must contain real image pixels');
        assert.match(state.detail, /Video: HEVC \(H.265\)/);
        if (state.listening.channels) assert.match(state.detail, /Audio: AAC/);
        return state;
      };
      try {
        await page.goto(origin);
        await page.locator('#file-input').setInputFiles(file);
        await page.waitForFunction(() => document.querySelector('iframe')?.contentWindow.__PANO_PLAYER__?.getState().ready,
          null, { timeout: 120000 });
        frame = page.frames().find(item => item.url().endsWith('/player.html'));
        await frame.evaluate(() => { window.hevcVideo = __PANO_PLAYER__.monitor.video; });
        await frame.waitForFunction(() => __PANO_PLAYER__.monitor.video.frames > 0, null, { timeout: 120000 });
        const initial = await snapshot('initial');
        assert.equal(initial.backend, forceWasm ? 'FFmpeg/WASM' : 'WebCodecs');
        await frame.locator('#play').click();
        await frame.waitForFunction(() => __PANO_PLAYER__.getState().currentTime > .2 &&
          __PANO_PLAYER__.monitor.video.frames > 3, null, { timeout: 120000 });
        for (let i = 0; i < 8; i++) {
          await page.waitForTimeout(100);
          const state = await snapshot('playing-' + i);
          if (forceWasm) assert.ok(state.currentTime - state.videoEndTime < .25, 'Slow software video must not let audio run away');
        }
        if (!(await frame.evaluate(() => __PANO_PLAYER__.getState().paused))) await frame.locator('#play').click();
        const paused = await snapshot('paused');
        await page.waitForTimeout(150);
        assert.ok(Math.abs((await snapshot('still-paused')).currentTime - paused.currentTime) < .03);
        await frame.locator('#seek').fill('0.75');
        await frame.locator('#seek').dispatchEvent('input');
        await frame.waitForFunction(() => !__PANO_PLAYER__.monitor.video.seeking &&
          __PANO_PLAYER__.monitor.video.videoEndTime >= .72, null, { timeout: 120000 });
        await snapshot('seeked');
        if ((await frame.locator('#audio-track option').count()) > 1) {
          await frame.locator('#audio-track').selectOption('["primary",1]');
          await frame.waitForFunction(() => !__PANO_PLAYER__.getState().switchingTrack, null, { timeout: 120000 });
          const switched = await snapshot('track-switched');
          assert.equal(switched.audioTrackIndex, 1);
          assert.equal(switched.backend, initial.backend);
        }
        await frame.locator('#view-spatial').click();
        await frame.waitForFunction(() => __PANO_PLAYER__.view?.active);
        assert.ok(await frame.evaluate(() => {
          const view = __PANO_PLAYER__.view; view.render(); const gl = view.gpu.getContext();
          const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
          gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          return pixels.some((value, i) => i % 4 !== 3 && value > 30);
        }), 'HEVC also renders in the Perspective canvas');
        for (const width of index === 0 && forceWasm ? [1440, 390, 320] : [1440]) {
          await page.setViewportSize({ width, height: 1000 });
          await page.waitForTimeout(80);
          assert.ok(await frame.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
          await page.screenshot({ path: path.join(output, `${index}-${forceWasm ? 'wasm' : 'native'}-${width}.png`) });
        }
        if (initial.width <= 1920) {
          await frame.locator('#play').click();
          await frame.waitForFunction(() => __PANO_PLAYER__.monitor.video.ended, null, { timeout: 30000 });
          await snapshot('ended');
          await frame.locator('#play').click();
          await frame.waitForFunction(() => __PANO_PLAYER__.getState().currentTime > .1 &&
            __PANO_PLAYER__.getState().currentTime < 1, null, { timeout: 30000 });
          await snapshot('replayed');
        }
        entry.hevcRequests = requests.filter(url => /decoder-hevc/.test(url));
        assert.equal(entry.hevcRequests.length, forceWasm ? 3 : 0, 'Software HEVC assets load once, only when required');
      } catch (error) {
        entry.failure = error.message;
        entry.body = await page.locator('body').innerText().catch(() => '');
        if (frame) entry.playerBody = await frame.locator('body').innerText().catch(() => '');
        await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
        throw error;
      } finally { await page.close(); }
    }
    assert.deepEqual(report.errors, []);
    console.log(JSON.stringify({ cases: report.cases.length, errors: report.errors,
      backends: report.cases.map(item => item.checkpoints[0]?.backend) }));
  } finally {
    await browser.close();
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
