const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

(async () => {
  const [base = 'http://127.0.0.1:4173', video, annotationFile] = process.argv.slice(2);
  assert.ok(video && annotationFile, 'Provide local video and annotation JSON paths.');
  const origin = new URL(base).origin, pluginId = 'shijunjie.pano-player-annotations';
  const expectedTotal = JSON.parse(await fs.readFile(annotationFile, 'utf8')).annotations.length;
  const output = path.join(__dirname, '../output/playwright/annotations');
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => requests.push({ url: request.url(), method: request.method() }));
    await page.goto(origin);
    await page.locator('#plugins-open').click();
    const enabled = page.locator(`#plugins-list input[data-plugin="${pluginId}"]`);
    await enabled.waitFor(); assert.equal(await enabled.isChecked(), true, 'Enabled without installation on a fresh profile');
    assert.match(await page.locator('#plugins-list').textContent(), /built-in/);
    assert.equal(await page.locator(`[data-remove-plugin="${pluginId}"]`).isVisible(), false);
    await page.locator('#plugins-close').click();
    await page.locator('#file-input').setInputFiles(video);
    await page.waitForFunction(() => document.querySelector('iframe')?.contentWindow.__PANO_PLAYER__?.getState().ready);
    const frame = page.frames().find(frame => frame.url().endsWith('/player.html'));
    const button = frame.getByRole('button', { name: 'Annotation settings', exact: true });
    await button.waitFor();
    assert.equal(await button.evaluate(node => node.closest('#overlay-options') !== null), true);
    assert.equal(await frame.locator('#plugin-panels').evaluate(node => node.children.length), 0, 'No standalone annotation section');
    assert.equal(await button.getAttribute('aria-expanded'), 'false');
    assert.equal(await frame.getByRole('checkbox', { name: 'Annotation', exact: true }).isDisabled(), true);
    assert.equal(await frame.locator('#annotation-open').isVisible(), false);
    await frame.locator('#seek').fill('16.4'); await frame.locator('#seek').dispatchEvent('input');
    await frame.waitForFunction(() => !__PANO_PLAYER__.monitor.video.previewFrame && Math.abs(__PANO_PLAYER__.getState().currentTime - 16.4) < .05);
    await page.screenshot({ path: path.join(output, 'collapsed-desktop.png') });
    await button.click();
    assert.equal(await button.getAttribute('aria-expanded'), 'true');
    const chooser = page.waitForEvent('filechooser'); await frame.locator('#annotation-open').click();
    await (await chooser).setFiles(annotationFile);
    await frame.waitForFunction(total => __PANO_PLAYER__.getState().plugins[0]?.data?.total === total, expectedTotal);
    assert.equal(await frame.getByRole('checkbox', { name: 'Annotation', exact: true }).isChecked(), true);
    assert.equal(await frame.getByRole('checkbox', { name: 'Show', exact: true }).count(), 0, 'One visibility toggle, in the Overlay toolbar');
    const pixels = () => frame.evaluate(() => {
      const canvas = document.querySelector('[data-plugin-layer]');
      return canvas.getContext('2d').getImageData(0, 0, 2048, 1024).data.filter((v, i) => i % 4 === 3 && v > 0).length;
    });
    const visiblePixels = await pixels(); assert.ok(visiblePixels > 1000);
    await page.screenshot({ path: path.join(output, 'expanded-desktop.png') });
    await button.click(); assert.equal(await frame.locator('#annotation-open').isVisible(), false);
    assert.equal(await pixels(), visiblePixels, 'Collapsing the controls does not hide the overlay');
    await frame.locator('#annotation-enabled').uncheck(); assert.equal(await pixels(), 0);
    assert.equal(await button.getAttribute('aria-expanded'), 'false', 'Visibility can change with settings collapsed');
    assert.equal(await frame.evaluate(() => __PANO_PLAYER__.getState().plugins[0].data.total), expectedTotal, 'Hiding annotations retains data');
    await frame.locator('#annotation-enabled').check(); assert.ok((await pixels()) > 1000);
    await button.click();
    await frame.locator('#view-spatial').click();
    await frame.waitForFunction(() => __PANO_PLAYER__.view?.overlayLayers.values().next().value?.mesh.visible);
    await button.click();
    await page.screenshot({ path: path.join(output, 'perspective-desktop.png') });
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.waitForTimeout(250);
      for (const expanded of [false, true]) {
        if ((await button.getAttribute('aria-expanded')) !== String(expanded)) await button.click();
        await page.waitForTimeout(150);
        assert.ok(await frame.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        if (expanded) assert.ok(await frame.locator('#annotation-sources').evaluate(node => {
          const r = node.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth;
        }));
        await page.screenshot({ path: path.join(output, `${expanded ? 'expanded' : 'collapsed'}-${width}.png`) });
      }
    }
    const gridSettings = frame.locator('#grid-settings'), powerSettings = frame.locator('#powermap-settings');
    const visibility = () => frame.evaluate(() => ['grid', 'enabled', 'annotation-enabled'].map(id => document.getElementById(id).checked));
    const beforeVisibility = await visibility();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await gridSettings.hover(); assert.equal(await gridSettings.getAttribute('aria-expanded'), 'false');
    await gridSettings.press('Enter'); await powerSettings.click();
    for (const control of [gridSettings, powerSettings, button]) assert.equal(await control.getAttribute('aria-expanded'), 'true');
    assert.deepEqual(await visibility(), beforeVisibility, 'Settings arrows never change visibility');
    await frame.locator('#gridOpacity').fill('0.42'); await frame.locator('#gridOpacity').dispatchEvent('input');
    await frame.locator('#mapAlgorithm').selectOption('pwd'); assert.equal(await frame.locator('#mapSources').isDisabled(), true);
    await frame.locator('#mapAlgorithm').selectOption('music'); assert.equal(await frame.locator('#mapSources').isDisabled(), false);
    await frame.locator('#audio-heading').click();
    for (const control of [gridSettings, powerSettings, button]) assert.equal(await control.getAttribute('aria-expanded'), 'true', 'Inline settings do not dismiss on outside clicks');
    await frame.locator('#gridOpacity').press('Escape');
    assert.equal(await gridSettings.getAttribute('aria-expanded'), 'false');
    assert.equal(await gridSettings.evaluate(node => node === document.activeElement), true);
    assert.equal(await powerSettings.getAttribute('aria-expanded'), 'true');
    await gridSettings.press('Space');
    await frame.locator('#overview').uncheck();
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
      await frame.locator('#viewport-resize').press('Home');
      await frame.locator('#overlay-heading').evaluate(node => node.scrollIntoView({ block: 'start' }));
      await page.waitForTimeout(200);
      assert.ok(await frame.evaluate(() => {
        const nodes = [document.getElementById('grid-menu'), document.getElementById('powermap-menu'), document.querySelector('.plugin-panel-content')];
        const rects = nodes.map(node => node.getBoundingClientRect());
        return nodes.every(node => !node.hidden && getComputedStyle(node).position === 'static')
          && rects.every(rect => rect.left >= 0 && rect.right <= innerWidth)
          && rects[0].bottom <= rects[1].top && rects[1].bottom <= rects[2].top
          && document.documentElement.scrollWidth <= innerWidth;
      }), 'All three settings expand in flow, in order, without overlap or horizontal overflow');
      await page.screenshot({ path: path.join(output, `overlays-expanded-${width}.png`) });
      if (width < 1440) {
        await frame.locator('#annotation-sources').scrollIntoViewIfNeeded();
        await page.waitForTimeout(150);
        await page.screenshot({ path: path.join(output, `overlays-annotation-${width}.png`) });
      }
    }
    await gridSettings.click(); await powerSettings.click();
    assert.deepEqual(await visibility(), beforeVisibility);
    const format = frame.locator('#annotation-format'), summary = format.locator('summary');
    assert.equal(await format.evaluate(node => node.open), false);
    const example = JSON.parse(await format.locator('pre code').textContent());
    assert.equal(example.version, 1); assert.ok(example.annotations[0].bbox); assert.ok(example.annotations[1].point);
    const time = await frame.evaluate(() => __PANO_PLAYER__.getState().currentTime);
    await frame.locator('#overview').uncheck();
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
      await frame.locator('#viewport-resize').press('Home');
      if (width === 1440) {
        await summary.hover(); assert.equal(await format.evaluate(node => node.open), false, 'Help is click-to-open, not hover');
        await summary.press('Enter');
      } else await summary.click();
      await format.evaluate(node => node.scrollIntoView({ block: 'start' }));
      await page.waitForTimeout(200);
      assert.equal(await format.evaluate(node => node.open), true);
      assert.ok(await frame.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.ok(await format.locator('.annotation-format-content').evaluate(node => {
        const bounds = node.getBoundingClientRect(); return bounds.left >= 0 && bounds.right <= innerWidth;
      }));
      await page.screenshot({ path: path.join(output, `format-${width}.png`) });
      if (width < 1440) {
        await format.locator('dl').scrollIntoViewIfNeeded();
        await page.waitForTimeout(150);
        await page.screenshot({ path: path.join(output, `format-${width}-fields.png`) });
      }
      await summary.click();
      assert.equal(await format.evaluate(node => node.open), false);
      assert.equal(await frame.evaluate(() => __PANO_PLAYER__.getState().currentTime), time, 'Reading the format does not change playback');
      assert.equal(await frame.evaluate(() => __PANO_PLAYER__.getState().plugins[0].data.total), expectedTotal);
    }
    await frame.locator('#viewport-resize').dblclick();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.waitForTimeout(250);
    await page.locator('#plugins-open').click();
    await page.screenshot({ path: path.join(output, 'plugins-desktop.png') });
    await page.setViewportSize({ width: 320, height: 844 });
    await page.waitForTimeout(250);
    assert.ok(await page.locator('#plugins-dialog').evaluate(node => node.scrollWidth <= node.clientWidth));
    await page.screenshot({ path: path.join(output, 'plugins-320.png') });
    await enabled.uncheck();
    await frame.waitForFunction(() => __PANO_PLAYER__.getState().plugins.length === 0);
    assert.equal(await frame.locator('#annotation-open').count(), 0);
    assert.equal(await frame.locator('#annotation-enabled').count(), 0, 'Unloading removes the toolbar visibility toggle');
    assert.equal(await frame.getByRole('button', { name: 'Annotation settings', exact: true }).count(), 0);
    assert.equal(await frame.locator('[data-plugin-layer]').count(), 0, 'Unloading releases the canvas layer');
    await page.reload(); await page.locator('#plugins-open').click(); await enabled.waitFor();
    assert.equal(await enabled.isChecked(), false, 'Explicit opt-out survives reload');
    await enabled.check(); await page.locator('#plugins-close').click();
    await page.reload();
    await page.locator('#file-input').setInputFiles(video);
    await page.waitForFunction(id => document.querySelector('iframe')?.contentWindow.__PANO_PLAYER__?.getState().plugins.some(p => p.id === id && p.status === 'active'), pluginId);
    const reopened = page.frames().find(frame => frame.url().endsWith('/player.html'));
    assert.equal(await reopened.evaluate(() => __PANO_PLAYER__.getState().plugins[0].data.total), 0, 'Annotation files remain session-local');
    assert.equal(await reopened.locator('#plugin-status').isVisible(), false);
    assert.equal(await page.locator('#message').isVisible(), false);
    assert.deepEqual(errors, []);
    assert.deepEqual(requests.filter(r => !r.url.startsWith('blob:') && (new URL(r.url).origin !== origin || r.method !== 'GET')), []);
    await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ total: expectedTotal, visiblePixels, viewports: [1440, 390, 320], errors, noInstallRequired: true, enablementPersisted: true }, null, 2));
    console.log(JSON.stringify({ total: expectedTotal, visiblePixels, errors, noInstallRequired: true, enablementPersisted: true }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
