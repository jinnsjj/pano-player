import { createRouting, validRouting } from '../media/channel-routing.js';

// Rows are output slots; multiple selected inputs sum at unity gain.
export class ChannelMatrix {
  constructor(channels, sampleRate) {
    this.channels = channels;
    this.fadeFrames = Math.max(1, Math.round(sampleRate * .005));
    this.samples = new Float32Array(channels);
    this.configure(createRouting(channels), false);
  }
  configure(config, playing) {
    if (!validRouting(config, this.channels)) return false;
    const matrix = config.enabled ? config.matrix : createRouting(this.channels).matrix;
    const target = matrix.map(row => row.flatMap((gain, input) => gain ? [{ input, gain, target: gain, step: 0 }] : []));
    if (playing) {
      this.routes = matrix.map((row, output) => row.flatMap((gain, input) => {
        const current = this.routes[output].find(route => route.input === input)?.gain || 0;
        return current || gain ? [{ input, gain: current, target: gain, step: (gain - current) / this.fadeFrames }] : [];
      }));
      this.remaining = this.fadeFrames;
    } else { this.routes = target; this.remaining = 0; }
    this.target = target;
    return true;
  }
  render(output, frame) {
    for (let channel = 0; channel < output.length; channel++) {
      let value = 0;
      for (const route of this.routes[channel]) {
        if (this.remaining) route.gain += route.step;
        value += this.samples[route.input] * route.gain;
      }
      output[channel][frame] = value;
    }
    if (this.remaining && --this.remaining === 0) this.routes = this.target;
  }
}
