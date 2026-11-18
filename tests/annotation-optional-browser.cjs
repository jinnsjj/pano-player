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
    const load = async (name, annotations, metadata = {}, skipped = 0) => {
      await frame.locator('#annotation-file').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ version: 1, ...metadata, annotations })) });
      await frame.waitForFunction(name => __PANO_PLAYER__.getState().plugins[0].data.name === name, name);
      await frame.evaluate(async () => { for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame); });
      assert.equal(await frame.locator('#annotation-status').isVisible(), skipped > 0);
      assert.equal((await state()).skipped, skipped);
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
      { ...interval, label: 'Interval note', source: 'positionless' },
      { ...interval, label: null, source: ' ', bbox: null, point: null },
    ]);
    assert.equal((await state()).total, 6); assert.equal((await state()).active, 5);
    assert.deepEqual((await state()).sources, ['example-method', 'positionless']);
    assert.equal(await frame.locator('#annotation-sources label').count(), 2);
    assert.equal(await frame.locator('#annotation-global-list li').textContent(), 'Interval notepositionless');
    assert.ok((await image()).alpha > 1000);
    const source = frame.getByRole('checkbox', { name: 'example-method', exact: true });
    await source.uncheck(); assert.equal((await state()).active, 3, 'Unnamed shapes and global text remain visible independently');
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
    assert.equal(await frame.locator('#plugin-sidebar').isVisible(), false);
    const longLabel = 'Timed annotation '.repeat(30) + 'x'.repeat(160);
    await load('global-only.json', [
      { ...interval, label: longLabel, source: 'notes' },
      { start: 16.2, end: 18, label: '<img src=x onerror=alert(1)>\nA second note', bbox: null, point: null },
    ]);
    const globals = frame.locator('#annotation-global');
    assert.equal(await globals.getAttribute('aria-label'), 'Annotations');
    assert.equal(await globals.getByRole('heading', { name: 'Annotations', exact: true }).count(), 1);
    assert.equal((await state()).active, 2); assert.equal((await image()).alpha, 0, 'Global text is not painted into the image');
    assert.equal(await globals.locator('li').count(), 2); assert.equal(await globals.locator('img').count(), 0);
    await frame.getByRole('button', { name: 'Annotation settings', exact: true }).click();
    assert.equal(await globals.isVisible(), true, 'Collapsing settings keeps global annotations visible');
    const seek = async time => {
      await frame.locator('#seek').fill(String(time)); await frame.locator('#seek').dispatchEvent('input');
      await frame.waitForFunction(time => Math.abs(__PANO_PLAYER__.getState().currentTime - time) < .01, time);
      await frame.evaluate(async () => { for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame); });
    };
    await seek(16); assert.equal(await globals.locator('li').count(), 1);
    await seek(17); assert.equal(await globals.locator('li').count(), 1);
    assert.match(await globals.textContent(), /second note/);
    await seek(18); assert.equal(await globals.isVisible(), false);
    await seek(16.4); assert.equal(await globals.locator('li').count(), 2);
    await frame.locator('#annotation-enabled').uncheck(); assert.equal(await globals.isVisible(), false);
    await frame.locator('#annotation-enabled').check(); assert.equal(await globals.isVisible(), true);
    await frame.getByRole('button', { name: 'Annotation settings', exact: true }).click();
    await frame.locator('#annotation-labels').uncheck(); assert.equal(await globals.isVisible(), false);
    await frame.locator('#annotation-labels').check(); assert.equal(await globals.isVisible(), true);
    await frame.getByRole('checkbox', { name: 'notes', exact: true }).uncheck();
    assert.equal(await globals.locator('li').count(), 1); assert.equal((await state()).active, 1);
    await frame.getByRole('checkbox', { name: 'notes', exact: true }).check();
    await frame.getByRole('button', { name: 'Annotation settings', exact: true }).click();
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
      await page.waitForTimeout(250);
      const layout = await frame.evaluate(() => {
        const stage = document.querySelector('#stage').getBoundingClientRect();
        const sidebar = document.querySelector('#plugin-sidebar').getBoundingClientRect();
        const transport = document.querySelector('#transport').getBoundingClientRect();
        return { overflow: document.documentElement.scrollWidth > innerWidth,
          beside: sidebar.left >= stage.right, below: sidebar.top >= stage.bottom,
          transportVisible: transport.top >= sidebar.bottom && transport.bottom <= innerHeight,
          textOverflow: [...document.querySelectorAll('#annotation-global-list li > div')].some(node => node.scrollWidth > node.clientWidth),
          scrollable: document.querySelector('#plugin-sidebar').scrollHeight > sidebar.height };
      });
      assert.equal(layout.overflow, false); assert.equal(layout.textOverflow, false); assert.equal(layout.transportVisible, true);
      assert.equal(width > 760 ? layout.beside : layout.below, true);
      assert.equal(layout.scrollable, true, 'Long concurrent labels remain available by scrolling');
      await page.screenshot({ path: path.join(output, `global-${width}.png`) });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await frame.locator('#plugin-sidebar').evaluate(node => { node.scrollTop = 100; });
    const scrollTop = await frame.locator('#plugin-sidebar').evaluate(node => node.scrollTop);
    await frame.locator('#view-spatial').click();
    assert.equal(await globals.isVisible(), true, 'Global annotations do not depend on projection');
    await frame.evaluate(async () => { for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame); });
    assert.equal(await frame.locator('#plugin-sidebar').evaluate(node => node.scrollTop), scrollTop, 'View changes preserve global text scrolling');
    await frame.locator('#view-flat').click();
    await frame.getByRole('button', { name: 'Annotation settings', exact: true }).click();
    await frame.locator('#annotation-clear').click(); assert.equal(await globals.isVisible(), false);
    assert.equal(await frame.locator('#plugin-sidebar').isVisible(), false);
    assert.ok(Math.abs(await frame.evaluate(() => __PANO_PLAYER__.getState().currentTime) - 16.4) < .05);
    await seek(16.42);
    await load('timing-samples.json', [
      { frame: 410, label: 'Face', source: 'face', bbox: [.2, .2, .4, .5] },
      { frame: 164, fps: 10, label: 'SELD', source: 'audio', point: [.6, .5] },
      { timestamp: 16.4, label: 'Timestamp sample' },
      { start: 16, end: 17, label: 'Legacy interval' },
    ], { fps: 25, version: undefined });
    assert.equal((await state()).active, 4); assert.ok((await image()).alpha > 1000);
    await seek(16.45); assert.equal((await state()).active, 2, '25 FPS samples end before 10 FPS samples');
    await seek(16.42); assert.equal((await state()).active, 4, 'Backward seek restores samples');
    await frame.getByRole('checkbox', { name: 'face', exact: true }).uncheck();
    assert.equal((await state()).active, 3);
    const beforeInvalid = await state(), beforePixels = await image();
    for (const sample of [{ frame: 410 }, { timestamp: 16.4 }]) {
      const field = 'frame' in sample ? 'frame' : 'timestamp';
      await frame.locator('#annotation-file').setInputFiles({ name: `missing-${field}-fps.json`, mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify({ version: 1, annotations: [{ ...sample, label: 'No FPS' }] })) });
      await frame.waitForFunction(field => document.querySelector('#annotation-status').textContent.includes(`${field} requires an explicit fps`), field);
      assert.deepEqual(await state(), beforeInvalid); assert.deepEqual(await image(), beforePixels);
    }
    assert.ok(Math.abs(await frame.evaluate(() => __PANO_PLAYER__.getState().currentTime) - 16.42) < .01);
    await frame.locator('#annotation-file').setInputFiles({ name: 'unsupported-version.json', mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ version: 2, annotations: [{ start: 16, end: 17, label: 'Future version' }] })) });
    await frame.waitForFunction(() => document.querySelector('#annotation-status').textContent.includes('Expected annotation JSON'));
    assert.deepEqual(await state(), beforeInvalid, 'An explicit unsupported version remains a file-level failure');
    await load('timestamp-only.json', [{ timestamp: 16.4, fps: 10, label: 'Timestamp at 10 FPS' }], { version: undefined });
    assert.equal((await state()).active, 1);
    await load('partial-import.json', [
      { timestamp: 16.4, label: 'Valid face', source: 'face', bbox: [.2, .2, .4, .5] },
      ...Array(15).fill({ start: 0, end: 0, source: 'invalid-time' }),
      { frame: 164, source: 'audio', point: [.6, .5] },
      { timestamp: 16.4, label: 'Valid note after invalid rows' },
    ], { fps: 10, version: undefined }, 15);
    assert.equal((await state()).total, 3); assert.equal((await state()).active, 3);
    assert.deepEqual((await state()).sources, ['audio', 'face']);
    assert.ok((await image()).alpha > 1000);
    assert.match(await frame.locator('#annotation-status').textContent(), /Only the first 10 errors are shown/);
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
      await frame.locator('#annotation-status').scrollIntoViewIfNeeded();
      assert.equal(await frame.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: path.join(output, `partial-warning-${width}.png`) });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await frame.getByRole('checkbox', { name: 'audio', exact: true }).uncheck();
    assert.equal((await state()).active, 2, 'Source filters still apply to the valid subset');
    const partialState = await state();
    await frame.locator('#annotation-file').setInputFiles({ name: 'all-invalid.json', mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ version: 1, annotations: [{ start: 1, end: 1 }, { frame: 4 }] })) });
    await frame.waitForFunction(() => document.querySelector('#annotation-status').textContent.includes('Annotations unchanged: No valid annotations.'));
    assert.deepEqual(await state(), partialState, 'An all-invalid replacement preserves the valid subset and its filters');
    assert.ok(Math.abs(await frame.evaluate(() => __PANO_PLAYER__.getState().currentTime) - 16.42) < .01);
    await load('clean-after-partial.json', [{ timestamp: 16.4, fps: 10, label: 'Clean import clears warnings' }]);
    await frame.locator('#annotation-format summary').click();
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
      await frame.locator('#annotation-format').scrollIntoViewIfNeeded();
      assert.equal(await frame.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: path.join(output, `timing-format-${width}.png`) });
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(requests.filter(r => !r.url.startsWith('blob:') && (new URL(r.url).origin !== origin || r.method !== 'GET')), []);
    const result = { mixedTotal: 6, mixedActive: 5, geometryOnlyPixels: geometry.alpha, noPlaceholderPixels: true,
      globalLabels: 2, globalTimeAndFilters: true, timestampAndFrameSamples: true, missingFpsRollback: true,
      partialImport: { loaded: 3, skipped: 15, diagnosticsLimit: 10, allInvalidRollback: true }, optionalVersion: true,
      responsiveWidths: [1440, 390, 320], positionlessWithoutLabelDrawn: 0, errors };
    await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
