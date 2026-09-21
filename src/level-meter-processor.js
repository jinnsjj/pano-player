import { LoudnessMeter } from './loudness-meter.js';

class LevelMeterProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.meter = new LoudnessMeter(sampleRate);
    this.enabled = false; this.epoch = 0; this.frames = 0;
    this.port.onmessage = ({ data }) => {
      if (!Number.isInteger(data?.epoch) || !['configure', 'reset'].includes(data.type)) return;
      this.epoch = data.epoch;
      if (data.type === 'configure') this.enabled = Boolean(data.enabled);
      this.meter.reset(); this.frames = 0;
      this.port.postMessage({ epoch: this.epoch, data: this.meter.snapshot() });
    };
  }
  process(inputs, outputs) {
    const output = outputs[0]?.[0];
    output?.fill(0);
    if (!this.enabled) return true;
    const frames = output?.length || inputs[0]?.[0]?.length || 128;
    this.meter.process(inputs[0] || [], frames);
    this.frames += frames;
    if (this.frames >= sampleRate * .05) {
      this.frames %= Math.round(sampleRate * .05);
      this.port.postMessage({ epoch: this.epoch, data: this.meter.snapshot() });
    }
    return true;
  }
}
registerProcessor('level-meter-processor', LevelMeterProcessor);
