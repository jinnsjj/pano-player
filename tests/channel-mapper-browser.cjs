// NODE_PATH=<playwright packages> node tests/channel-mapper-browser.cjs [origin]
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

function wav(channels, seconds = 30) {
  const rate = 48000, frames = rate * seconds, buffer = Buffer.alloc(44 + frames * channels * 2);
  buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * channels * 2, 28);
  buffer.writeUInt16LE(channels * 2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(buffer.length - 44, 40);
  for (let frame = 0; frame < frames; frame++) {
    const front = .1 * Math.sin(2 * Math.PI * 440 * frame / rate);
    const samples = [front, 0, 0, front, .2 * Math.sin(2 * Math.PI * 880 * frame / rate), .4 * Math.sin(2 * Math.PI * 1320 * frame / rate)];
    for (let channel = 0; channel < channels; channel++) buffer.writeInt16LE(Math.round((samples[channel] || 0) * 32767), 44 + (frame * channels + channel) * 2);
  }
  return buffer;
}

(async () => {
  const output = path.resolve(__dirname, '../output/playwright/channel-mapper');
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  let server;
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.argv[2] || 'http://127.0.0.1:4174');
    await page.locator('#file-input').setInputFiles({ name: 'FOA-HL-test.wav', mimeType: 'audio/wav', buffer: wav(6) });
    await page.waitForFunction(() => document.querySelector('iframe')?.contentWindow.__PANO_PLAYER__?.getState().ready);
    let frame = page.frames().find(item => item.url().endsWith('/player.html'));
    await frame.locator('#mapper-open').click();
    assert.equal(await frame.locator('#mapper-matrix input').count(), 36);
    assert.deepEqual(await frame.locator('#mapper-matrix thead th').allTextContents(), ['Output / Input', '1', '2', '3', '4', '5', '6']);
    assert.deepEqual(await frame.locator('#mapper-matrix tbody th').allTextContents(), ['1', '2', '3', '4', '5', '6']);
    assert.equal(await frame.locator('[data-output="4"][data-input="4"]').getAttribute('aria-label'), 'Input 5 to output 5');
    await frame.locator('#meter').check();
    await frame.locator('#enabled').check();
    await frame.locator('#listening').selectOption('stereo');
    await frame.evaluate(() => {
      const monitor = __PANO_PLAYER__.monitor, previous = monitor.onMap;
      monitor.onMap = data => { window.mapAlpha = data.rgba.filter((_, index) => index % 4 === 3); previous(data); };
      window.clockEvents = [];
      for (const type of ['pause', 'seeking']) monitor.video.addEventListener(type, () => clockEvents.push(type));
      window.originalWorker = monitor.video.worker;
    });
    await frame.locator('#play').click();
    const levels = {};
    async function measure(name) {
      await frame.waitForFunction(() => __PANO_PLAYER__.monitor.getMeterState().data?.duration > .7);
      levels[name] = await frame.evaluate(() => __PANO_PLAYER__.monitor.getMeterState().data.channels.map(channel => channel.rms));
      return levels[name];
    }
    function near(actual, amplitudes) {
      amplitudes.forEach((value, side) => assert.ok(Math.abs(actual[side] - 20 * Math.log10(value / Math.sqrt(2))) < .2, `${actual} versus ${amplitudes}`));
    }
    near(await measure('direct'), [Math.hypot(.075, .2), Math.hypot(.075, .4)]);
    await frame.locator('#mapper-preset').selectOption('foa');
    near(await measure('foa'), [.075, .075]);
    assert.ok(await frame.evaluate(() => mapAlpha.some(value => value > 0)));
    await frame.locator('#mapper-preset').selectOption('hl');
    near(await measure('hl'), [.2, .4]);
    await frame.waitForFunction(() => mapAlpha.every(value => value === 0));
    await frame.locator('#listening').selectOption('binaural');
    await frame.locator('#order').selectOption('WXYZ');
    assert.deepEqual(await frame.locator('#mapper-matrix tbody th').allTextContents(), ['1', '2', '3', '4', '5', '6']);
    await frame.locator('#normalization').selectOption('N3D');
    near(await measure('hl-binaural'), [.2, .4]);
    assert.deepEqual(await frame.evaluate(() => clockEvents), []);
    assert.equal(await frame.evaluate(() => originalWorker === __PANO_PLAYER__.monitor.video.worker), true);
    await frame.locator('#mapper-clear').click();
    assert.ok((await measure('silent')).every(value => value < -100));
    await frame.locator('#mapper-enabled').uncheck();
    assert.ok((await measure('bypassed')).every(value => value > -60));
    await frame.locator('#mapper-reset').click();
    const first = frame.locator('[data-output="0"][data-input="0"]');
    await first.focus(); await first.press('Space');
    assert.equal(await first.isChecked(), false);
    await first.press('ArrowRight');
    assert.equal(await frame.evaluate(() => document.activeElement.dataset.input), '1');
    await frame.locator('[data-output="0"][data-input="1"]').press('Space');
    await first.check();
    assert.equal(await frame.locator('#mapper-warning').isVisible(), true);
    assert.equal(await frame.locator('#mapper-preset').inputValue(), 'custom');
    await frame.locator('#mapper-preset').selectOption('foa');
    await frame.locator('#audio-file').setInputFiles({ name: 'Another-six-channel.wav', mimeType: 'audio/wav', buffer: wav(6) });
    await frame.waitForFunction(() => !__PANO_PLAYER__.getState().switchingTrack && __PANO_PLAYER__.getState().audioSource === 'external-1');
    assert.equal(await frame.locator('#mapper-preset').inputValue(), 'foa');
    await frame.locator('#play').click();
    const at = await frame.evaluate(() => __PANO_PLAYER__.getState().currentTime);
    await frame.locator('#mapper-preset').selectOption('hl');
    assert.equal(await frame.evaluate(() => __PANO_PLAYER__.getState().currentTime), at);
    assert.equal(await frame.evaluate(() => __PANO_PLAYER__.getState().paused), true);
    await frame.locator('#mapper-close').click();
    assert.equal(await frame.evaluate(() => document.activeElement.id), 'mapper-open');
    assert.equal(await frame.locator('#mapper-panel').isHidden(), true);
    await frame.locator('#mapper-open').click();
    await frame.locator('#audio-file').setInputFiles({ name: 'Stereo.wav', mimeType: 'audio/wav', buffer: wav(2) });
    await frame.waitForFunction(() => !__PANO_PLAYER__.getState().switchingTrack && __PANO_PLAYER__.getState().listening.channels === 2);
    assert.equal(await frame.locator('#mapper-preset').inputValue(), 'identity');
    assert.equal(await frame.locator('#mapper-matrix input').count(), 4);
    const hlOption = await frame.locator('#mapper-hl').evaluate(option => ({ disabled: option.disabled, html: option.outerHTML }));
    assert.equal(hlOption.disabled, true, JSON.stringify(hlOption));
    await frame.locator('#audio-track').selectOption('["primary",0]');
    await frame.waitForFunction(() => !__PANO_PLAYER__.getState().switchingTrack && __PANO_PLAYER__.getState().audioSource === 'primary');
    assert.equal(await frame.locator('#mapper-preset').inputValue(), 'identity');
    assert.ok(await frame.evaluate(() => !('routing' in __PANO_PLAYER__.getState().preferences)));
    await page.locator('#file-input').setInputFiles(path.resolve(__dirname, '../output/playwright/web/multi-foa.mp4'));
    await page.waitForFunction(() => document.querySelector('iframe')?.contentWindow.__PANO_PLAYER__?.getState().ready);
    frame = page.frames().find(item => item.url().endsWith('/player.html'));
    await frame.locator('#audio-file').setInputFiles({ name: 'FOA-HL-test.wav', mimeType: 'audio/wav', buffer: wav(6) });
    await frame.waitForFunction(() => !__PANO_PLAYER__.getState().switchingTrack && __PANO_PLAYER__.getState().listening.channels === 6);
    await frame.locator('#mapper-open').click();
    await frame.locator('#meter').uncheck();
    await frame.locator('#view-spatial').click();
    await frame.waitForFunction(() => __PANO_PLAYER__.view?.active);
    await frame.locator('#overview').uncheck();
    await frame.locator('#spatial').press('ArrowLeft');
    await frame.evaluate(() => {
      window.mainVideo = __PANO_PLAYER__.view.video;
      window.mapperEvents = []; window.mapperWorker = mainVideo.worker;
      for (const type of ['pause', 'seeking']) mainVideo.addEventListener(type, () => mapperEvents.push(type));
    });
    await frame.locator('#play').click();
    await frame.waitForFunction(() => __PANO_PLAYER__.getState().currentTime > .2);
    const before = await frame.evaluate(() => mainVideo.frames);
    for (const preset of ['hl', 'foa', 'clear', 'identity', 'hl']) await frame.locator('#mapper-preset').selectOption(preset);
    await frame.waitForFunction(frames => mainVideo.frames > frames && __PANO_PLAYER__.getState().currentTime > .5, before);
    assert.deepEqual(await frame.evaluate(() => mapperEvents), []);
    assert.equal(await frame.locator('#empty').isHidden(), true);
    assert.equal(await frame.evaluate(() => mainVideo.worker === mapperWorker), true);
    await frame.locator('#play').click();
    for (const width of [1280, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await frame.evaluate(() => scrollTo(0, 0));
      assert.ok(await frame.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.ok(await frame.evaluate(() => {
        const view = __PANO_PLAYER__.view; view.render(); const gl = view.gpu.getContext();
        const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
        gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        return pixels.some((value, index) => index % 4 !== 3 && value > 30);
      }), 'Perspective remains nonblank with channel mapper active');
    }
    await page.setViewportSize({ width: 1280, height: 1000 });
    await frame.locator('#audio-file').setInputFiles({ name: '32-channel.wav', mimeType: 'audio/wav', buffer: wav(32, 3) });
    await frame.waitForFunction(() => !__PANO_PLAYER__.getState().switchingTrack && __PANO_PLAYER__.getState().listening.channels === 32);
    assert.equal(await frame.locator('#mapper-matrix input').count(), 1024);
    await page.setViewportSize({ width: 320, height: 1000 });
    assert.ok(await frame.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await frame.locator('#mapper-preset').selectOption('clear');
    await frame.locator('#play').click();
    await frame.waitForFunction(() => !__PANO_PLAYER__.getState().paused);
    assert.deepEqual(errors, []);
    // Capture the shared extension surface directly: iframe screenshots clip below its viewport.
    const fixture = path.join(output, 'six-channel.wav');
    await fs.writeFile(fixture, wav(6));
    server = spawn(process.execPath, [path.join(__dirname, 'stream-server.cjs'),
      path.resolve(__dirname, '../output/playwright/web/multi-foa.mp4'), fixture]);
    const captureOrigin = await new Promise((resolve, reject) => {
      server.stdout.on('data', data => { const url = String(data).match(/http:\/\/127\.0\.0\.1:\d+/); if (url) resolve(url[0]); });
      server.on('error', reject); server.on('exit', code => reject(new Error(`Capture server exited ${code}`)));
    });
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.goto(captureOrigin);
    await page.waitForFunction(() => __PANO_PLAYER__?.getState().ready);
    await page.evaluate(origin => window.postMessage({ type: 'audio-source', source: { id: 'external-capture',
      name: 'FOA-HL-test.wav', url: origin + '/source/1' } }), captureOrigin);
    await page.waitForFunction(() => !__PANO_PLAYER__.getState().switchingTrack && __PANO_PLAYER__.getState().listening.channels === 6);
    await page.locator('#view-spatial').click();
    await page.waitForFunction(() => __PANO_PLAYER__.view?.active);
    await page.locator('#overview').uncheck();
    await page.locator('#mapper-open').click();
    await page.locator('#mapper-preset').selectOption('hl');
    for (const width of [1280, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(() => scrollTo(0, 0));
      await page.waitForTimeout(150);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: path.join(output, `${width}.png`), fullPage: true });
    }
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.evaluate(() => { document.body.classList.add('vscode-light'); scrollTo(0, 0); });
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(output, 'light.png'), fullPage: true });
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(output, 'levels.json'), JSON.stringify(levels, null, 2));
    console.log(JSON.stringify({ levels, errors }, null, 2));
  } finally {
    await browser.close();
    if (server && server.exitCode === null) await new Promise(resolve => { server.once('exit', resolve); server.kill(); });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
