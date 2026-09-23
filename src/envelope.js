export async function scanEnvelope(sink, duration, channelCount, publish) {
  if (!sink || !Number.isFinite(duration) || duration <= 0) return;
  const bins = 2048;
  const channels = Array.from({ length: channelCount }, () => new Float32Array(bins));
  let updated = 0;
  for await (const sample of sink.samples()) {
    try {
      if (sample.numberOfChannels !== channelCount) throw new Error('Audio channel count changed.');
      const pcm = new Float32Array(sample.numberOfFrames);
      for (let ch = 0; ch < channelCount; ch++) {
        sample.copyTo(pcm, { planeIndex: ch, format: 'f32-planar' });
        for (let i = 0; i < pcm.length; i++) {
          const bin = Math.floor((sample.timestamp + i / sample.sampleRate) / duration * bins);
          if (bin >= 0 && bin < bins && Number.isFinite(pcm[i])) {
            channels[ch][bin] = Math.max(channels[ch][bin], Math.abs(pcm[i]));
          }
        }
      }
    } finally { sample.close(); }
    if (performance.now() - updated > 250) {
      publish(channels, false); updated = performance.now();
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
  publish(channels, true);
}
