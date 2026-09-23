import { PowermapService } from './powermap/powermap-service.js';
import { colourizeMap } from './powermap/powermap-renderer.js';

async function loadScriptBlob(url, signal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Cannot load audio processor (${response.status}).`);
  return URL.createObjectURL(new Blob([await response.text()], { type: 'text/javascript' }));
}

export class FoaMonitor {
  constructor(video, onError, onMap = () => {}) {
    this.video = video; this.onError = onError; this.onMap = onMap;
    this.mode = 'binaural'; this.volume = 1; this.muted = false;
    this.order = 'WYZX'; this.enabled = false; this.generation = 0;
    this.mapAlgorithm = 'music'; this.mapSources = 1;
    this.normalization = 'SN3D';
    this.ready = false; this.state = 'initializing'; this.channelCount = null;
    this.meterEnabled = false; this.meterEpoch = 0; this.meterData = null; this.meterStatus = 'off';
    this.events = new AbortController();
    for (const type of ['play', 'playing']) video.addEventListener(type, () => {
      if (type === 'playing') this.reset();
      if (type === 'play') this.resetMeter();
      void this.context?.resume().catch(error => this.report(error));
    }, { signal: this.events.signal });
    video.addEventListener('seeking', () => this.resetMeter(), { signal: this.events.signal });
    for (const type of ['pause', 'ended']) video.addEventListener(type, () => {
      void this.context?.suspend().catch(error => this.report(error));
    }, { signal: this.events.signal });
    this.applyGain();
  }
  report(error) { if (!this.disposed) this.onError(error); }
  prepare() {
    if (this.initialized) return this.initialized;
    this.initialized = this.initialize().catch(error => {
      this.state = 'unavailable'; this.ready = false; this.applyGain(); this.report(error);
      if (this.video.attach) this.video.fail(error);
    });
    return this.initialized;
  }
  async initialize() {
    if (this.video.attach) {
      await this.video.metadata;
      if (this.disposed) return;
      if (this.video.channels === 0) {
        this.noAudio = true; this.channelCount = 0; this.ready = true; this.state = 'no-audio';
        return;
      }
    }
    this.context = new AudioContext();
    // The optional meter tap leaves all audible playback routes unchanged.
    this.meterInput = this.context.createGain();
    this.meterInput.channelCount = 2; this.meterInput.channelCountMode = 'explicit';
    if (this.meterEnabled) void this.prepareMeter();
    if (this.video.attach) {
      if (this.video.channels !== 4) {
        this.bypass = true; this.channelCount = this.video.channels;
        this.fallback = this.context.createGain(); this.fallback.connect(this.context.destination);
        this.fallback.connect(this.meterInput);
        this.applyGain();
        await this.video.attach(this.context, this.fallback);
        if (this.disposed) return;
        this.source = this.video.node; this.ready = true; this.state = 'bypass'; this.applyGain();
        if (!this.video.paused) await this.context.resume(); else await this.context.suspend();
        return;
      }
    }
    this.renderer = Omnitone.createFOARenderer(this.context, { channelMap: [0, 1, 2, 3] });
    const signal = this.events.signal;
    const workletUrl = await loadScriptBlob(this.video.dataset.worklet, signal);
    try {
      await Promise.all([this.renderer.initialize(), this.context.audioWorklet.addModule(workletUrl)]);
    } finally { URL.revokeObjectURL(workletUrl); }
    if (this.disposed) return;
    this.capture = new AudioWorkletNode(this.context, 'foa-capture-processor', {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [4],
      channelCountMode: 'max', channelInterpretation: 'discrete',
      processorOptions: { frameSize: 1024 },
    });
    this.capture.port.onmessage = ({ data }) => this.frame(data);
    this.capture.addEventListener('processorerror', () => {
      this.ready = false; this.state = 'unavailable'; this.applyGain();
      const error = new Error('Audio processor failed.');
      this.report(error);
      if (this.video.attach) this.video.fail(error);
    }, { signal });
    this.capture.connect(this.renderer.input);
    this.output = this.context.createGain(); this.output.gain.value = 0;
    this.renderer.output.connect(this.output); this.output.connect(this.context.destination);
    this.fallback = this.context.createGain(); this.fallback.connect(this.context.destination);
    this.stereo = this.context.createGain(); this.stereo.gain.value = 0;
    this.stereo.connect(this.context.destination);
    for (const node of [this.output, this.fallback, this.stereo]) node.connect(this.meterInput);
    const splitter = this.context.createChannelSplitter(4);
    const merger = this.context.createChannelMerger(2);
    this.capture.connect(splitter);
    // Existing monitor convention: L/R = .5W + .25X +/- .25Y (SN3D).
    for (const [channel, left, right] of [[0, .5, .5], [3, .25, .25], [1, .25, -.25]]) {
      for (const [side, scale] of [left, right].entries()) {
        const gain = this.context.createGain(); gain.gain.value = scale;
        splitter.connect(gain, channel); gain.connect(merger, 0, side);
      }
    }
    merger.connect(this.stereo);
    if (this.orientation) this.renderer.setRotationMatrixFromCamera(this.orientation);
    this.configure();
    // Only intercept native audio after every playback node is connected.
    if (this.video.attach) {
      await this.video.attach(this.context, this.capture);
      this.source = this.video.node;
    } else {
      this.source = this.context.createMediaElementSource(this.video);
      this.source.connect(this.capture); this.source.connect(this.fallback);
    }
    this.state = 'checking-channels'; this.applyGain();
    if (!this.video.paused) await this.context.resume();
    else await this.context.suspend();
    this.mapLoading = this.initializeMap().catch(error => this.report(error));
  }
  async initializeMap() {
    const url = await loadScriptBlob(this.video.dataset.worker, this.events.signal);
    try {
      if (this.disposed) return;
      const worker = new Worker(url);
      this.service = new PowermapService({ workerUrl: url, workerFactory: () => worker });
      worker.addEventListener('error', event => {
        this.service?.dispose(); this.service = undefined;
        this.report(new Error(event.message || 'PowerMap worker failed; media playback is unaffected.'));
      });
      this.service.register({ sessionId: 'preview' });
    } finally { URL.revokeObjectURL(url); }
  }
  configure() {
    this.capture?.port.postMessage({ type: 'configure', enabled: true,
      normalization: this.normalization,
      channelMap: this.order === 'WXYZ' ? [0, 2, 3, 1] : [0, 1, 2, 3],
      intervalFrames: Math.round((this.context?.sampleRate || 48000) * .14), epoch: this.generation });
  }
  reset() {
    this.generation++;
    this.capture?.port.postMessage({ type: 'reset', epoch: this.generation });
    this.service?.reset('preview');
  }
  setOrder(order) {
    if (!['WYZX', 'WXYZ'].includes(order)) return;
    if (this.order !== order) this.resetMeter();
    this.order = order; this.reset(); this.configure();
  }
  setEnabled(enabled) { this.enabled = Boolean(enabled); this.reset(); }
  setPowermap(algorithm, numSources) {
    if (!['music', 'pwd'].includes(algorithm) || ![1, 2].includes(numSources)) return;
    if (this.mapAlgorithm === algorithm && this.mapSources === numSources) return;
    this.mapAlgorithm = algorithm; this.mapSources = numSources; this.reset();
  }
  setNormalization(normalization) {
    if (!['SN3D', 'N3D'].includes(normalization) || normalization === this.normalization) return;
    this.normalization = normalization; this.reset(); this.configure(); this.resetMeter();
  }
  async frame(data) {
    if (this.bypass || this.noAudio) return;
    if (this.disposed || data.epoch !== this.generation || this.video.paused || this.video.readyState < 2) return;
    if (data.type === 'error') {
      this.channelCount = data.channelCount; this.ready = false; this.state = 'unsupported-channels';
      this.applyGain();
      // A media source can expose default silent channels when its audio codec is unsupported.
      const missingAac = /\.mp4(?:[?#]|$)/i.test(this.video.currentSrc || this.video.src || '') &&
        this.video.canPlayType?.('audio/mp4; codecs="mp4a.40.2"') === '';
      const hint = missingAac ? ' This browser does not support AAC; the MP4 audio track may be unavailable.' :
        ' Check source channels and browser codec support.';
      this.report(new Error(`Web Audio exposes ${data.channelCount} channels; 4 are required. PowerMap and binaural audio disabled.${hint}`));
      return;
    }
    if (data.type !== 'frame') return;
    this.channelCount = 4; this.ready = true; this.state = 'ready'; this.applyGain();
    if (!this.enabled || !this.service || this.video.paused || this.video.seeking) return;
    const generation = this.generation;
    const time = this.video.currentTime;
    const started = performance.now();
    try {
      const result = await this.service.requestMap('preview', time, {
        channels: data.channels, sampleRate: this.context.sampleRate,
        algorithm: this.mapAlgorithm, numSources: this.mapSources, mapAverage: .666,
      });
      if (!result || this.disposed || generation !== this.generation || !this.enabled) return;
      this.onMap({ generation, time, rgba: colourizeMap(result.map), computeMs: performance.now() - started });
    } catch (error) { this.report(error); }
  }
  setOrientation(matrix) {
    this.orientation = matrix;
    if (this.source) this.renderer?.setRotationMatrixFromCamera(matrix);
  }
  setMode(mode) {
    if (!['stereo', 'binaural'].includes(mode)) return;
    if (this.mode !== mode) this.resetMeter();
    this.mode = mode; this.applyGain();
  }
  setVolume(value) { this.volume = Math.max(0, Math.min(1, value)); this.applyGain(); }
  setMuted(value) { this.muted = Boolean(value); this.applyGain(); }
  prepareMeter() {
    if (!this.context || this.disposed) return;
    return this.meterLoading ||= (async () => {
      this.meterStatus = 'loading';
      const url = await loadScriptBlob(new URL('level-meter-processor.js', this.video.dataset.worklet).href, this.events.signal);
      try { await this.context.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
      if (this.disposed) return;
      this.meterNode = new AudioWorkletNode(this.context, 'level-meter-processor', {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
        channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers',
      });
      this.meterNode.port.onmessage = ({ data }) => {
        if (!this.disposed && this.meterEnabled && data.epoch === this.meterEpoch) this.meterData = data.data;
      };
      this.meterNode.onprocessorerror = () => { this.meterStatus = 'unavailable'; this.meterData = null; };
      this.meterInput.connect(this.meterNode);
      // The worklet emits silence, ensuring it is pulled without doubling the audio.
      this.meterNode.connect(this.context.destination);
      this.meterStatus = 'ready'; this.resetMeter();
    })().catch(() => { if (!this.disposed) { this.meterStatus = 'unavailable'; this.meterData = null; } });
  }
  resetMeter() {
    this.meterData = null; this.meterEpoch++;
    this.meterNode?.port.postMessage({ type: 'configure', enabled: this.meterEnabled, epoch: this.meterEpoch });
  }
  setMeterEnabled(enabled) {
    if (this.meterEnabled === Boolean(enabled)) return;
    this.meterEnabled = Boolean(enabled); this.resetMeter();
    if (this.meterEnabled) void this.prepareMeter();
  }
  getMeterState() {
    return { status: this.meterStatus, data: this.meterData, active: this.context?.state === 'running' &&
      !this.disposed && !this.video.paused && !this.video.seeking && !this.video.error };
  }
  applyGain() {
    const volume = this.muted ? 0 : this.volume;
    this.video.volume = this.source ? 1 : volume;
    if (this.fallback) this.fallback.gain.value = this.bypass || !this.ready ? volume : 0;
    if (this.output) this.output.gain.value = this.ready && this.mode === 'binaural' ? volume : 0;
    if (this.stereo) this.stereo.gain.value = this.ready && this.mode === 'stereo' ? volume : 0;
  }
  async resume() { await this.prepare(); await this.context?.resume(); }
  async selectAudioTrack(index) {
    if (this.switchingTrack) return this.switchingTrack;
    if (index === this.video.audioTrackIndex && !this.video.error) return;
    if (!Number.isInteger(index) || !this.video.audioTracks?.[index]?.supported) throw new Error('Unsupported audio track.');
    const playing = !this.video.paused;
    this.video.pause();
    this.switchingTrack = (async () => {
      await this.initialized;
      await Promise.all([this.mapLoading, this.meterLoading]);
      if (this.disposed) return;
      this.reset(); this.resetMeter(); this.service?.dispose();
      if (this.capture) this.capture.port.onmessage = null;
      if (this.meterNode) this.meterNode.port.onmessage = null;
      await this.context?.close();
      if (this.disposed) return;
      for (const key of ['context', 'source', 'renderer', 'capture', 'output', 'fallback', 'stereo',
        'service', 'mapLoading', 'meterInput', 'meterNode', 'meterLoading', 'initialized']) this[key] = undefined;
      this.ready = this.bypass = this.noAudio = false;
      this.channelCount = null; this.state = 'initializing'; this.meterStatus = 'off';
      await this.video.selectAudioTrack(index);
      if (this.disposed) return;
      await this.prepare();
      if (this.video.error) throw this.video.error;
      if (playing) await this.video.play();
    })();
    try { await this.switchingTrack; } finally { this.switchingTrack = undefined; }
  }
  dispose() {
    this.disposed = true; this.events.abort(); this.service?.dispose();
    this.video.dispose?.();
    if (this.capture) this.capture.port.onmessage = null;
    if (this.meterNode) this.meterNode.port.onmessage = null;
    void this.context?.close();
  }
  getState() {
    return { mode: this.noAudio ? 'none' : this.bypass ? 'bypass' : this.mode, ready: this.ready, state: this.state, channels: this.channelCount,
      normalization: this.normalization,
      sampleRate: this.context?.sampleRate, time: this.video.currentTime, generation: this.generation,
      clock: this.noAudio ? 'video' : this.video.attach ? 'consumed-pcm' : 'native-media', contextState: this.context?.state };
  }
}
if (typeof window !== 'undefined') window.FoaMonitor = FoaMonitor;
