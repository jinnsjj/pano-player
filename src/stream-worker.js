import { Input, UrlSource, ALL_FORMATS, AudioSampleSink, VideoSampleSink, EncodedPacketSink } from 'mediabunny';
import { setWebmOpusTiming } from './stream-codecs.js';
import { resourceFetch } from './resource-fetch.js';

globalThis.fetch = resourceFetch;

let input, audioSink, videoSink, audio, video, pendingAudio, epoch = 0, audioCursor = 0, rate = 48000;
let channelCount = 4;
const send = (message, transfer = []) => postMessage({ ...message, epoch }, transfer);
function position(time) {
  void audio?.return().catch(() => {}); void video?.return().catch(() => {});
  pendingAudio?.close(); pendingAudio = undefined;
  audioCursor = Math.round(time * rate);
  // Decode a short preroll to restore AAC overlap/Opus prediction before the requested point.
  audio = audioSink?.samples(time - .12);
  video = videoSink?.samples(time);
}
async function open(url, libav) {
  input?.dispose();
  input = new Input({ formats: ALL_FORMATS, source: new UrlSource(url, {
    maxCacheSize: 8 * 1024 * 1024, getRetryDelay: attempt => attempt < 2 ? .25 : null,
    handleUnhandledError: error => send({ type: 'error', message: error.message }),
  }) });
  const audioTrack = await input.getPrimaryAudioTrack();
  const videoTrack = await input.getPrimaryVideoTrack();
  if (!audioTrack && !videoTrack) throw new Error('No audio or video track found.');
  const config = await audioTrack?.getDecoderConfig();
  if (audioTrack?.codec === 'aac') {
    // VS Code resource service workers support fetch, not cross-origin importScripts.
    for (const source of [libav, libav.replace(/\.js$/, '.wasm.js')]) {
      const response = await fetch(source);
      if (!response.ok) throw new Error(`Cannot load AAC decoder (${response.status}).`);
      const blob = URL.createObjectURL(new Blob([await response.text()], { type: 'text/javascript' }));
      try { importScripts(blob); } finally { URL.revokeObjectURL(blob); }
    }
    globalThis.foaLibavOptions = { factory: globalThis.LibAVFactory,
      wasmurl: libav.replace(/\.js$/, '.wasm.wasm') };
  }
  const webm = ['WebM', 'Matroska'].includes((await input.getFormat()).name);
  const first = webm && audioTrack?.codec === 'opus' ? await new EncodedPacketSink(audioTrack).getFirstPacket({ metadataOnly: true }) : null;
  setWebmOpusTiming(webm, first?.sequenceNumber);
  if (audioTrack && ![1, 2, 4].includes(config?.numberOfChannels)) throw new Error(`Only mono, stereo or four-channel FOA audio is supported; found ${config?.numberOfChannels ?? 0} channels.`);
  channelCount = config?.numberOfChannels ?? 0;
  rate = config?.sampleRate ?? 0;
  const videoConfig = await videoTrack?.getDecoderConfig();
  audioSink = audioTrack ? new AudioSampleSink(audioTrack) : undefined;
  videoSink = videoTrack ? new VideoSampleSink(videoTrack) : undefined;
  position(0);
  send({ type: 'metadata', sampleRate: rate, channels: channelCount, codec: audioTrack?.codec ?? null,
    width: videoConfig?.codedWidth || 0, height: videoConfig?.codedHeight || 0,
    duration: await input.getDurationFromMetadata() });
}
async function pullAudio(generation) {
  if (!audio) return;
  const iterator = audio;
  const buffers = Array.from({ length: channelCount }, () => new Float32Array(Math.ceil(rate * .4)));
  let length = 0, eof = false;
  while (length < buffers[0].length) {
    if (!pendingAudio) {
      const result = await iterator.next();
      if (generation !== epoch) { result.value?.close(); return; }
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
  if (data.type === 'seek') { epoch = data.epoch; position(data.time); return; }
  if (data.epoch !== epoch && data.type !== 'open') return;
  const generation = epoch;
  const task = data.type === 'open' ? open(data.url, data.libav) : data.type === 'audio' ? pullAudio(generation) : pullVideo(generation);
  void task.catch(error => { if (generation === epoch) send({ type: 'error', message: error.message }); });
};
