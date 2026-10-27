import { serveResource } from './resource-fetch.js';
import { createHostFetch } from './host-fetch.js';
import { loadWorklet } from './audio-worklet.js';
import { copyRouting, validRouting } from '../media/channel-routing.js';

export class StreamPlayer extends EventTarget {
  constructor(element, api) {
    super(); this.element = element; this.dataset = element.dataset;
    this.file = api?.file;
    this.audioOnly = Boolean(api?.audioOnly);
    this.deferEnvelope = Boolean(api?.deferEnvelope);
    this.audioTrackIndex = api?.audioTrackIndex;
    this.paused = true; this.readyState = 0; this.epoch = 0; this.time = api?.time ?? 0; this.duration = NaN;
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
      this.decoderSource = await response.text();
      const url = URL.createObjectURL(new Blob([this.decoderSource], { type: 'text/javascript' }));
      if (this.disposed) { URL.revokeObjectURL(url); return; }
      this.worker = new Worker(url); URL.revokeObjectURL(url);
      this.worker.onerror = event => this.fail(new Error(event.message));
      this.worker.onmessage = ({ data }) => this.receive(data);
      this.worker.postMessage({ type: 'open', url: this.dataset.source, file: this.file,
        audioOnly: this.audioOnly,
        epoch: this.epoch, audioTrackIndex: this.audioTrackIndex, time: this.time,
        libav: new URL('libav-6.10.7.1.5-decoder-aac.js', this.dataset.decoder).href });
    } catch (error) { this.fail(error); }
  }
  startEnvelope() {
    if (!this.channels || !Number.isFinite(this.duration) || this.duration <= 0) return;
    const url = URL.createObjectURL(new Blob([this.decoderSource], { type: 'text/javascript' }));
    const worker = this.envelopeWorker = new Worker(url); URL.revokeObjectURL(url);
    const abort = this.envelopeAbort = new AbortController();
    const finish = () => { worker.terminate(); abort.abort(); };
    worker.onerror = finish;
    worker.onmessage = ({ data }) => {
      if (this.disposed || this.envelopeWorker !== worker) { data.port?.close(); return; }
      if (data.type === 'fetch') {
        void serveResource(data.port, data.url, data.init, abort.signal, this.fetchResource);
      } else if (data.type === 'envelope') {
        this.envelope = data.channels; this.emit('envelope');
        if (data.done) finish();
      } else if (data.type === 'error') finish();
    };
    worker.postMessage({ type: 'open', envelope: true, url: this.dataset.source, file: this.file,
      audioTrackIndex: this.audioTrackIndex,
      libav: new URL('libav-6.10.7.1.5-decoder-aac.js', this.dataset.decoder).href });
  }
  clearEnvelope() {
    this.envelopeWorker?.terminate(); this.envelopeWorker = undefined;
    this.envelopeAbort?.abort(); this.envelope = undefined; this.emit('envelope');
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
      this.audioTracks = data.audioTracks ?? []; this.audioTrackIndex = data.audioTrackIndex;
      this.videoWidth = data.width; this.videoHeight = data.height;
      this.element.width = Math.max(1, data.width); this.element.height = Math.max(1, data.height);
      this.codec = data.codec; this.readyState = 1; this.metadataReady(); this.emit('loadedmetadata');
      this.requestVideo();
      if (!this.deferEnvelope) try { this.startEnvelope(); } catch { this.clearEnvelope(); }
    } else if (data.type === 'audio') {
      if (this.audioSession) return;
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
    await this.metadata;
    if (this.channels === 0) return;
    if (this.channels > 32) throw new Error(`Playback exceeds the browser's 32-channel limit (${this.channels} channels). The audio envelope is still available.`);
    this.context = context;
    await loadWorklet(context, this.dataset.pcm);
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
    if (this.channelRouting) this.setChannelRouting(this.channelRouting);
    this.refill();
    if (!this.paused) this.node.port.postMessage({ type: 'play', epoch: this.epoch });
  }
  setChannelRouting(routing) {
    if (this.audioSession) return this.audioSession.setChannelRouting(routing);
    if (!validRouting(routing, this.channels)) return false;
    this.channelRouting = copyRouting(routing);
    this.node?.port.postMessage({ type: 'routing', routing: this.channelRouting });
    return true;
  }
  refill() {
    if (this.audioSession || !this.node || this.eof || this.audioPending || (this.endFrame / this.sampleRate - this.time) > 2) return;
    this.audioPending = true; this.worker.postMessage({ type: 'audio', epoch: this.epoch });
  }
  requestVideo() {
    if (!this.videoWidth || this.nextFrame || this.videoPending || this.videoEnded) return;
    this.videoPending = true; this.worker.postMessage({ type: 'video', epoch: this.epoch });
  }
  advanceVideoClock() {
    if (this.audioSession || this.channels !== 0 || this.paused || this.clockStartedAt === undefined) return;
    const now = performance.now();
    this.time += (now - this.clockStartedAt) / 1000;
    this.clockStartedAt = now;
    if (Number.isFinite(this.duration)) this.time = Math.min(this.time, this.duration);
    this.emit('timeupdate');
  }
  render() {
    this.audioSession?.advanceVideoClock();
    this.advanceVideoClock();
    const frame = this.nextFrame;
    if (frame && (this.previewFrame || frame.time <= this.time + .025)) {
      this.previewFrame = false;
      this.element.getContext('2d').drawImage(frame.frame, 0, 0, this.element.width, this.element.height);
      frame.frame.close(); this.nextFrame = undefined; this.frames++;
      // A decoded picture is available even while the audio pipeline is initializing.
      this.readyState = Math.max(this.readyState, 2);
      if (this.channels === 0) {
        this.videoEndTime = frame.time + frame.duration;
        if (this.readyState < 3 || this.seeking) {
          this.readyState = 3; this.seeking = false; this.emit('canplay'); this.emit('seeked');
        }
        if (!this.paused && this.clockStartedAt === undefined) this.clockStartedAt = performance.now();
      }
      if (this.time - frame.time > .1) this.dropped++;
      this.emit('loadeddata'); this.requestVideo();
    }
    if (this.channels === 0 && this.videoEnded && !this.paused) {
      const end = Number.isFinite(this.duration) ? this.duration : this.videoEndTime ?? this.time;
      if (this.time >= end) {
        this.pause(); this.time = this.duration = end; this.ended = true; this.seeking = false;
        this.emit('ended');
      }
    }
  }
  async play() {
    if (this.audioSession) {
      if (this.ended) await this.seek(0);
      return this.audioSession.play();
    }
    if (this.error) throw this.error;
    if (this.ended) await this.seek(0);
    this.paused = false; this.emit('play');
    if (this.channels === 0 && (!this.previewFrame || this.audioOnly)) this.clockStartedAt = performance.now();
    await this.context?.resume();
    this.node?.port.postMessage({ type: 'play', epoch: this.epoch });
    this.emit('playing');
  }
  pause() {
    if (this.audioSession) { this.audioSession.pause(); return; }
    if (this.paused) return;
    this.advanceVideoClock(); this.clockStartedAt = undefined;
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
    this.clockStartedAt = undefined; this.videoEndTime = undefined;
    this.node?.port.postMessage({ type: 'seek', frame: Math.round(this.time * this.sampleRate), epoch: this.epoch });
    this.worker.postMessage({ type: 'seek', time: this.time, epoch: this.epoch });
    if (this.audioSession) {
      this.requestVideo();
      await this.audioSession.seek(this.time);
      return;
    }
    this.emit('seeking'); this.refill(); this.requestVideo();
    if (this.audioOnly && this.channels === 0) {
      this.seeking = false;
      if (!this.paused) this.clockStartedAt = performance.now();
      this.emit('seeked');
    }
    if (!this.paused) this.node?.port.postMessage({ type: 'play', epoch: this.epoch });
  }
  getVideoPlaybackQuality() { return { totalVideoFrames: this.frames, droppedVideoFrames: this.dropped }; }
  alignAudio(time) {
    const frame = Math.round(time * this.sampleRate);
    if (!this.node || frame < Math.round(this.time * this.sampleRate) || frame >= this.endFrame) {
      throw new Error('The replacement audio is not buffered at the playback position.');
    }
    this.time = frame / this.sampleRate;
    this.node.port.postMessage({ type: 'align', frame, epoch: this.epoch });
  }
  useAudioSession(session) {
    this.audioEvents?.abort();
    this.clearEnvelope();
    if (!this.audioSession) {
      const node = this.node;
      if (node) { node.port.onmessage = null; setTimeout(() => node.disconnect(), 15); }
      this.node = undefined;
      this.worker.postMessage({ type: 'drop-audio' });
      this.originalDuration = this.duration;
    }
    this.audioSession = session;
    this.audioEvents = new AbortController();
    for (const key of ['channels', 'sampleRate', 'audioTracks', 'audioTrackIndex', 'codec']) this[key] = session[key];
    this.duration = Number.isFinite(this.originalDuration) && Number.isFinite(session.duration)
      ? Math.min(this.originalDuration, session.duration) : this.originalDuration;
    const sync = () => {
      this.time = session.currentTime; this.paused = session.paused;
      this.ended = session.ended; this.seeking = session.seeking;
    };
    sync();
    for (const type of ['timeupdate', 'play', 'playing', 'pause', 'waiting', 'ended', 'seeking', 'seeked', 'error', 'envelope']) {
      session.addEventListener(type, () => {
        sync();
        if (type === 'error') this.error = session.error;
        if (type === 'envelope') this.envelope = session.envelope;
        if (type === 'timeupdate' && this.time >= this.duration && !session.paused) {
          session.pause(); this.time = this.duration; this.ended = true; this.emit('ended');
        }
        this.emit(type);
      }, { signal: this.audioEvents.signal });
    }
    this.emit('loadedmetadata');
    session.startEnvelope();
  }
  dispose() {
    if (this.disposed) return;
    this.audioEvents?.abort(); this.audioSession?.dispose();
    this.disposed = true; this.abort.abort(); this.worker?.terminate();
    this.clearEnvelope();
    this.nextFrame?.frame.close(); this.node?.disconnect();
    if (this.node) this.node.port.onmessage = null;
  }
}
window.StreamPlayer = StreamPlayer;
