import { serveResource } from './resource-fetch.js';
import { createHostFetch } from './host-fetch.js';

export class StreamPlayer extends EventTarget {
  constructor(element, api) {
    super(); this.element = element; this.dataset = element.dataset;
    this.paused = true; this.readyState = 0; this.epoch = 0; this.time = 0; this.duration = NaN;
    this.videoWidth = 0; this.videoHeight = 0; this.frames = 0; this.dropped = 0;
    this.previewFrame = true;
    this.abort = new AbortController();
    this.fetchResource = api && this.dataset.host === '1' ? createHostFetch(api, this.dataset.source, this.abort.signal) : fetch;
    this.metadata = new Promise((resolve, reject) => { this.metadataReady = resolve; this.metadataError = reject; });
    this.metadata.catch(() => {});
    this.load();
  }
  get hidden() { return this.element.hidden; }
  set hidden(value) { this.element.hidden = value; }
  get currentTime() { return this.time; }
  set currentTime(value) { void this.seek(value).catch(error => this.fail(error)); }
  emit(type) { this.dispatchEvent(new Event(type)); }
  fail(error) {
    if (this.disposed) return;
    this.error = error; this.metadataError(error); this.pause(); this.emit('error');
  }
  async load() {
    try {
      const response = await fetch(this.dataset.decoder, { signal: this.abort.signal });
      if (!response.ok) throw new Error(`Cannot load bundled decoder (${response.status}).`);
      const url = URL.createObjectURL(new Blob([await response.text()], { type: 'text/javascript' }));
      this.worker = new Worker(url); URL.revokeObjectURL(url);
      this.worker.onerror = event => this.fail(new Error(event.message));
      this.worker.onmessage = ({ data }) => this.receive(data);
      this.worker.postMessage({ type: 'open', url: this.dataset.source,
        libav: new URL('libav-6.10.7.1.5-decoder-aac.js', this.dataset.decoder).href });
    } catch (error) { this.fail(error); }
  }
  receive(data) {
    if (data.type === 'fetch') {
      if (this.disposed) { data.port.close(); return; }
      void serveResource(data.port, data.url, data.init, this.abort.signal, this.fetchResource); return;
    }
    if (this.disposed || data.epoch !== this.epoch) { data.frame?.close(); return; }
    if (data.type === 'error') { this.fail(new Error(data.message)); return; }
    if (data.type === 'metadata') {
      this.sampleRate = data.sampleRate; this.duration = data.duration ?? NaN;
      this.channels = data.channels;
      this.videoWidth = data.width; this.videoHeight = data.height;
      this.element.width = Math.max(1, data.width); this.element.height = Math.max(1, data.height);
      this.codec = data.codec; this.readyState = 1; this.metadataReady(); this.emit('loadedmetadata');
      this.requestVideo();
    } else if (data.type === 'audio') {
      this.audioPending = false; this.endFrame = data.endFrame; this.eof = data.eof;
      this.node.port.postMessage({ type: 'chunk', channels: data.channels, epoch: this.epoch }, data.channels.map(channel => channel.buffer));
      if (data.eof) this.node.port.postMessage({ type: 'eof', epoch: this.epoch });
      if (this.readyState < 3 || this.seeking) {
        this.readyState = 3; this.seeking = false; this.emit('canplay'); this.emit('seeked');
        if (!this.videoWidth) this.emit('loadeddata');
      }
      this.refill();
    } else if (data.type === 'video') {
      this.videoPending = false; this.nextFrame = data;
      this.render();
    } else if (data.type === 'video-end') { this.videoPending = false; this.videoEnded = true; }
  }
  async attach(context, destination) {
    this.context = context;
    await this.metadata;
    const response = await fetch(this.dataset.pcm, { signal: this.abort.signal });
    if (!response.ok) throw new Error('Cannot load PCM audio worklet.');
    const url = URL.createObjectURL(new Blob([await response.text()], { type: 'text/javascript' }));
    try { await context.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
    if (this.disposed) return;
    this.node = new AudioWorkletNode(context, 'wav-stream-processor', {
      numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [this.channels], channelInterpretation: 'discrete',
      processorOptions: { channels: this.channels, sourceSampleRate: this.sampleRate, capacityFrames: this.sampleRate * 4,
        lowWatermarkFrames: this.sampleRate, timeUpdateSeconds: .02 },
    });
    this.node.connect(destination);
    this.node.onprocessorerror = () => this.fail(new Error('PCM playback processor failed.'));
    this.node.port.onmessage = ({ data }) => {
      if (data.epoch !== this.epoch) return;
      if (data.type === 'time') { this.time = data.frame / this.sampleRate; this.emit('timeupdate'); this.refill(); }
      if (data.type === 'need-data') this.refill();
      if (data.type === 'waiting') this.emit('waiting');
      if (data.type === 'error') this.fail(new Error(data.message));
      if (data.type === 'ended') {
        this.time = data.frame / this.sampleRate; this.duration = this.time;
        this.ended = true; this.pause(); this.emit('ended');
      }
    };
    this.node.port.postMessage({ type: 'seek', frame: Math.round(this.time * this.sampleRate), epoch: this.epoch });
    this.refill();
    if (!this.paused) this.node.port.postMessage({ type: 'play', epoch: this.epoch });
  }
  refill() {
    if (!this.node || this.eof || this.audioPending || (this.endFrame / this.sampleRate - this.time) > 2) return;
    this.audioPending = true; this.worker.postMessage({ type: 'audio', epoch: this.epoch });
  }
  requestVideo() {
    if (!this.videoWidth || this.nextFrame || this.videoPending || this.videoEnded) return;
    this.videoPending = true; this.worker.postMessage({ type: 'video', epoch: this.epoch });
  }
  render() {
    const frame = this.nextFrame;
    if (frame && (this.previewFrame || frame.time <= this.time + .025)) {
      this.previewFrame = false;
      this.element.getContext('2d').drawImage(frame.frame, 0, 0, this.element.width, this.element.height);
      frame.frame.close(); this.nextFrame = undefined; this.frames++;
      if (this.time - frame.time > .1) this.dropped++;
      this.emit('loadeddata'); this.requestVideo();
    }
  }
  async play() {
    if (this.error) throw this.error;
    if (this.ended) await this.seek(0);
    this.paused = false; this.emit('play');
    await this.context?.resume();
    this.node?.port.postMessage({ type: 'play', epoch: this.epoch });
    this.emit('playing');
  }
  pause() {
    if (this.paused) return;
    this.paused = true; this.node?.port.postMessage({ type: 'pause', epoch: this.epoch }); this.emit('pause');
  }
  async seek(value) {
    if (!Number.isFinite(value)) return;
    await this.metadata;
    this.time = Math.max(0, Math.min(value, Number.isFinite(this.duration) ? this.duration : value));
    this.epoch++; this.seeking = true; this.ended = false; this.eof = false;
    this.endFrame = this.time * this.sampleRate; this.audioPending = false;
    this.nextFrame?.frame.close(); this.nextFrame = undefined; this.videoPending = false; this.videoEnded = false;
    this.previewFrame = true;
    this.node?.port.postMessage({ type: 'seek', frame: Math.round(this.time * this.sampleRate), epoch: this.epoch });
    this.worker.postMessage({ type: 'seek', time: this.time, epoch: this.epoch });
    this.emit('seeking'); this.refill(); this.requestVideo();
    if (!this.paused) this.node?.port.postMessage({ type: 'play', epoch: this.epoch });
  }
  getVideoPlaybackQuality() { return { totalVideoFrames: this.frames, droppedVideoFrames: this.dropped }; }
  dispose() {
    this.disposed = true; this.abort.abort(); this.worker?.terminate();
    this.nextFrame?.frame.close(); this.node?.disconnect();
    if (this.node) this.node.port.onmessage = null;
  }
}
window.StreamPlayer = StreamPlayer;
