const assert = require('node:assert/strict');

exports.directionWav = () => {
  const rate = 48000, frames = rate * 20, channels = 4;
  const wav = Buffer.alloc(44 + frames * channels * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(channels, 22);
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * channels * 2, 28);
  wav.writeUInt16LE(channels * 2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
  // A stationary source at +90 degrees: WYZX/SN3D = [signal, signal, 0, 0].
  for (let i = 0; i < frames; i++) {
    const sample = Math.round(6000 * Math.sin(2 * Math.PI * 1000 * i / rate));
    wav.writeInt16LE(sample, 44 + i * 8); wav.writeInt16LE(sample, 46 + i * 8);
  }
  return wav;
};

exports.checkAudio = async (browser, origin) => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await page.goto(`${origin}/?direction=left`);
    await page.locator('#play').click();
    await page.waitForFunction(() => window.__PANO_PLAYER__?.monitor.ready);
    await page.evaluate(() => {
      const m = window.__PANO_PLAYER__.monitor;
      const split = m.context.createChannelSplitter(2);
      // Observe the real post-gain playback mix, not a separate test renderer.
      for (const node of [m.output, m.stereo, m.fallback]) node.connect(split);
      window.meters = [0, 1].map(channel => {
        const meter = m.context.createAnalyser(); meter.fftSize = 4096;
        split.connect(meter, channel); return meter;
      });
    });
    async function energy() {
      await page.waitForTimeout(250);
      return page.evaluate(() => window.meters.map(meter => {
        const values = new Float32Array(meter.fftSize); meter.getFloatTimeDomainData(values);
        return values.reduce((sum, v) => sum + v * v, 0) / values.length;
      }));
    }
    const front = await energy();
    assert.ok(front[0] > front[1] * 2 && front[1] > 1e-8, `Left source must favor L: ${front}`);
    await page.locator('#view-spatial').click();
    await page.waitForFunction(() => window.__PANO_PLAYER__.view?.active);
    await page.locator('#spatial').focus();
    for (let i = 0; i < 31; i++) await page.keyboard.press('ArrowLeft');
    const rotated = await energy();
    assert.ok(rotated[1] > rotated[0] * 2, `Half-turn must favor R: ${rotated}`);
    await page.locator('#reset-view').click();
    const reset = await energy();
    assert.ok(reset[0] > reset[1] * 2, 'Reset must restore left direction');
    await page.locator('#mute').click();
    const muted = await energy();
    assert.ok(muted.every(v => v < 1e-12), 'Mute must silence the entire graph');
    await page.locator('#mute').click();
    await page.locator('#listening').selectOption('stereo');
    const stereo = await energy();
    assert.ok(stereo[0] > stereo[1] * 7, `Stereo monitor must preserve left direction: ${stereo}`);
    return { front, rotated, reset, muted, stereo, state: await page.evaluate(() => window.__PANO_PLAYER__.getState()) };
  } finally { await page.close(); }
};
