class FoaCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.frameSize = Math.max(1, options?.processorOptions?.frameSize ?? 1024);
    this.buffers = Array.from(
      { length: 4 },
      () => new Float32Array(this.frameSize),
    );
    this.enabled = false;
    this.intervalFrames = this.frameSize;
    this.channelMap = [0, 1, 2, 3];
    this.directionScale = 1;
    this.writeIndex = 0;
    this.filled = 0;
    this.framesSinceEmit = 0;
    this.hasEmitted = false;
    this.channelErrorReported = false;
    this.epoch = 0;
    this.port.onmessage = ({ data }) => this.handleMessage(data);
  }

  handleMessage(message) {
    if (Number.isInteger(message?.epoch)) this.epoch = message.epoch;
    if (message?.type === 'configure') {
      this.enabled = Boolean(message.enabled);
      if (['SN3D', 'N3D'].includes(message.normalization)) {
        // FOA N3D -> SN3D: W is unchanged; first-order channels divide by sqrt(3).
        this.directionScale = message.normalization === 'N3D' ? 1 / Math.sqrt(3) : 1;
      }
      if (Array.isArray(message.channelMap)
          && message.channelMap.length === 4
          && new Set(message.channelMap).size === 4
          && message.channelMap.every((channel) => Number.isInteger(channel)
            && channel >= 0 && channel < 4)) {
        this.channelMap = message.channelMap.slice();
      }
      this.intervalFrames = Math.max(
        this.frameSize,
        Math.round(Number(message.intervalFrames) || this.frameSize),
      );
      if (!this.enabled) this.resetBuffer();
    } else if (message?.type === 'reset') {
      this.resetBuffer();
    }
  }

  resetBuffer() {
    this.writeIndex = 0;
    this.filled = 0;
    this.framesSinceEmit = 0;
    this.hasEmitted = false;
    this.channelErrorReported = false;
  }

  passThrough(input, output) {
    for (let channel = 0; channel < output.length; channel += 1) {
      const source = input[this.channelMap[channel]];
      if (source) {
        const scale = channel === 0 ? 1 : this.directionScale;
        for (let sample = 0; sample < source.length; sample++) output[channel][sample] = source[sample] * scale;
      }
      else output[channel].fill(0);
    }
  }

  emitFrame() {
    const channels = this.buffers.map((buffer) => {
      const frame = new Float32Array(this.frameSize);
      const tailLength = this.frameSize - this.writeIndex;
      frame.set(buffer.subarray(this.writeIndex), 0);
      frame.set(buffer.subarray(0, this.writeIndex), tailLength);
      return frame;
    });
    this.port.postMessage({ type: 'frame', channels, epoch: this.epoch }, channels.map((channel) => channel.buffer));
    this.framesSinceEmit = 0;
    this.hasEmitted = true;
  }

  process(inputs, outputs) {
    const input = inputs[0] ?? [];
    const output = outputs[0] ?? [];
    this.passThrough(input, output);
    if (!this.enabled || input.length === 0) return true;
    if (input.length !== 4) {
      if (!this.channelErrorReported) {
        this.port.postMessage({
          type: 'error',
          code: 'channel-count',
          channelCount: input.length,
          epoch: this.epoch,
        });
        this.channelErrorReported = true;
      }
      return true;
    }

    const quantumLength = input[0].length;
    for (let sample = 0; sample < quantumLength; sample += 1) {
      for (let channel = 0; channel < 4; channel += 1) {
        this.buffers[channel][this.writeIndex] = input[this.channelMap[channel]][sample]
          * (channel === 0 ? 1 : this.directionScale);
      }
      this.writeIndex = (this.writeIndex + 1) % this.frameSize;
      this.filled = Math.min(this.frameSize, this.filled + 1);
      this.framesSinceEmit += 1;
      if (this.filled === this.frameSize
          && (!this.hasEmitted || this.framesSinceEmit >= this.intervalFrames)) {
        this.emitFrame();
      }
    }
    return true;
  }
}

registerProcessor('foa-capture-processor', FoaCaptureProcessor);
