// Run after build:web with a local preview: NODE_PATH=<playwright packages> node tests/web-browser.cjs <origin> <video> <foa-wav>
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

(async () => {
  const [origin = 'http://127.0.0.1:4173', videoPath, foaPath] = process.argv.slice(2);
  assert.ok(videoPath && foaPath, 'Provide video and four-channel WAV fixtures.');
  const output = path.resolve(__dirname, '../output/playwright/web');
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const requests = [], errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => requests.push({ url: request.url(), method: request.method(), body: request.postData() }));
    await page.goto(origin);
    await page.locator('#empty-open').waitFor();
    assert.equal(await page.locator('#message').isVisible(), false);
    await page.locator('#help').click();
    await page.locator('#help-dialog').waitFor({ state: 'visible' });
    assert.match(await page.locator('#help-dialog').textContent(), /FOA/);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#help-dialog').isVisible(), false);
    assert.equal(await page.locator('#help').evaluate(element => element === document.activeElement), true);
    await page.screenshot({ path: path.join(output, 'empty-desktop.png') });
    const open = async file => {
      await page.locator('#file-input').setInputFiles(path.resolve(file));
      await page.waitForFunction(() => document.querySelector('iframe')?.contentWindow.__PANO_PLAYER__?.getState().ready);
      return page.frames().find(frame => /\/player(?:\.html)?$/.test(new URL(frame.url()).pathname));
    };
    let frame = await open(videoPath);
    await frame.locator('#play').click();
    await frame.waitForFunction(() => __PANO_PLAYER__.getState().currentTime > .5);
    assert.ok((await frame.evaluate(() => __PANO_PLAYER__.getState())).videoQuality.total > 1, 'Video frames advance');
    await frame.locator('#play').click();
    const videoPixels = await frame.evaluate(() => {
      const canvas = document.querySelector('#video');
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let lit = 0; for (let i = 0; i < pixels.length; i += 4) if (pixels[i] + pixels[i + 1] + pixels[i + 2] > 30) lit++;
      return lit;
    });
    assert.ok(videoPixels > 1000, 'Decoded video is nonblank');
    await frame.locator('#view-spatial').click();
    await frame.waitForFunction(() => __PANO_PLAYER__.view?.active);
    const pixels3d = await frame.evaluate(() => {
      const view = __PANO_PLAYER__.view; view.render();
      const gl = view.gpu.getContext();
      const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
      gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let lit = 0; for (let i = 0; i < pixels.length; i += 4) if (pixels[i] + pixels[i + 1] + pixels[i + 2] > 30) lit++;
      return lit;
    });
    assert.ok(pixels3d > 1000, 'Perspective canvas is nonblank');
    const yaw = await frame.evaluate(() => __PANO_PLAYER__.view.yaw);
    await frame.locator('#spatial').press('ArrowLeft');
    assert.notEqual(await frame.evaluate(() => __PANO_PLAYER__.view.yaw), yaw);
    await page.screenshot({ path: path.join(output, 'video-desktop.png') });
    await frame.locator('#grid').check();
    await frame.locator('#seek').fill('3');
    await frame.locator('#seek').dispatchEvent('input');
    await frame.waitForFunction(() => Math.abs(__PANO_PLAYER__.getState().currentTime - 3) < .2);
    const tracks = await frame.evaluate(() => __PANO_PLAYER__.getState().audioTracks);
    if (tracks.length > 1) {
      await frame.locator('#audio-track').selectOption('["primary",1]');
      await frame.waitForFunction(() => __PANO_PLAYER__.getState().audioTrackIndex === 1 && !__PANO_PLAYER__.getState().switchingTrack);
      assert.ok(Math.abs((await frame.evaluate(() => __PANO_PLAYER__.getState())).currentTime - 3) < .2);
      await frame.locator('#audio-track').selectOption('["primary",0]');
      await frame.waitForFunction(() => __PANO_PLAYER__.getState().audioTrackIndex === 0 && !__PANO_PLAYER__.getState().switchingTrack);
    }
    await Promise.all([frame.waitForNavigation(), frame.locator('#retry').evaluate(button => button.click())]);
    await frame.waitForFunction(() => __PANO_PLAYER__?.getState().ready);
    await frame.waitForFunction(() => __PANO_PLAYER__.view?.active);
    assert.equal(await frame.locator('#grid').isChecked(), true);
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.waitForTimeout(250);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.locator('#help').click();
      assert.ok(await page.locator('#help-dialog').evaluate(element => {
        const bounds = element.getBoundingClientRect();
        return bounds.left >= 0 && bounds.right <= innerWidth && bounds.bottom <= innerHeight && element.scrollWidth === element.clientWidth;
      }), 'Help fits the mobile viewport');
      await page.screenshot({ path: path.join(output, `help-${width}.png`) });
      await page.locator('#help-close').click();
      assert.ok(await frame.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.ok(await frame.evaluate(() => {
        const panel = document.querySelector('#overview-overlay').getBoundingClientRect();
        const controls = document.querySelector('#options').getBoundingClientRect();
        return panel.top >= controls.bottom;
      }), 'Mobile overview must not obscure playback/settings');
      assert.ok(await frame.evaluate(() => {
        const view = __PANO_PLAYER__.view; view.render(); const gl = view.gpu.getContext();
        const data = new Uint8Array(4);
        gl.readPixels(Math.floor(gl.drawingBufferWidth / 2), Math.floor(gl.drawingBufferHeight / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, data);
        return data[0] + data[1] + data[2] > 30;
      }), 'Mobile Perspective renders visible pixels');
      await page.screenshot({ path: path.join(output, `video-${width}.png`) });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    // Keep a reference to the old graph to prove replacement closes it explicitly.
    await page.evaluate(() => { window.oldPlayer = document.querySelector('iframe').contentWindow.__PANO_PLAYER__; });
    frame = await open(foaPath);
    assert.ok(await page.evaluate(() => oldPlayer.monitor.disposed && oldPlayer.monitor.video.disposed));
    assert.equal(await frame.evaluate(() => __PANO_PLAYER__.monitor.video.channels), 4);
    assert.equal(await frame.locator('#grid').isChecked(), true);
    await frame.locator('#normalization').selectOption('N3D');
    await frame.locator('#enabled').check();
    await frame.locator('#meter').check();
    await frame.locator('#play').click();
    await frame.waitForFunction(() => __PANO_PLAYER__.getState().received > 2);
    assert.equal((await frame.evaluate(() => __PANO_PLAYER__.getState())).listening.channels, 4);
    await frame.waitForFunction(() => __PANO_PLAYER__.monitor.meterData !== null);
    await page.screenshot({ path: path.join(output, 'foa-desktop.png') });
    const foaState = await frame.evaluate(() => __PANO_PLAYER__.getState());
    assert.ok(await frame.evaluate(() => document.querySelector('#overlay').getContext('2d')
      .getImageData(0, 0, 140, 70).data.some((value, index) => index % 4 === 3 && value > 0)), 'PowerMap contains visible pixels');
    await page.locator('#file-input').setInputFiles({ name: 'empty.wav', mimeType: 'audio/wav', buffer: Buffer.alloc(0) });
    assert.match(await page.locator('#message').textContent(), /empty/);
    assert.equal(await page.locator('#filename').textContent(), path.basename(foaPath));
    await page.locator('#close').click();
    assert.equal(await page.locator('iframe').count(), 0);
    await page.locator('#file-input').setInputFiles({ name: 'broken.mp4', mimeType: 'video/mp4', buffer: Buffer.from('not media') });
    const broken = page.frameLocator('#player-frame');
    await broken.locator('#retry').waitFor({ state: 'visible' });
    frame = await open(videoPath);
    await page.evaluate(() => {
      const target = document.querySelector('iframe').contentWindow;
      const dataTransfer = new DataTransfer(); dataTransfer.items.add(panoWebHost.getFile());
      target.dispatchEvent(new target.DragEvent('drop', { dataTransfer }));
    });
    await page.waitForFunction(() => document.querySelector('iframe')?.contentWindow.__PANO_PLAYER__?.getState().ready);
    await page.locator('#close').click();
    const unexpected = requests.filter(request => !request.url.startsWith('blob:') &&
      (new URL(request.url).origin !== origin || request.method !== 'GET' || request.body));
    assert.deepEqual(unexpected, [], 'No external requests or media uploads');
    assert.deepEqual(errors, [], 'No uncaught browser errors');
    const result = { videoPixels, pixels3d, tracksTested: tracks.length, foaState, requests: requests.length, unexpected, errors };
    await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
