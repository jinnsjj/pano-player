const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

(async () => {
  const [base = 'http://127.0.0.1:4173', video] = process.argv.slice(2);
  assert.ok(video, 'Provide a local video. Annotation fixtures are synthetic.');
  const output = path.join(__dirname, '../output/playwright/annotation-fields');
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base); await page.locator('#file-input').setInputFiles(video);
    await page.waitForFunction(() => document.querySelector('iframe')?.contentWindow.__PANO_PLAYER__?.getState().ready);
    const frame = page.frames().find(frame => frame.url().endsWith('/player.html'));
    await frame.getByRole('button', { name: 'Annotation settings', exact: true }).click();
    const state = () => frame.evaluate(() => __PANO_PLAYER__.getState().plugins[0].data);
    const load = async (name, annotations) => {
      await frame.locator('#annotation-file').setInputFiles({ name, mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify({ annotations })) });
      await frame.waitForFunction(name => __PANO_PLAYER__.getState().plugins[0].data.name === name, name);
    };
    const image = () => frame.evaluate(async () => {
      for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
      const canvas = document.querySelector('[data-plugin-layer]');
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let alpha = 0, hash = 2166136261;
      for (let i = 0; i < data.length; i++) { hash = Math.imul(hash ^ data[i], 16777619); if (i % 4 === 3 && data[i]) alpha++; }
      return { alpha, hash: hash >>> 0 };
    });
    const interval = { start: .2, end: .4 };
    await load('custom-fields.json', [
      { ...interval, label: 'AC153', bbox: [.549, .445, .629, .547], active: false, confidence: .88 },
      { ...interval, label: 'Note', source: 'notes', active: false, confidence: 0, details: { visible: true } },
      { ...interval, point: [.3, .3], active: true },
      { start: 1, end: 2, label: 'Later', later: 'future' },
    ]);
    await frame.locator('#seek').fill('.3'); await frame.locator('#seek').dispatchEvent('input');
    await frame.waitForFunction(() => Math.abs(__PANO_PLAYER__.getState().currentTime - .3) < .01);
    await frame.waitForFunction(() => __PANO_PLAYER__.getState().plugins[0].data.active === 3);
    assert.equal(await frame.locator('#annotation-fields').isVisible(), true);
    assert.deepEqual((await state()).fields, ['active', 'confidence', 'details', 'later']);
    const fields = frame.getByRole('group', { name: 'Label fields', exact: true });
    const active = fields.getByRole('checkbox', { name: 'active', exact: true });
    const confidence = fields.getByRole('checkbox', { name: 'confidence', exact: true });
    assert.equal(await active.isChecked(), false); assert.equal(await confidence.isChecked(), false);
    const original = await image(); assert.ok(original.alpha > 0);
    await active.check(); const activeOnly = await image(); assert.notEqual(activeOnly.hash, original.hash);
    assert.equal((await state()).active, 3, 'active: false is caption metadata, not a visibility rule');
    assert.equal(await frame.locator('#annotation-global-list li > div > span').first().textContent(), 'Note | active: false');
    await confidence.check(); const both = await image(); assert.notEqual(both.hash, activeOnly.hash);
    await active.uncheck(); const confidenceOnly = await image(); assert.notEqual(confidenceOnly.hash, both.hash);
    assert.equal(await frame.locator('#annotation-global-list li > div > span').first().textContent(), 'Note | confidence: 0');
    await confidence.uncheck();
    assert.equal((await image()).alpha, original.alpha, 'Deselecting fields restores the original caption bounds');
    assert.deepEqual((await state()).selectedFields, []);
    await active.focus(); await active.press('Space'); assert.equal(await active.isChecked(), true);
    await confidence.check();
    await frame.locator('#annotation-labels').uncheck();
    assert.equal(await active.isDisabled(), true); assert.equal(await confidence.isDisabled(), true);
    assert.ok((await image()).alpha > 0, 'Shapes remain visible with labels hidden');
    await frame.locator('#annotation-labels').check();
    assert.equal((await image()).alpha, both.alpha, 'Labels toggle preserves selected fields');
    assert.equal(await active.isEnabled(), true);
    assert.equal(await frame.locator('#annotation-global-list li > div > span').first().textContent(), 'Note | active: false | confidence: 0');
    assert.ok(Math.abs(await frame.evaluate(() => __PANO_PLAYER__.getState().currentTime) - .3) < .01);
    const source = frame.locator('#annotation-sources').getByRole('checkbox', { name: 'notes', exact: true });
    await source.uncheck(); assert.equal((await state()).active, 2);
    assert.deepEqual((await state()).selectedFields, ['active', 'confidence']);
    await source.check();
    const longField = 'custom_' + 'very_long_field_name_'.repeat(10);
    await load('long-fields.json', [{ ...interval, label: 'AC153', bbox: [.549, .445, .629, .547],
      active: false, confidence: .88, [longField]: 'wrapped', '<img src=x onerror=alert(1)>': 'literal' }]);
    await fields.getByRole('checkbox', { name: 'active', exact: true }).check();
    await fields.getByRole('checkbox', { name: 'confidence', exact: true }).check();
    assert.equal(await fields.locator('img').count(), 0);
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
      await frame.locator('#annotation-fields').scrollIntoViewIfNeeded();
      await frame.evaluate(async () => { for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame); });
      assert.ok(await frame.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.ok(await fields.evaluate(node => [...node.querySelectorAll('label')].every(label => {
        const bounds = label.getBoundingClientRect(); return bounds.left >= 0 && bounds.right <= innerWidth && label.scrollWidth <= label.clientWidth;
      })), 'Long field names wrap without horizontal overflow');
      await page.screenshot({ path: path.join(output, `fields-${width}.png`) });
    }
    await load('standard-only.json', [{ ...interval, label: 'AC153', bbox: [.549, .445, .629, .547] }]);
    assert.equal(await frame.locator('#annotation-fields').isVisible(), false);
    assert.deepEqual((await state()).selectedFields, []);
    await load('replacement.json', [{ ...interval, label: 'AC153', bbox: [.549, .445, .629, .547], active: true }]);
    assert.equal(await fields.getByRole('checkbox', { name: 'active', exact: true }).isChecked(), false);
    await fields.getByRole('checkbox', { name: 'active', exact: true }).check();
    await frame.locator('#annotation-clear').click();
    assert.equal(await frame.locator('#annotation-fields').isVisible(), false);
    assert.deepEqual((await state()).fields, []); assert.deepEqual((await state()).selectedFields, []);
    assert.deepEqual(errors, []);
    const result = { original, activeOnly, both, confidenceOnly, viewports: [1440, 390, 320], errors };
    await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
