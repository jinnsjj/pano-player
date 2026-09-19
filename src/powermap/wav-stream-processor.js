class WavStreamProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const config = options?.processorOptions ?? {};
    this.channels = config.channels ?? 4;
    if (![1, 2, 4].includes(this.channels)) throw new Error('Unsupported PCM channel count.');
    this.sourceSampleRate = Math.max(1, Number(config.sourceSampleRate) || sampleRate);
    this.outputSampleRate = sampleRate;
    this.ratio = this.sourceSampleRate / this.outputSampleRate;
    this.capacityFrames = Math.max(1024, Number(config.capacityFrames) || this.sourceSampleRate * 12);
    this.lowWatermarkFrames = Math.min(
      this.capacityFrames / 2,
      Math.max(256, Number(config.lowWatermarkFrames) || this.sourceSampleRate * 3),
    );
    this.buffers = Array.from(
      { length: this.channels },
      () => new Float32Array(this.capacityFrames),
    );
    this.readIndex = 0;
    this.writeIndex = 0;
    this.availableFrames = 0;
    this.sourceFrame = 0;
    this.phase = 0;
    this.playing = false;
    this.eof = false;
    this.needDataSignaled = false;
    this.endedSignaled = false;
    this.framesSinceTimeUpdate = 0;
    this.timeUpdateFrames = this.outputSampleRate * (Number(config.timeUpdateSeconds) || .1);
    this.epoch = 0;
    this.waiting = false;
    this.port.onmessage = ({ data }) => this.handleMessage(data);
  }

  handleMessage(message) {
    if (message?.type === 'seek') this.epoch = message.epoch ?? this.epoch;
    if (message?.epoch !== undefined && message.epoch !== this.epoch) return;
    switch (message?.type) {
      case 'chunk':
        this.appendChunk(message.channels);
        break;
      case 'eof':
        this.eof = true;
        break;
      case 'play':
        this.playing = true;
        this.endedSignaled = false;
        break;
      case 'pause':
        this.playing = false;
        break;
      case 'seek':
        this.reset(Number(message.frame) || 0);
        break;
      default:
        break;
    }
  }

  reset(frame) {
    this.waiting = false;
    this.readIndex = 0;
    this.writeIndex = 0;
    this.availableFrames = 0;
    this.sourceFrame = Math.max(0, Math.floor(frame));
    this.phase = 0;
    this.playing = false;
    this.eof = false;
    this.needDataSignaled = false;
    this.endedSignaled = false;
    this.framesSinceTimeUpdate = 0;
  }

  appendChunk(channels) {
    if (!Array.isArray(channels)
        || channels.length !== this.channels
        || channels.some((channel) => !(channel instanceof Float32Array))
        || channels.some((channel) => channel.length !== channels[0].length)) {
      this.port.postMessage({ type: 'error', message: 'Invalid PCM stream chunk.', epoch: this.epoch });
      return;
    }
    if (channels[0].length > this.capacityFrames - this.availableFrames) {
      this.port.postMessage({ type: 'error', message: 'PCM stream buffer overflow.', epoch: this.epoch });
      return;
    }
    const frameCount = channels[0].length;
    for (let frame = 0; frame < frameCount; frame += 1) {
      for (let channel = 0; channel < this.channels; channel += 1) {
        this.buffers[channel][this.writeIndex] = channels[channel][frame];
      }
      this.writeIndex = (this.writeIndex + 1) % this.capacityFrames;
    }
    this.availableFrames += frameCount;
    if (frameCount) this.waiting = false;
    this.needDataSignaled = false;
  }

  signalNeedData() {
    if (this.needDataSignaled || this.eof) return;
    this.needDataSignaled = true;
    this.port.postMessage({ type: 'need-data', availableFrames: this.availableFrames, epoch: this.epoch });
  }

  finish() {
    if (this.endedSignaled) return;
    this.playing = false;
    this.endedSignaled = true;
    this.port.postMessage({ type: 'time', frame: this.sourceFrame, epoch: this.epoch });
    this.port.postMessage({ type: 'ended', frame: this.sourceFrame, epoch: this.epoch });
  }

  renderSample(output, outputFrame) {
    if (!this.availableFrames) return false;
    const nextIndex = (this.readIndex + 1) % this.capacityFrames;
    const interpolate = this.phase > 0 && this.availableFrames > 1;
    for (let channel = 0; channel < output.length; channel += 1) {
      const current = this.buffers[channel][this.readIndex];
      const next = interpolate ? this.buffers[channel][nextIndex] : current;
      output[channel][outputFrame] = current + (next - current) * this.phase;
    }
    const nextPhase = this.phase + this.ratio;
    const consumed = Math.floor(nextPhase);
    this.phase = nextPhase - consumed;
    const available = this.availableFrames;
    const actualConsumed = Math.min(consumed, available);
    this.readIndex = (this.readIndex + actualConsumed) % this.capacityFrames;
    this.availableFrames -= actualConsumed;
    this.sourceFrame += actualConsumed;
    return true;
  }

  process(_inputs, outputs) {
    const output = outputs[0] ?? [];
    for (const channel of output) channel.fill(0);
    if (!this.playing || output.length === 0) return true;

    const outputFrames = output[0].length;
    for (let frame = 0; frame < outputFrames; frame += 1) {
      if (!this.renderSample(output, frame)) break;
    }
    this.framesSinceTimeUpdate += outputFrames;
    if (this.framesSinceTimeUpdate >= this.timeUpdateFrames) {
      this.framesSinceTimeUpdate = 0;
      this.port.postMessage({ type: 'time', frame: this.sourceFrame, epoch: this.epoch });
    }
    if (this.eof && this.availableFrames === 0) this.finish();
    else if (this.availableFrames <= this.lowWatermarkFrames) this.signalNeedData();
    if (!this.eof && !this.availableFrames && !this.waiting) {
      this.waiting = true; this.port.postMessage({ type: 'waiting', epoch: this.epoch });
    }
    return true;
  }
}

registerProcessor('wav-stream-processor', WavStreamProcessor);
