const names = { hevc: 'HEVC (H.265)', avc: 'H.264', av1: 'AV1', vp8: 'VP8', vp9: 'VP9',
  aac: 'AAC', opus: 'Opus', flac: 'FLAC', mp3: 'MP3', vorbis: 'Vorbis' };

export function codecInfo(video) {
  const items = [];
  if (video.videoCodec) items.push('Video: ' + (names[video.videoCodec] || video.videoCodec.toUpperCase()));
  if (video.videoDecoder) items.push(video.videoDecoder);
  if (video.channels > 0 && video.codec) items.push('Audio: ' +
    (names[video.codec] || (video.codec.startsWith('pcm-') ? 'PCM' : video.codec.toUpperCase())));
  return items;
}
