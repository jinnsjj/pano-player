// NODE_PATH=<playwright packages> node tests/settings-scroll-browser.cjs [origin]
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

(async () => {
  const output = path.resolve(__dirname, '../output/playwright/settings-scroll');
  const video = path.resolve(__dirname, '../output/playwright/web/multi-foa.mp4');
  const audio = path.resolve(__dirname, '../output/playwright/channel-mapper/six-channel.wav');
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  let server;
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [], checks = [];
    page.on('pageerror', error => errors.push(error.message));
    async function bounds(frame) {
      return frame.evaluate(() => {
        const rect = id => {
          const { x, y, width, height, bottom } = document.getElementById(id).getBoundingClientRect();
          return { x, y, width, height, bottom };
        };
        const settings = document.getElementById('settings-scroll');
        return { stage: rect('stage'), transport: rect('transport'), settings: rect('settings-scroll'),
          top: settings.scrollTop, scrollHeight: settings.scrollHeight, height: innerHeight,
          layoutHeight: document.getElementById('player-layout').clientHeight, rootScroll: scrollY,
          rootOverflow: document.documentElement.scrollHeight > innerHeight,
          horizontalOverflow: document.documentElement.scrollWidth > innerWidth };
      });
    }
    function fixed(before, after) {
      assert.deepEqual(after.stage, before.stage, 'Video must not move when settings scroll');
      assert.deepEqual(after.transport, before.transport, 'Transport must not move when settings scroll');
      assert.equal(after.rootScroll, 0);
      assert.equal(after.rootOverflow, false);
      assert.equal(after.horizontalOverflow, false);
      assert.ok(after.transport.bottom < after.height);
    }
    async function verify(frame, surface) {
      await frame.locator('#view-spatial').click();
      await frame.waitForFunction(() => __PANO_PLAYER__.view?.active);
      await frame.locator('#overview').uncheck();
      await frame.locator('#meter').uncheck();
      await frame.locator('#mapper-open').click();
      for (const size of [{ width: 1440, height: 900 }, { width: 1280, height: 500 },
        { width: 390, height: 844 }, { width: 320, height: 568 }]) {
        await page.setViewportSize(size);
        await frame.evaluate(() => document.getElementById('settings-scroll').scrollTop = 0);
        await page.waitForTimeout(200);
        const before = await bounds(frame);
        assert.ok(before.scrollHeight > before.settings.height, 'Expanded mapper needs scrollable settings');
        const pane = await frame.locator('#settings-scroll').boundingBox();
        await page.mouse.move(pane.x + pane.width - 12, pane.y + Math.min(40, pane.height / 2));
        await page.mouse.wheel(0, 400);
        await frame.waitForFunction(() => document.getElementById('settings-scroll').scrollTop > 0);
        fixed(before, await bounds(frame));
        await frame.locator('#settings-scroll').focus();
        await frame.locator('#settings-scroll').press('End');
        await frame.waitForFunction(() => {
          const pane = document.getElementById('settings-scroll');
          return pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 1;
        });
        const after = await bounds(frame); fixed(before, after);
        await frame.locator('[data-output="5"][data-input="5"]').focus();
        fixed(before, await bounds(frame));
        const cell = await frame.locator('[data-output="5"][data-input="5"]').boundingBox();
        const scroller = await frame.locator('#settings-scroll').boundingBox();
        assert.ok(cell.y >= scroller.y && cell.y + cell.height <= scroller.y + scroller.height);
        assert.ok(await frame.evaluate(() => {
          const view = __PANO_PLAYER__.view; view.render(); const gl = view.gpu.getContext();
          const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
          gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          return pixels.some((value, index) => index % 4 !== 3 && value > 30);
        }), 'Resized perspective canvas must remain nonblank');
        await page.screenshot({ path: path.join(output, `${surface}-${size.width}-scrolled.png`) });
        await frame.locator('#viewport-resize').focus();
        await frame.locator('#viewport-resize').press('End');
        await page.waitForTimeout(150);
        const maximized = await bounds(frame);
        assert.ok(maximized.transport.bottom < maximized.height);
        assert.ok(maximized.settings.height >= Math.min(160, maximized.layoutHeight / 3) - 1);
        assert.equal(maximized.rootOverflow, false);
        await frame.locator('#viewport-resize').dblclick();
        await page.waitForTimeout(150);
        await frame.locator('#powermap-settings summary').click();
        await frame.locator('#opacity').focus();
        await frame.locator('#opacity').scrollIntoViewIfNeeded();
        const menuControl = await frame.locator('#opacity').boundingBox();
        const region = await frame.locator('#settings-scroll').boundingBox();
        assert.ok(menuControl.y >= region.y - 1 && menuControl.y + menuControl.height <= region.y + region.height + 1,
          `Settings menu remains reachable: ${JSON.stringify({ surface, size, menuControl, region })}`);
        await frame.locator('#opacity').press('Escape');
        checks.push({ surface, ...size, settingsHeight: before.settings.height, scrollTop: after.top });
      }
      await page.setViewportSize({ width: 1280, height: 700 });
      await frame.locator('#play').click();
      await frame.waitForFunction(() => __PANO_PLAYER__.getState().currentTime > .1);
      const start = await frame.evaluate(() => {
        window.scrollEvents = [];
        const video = __PANO_PLAYER__.view.video;
        for (const event of ['pause', 'seeking']) video.addEventListener(event, () => scrollEvents.push(event));
        return { time: video.currentTime, frames: video.frames };
      });
      await frame.locator('#settings-scroll').focus();
      await frame.locator('#settings-scroll').press('Home');
      await frame.locator('#settings-scroll').press('End');
      await frame.waitForFunction(start => __PANO_PLAYER__.getState().currentTime > start.time + .2
        && __PANO_PLAYER__.view.video.frames > start.frames, start);
      assert.deepEqual(await frame.evaluate(() => scrollEvents), []);
      await frame.locator('#play').click();
    }
    await page.goto(process.argv[2] || 'http://127.0.0.1:4174');
    await page.locator('#file-input').setInputFiles(video);
    await page.waitForFunction(() => document.querySelector('iframe')?.contentWindow.__PANO_PLAYER__?.getState().ready);
    const frame = page.frames().find(item => item.url().endsWith('/player.html'));
    await frame.locator('#audio-file').setInputFiles(audio);
    await frame.waitForFunction(() => !__PANO_PLAYER__.getState().switchingTrack && __PANO_PLAYER__.getState().listening.channels === 6);
    await verify(frame, 'web');
    // On narrow web viewports the meters are inline and must share the settings scroller.
    await page.setViewportSize({ width: 390, height: 844 });
    await frame.locator('#meter').check();
    await frame.locator('#meter-close').scrollIntoViewIfNeeded();
    const meterBounds = await bounds(frame);
    assert.equal(await frame.locator('#meter-overlay').evaluate(node => getComputedStyle(node).position), 'relative');
    assert.equal(meterBounds.rootOverflow, false);
    await frame.locator('#meter-close').click();
    server = spawn(process.execPath, [path.join(__dirname, 'stream-server.cjs'), video, audio]);
    const origin = await new Promise((resolve, reject) => {
      server.stdout.on('data', data => { const url = String(data).match(/http:\/\/127\.0\.0\.1:\d+/); if (url) resolve(url[0]); });
      server.on('error', reject); server.on('exit', code => reject(new Error(`Test server exited ${code}`)));
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(origin);
    await page.waitForFunction(() => __PANO_PLAYER__?.getState().ready);
    await page.evaluate(origin => window.postMessage({ type: 'audio-source', source: {
      id: 'external-scroll', name: 'FOA-HL.wav', url: origin + '/source/1' } }), origin);
    await page.waitForFunction(() => !__PANO_PLAYER__.getState().switchingTrack && __PANO_PLAYER__.getState().listening.channels === 6);
    await verify(page, 'extension');
    await page.evaluate(() => document.body.classList.add('vscode-light'));
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(output, 'extension-light.png') });
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(output, 'checks.json'), JSON.stringify({ checks, errors }, null, 2));
    console.log(JSON.stringify({ checks, errors }, null, 2));
  } finally {
    await browser.close();
    if (server && server.exitCode === null) await new Promise(resolve => { server.once('exit', resolve); server.kill(); });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
