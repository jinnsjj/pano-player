// Run after build:web with a local preview and NODE_PATH pointing to Playwright.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

(async () => {
  const [base = 'http://127.0.0.1:4173', video] = process.argv.slice(2);
  assert.ok(video, 'Provide a local video fixture. Annotations are synthetic.');
  const origin = new URL(base).origin, pluginId = 'shijunjie.pano-player-annotations';
  const output = path.resolve(__dirname, '../output/playwright/annotation-drop');
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => requests.push({ url: request.url(), method: request.method() }));
    await page.goto(base);
    await page.locator('#file-input').setInputFiles(video);
    await page.waitForFunction(() => document.querySelector('iframe')?.contentWindow.__PANO_PLAYER__?.getState().ready);
    let frame = page.frames().find(frame => frame.url().endsWith('/player.html'));
    await frame.waitForFunction(id => __PANO_PLAYER__.getState().plugins.some(p => p.id === id && p.status === 'active'), pluginId);
    await page.evaluate(() => { window.originalPlayer = document.querySelector('iframe').contentWindow.__PANO_PLAYER__; });
    await frame.locator('#seek').fill('2'); await frame.locator('#seek').dispatchEvent('input');
    await frame.waitForFunction(() => !__PANO_PLAYER__.monitor.video.previewFrame && Math.abs(__PANO_PLAYER__.getState().currentTime - 2) < .05);
    const state = () => frame.evaluate(() => __PANO_PLAYER__.getState());
    const unchanged = async () => {
      assert.equal(await page.evaluate(() => originalPlayer === document.querySelector('iframe').contentWindow.__PANO_PLAYER__), true);
      const current = await state();
      assert.equal(current.paused, true); assert.ok(Math.abs(current.currentTime - 2) < .05);
    };
    const contents = JSON.stringify({ version: 1, annotations: [{ start: 0, end: 100, label: 'Dropped annotation', bbox: [.2, .2, .6, .7] }] });
    const drop = async (files, parent = false) => {
      await page.evaluate(({ files, parent }) => {
        const target = parent ? window : document.querySelector('iframe').contentWindow;
        const dataTransfer = new target.DataTransfer();
        for (const file of files) dataTransfer.items.add(file.media ?
          panoWebHost.getFile() :
          new target.File([file.size ? new Uint8Array(file.size) : file.contents ?? ''], file.name, { type: 'application/json' }));
        target.document.getElementById(parent ? 'workspace' : 'stage').dispatchEvent(new target.DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
      }, { files, parent });
    };
    const loaded = name => frame.waitForFunction(name => __PANO_PLAYER__.getState().plugins[0]?.data?.name === name, name);
    const settings = () => frame.getByRole('button', { name: 'Annotation settings', exact: true });
    assert.equal(await settings().getAttribute('aria-expanded'), 'false');
    assert.equal(await frame.locator('#annotation-open').isVisible(), true);
    assert.equal(await frame.locator('#annotation-open').evaluate(node => Boolean(node.closest('.overlay-control')) && !node.closest('.plugin-panel-content')), true);
    await drop([{ name: 'dropped.JSON', contents }]); await loaded('dropped.JSON'); await unchanged();
    assert.equal(await settings().getAttribute('aria-expanded'), 'true');
    assert.equal((await state()).plugins[0].data.active, 1);
    const pixels = await frame.evaluate(() => {
      const canvas = document.querySelector('[data-plugin-layer]');
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      return data.filter((v, i) => i % 4 === 3 && v > 0).length;
    });
    assert.ok(pixels > 1000, 'Dropped annotation renders a nonblank layer');
    for (const files of [
      [{ name: 'broken.json', contents: '{' }],
      [{ name: 'wrong-schema.json', contents: '{}' }],
      [{ name: 'empty.json' }],
      [{ name: 'oversized.json', size: 20 * 1024 * 1024 + 1 }],
      [{ name: 'one.json', contents }, { name: 'two.json', contents }],
      [{ media: true }, { name: 'mixed.json', contents }],
    ]) {
      await settings().click();
      await drop(files);
      await frame.waitForFunction(() => document.getElementById('annotation-status').textContent.includes('unchanged'));
      assert.equal(await frame.locator('#annotation-status').isVisible(), true);
      assert.equal((await state()).plugins[0].data.name, 'dropped.JSON'); await unchanged();
    }
    await drop([{ name: 'parent-drop.json', contents }], true); await loaded('parent-drop.json'); await unchanged();
    assert.equal(await page.locator('#message').isVisible(), false);
    await settings().click(); assert.equal(await settings().getAttribute('aria-expanded'), 'false');
    const chooser = page.waitForEvent('filechooser'); await frame.locator('#annotation-open').click();
    await (await chooser).setFiles({ name: 'browser-picker.json', mimeType: 'application/json', buffer: Buffer.from(contents) });
    await loaded('browser-picker.json'); await unchanged();
    assert.equal(await settings().getAttribute('aria-expanded'), 'false', 'Open imports without needing to expand secondary settings');
    await frame.locator('#play').click();
    await frame.waitForFunction(() => !__PANO_PLAYER__.getState().paused && __PANO_PLAYER__.getState().currentTime > 2.1);
    const playingTime = (await state()).currentTime;
    await drop([{ name: 'playing-drop.json', contents }]); await loaded('playing-drop.json');
    assert.equal((await state()).paused, false); assert.ok((await state()).currentTime >= playingTime);
    await frame.locator('#play').click();
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
      await page.waitForTimeout(200);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.ok(await frame.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      if (await settings().getAttribute('aria-expanded') !== 'false') await settings().click();
      assert.equal(await frame.locator('#annotation-open').isVisible(), true);
      assert.ok(await frame.locator('#annotation-open').evaluate(node => {
        const bounds = node.getBoundingClientRect(); return bounds.left >= 0 && bounds.right <= innerWidth;
      }), 'The first-level Open button fits every viewport');
      await page.screenshot({ path: path.join(output, `drop-collapsed-${width}.png`) });
      await settings().click();
      await page.screenshot({ path: path.join(output, `drop-${width}.png`) });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('#plugins-open').click();
    const enabled = page.locator(`#plugins-list input[data-plugin="${pluginId}"]`);
    await enabled.uncheck();
    await frame.waitForFunction(() => __PANO_PLAYER__.getState().plugins.length === 0);
    await page.locator('#plugins-close').click();
    await drop([{ name: 'disabled.json', contents }]);
    assert.match(await page.locator('#message').textContent(), /Unsupported/);
    assert.equal(await page.evaluate(() => originalPlayer === document.querySelector('iframe').contentWindow.__PANO_PLAYER__), true);
    await page.locator('#plugins-open').click(); await enabled.check(); await page.locator('#plugins-close').click();
    await frame.waitForFunction(() => __PANO_PLAYER__.getState().plugins[0]?.status === 'active');
    await drop([{ name: 'reenabled.json', contents }]); await loaded('reenabled.json');
    await drop([{ media: true }]);
    await page.waitForFunction(() => originalPlayer !== document.querySelector('iframe')?.contentWindow.__PANO_PLAYER__ &&
      document.querySelector('iframe')?.contentWindow.__PANO_PLAYER__?.getState().ready);
    frame = page.frames().find(frame => frame.url().endsWith('/player.html'));
    await frame.waitForFunction(() => __PANO_PLAYER__.getState().plugins[0]?.status === 'active');
    assert.equal((await state()).plugins[0].data.total, 0, 'Ordinary media drops still create a fresh media session');
    assert.equal(await page.evaluate(() => originalPlayer.monitor.video.disposed), true);
    assert.deepEqual(errors, []);
    assert.deepEqual(requests.filter(r => !r.url.startsWith('blob:') && (new URL(r.url).origin !== origin || r.method !== 'GET')), []);
    const result = { iframeDrop: true, parentDrop: true, browserPicker: true, playingDrop: true, rejectedDrops: 6, pixels,
      disabledPlugin: true, mediaReplacement: true, viewports: [1440, 390, 320], errors };
    await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
