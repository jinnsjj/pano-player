'use strict';
const path = require('node:path');

function inspectMedia(probe, audioIndex) {
  const streams = probe.streams || [];
  const video = streams.find(s => s.codec_type === 'video' && !s.disposition?.attached_pic);
  if (video && (!Number.isInteger(video.width) || !Number.isInteger(video.height) || video.width <= 0 || video.height <= 0)) {
    throw new Error('Invalid video dimensions.');
  }
  const tracks = streams.filter(s => s.codec_type === 'audio' && s.channels === 4);
  if (tracks.length > 1 && audioIndex === undefined) throw new Error('Select a four-channel audio track.');
  const audio = audioIndex === undefined ? tracks[0] : tracks.find(s => s.index === audioIndex);
  if (!audio) throw new Error('No matching four-channel audio track. Four channels must contain FOA, not quad speakers.');
  const audioStart = Number(audio.start_time || 0);
  const reportedVideoStart = Number(video?.start_time || 0);
  // Audio-only files use the selected audio stream as their timeline origin.
  const videoStart = video ? Number(video.decoded_start_time ?? reportedVideoStart) : audioStart;
  const duration = !video && audio.duration ? Number(audio.duration)
    : video?.duration ? Number(video.duration) - (videoStart - reportedVideoStart)
    : Number(probe.format?.duration) + Number(probe.format?.start_time || 0) - videoStart;
  const sampleRate = Number(audio.sample_rate);
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(audioStart - videoStart)
      || !Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 384000) {
    throw new Error('Unsupported or missing stream duration/sample rate/timestamps.');
  }
  return { hasVideo: Boolean(video), videoIndex: video?.index, audioIndex: audio.index, duration, sampleRate,
    videoStart, audioOffset: audioStart - videoStart, width: video?.width, height: video?.height };
}

function preparationArgs(input, pcm, proxy, info, order) {
  if (!['WYZX', 'WXYZ'].includes(order)) throw new Error('Unknown FOA channel order.');
  const { sampleRate: rate, duration, videoStart } = info;
  const x = order === 'WYZX' ? 3 : 1;
  const y = order === 'WYZX' ? 1 : 2;
  // Index-based pan is intentional: container speaker labels do not describe FOA.
  // Align decoded timestamps, not packet start_time: Opus/AAC priming is skipped
  // by the decoder and must not be subtracted from the content a second time.
  const filter = `[0:${info.audioIndex}]asetpts=PTS-${videoStart}/TB,aresample=${rate}:async=1:first_pts=0,apad=whole_dur=${duration},atrim=duration=${duration},asplit=3[pcm][monitor][foa];`
    + `[foa]pan=4c|c0=c0|c1=c${y}|c2=c${order === 'WYZX' ? 2 : 3}|c3=c${x}[ambix];`
    + `[monitor]pan=stereo|c0=0.5*c0+0.25*c${x}+0.25*c${y}|c1=0.5*c0+0.25*c${x}-0.25*c${y}[stereo]`
    + (info.hasVideo ? `;[0:${info.videoIndex}]setpts=PTS-STARTPTS,scale=960:480:force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1[v]` : '');
  return ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-copyts', '-i', input,
    '-filter_complex_threads', '1', '-filter_complex', filter,
    '-map', '[pcm]', '-c:a', 'pcm_f32le', '-ar', String(rate), '-f', 'f32le', pcm,
    '-map', '[ambix]', '-c:a', 'pcm_f32le', '-rf64', 'auto', path.join(path.dirname(pcm), 'foa.wav'),
    ...(info.hasVideo ? ['-map', '[v]', '-c:v', 'libx264', '-preset', 'veryfast',
      '-threads', '2', '-crf', '25', '-pix_fmt', 'yuv420p'] : []),
    '-map', '[stereo]', '-c:a', 'libmp3lame', '-b:a', '192k',
    ...(info.hasVideo ? ['-movflags', '+faststart'] : []),
    '-t', String(duration), '-progress', 'pipe:1', proxy];
}

class LatestQueue {
  constructor(run, onError = () => {}) { this.run = run; this.onError = onError; this.busy = false; this.closed = false; }
  push(value) {
    if (this.closed) return;
    this.pending = value;
    if (!this.busy) void this.drain();
  }
  clear() { this.pending = undefined; }
  dispose() { this.closed = true; this.clear(); }
  async drain() {
    this.busy = true;
    while (!this.closed && this.pending !== undefined) {
      const value = this.pending;
      this.pending = undefined;
      try { await this.run(value); } catch (error) { this.onError(error); }
    }
    this.busy = false;
  }
}

function validRequest(message, duration) {
  return message?.type === 'analyze' && Number.isFinite(message.time)
    && message.time >= 0 && message.time <= duration
    && Number.isSafeInteger(message.generation) && message.generation >= 0
    && Number.isSafeInteger(message.id) && message.id >= 0;
}

module.exports = { inspectMedia, preparationArgs, LatestQueue, validRequest };
