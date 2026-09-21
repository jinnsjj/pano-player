/*!
 * Adapted from Cockos JSFX analysis/loudness_meter, REAPER 7.52.
 * Copyright (C) 2021 and later Cockos Incorporated.
 * JavaScript adaptation for PanoPlayer, 2026.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 * See media/LICENSE-loudness-meter.txt and meter-sources/loudness_meter.
 */
const db = power => power > 0 ? 10 * Math.log10(power) : -Infinity;
const loudness = power => -.691 + db(power);
const bin = value => Math.max(0, Math.min(1023, Math.floor((value + 70) * 10)));

export class LoudnessMeter {
  constructor(rate) {
    this.rate = rate;
    this.windowFrames = Math.round(rate * .1);
    const k1 = Math.tan(Math.PI * 1681.974450955533 / rate), q1 = .7071752369554196;
    const vh = 10 ** (3.999843853973347 / 20), vb = vh ** .4996667741545416;
    const a1 = 1 + k1 / q1 + k1 * k1;
    this.shelf = [(2 * (k1 * k1 - 1)) / a1, (1 - k1 / q1 + k1 * k1) / a1,
      (vh + vb * k1 / q1 + k1 * k1) / a1, 2 * (k1 * k1 - vh) / a1,
      (vh - vb * k1 / q1 + k1 * k1) / a1];
    const k2 = Math.tan(Math.PI * 38.13547087602444 / rate), q2 = .5003270373238773;
    this.highpass = [2 * (k2 * k2 - 1) / (1 + k2 / q2 + k2 * k2),
      (1 - k2 / q2 + k2 * k2) / (1 + k2 / q2 + k2 * k2)];
    this.sinc = (rate < 96000 ? [.25, .5, .75] : [.5]).map(phase => Float64Array.from({ length: 32 }, (_, i) => {
      const t = i + phase, x = Math.PI * (t - 16);
      return (.53836 - .46164 * Math.cos(2 * Math.PI * t / 32)) * Math.sin(x) / x;
    }));
    this.reset();
  }
  reset() {
    this.channels = [0, 1].map(() => ({ peak: 0, heldPeak: 0, truePeak: 0, heldTruePeak: 0,
      clips: 0, trueClips: 0, sum: 0, rms: null, rmsBins: new Float64Array(4),
      history: new Float64Array(32), f1: 0, f2: 0, h1: 0, h2: 0 }));
    this.frame = 0; this.windows = 0; this.historyPosition = 0; this.weightedSum = 0;
    this.lufsBins = new Float64Array(30);
    this.integratedCounts = new Float64Array(1024); this.integratedEnergy = new Float64Array(1024);
    this.rangeCounts = new Float64Array(1024);
    this.rmsSum = 0; this.lufsSum = 0; this.lufsCount = 0; this.rangeSum = 0; this.rangeCount = 0;
    this.rmsMomentary = this.rmsIntegrated = this.lufsMomentary = this.lufsShort = this.lufsIntegrated = null;
    this.lra = this.lraLow = this.lraHigh = null;
    this.maxRmsMomentary = this.maxLufsMomentary = this.maxLufsShort = -Infinity;
  }
  process(input, frames) {
    const decay = .5 ** (frames / this.rate / .15);
    const [a1, a2, b0, b1, b2] = this.shelf, [c1, c2] = this.highpass;
    for (const channel of this.channels) { channel.peak *= decay; channel.truePeak *= decay; }
    for (let i = 0; i < frames; i++) {
      for (let ch = 0; ch < 2; ch++) {
        const channel = this.channels[ch];
        const value = input[ch]?.[i];
        const sample = Number.isFinite(value) ? value : 0;
        const peak = Math.abs(sample);
        channel.peak = Math.max(channel.peak, peak); channel.heldPeak = Math.max(channel.heldPeak, peak);
        if (peak > 1) channel.clips++;
        channel.history[this.historyPosition] = sample;
        let truePeak = Math.abs(channel.history[(this.historyPosition - 16) & 31]);
        for (const coefficients of this.sinc) {
          let interpolated = 0;
          for (let tap = 0; tap < 32; tap++) interpolated += channel.history[(this.historyPosition - tap) & 31] * coefficients[tap];
          truePeak = Math.max(truePeak, Math.abs(interpolated));
        }
        channel.truePeak = Math.max(channel.truePeak, truePeak);
        channel.heldTruePeak = Math.max(channel.heldTruePeak, truePeak);
        if (truePeak > 1) channel.trueClips++;
        channel.sum += sample * sample;
        const shelf = sample - a1 * channel.f1 - a2 * channel.f2;
        const weighted = b0 * shelf + b1 * channel.f1 + b2 * channel.f2;
        channel.f2 = channel.f1; channel.f1 = shelf;
        const highpass = weighted - c1 * channel.h1 - c2 * channel.h2;
        const filtered = highpass - 2 * channel.h1 + channel.h2;
        channel.h2 = channel.h1; channel.h1 = highpass;
        this.weightedSum += filtered * filtered;
      }
      this.historyPosition = (this.historyPosition + 1) & 31;
      if (++this.frame === this.windowFrames) { this.frame = 0; this.finishWindow(); }
    }
  }
  finishWindow() {
    let rmsEnergy = 0;
    for (const channel of this.channels) {
      channel.rmsBins[this.windows % 4] = channel.sum; channel.sum = 0;
      const energy = channel.rmsBins.reduce((sum, value) => sum + value, 0) / (4 * this.windowFrames);
      channel.rms = this.windows >= 3 ? db(energy) : null;
      rmsEnergy += energy;
    }
    this.lufsBins[this.windows % 30] = this.weightedSum; this.weightedSum = 0;
    let momentary = 0;
    for (let i = 0; i < Math.min(4, this.windows + 1); i++) momentary += this.lufsBins[(this.windows - i + 30) % 30];
    momentary /= 4 * this.windowFrames;
    const short = this.lufsBins.reduce((sum, value) => sum + value, 0) / (30 * this.windowFrames);
    this.windows++;
    this.rmsSum += rmsEnergy;
    if (this.windows >= 4) {
      this.rmsMomentary = db(rmsEnergy); this.rmsIntegrated = db(this.rmsSum / this.windows);
      this.maxRmsMomentary = Math.max(this.maxRmsMomentary, this.rmsMomentary);
      this.lufsMomentary = loudness(momentary);
      this.maxLufsMomentary = Math.max(this.maxLufsMomentary, this.lufsMomentary);
      if (this.lufsMomentary >= -70) {
        const index = bin(this.lufsMomentary);
        this.integratedCounts[index]++; this.integratedEnergy[index] += momentary;
        this.lufsSum += momentary; this.lufsCount++;
        const gate = bin(loudness(this.lufsSum / this.lufsCount) - 10);
        let energy = 0, count = 0;
        for (let i = gate; i < 1024; i++) { energy += this.integratedEnergy[i]; count += this.integratedCounts[i]; }
        this.lufsIntegrated = count ? loudness(energy / count) : -Infinity;
      } else if (!this.lufsCount) this.lufsIntegrated = -Infinity;
    }
    if (this.windows >= 30) {
      this.lufsShort = loudness(short);
      this.maxLufsShort = Math.max(this.maxLufsShort, this.lufsShort);
      if (this.lufsShort >= -70) {
        this.rangeCounts[bin(this.lufsShort)]++; this.rangeSum += short; this.rangeCount++;
        const gate = bin(loudness(this.rangeSum / this.rangeCount) - 20);
        let count = 0;
        for (let i = gate; i < 1024; i++) count += this.rangeCounts[i];
        if (count >= 20) {
          let low = gate, high = 1023, accumulated = 0;
          while (low < 1023 && accumulated + this.rangeCounts[low] < count * .1) accumulated += this.rangeCounts[low++];
          accumulated = 0;
          while (high > gate && accumulated + this.rangeCounts[high] < count * .05) accumulated += this.rangeCounts[high--];
          this.lraLow = low / 10 - 70; this.lraHigh = high / 10 - 70;
          this.lra = this.lraHigh - this.lraLow;
        }
      }
    }
  }
  snapshot() {
    return { channels: this.channels.map(channel => ({
      peak: db(channel.peak ** 2), heldPeak: db(channel.heldPeak ** 2),
      truePeak: db(channel.truePeak ** 2), heldTruePeak: db(channel.heldTruePeak ** 2),
      clips: channel.clips, trueClips: channel.trueClips, rms: channel.rms,
    })), rmsMomentary: this.rmsMomentary, rmsIntegrated: this.rmsIntegrated,
    lufsMomentary: this.lufsMomentary, lufsShort: this.lufsShort, lufsIntegrated: this.lufsIntegrated,
    maxRmsMomentary: this.maxRmsMomentary, maxLufsMomentary: this.maxLufsMomentary, maxLufsShort: this.maxLufsShort,
    lra: this.lra, lraLow: this.lraLow, lraHigh: this.lraHigh,
    duration: (this.windows * this.windowFrames + this.frame) / this.rate };
  }
}
