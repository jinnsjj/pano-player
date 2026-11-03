const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

(async () => {
  const [base = 'http://127.0.0.1:4173', video] = process.argv.slice(2);
  assert.ok(video, 'Provide a local video. Fixtures are synthetic.');
  const origin = new URL(base).origin, output = path.join(__dirname, '../output/playwright/annotation-optional');
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => requests.push({ url: request.url(), method: request.method() }));
    await page.goto(origin); await page.locator('#file-input').setInputFiles(video);
    await page.waitForFunction(() => document.querySelector('iframe')?.contentWindow.__PANO_PLAYER__?.getState().ready);
    const frame = page.frames().find(frame => frame.url().endsWith('/player.html'));
    await frame.getByRole('button', { name: 'Annotation settings', exact: true }).click();
    await frame.locator('#seek').fill('16.4'); await frame.locator('#seek').dispatchEvent('input');
    await frame.waitForFunction(() => !__PANO_PLAYER__.monitor.video.previewFrame && Math.abs(__PANO_PLAYER__.getState().currentTime - 16.4) < .05);
    const state = () => frame.evaluate(() => __PANO_PLAYER__.getState().plugins[0].data);
    const load = async (name, annotations) => {
      await frame.locator('#annotation-file').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ version: 1, annotations })) });
      await frame.waitForFunction(name => __PANO_PLAYER__.getState().plugins[0].data.name === name, name);
      assert.equal(await frame.locator('#annotation-status').isVisible(), false);
    };
    const image = () => frame.evaluate(() => {
      const canvas = document.querySelector('[data-plugin-layer]');
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let alpha = 0, hash = 2166136261;
      for (let i = 0; i < data.length; i++) { hash = Math.imul(hash ^ data[i], 16777619); if (i % 4 === 3 && data[i]) alpha++; }
      return { alpha, hash: hash >>> 0 };
    });
    const interval = { start: 16, end: 17 };
    await load('optional-fields.json', [
      { ...interval, label: 'Example label', bbox: [.1, .25, .3, .6] },
      { ...interval, source: 'example-method', point: [.58, .3] },
      { ...interval, point: [.7, .7] },
      { ...interval, label: 'With source', source: 'example-method', bbox: [.55, .5, .75, .8] },
      { ...interval, label: 'Not drawn', source: 'positionless' },
      { ...interval, label: null, source: ' ', bbox: null, point: null },
    ]);
    assert.equal((await state()).total, 6); assert.equal((await state()).active, 4);
    assert.deepEqual((await state()).sources, ['example-method']);
    assert.equal(await frame.locator('#annotation-sources label').count(), 1);
    assert.ok((await image()).alpha > 1000);
    const source = frame.getByRole('checkbox', { name: 'example-method', exact: true });
    await source.uncheck(); assert.equal((await state()).active, 2, 'Unnamed shapes remain visible independently');
    await source.check();
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
      await page.waitForTimeout(250);
      assert.ok(await frame.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: path.join(output, `optional-${width}.png`) });
    }
    await page.setViewportSize({ width: 1440, height: 1000 }); await page.waitForTimeout(250);
    await load('geometry-only.json', [
      { ...interval, bbox: [.15, .3, .4, .65] },
      { ...interval, label: null, source: '', point: [.65, .45] },
    ]);
    assert.equal((await state()).active, 2); assert.deepEqual((await state()).sources, []);
    assert.equal(await frame.locator('#annotation-sources').isVisible(), false);
    const geometry = await image(); assert.ok(geometry.alpha > 1000);
    await frame.locator('#annotation-labels').uncheck();
    assert.deepEqual(await image(), geometry, 'Absent metadata paints no text, brackets or placeholder background');
    await frame.locator('#annotation-labels').check(); assert.deepEqual(await image(), geometry);
    await page.screenshot({ path: path.join(output, 'geometry-only-desktop.png') });
    await load('no-position.json', [{ ...interval, source: 'positionless', bbox: null, point: null }]);
    assert.equal((await state()).total, 1); assert.equal((await state()).active, 0);
    assert.equal((await image()).alpha, 0); assert.deepEqual((await state()).sources, []);
    assert.equal(await frame.locator('#annotation-count').textContent(), '0 active / 1');
    assert.ok(Math.abs(await frame.evaluate(() => __PANO_PLAYER__.getState().currentTime) - 16.4) < .05);
    assert.deepEqual(errors, []);
    assert.deepEqual(requests.filter(r => !r.url.startsWith('blob:') && (new URL(r.url).origin !== origin || r.method !== 'GET')), []);
    const result = { mixedTotal: 6, mixedDrawn: 4, geometryOnlyPixels: geometry.alpha, noPlaceholderPixels: true, positionlessDrawn: 0, errors };
    await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
