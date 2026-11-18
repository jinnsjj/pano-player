import { Input, UrlSource, BlobSource, ReadableStreamSource, ALL_FORMATS, AudioSampleSink, VideoSampleSink, EncodedPacketSink } from 'mediabunny';
import { getAacChannelCount, setWebmOpusTiming } from './stream-codecs.js';
import { resourceFetch } from './resource-fetch.js';
import { scanEnvelope } from './envelope.js';
import { loadLibav } from './libav-loader.js';
import { prepareVideoDecoder, cancelHevcDecoding } from './hevc-decoder.js';

globalThis.fetch = resourceFetch;

let input, videoInput, audioSink, videoSink, audio, video, pendingAudio, epoch = 0, audioCursor = 0, rate = 48000;
let channelCount = 4;
let nativeVideo, videoAbort, videoReady = Promise.resolve();
const send = (message, transfer = []) => postMessage({ ...message, epoch }, transfer);
function position(time, keepNative = false) {
  if (videoSink) cancelHevcDecoding();
  void audio?.return().catch(() => {}); void video?.return().catch(() => {});
  pendingAudio?.close(); pendingAudio = undefined;
  audioCursor = Math.round(time * rate);
  // Decode a short preroll to restore AAC overlap/Opus prediction before the requested point.
  audio = audioSink?.samples(time - .12);
  if (nativeVideo && !keepNative) {
    video = undefined;
    const generation = epoch;
    videoReady = openNativeVideo(time, generation).then(() => {
      if (generation === epoch) video = videoSink.samples(time);
    });
    videoReady.catch(() => {});
  } else {
    video = videoSink?.samples(time);
    videoReady = Promise.resolve();
  }
}
function createInput(url, file) {
  return new Input({ formats: ALL_FORMATS, source: file ? new BlobSource(file) : new UrlSource(url, {
    maxCacheSize: 8 * 1024 * 1024, getRetryDelay: attempt => attempt < 2 ? .25 : null,
    handleUnhandledError: error => send({ type: 'error', message: error.message }),
  }) });
}
async function openNativeVideo(time, generation) {
  videoAbort?.abort(); videoInput?.dispose(); videoInput = undefined;
  const abort = videoAbort = new AbortController();
  const query = new URLSearchParams({ time, width: nativeVideo.codedWidth, height: nativeVideo.codedHeight });
  const response = await resourceFetch('pano-native:video?' + query, { signal: abort.signal });
  if (!response.ok || !response.body) throw new Error('Cannot open the system video decoder.');
  const candidate = new Input({ formats: ALL_FORMATS,
    source: new ReadableStreamSource(response.body, { maxCacheSize: 8 * 1024 * 1024 }) });
  try {
    const track = await candidate.getPrimaryVideoTrack();
    if (track?.codec !== 'avc') throw new Error('Invalid system video stream codec.');
    const config = await track.getDecoderConfig();
    const supported = await globalThis.VideoDecoder?.isConfigSupported(config).catch(() => null);
    if (!supported?.supported) throw new Error('System H.264 video is not supported by this webview.');
    if (abort.signal.aborted || generation !== epoch) throw new Error('System video stream superseded.');
    videoInput = candidate;
    videoSink = new VideoSampleSink(track, { hardwareAcceleration: 'prefer-hardware', optimizeForLatency: true });
    return { config, backend: response.headers.get('X-Pano-Backend') + ' live + WebCodecs' };
  } catch (error) { candidate.dispose(); abort.abort(); throw error; }
}
async function open(url, libav, selectedTrack, time = 0, envelope = false, file, audioOnly = false, hevc, hostVideo = false) {
  videoAbort?.abort(); nativeVideo = undefined;
  input?.dispose();
  videoInput?.dispose(); videoInput = undefined;
  input = createInput(url, file);
  const tracks = await input.getAudioTracks();
  const audioTracks = await Promise.all(tracks.map(async (track, index) => {
    const config = await track.getDecoderConfig().catch(() => null);
    return { index, name: await track.getName(), language: await track.getLanguageCode(),
      channels: config?.numberOfChannels ?? 0, sampleRate: config?.sampleRate ?? 0,
      codec: track.codec, supported: Number.isInteger(config?.numberOfChannels) && config.numberOfChannels > 0 };
  }));
  if (selectedTrack !== undefined && (!Number.isInteger(selectedTrack) || !audioTracks[selectedTrack]?.supported)) {
    throw new Error('Unsupported audio track.');
  }
  const primary = await input.getPrimaryAudioTrack();
  const primaryIndex = tracks.indexOf(primary);
  const audioTrackIndex = selectedTrack ?? (audioTracks[primaryIndex]?.supported ? primaryIndex : audioTracks.findIndex(track => track.supported));
  const audioTrack = tracks[audioTrackIndex];
  if (tracks.length && !audioTrack) throw new Error('No supported audio track found.');
  const sourceVideoTrack = await input.getPrimaryVideoTrack();
  const videoTrack = audioOnly ? null : sourceVideoTrack;
  if (!audioTrack && !sourceVideoTrack) throw new Error('No audio or video track found.');
  const config = await audioTrack?.getDecoderConfig();
  if (audioTrack?.codec === 'aac') {
    globalThis.foaLibavOptions = await loadLibav(libav);
  }
  const webm = ['WebM', 'Matroska'].includes((await input.getFormat()).name);
  const first = webm && audioTrack?.codec === 'opus' ? await new EncodedPacketSink(audioTrack).getFirstPacket({ metadataOnly: true }) : null;
  setWebmOpusTiming(webm, first?.sequenceNumber);
  if (audioTrack && (!Number.isInteger(config?.numberOfChannels) || config.numberOfChannels <= 0)) throw new Error('Invalid audio channel count.');
  channelCount = audioTrack?.codec === 'aac' ? await getAacChannelCount(config) : config?.numberOfChannels ?? 0;
  if (audioTrack) audioTracks[audioTrackIndex].channels = channelCount;
  rate = config?.sampleRate ?? 0;
  const sourceVideoConfig = await videoTrack?.getDecoderConfig();
  let videoConfig = sourceVideoConfig, videoDecoder;
  audioSink = audioTrack ? new AudioSampleSink(audioTrack) : undefined;
  const duration = await input.getDurationFromMetadata();
  if (envelope) {
    try {
      await scanEnvelope(audioSink, duration, channelCount,
        (channels, done) => send({ type: 'envelope', channels, done }));
    } finally { input.dispose(); }
    return;
  }
  // An 8-bit live AVC bridge must not silently replace Main 10 or HDR precision.
  const streamCompatible = /^(?:hvc1|hev1)\.1\./.test(videoConfig?.codec || '') &&
    !['smpte2084', 'arib-std-b67', 'pq', 'hlg'].includes(videoConfig?.colorSpace?.transfer);
  if (hostVideo && videoTrack?.codec === 'hevc' && streamCompatible) {
    const native = await globalThis.VideoDecoder?.isConfigSupported(videoConfig).catch(() => null);
    if (!native?.supported) {
      try {
        nativeVideo = videoConfig;
        const stream = await openNativeVideo(time, epoch);
        videoConfig = stream.config; videoDecoder = stream.backend;
      } catch (error) {
        videoAbort?.abort(); nativeVideo = undefined;
        videoInput?.dispose(); videoInput = undefined;
        send({ type: 'video-native-unavailable', message: error.message });
      }
    }
  }
  videoDecoder ??= videoTrack ? await prepareVideoDecoder(videoTrack.codec, videoConfig, hevc) : null;
  if (!nativeVideo) videoSink = videoTrack ? new VideoSampleSink(videoTrack) : undefined;
  position(time, true);
  send({ type: 'metadata', sampleRate: rate, channels: channelCount, codec: audioTrack?.codec ?? null,
    audioCodecString: config?.codec ?? null, videoCodec: audioOnly ? null : sourceVideoTrack?.codec ?? null,
    videoCodecString: sourceVideoConfig?.codec ?? null, videoDecoder, videoLive: !!nativeVideo,
    audioTracks, audioTrackIndex,
    width: sourceVideoConfig?.codedWidth || 0, height: sourceVideoConfig?.codedHeight || 0,
    renderWidth: videoConfig?.codedWidth || 0, renderHeight: videoConfig?.codedHeight || 0,
    duration });
}
async function pullAudio(generation) {
  if (!audio) return;
  const iterator = audio;
  const buffers = Array.from({ length: channelCount }, () => new Float32Array(Math.ceil(rate * .4)));
  let length = 0, eof = false;
  while (length < buffers[0].length) {
    if (!pendingAudio) {
      const result = await iterator.next();
      if (generation !== epoch || iterator !== audio) { result.value?.close(); return; }
      if (result.done) { eof = true; break; }
      pendingAudio = result.value;
    }
    const sample = pendingAudio;
    if (sample.numberOfChannels !== channelCount || sample.sampleRate !== rate) throw new Error('Audio format changed during playback.');
    const first = Math.round(sample.timestamp * rate);
    const gap = Math.min(buffers[0].length - length, Math.max(0, first - audioCursor));
    length += gap; audioCursor += gap;
    if (length === buffers[0].length) break;
    const skip = Math.max(0, audioCursor - first);
    const count = Math.min(buffers[0].length - length, sample.numberOfFrames - skip);
    if (count > 0) {
      for (let ch = 0; ch < channelCount; ch++) sample.copyTo(buffers[ch].subarray(length, length + count),
        { planeIndex: ch, format: 'f32-planar', frameOffset: skip, frameCount: count });
      length += count; audioCursor += count;
    }
    if (skip + Math.max(0, count) >= sample.numberOfFrames) { sample.close(); pendingAudio = undefined; }
  }
  const channels = buffers.map(buffer => buffer.slice(0, length));
  send({ type: 'audio', channels, eof, endFrame: audioCursor }, channels.map(channel => channel.buffer));
}
async function pullVideo(generation) {
  await videoReady;
  if (generation !== epoch) return;
  if (!video) return;
  const result = await video.next();
  if (generation !== epoch) { result.value?.close(); return; }
  if (result.done) { send({ type: 'video-end' }); return; }
  const sample = result.value;
  try {
    const frame = sample.toVideoFrame();
    send({ type: 'video', frame, time: sample.timestamp, duration: (frame.duration ?? 0) / 1e6 }, [frame]);
  } finally { sample.close(); }
}
self.onmessage = ({ data }) => {
  if (data.type === 'drop-audio') {
    void audio?.return().catch(() => {}); audio = audioSink = undefined;
    pendingAudio?.close(); pendingAudio = undefined;
    return;
  }
  if (data.type === 'open') epoch = data.epoch ?? 0;
  if (data.type === 'seek') { epoch = data.epoch; position(data.time); return; }
  if (data.epoch !== epoch && data.type !== 'open') return;
  const generation = epoch;
  const task = data.type === 'open' ? open(data.url, data.libav, data.audioTrackIndex, data.time, data.envelope, data.file, data.audioOnly, data.hevc, data.hostVideo) : data.type === 'audio' ? pullAudio(generation) : pullVideo(generation);
  void task.catch(error => { if (generation === epoch && (data.type !== 'audio' || audio)) send({ type: 'error', message: error.message }); });
};
