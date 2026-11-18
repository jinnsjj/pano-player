const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../src/stream-worker.js'), 'utf8').replace(/^import .*;\n/gm, '');
const settle = () => new Promise(setImmediate);

function worker(options = {}) {
  const sent = [], self = {}, inputs = [], audioStarts = [], videoStarts = [], preparations = [], requests = [], videoSinks = [];
  const originalConfig = { codec: 'hev1.1.6.H183.90', codedWidth: 4096, codedHeight: 4096, ...options.videoConfig };
  const nativeConfig = { codec: 'avc1.640033', codedWidth: 4096, codedHeight: 4096, ...options.nativeConfig };
  const tracks = [2, 2].map((count, index) => ({ codec: 'aac', index,
    getDecoderConfig: async () => ({ codec: 'mp4a.40.2', numberOfChannels: count, sampleRate: 48000 }),
    getName: async () => index ? 'FOA + HL' : 'Stereo', getLanguageCode: async () => 'eng',
  }));
  const originalVideo = { codec: 'hevc', getDecoderConfig: async () => originalConfig };
  const matches = (name, request) => options[name] === true || options[name]?.includes?.(request.index);
  const response = (request, overrides = {}) => ({ ok: !options.notOk,
    body: options.noBody ? null : { request }, headers: { get: () => 'FFmpeg/VideoToolbox' }, ...overrides });
  vm.runInNewContext(source, { self, Float32Array, AbortController, URLSearchParams,
    ALL_FORMATS: [], postMessage(data) { sent.push(data); },
    resourceFetch(url, init) {
      const request = { url, init, index: requests.length };
      requests.push(request);
      if (matches('fetchErrorAt', request) || options.fetchError) return Promise.reject(new Error('System decoder unavailable.'));
      if (options.deferredNativeAt?.includes(request.index)) return new Promise((resolve, reject) => {
        request.resolve = overrides => resolve(response(request, overrides)); request.reject = reject;
      });
      return Promise.resolve(response(request));
    },
    UrlSource: class { constructor(url, options) { this.url = url; this.options = options; } },
    BlobSource: class { constructor(file) { this.file = file; } },
    ReadableStreamSource: class { constructor(body, options) { this.body = body; this.options = options; } },
    Input: class {
      constructor({ source }) {
        this.source = source; this.native = Boolean(source.body); this.disposed = 0; inputs.push(this);
        if (this.native) this.track = { request: source.body.request, codec: options.nativeCodec || 'avc',
          getDecoderConfig: async () => {
            if (options.nativeConfigError) throw new Error('Invalid live description.');
            return nativeConfig;
          },
        };
      }
      async getAudioTracks() { assert.equal(this.native, false, 'Only original audio tracks are enumerated'); return tracks; }
      async getPrimaryAudioTrack() { return tracks[0]; }
      async getPrimaryVideoTrack() {
        if (this.native && options.nativeReadError) throw new Error('Live initialization read failed.');
        return this.native ? this.track : originalVideo;
      }
      async getFormat() { return { name: 'MP4' }; }
      async getDurationFromMetadata() { assert.equal(this.native, false, 'Duration comes only from the original source'); return 40; }
      dispose() { this.disposed++; }
    },
    loadLibav: async () => ({}), getAacChannelCount: async () => 6, setWebmOpusTiming() {},
    VideoDecoder: { isConfigSupported: async config => {
      if (config === nativeConfig && options.avcCheckError) throw new Error('Decoder check failed.');
      return { supported: config === originalConfig ? Boolean(options.nativeHevc) : options.nativeAvc !== false };
    } },
    prepareVideoDecoder: async (codec, config) => {
      preparations.push({ codec, config }); return options.nativeHevc ? 'WebCodecs' : 'FFmpeg/WASM';
    }, cancelHevcDecoding() {},
    AudioSampleSink: class {
      constructor(track) { this.track = track; }
      async *samples(time) {
        audioStarts.push({ time, track: this.track });
        yield { timestamp: time + .12, numberOfChannels: 6, sampleRate: 48000, numberOfFrames: 19200,
          copyTo(buffer, { planeIndex }) { buffer.fill((planeIndex + 1) / 10); }, close() {} };
      }
    },
    VideoSampleSink: class {
      constructor(track, options) { this.track = track; this.options = options; videoSinks.push(this); }
      async *samples(time) {
        videoStarts.push({ time, track: this.track });
        if (this.track.request && options.nativeFrameError) throw new Error('Active system stream failed.');
        yield { timestamp: time, toVideoFrame: () => ({ duration: 33366 }), close() {} };
      }
    },
    scanEnvelope: async (sink, duration, count, update) => {
      assert.equal(sink.track, tracks[1]); assert.equal(duration, 40); assert.equal(count, 6);
      update([], true);
    },
  });
  const message = data => self.onmessage({ data });
  const open = async (extra = {}) => {
    message({ type: 'open', url: 'original.mp4', libav: 'aac.js', hevc: 'hevc.js',
      audioTrackIndex: 1, time: 7, epoch: 4, hostVideo: true, ...extra });
    await settle();
  };
  const pull = async (type, epoch = 4) => { message({ type, epoch }); await settle(); };
  const seek = async (time, epoch) => { message({ type: 'seek', time, epoch }); await settle(); };
  const metadata = () => sent.findLast(data => data.type === 'metadata');
  return { open, pull, seek, message, metadata, sent, inputs, audioStarts, videoStarts, preparations, requests, videoSinks,
    tracks, originalVideo, originalConfig, nativeConfig };
}

test('live AVC preserves original HEVC metadata and six-channel PCM without asking for stream duration or final size', async () => {
  const w = worker({ nativeConfig: { codedWidth: 2048, codedHeight: 2048 } }); await w.open();
  const metadata = w.metadata();
  assert.ok(metadata, JSON.stringify(w.sent));
  assert.equal(metadata.videoCodec, 'hevc'); assert.equal(metadata.videoCodecString, w.originalConfig.codec);
  assert.equal(metadata.videoDecoder, 'FFmpeg/VideoToolbox live + WebCodecs'); assert.equal(metadata.videoLive, true);
  assert.equal(metadata.width, 4096); assert.equal(metadata.height, 4096);
  assert.equal(metadata.renderWidth, 2048); assert.equal(metadata.renderHeight, 2048);
  assert.equal(metadata.duration, 40); assert.equal(metadata.channels, 6); assert.equal(metadata.sampleRate, 48000);
  assert.equal(metadata.audioTrackIndex, 1); assert.equal(metadata.audioTracks.length, 2);
  assert.equal(metadata.audioTracks[1].name, 'FOA + HL'); assert.equal(metadata.audioTracks[1].channels, 6);
  assert.equal(metadata.audioCodecString, 'mp4a.40.2');
  assert.equal(w.preparations.length, 0, 'A usable system stream does not load the WASM video decoder');
  assert.equal(w.requests.length, 1);
  const request = w.requests[0], url = new URL(request.url);
  assert.equal(url.protocol, 'pano-native:'); assert.equal(url.pathname, 'video');
  assert.equal(url.searchParams.get('time'), '7'); assert.equal(url.searchParams.get('width'), '4096');
  assert.equal(url.searchParams.get('height'), '4096'); assert.equal(request.init.signal.aborted, false);
  const nativeInput = w.inputs.find(input => input.native), sink = w.videoSinks[0];
  assert.equal(nativeInput.source.options.maxCacheSize, 8 * 1024 * 1024);
  assert.equal(sink.options.hardwareAcceleration, 'prefer-hardware'); assert.equal(sink.options.optimizeForLatency, true);
  await w.pull('video'); await w.pull('audio');
  assert.equal(w.videoStarts[0].track, nativeInput.track); assert.equal(w.videoStarts[0].time, 7);
  assert.equal(w.audioStarts[0].track, w.tracks[1]); assert.equal(w.audioStarts[0].time, 6.88);
  const audio = w.sent.findLast(data => data.type === 'audio');
  assert.equal(audio.channels.length, 6); assert.equal(audio.endFrame, Math.round(7.4 * 48000));
  for (let ch = 0; ch < 6; ch++) assert.equal(audio.channels[ch][0], Math.fround((ch + 1) / 10));
  assert.equal(w.sent.some(data => data.type === 'error'), false);
});

test('native HEVC, browser, audio-only and envelope workers never start a system video stream', async () => {
  for (const mode of ['native', 'audioOnly', 'envelope', 'browser']) {
    const w = worker({ nativeHevc: mode === 'native' });
    await w.open({ audioOnly: mode === 'audioOnly', envelope: mode === 'envelope', hostVideo: mode !== 'browser' });
    assert.equal(w.requests.length, 0, mode); assert.equal(w.inputs.length, 1, mode);
    if (mode === 'envelope') {
      assert.equal(w.metadata(), undefined); assert.equal(w.inputs[0].disposed, 1);
      assert.equal(w.sent.at(-1).type, 'envelope'); assert.equal(w.sent.at(-1).done, true);
    } else if (mode === 'audioOnly') {
      assert.equal(w.metadata().videoCodec, null); assert.equal(w.metadata().width, 0);
      assert.equal(w.metadata().renderWidth, 0); assert.equal(w.preparations.length, 0);
      assert.equal(w.metadata().videoLive, false);
    } else {
      assert.equal(w.metadata().videoDecoder, mode === 'native' ? 'WebCodecs' : 'FFmpeg/WASM');
      assert.equal(w.preparations[0].config, w.originalConfig);
      assert.equal(w.metadata().renderWidth, 4096); assert.equal(w.metadata().videoLive, false);
    }
  }
});

test('failed system initialization and unsupported AVC fall back without changing original audio or precision', async () => {
  for (const options of [{ fetchError: true }, { notOk: true }, { noBody: true }, { nativeAvc: false },
    { nativeCodec: 'hevc' }, { nativeConfigError: true }, { avcCheckError: true }, { nativeReadError: true }]) {
    const w = worker(options); await w.open();
    const metadata = w.metadata();
    assert.ok(metadata, JSON.stringify(w.sent));
    assert.equal(metadata.videoDecoder, 'FFmpeg/WASM'); assert.equal(metadata.videoLive, false);
    assert.equal(metadata.channels, 6); assert.equal(metadata.width, 4096); assert.equal(metadata.renderWidth, 4096);
    assert.equal(w.preparations.length, 1); assert.equal(w.preparations[0].config, w.originalConfig);
    assert.equal(w.preparations[0].codec, 'hevc'); assert.equal(w.inputs[0].disposed, 0);
    for (const candidate of w.inputs.filter(input => input.native)) assert.equal(candidate.disposed, 1);
    assert.ok(w.requests.every(request => request.init.signal.aborted), 'Failed native sessions are canceled');
    assert.equal(w.sent.findLast(data => data.type === 'video-native-unavailable')?.epoch, 4);
    await w.pull('video'); await w.pull('audio');
    assert.equal(w.videoStarts[0].track, w.originalVideo); assert.equal(w.audioStarts[0].track, w.tracks[1]);
    assert.equal(w.sent.some(data => data.type === 'error'), false);
  }
});

test('Main 10 and HDR preserve source precision instead of starting an eight-bit AVC stream', async () => {
  for (const videoConfig of [{ codec: 'hvc1.2.4.L153.B0' }, { codec: 'hev1.2.4.H183.90' },
    { colorSpace: { transfer: 'smpte2084' } }, { colorSpace: { transfer: 'arib-std-b67' } },
    { colorSpace: { transfer: 'pq' } }, { colorSpace: { transfer: 'hlg' } }]) {
    const w = worker({ videoConfig }); await w.open();
    assert.equal(w.requests.length, 0); assert.equal(w.inputs.length, 1);
    assert.equal(w.metadata().videoDecoder, 'FFmpeg/WASM'); assert.equal(w.metadata().videoLive, false);
    assert.equal(w.preparations[0].config, w.originalConfig);
    assert.equal(w.metadata().videoCodecString, w.originalConfig.codec); assert.equal(w.metadata().renderWidth, 4096);
  }
});

test('live seeks restart at absolute source time, abort and dispose the old stream, and preserve PCM preroll', async () => {
  const w = worker(); await w.open(); await w.pull('video'); await w.pull('audio');
  const firstNative = w.inputs.find(input => input.native);
  await w.seek(12.5, 5); await w.pull('video', 5); await w.pull('audio', 5);
  assert.equal(w.requests.length, 2); assert.equal(w.requests[0].init.signal.aborted, true);
  assert.equal(firstNative.disposed, 1); assert.equal(w.inputs[0].disposed, 0, 'Original audio input stays open');
  assert.equal(new URL(w.requests[1].url).searchParams.get('time'), '12.5');
  const replacement = w.inputs.find(input => input.native && input !== firstNative);
  assert.equal(w.videoStarts.at(-1).track, replacement.track); assert.equal(w.videoStarts.at(-1).time, 12.5);
  assert.equal(w.audioStarts.at(-1).track, w.tracks[1]); assert.equal(w.audioStarts.at(-1).time, 12.38);
  const picture = w.sent.findLast(data => data.type === 'video');
  assert.equal(picture.time, 12.5); assert.equal(picture.epoch, 5);
  assert.equal(w.sent.some(data => data.type === 'error'), false);
});

test('late seek initialization cannot replace the latest epoch or leak its superseded live input', async () => {
  const w = worker({ deferredNativeAt: [1, 2] }); await w.open();
  await w.seek(12.5, 5); await w.seek(3, 6);
  assert.equal(w.requests[1].init.signal.aborted, true);
  w.requests[2].resolve(); await settle(); await w.pull('video', 6);
  const latest = w.inputs.find(input => input.native && input.track.request === w.requests[2]);
  assert.equal(w.videoStarts.at(-1).track, latest.track); assert.equal(w.videoStarts.at(-1).time, 3);
  w.requests[1].resolve(); await settle();
  const stale = w.inputs.find(input => input.native && input.track.request === w.requests[1]);
  assert.equal(stale.disposed, 1); assert.equal(latest.disposed, 0);
  assert.equal(w.sent.findLast(data => data.type === 'video').epoch, 6);
  assert.equal(w.sent.findLast(data => data.type === 'video').time, 3);
  assert.equal(w.sent.some(data => data.type === 'error'), false);
  await w.seek(8, 7); await w.pull('video', 7);
  assert.equal(latest.disposed, 1, 'The next seek still owns and releases the latest committed input');
  assert.equal(w.sent.findLast(data => data.type === 'video').time, 8);
});

test('accepted live stream failures are fatal rather than silently freezing or switching video timelines', async () => {
  const w = worker({ nativeFrameError: true }); await w.open(); await w.pull('video');
  assert.equal(w.metadata().videoLive, true); assert.equal(w.preparations.length, 0);
  assert.equal(w.sent.at(-1).type, 'error'); assert.equal(w.sent.at(-1).message, 'Active system stream failed.');
  assert.equal(w.sent.at(-1).epoch, 4);
});

test('a failed live seek reports the current epoch error while leaving original audio available', async () => {
  const w = worker({ fetchErrorAt: [1] }); await w.open();
  await w.seek(15, 5); await w.pull('video', 5);
  assert.equal(w.sent.at(-1).type, 'error'); assert.equal(w.sent.at(-1).epoch, 5);
  assert.equal(w.sent.at(-1).message, 'System decoder unavailable.');
  assert.equal(w.preparations.length, 0, 'An established live timeline never silently falls back after a seek');
  await w.pull('audio', 5); assert.equal(w.sent.at(-1).type, 'audio');
  assert.equal(w.audioStarts.at(-1).track, w.tracks[1]); assert.equal(w.audioStarts.at(-1).time, 14.88);
});

test('reopening the worker cancels the prior live stream and releases both original and native inputs', async () => {
  const w = worker(); await w.open();
  const [original, native] = w.inputs;
  await w.open({ epoch: 5, time: 10 });
  assert.equal(w.requests[0].init.signal.aborted, true);
  assert.equal(original.disposed, 1); assert.equal(native.disposed, 1);
  assert.equal(w.inputs.length, 4); assert.equal(w.inputs[2].disposed, 0); assert.equal(w.inputs[3].disposed, 0);
  assert.equal(w.metadata().epoch, 5); assert.equal(w.metadata().videoLive, true);
});
