// NODE_PATH=<playwright packages> node tests/audio-switch-browser.cjs [origin]
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

(async () => {
  const origin = process.argv[2] || 'http://127.0.0.1:4173';
  const output = path.resolve(__dirname, '../output/playwright/audio-switch');
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin);
    await page.locator('#file-input').setInputFiles(path.resolve(__dirname, '../output/playwright/web/multi-foa.mp4'));
    await page.waitForFunction(() => document.querySelector('iframe')?.contentWindow.__PANO_PLAYER__?.getState().ready);
    const frame = page.frames().find(item => item.url().endsWith('/player.html'));
    await frame.locator('#view-spatial').click();
    await frame.waitForFunction(() => __PANO_PLAYER__.view?.active);
    await frame.locator('#spatial').press('ArrowLeft');
    await frame.locator('#play').click();
    await frame.waitForFunction(() => __PANO_PLAYER__.getState().currentTime > .3);
    await frame.evaluate(() => {
      const prepare = FoaMonitor.prototype.prepare;
      FoaMonitor.prototype.prepare = async function () {
        if (this.preloading) await new Promise(resolve => setTimeout(resolve, 180));
        return prepare.call(this);
      };
      window.originalVideo = __PANO_PLAYER__.monitor.video;
      window.originalWorker = originalVideo.worker;
      window.switchSamples = []; window.sampleSwitch = true;
      window.playbackEvents = [];
      for (const type of ['pause', 'seeking']) originalVideo.addEventListener(type, () => playbackEvents.push(type));
      const sample = () => {
        if (!sampleSwitch) return;
        switchSamples.push({ time: originalVideo.currentTime, frames: originalVideo.frames,
          paused: originalVideo.paused, empty: !document.querySelector('#empty').hidden });
        requestAnimationFrame(sample);
      };
      sample();
    });
    await frame.locator('#audio-track').selectOption('["primary",1]');
    await frame.waitForFunction(() => !__PANO_PLAYER__.getState().switchingTrack);
    const switched = await frame.evaluate(() => {
      sampleSwitch = false;
      return { state: __PANO_PLAYER__.getState(), samples: switchSamples, events: playbackEvents,
        sameWorker: originalWorker === originalVideo.worker, status: document.querySelector('#audio-switch-status').textContent };
    });
    assert.equal(switched.state.audioTrackIndex, 1, switched.status);
    assert.equal(switched.state.listening.channels, 2);
    assert.equal(switched.sameWorker, true);
    assert.deepEqual(switched.events, [], 'No pause or video seek during a track switch');
    assert.ok(switched.samples.length > 1);
    assert.ok(switched.samples.every(item => !item.paused && !item.empty));
    assert.ok(switched.samples.at(-1).frames > switched.samples[0].frames);
    for (let i = 1; i < switched.samples.length; i++) assert.ok(switched.samples[i].time >= switched.samples[i - 1].time - .001);
    await frame.locator('#play').click();
    const at = await frame.evaluate(() => __PANO_PLAYER__.getState().currentTime);
    await frame.locator('#audio-track').selectOption('["primary",0]');
    await frame.waitForFunction(() => !__PANO_PLAYER__.getState().switchingTrack);
    assert.equal(await frame.evaluate(() => __PANO_PLAYER__.getState().paused), true);
    assert.ok(Math.abs(await frame.evaluate(() => __PANO_PLAYER__.getState().currentTime) - at) < .03);
    assert.equal(await frame.evaluate(() => __PANO_PLAYER__.getState().listening.channels), 4);
    await frame.locator('#audio-file').setInputFiles(path.resolve(__dirname, '../output/playwright/stereo.wav'));
    await frame.waitForFunction(() => !__PANO_PLAYER__.getState().switchingTrack && __PANO_PLAYER__.getState().audioSource !== 'primary');
    assert.equal(await frame.evaluate(() => __PANO_PLAYER__.getState().listening.channels), 2);
    await frame.locator('#audio-file').setInputFiles({ name: 'broken.wav', mimeType: 'audio/wav', buffer: Buffer.from('not audio') });
    await frame.waitForFunction(() => !__PANO_PLAYER__.getState().switchingTrack);
    assert.match(await frame.locator('#audio-switch-status').textContent(), /Audio unchanged/);
    assert.equal(await frame.evaluate(() => __PANO_PLAYER__.getState().audioSource), 'external-1');
    await frame.locator('#audio-track').selectOption('["primary",0]');
    await frame.waitForFunction(() => !__PANO_PLAYER__.getState().switchingTrack);
    assert.equal(await frame.evaluate(() => __PANO_PLAYER__.getState().audioSource), 'primary');
    await frame.locator('#seek').fill('1');
    await frame.locator('#seek').dispatchEvent('input');
    await frame.waitForFunction(() => !originalVideo.seeking);
    assert.equal(await frame.evaluate(() => originalVideo.currentTime), 1);
    // Delay preparation deliberately: seeking and pausing remain available, and the latest selection wins.
    await frame.locator('#play').click();
    await frame.waitForFunction(() => originalVideo.currentTime > 1.3);
    await frame.locator('#audio-track').selectOption('["primary",0]');
    await frame.locator('#audio-track').selectOption('["primary",1]');
    await frame.locator('#audio-track').selectOption('["primary",0]');
    await frame.locator('#seek').fill('2');
    await frame.locator('#seek').dispatchEvent('input');
    await frame.locator('#play').click();
    await frame.waitForFunction(() => !__PANO_PLAYER__.getState().switchingTrack);
    assert.equal(await frame.evaluate(() => __PANO_PLAYER__.getState().audioTrackIndex), 0);
    assert.equal(await frame.evaluate(() => __PANO_PLAYER__.getState().paused), true);
    assert.ok(Math.abs(await frame.evaluate(() => originalVideo.currentTime) - 2) < .1);
    await frame.locator('#meter').check();
    await frame.locator('#enabled').check();
    await frame.locator('#play').click();
    await frame.waitForFunction(() => __PANO_PLAYER__.monitor.meterData && __PANO_PLAYER__.getState().received > 1);
    await frame.locator('#play').click();
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.waitForTimeout(100);
      assert.ok(await frame.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      const pixels = await frame.evaluate(() => {
        const view = __PANO_PLAYER__.view; view.render(); const gl = view.gpu.getContext();
        const data = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
        gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, data);
        return data.some((value, index) => index % 4 !== 3 && value > 30);
      });
      assert.ok(pixels, 'Perspective remains nonblank');
      await page.screenshot({ path: path.join(output, `${width}.png`) });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await frame.locator('#seek').fill('6');
    await frame.locator('#seek').dispatchEvent('input');
    await frame.locator('#play').click();
    await frame.waitForFunction(() => originalVideo.ended);
    await frame.locator('#audio-track').selectOption('["primary",1]');
    await frame.waitForFunction(() => !__PANO_PLAYER__.getState().switchingTrack);
    assert.equal(await frame.evaluate(() => __PANO_PLAYER__.getState().audioTrackIndex), 1);
    assert.equal(await frame.evaluate(() => originalVideo.ended), true);
    await frame.locator('#play').click();
    await frame.waitForFunction(() => originalVideo.currentTime > .2 && originalVideo.currentTime < 2);
    await page.locator('#file-input').setInputFiles(path.resolve(__dirname, '../output/playwright/silent.webm'));
    await page.waitForFunction(() => document.querySelector('iframe')?.contentWindow.__PANO_PLAYER__?.getState().ready);
    const silent = page.frames().find(item => item.url().endsWith('/player.html'));
    await silent.locator('#audio-file').setInputFiles(path.resolve(__dirname, '../output/playwright/stereo.wav'));
    await silent.waitForFunction(() => !__PANO_PLAYER__.getState().switchingTrack && __PANO_PLAYER__.getState().audioSource !== 'primary');
    await silent.locator('#audio-track').selectOption('["primary",null]');
    await silent.waitForFunction(() => !__PANO_PLAYER__.getState().switchingTrack);
    assert.equal(await silent.evaluate(() => __PANO_PLAYER__.getState().listening.channels), 0);
    await silent.locator('#play').click();
    await silent.waitForFunction(() => __PANO_PLAYER__.getState().currentTime > .2);
    await page.locator('#close').click();
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(switched, null, 2));
    console.log(JSON.stringify({ samples: switched.samples.length, before: switched.samples[0], after: switched.samples.at(-1), errors }, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
