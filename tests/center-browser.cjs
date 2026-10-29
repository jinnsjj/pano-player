// Run after build:web: NODE_PATH=<playwright packages> node tests/center-browser.cjs [video]
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createServer } = require('../web/serve.cjs');

(async () => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.locator('#file-input').setInputFiles(path.resolve(process.argv[2] || 'output/playwright/web/multi-foa.mp4'));
    const frame = page.frameLocator('#player-frame');
    await frame.locator('#play').waitFor({ state: 'visible' });
    await frame.locator('#center').check();
    const output = path.resolve('output/playwright/center');
    await fs.mkdir(output, { recursive: true });
    for (const size of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 568 }]) {
      await page.setViewportSize(size);
      for (const mode of ['flat', 'spatial']) {
        await frame.locator('#view-' + mode).click();
        if (mode === 'spatial') {
          await frame.locator('#spatial canvas').waitFor();
          await frame.locator('#overview').uncheck();
          await frame.locator('#spatial').press('Home');
          await frame.locator('#spatial').press('ArrowLeft');
          await frame.locator('#spatial').press('ArrowUp');
          assert.equal(await frame.locator('#center-angles').textContent(), 'Az 5.7° · El 5.7°');
          assert.ok(await frame.locator('#spatial').evaluate(() => {
            const view = window.__PANO_PLAYER__.view;
            view.render();
            const gl = view.gpu.getContext();
            const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
            gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
            return pixels.some((value, index) => index % 4 !== 3 && value > 30);
          }), 'Perspective renders nonblank pixels behind the marker');
        } else assert.equal(await frame.locator('#center-angles').textContent(), 'Az 0.0° · El 0.0°');
        const geometry = await frame.locator('#center-marker').evaluate(marker => {
          const center = marker.getBoundingClientRect(), stage = document.getElementById('stage').getBoundingClientRect();
          const angles = document.getElementById('center-angles').getBoundingClientRect();
          return { dx: center.x + center.width / 2 - stage.x - stage.width / 2,
            dy: center.y + center.height / 2 - stage.y - stage.height / 2,
            inside: angles.left >= stage.left && angles.right <= stage.right && angles.bottom <= stage.bottom,
            pointerEvents: getComputedStyle(marker).pointerEvents,
            icon: !!marker.querySelector('svg'), overflow: document.documentElement.scrollWidth > innerWidth };
        });
        assert.ok(Math.abs(geometry.dx) < 1 && Math.abs(geometry.dy) < 1);
        assert.equal(geometry.inside, true); assert.equal(geometry.pointerEvents, 'none');
        assert.equal(geometry.icon, true); assert.equal(geometry.overflow, false);
        await page.screenshot({ path: path.join(output, `${mode}-${size.width}.png`) });
      }
    }
    await frame.locator('#center').uncheck();
    assert.equal(await frame.locator('#center-marker').isVisible(), false);
    assert.deepEqual(errors, []);
    console.log('Center marker and live angles passed in both views at desktop, 390px and 320px.');
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
