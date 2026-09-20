const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const { build } = require('esbuild');

test('bundled decoder preserves original mono, stereo and FOA PCM', async t => {
  const files = process.env.PANO_PLAYER_CODEC_FILES?.split('|');
  if (!files) { t.skip('Set PANO_PLAYER_CODEC_FILES to original MP4 and WebM paths.'); return; }
  const root = path.resolve(__dirname, '..');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pano-player-codecs-'));
  try {
    const output = path.join(dir, 'decode.cjs');
    await build({ stdin: { contents: `export * from '${root}/src/stream-codecs.js'; export * from 'mediabunny';`,
      resolveDir: root }, bundle: true, platform: 'node', format: 'cjs', minify: true, outfile: output });
    globalThis.LibAV = require(path.join(root, 'media/libav-6.10.7.1.5-decoder-aac.js'));
    const { Input, CustomSource, ALL_FORMATS, AudioSampleSink, EncodedPacketSink, setWebmOpusTiming } = require(output);
    for (const file of files) {
      const handle = await fs.open(file); const size = (await handle.stat()).size;
      let bytes = 0;
      const input = new Input({ formats: ALL_FORMATS, source: new CustomSource({
        getSize: () => size, read: async (start, end) => {
          const buffer = new Uint8Array(end - start); const result = await handle.read(buffer, 0, buffer.length, start);
          bytes += result.bytesRead; return buffer.subarray(0, result.bytesRead);
        }, maxCacheSize: 1024 * 1024,
      }) });
      try {
        const track = await input.getPrimaryAudioTrack();
        const config = await track.getDecoderConfig();
        setWebmOpusTiming(['WebM', 'Matroska'].includes((await input.getFormat()).name),
          (await new EncodedPacketSink(track).getFirstPacket({ metadataOnly: true }))?.sequenceNumber);
        const channels = config.numberOfChannels;
        assert.ok([1, 2, 4].includes(channels));
        const planes = Array.from({ length: channels }, () => []); let frames = 0;
        const start = performance.now();
        for await (const sample of new AudioSampleSink(track).samples(-.12, 2)) {
          assert.equal(sample.numberOfChannels, channels);
          const skip = Math.max(0, Math.round(-sample.timestamp * sample.sampleRate));
          const count = Math.min(sample.numberOfFrames, Math.round((2 - sample.timestamp) * sample.sampleRate)) - skip;
          if (count <= 0) { sample.close(); continue; }
          for (let ch = 0; ch < channels; ch++) {
            const pcm = new Float32Array(count);
            sample.copyTo(pcm, { planeIndex: ch, format: 'f32-planar', frameOffset: skip, frameCount: count });
            assert.ok(pcm.every(Number.isFinite)); planes[ch].push(...pcm);
          }
          frames += count; sample.close();
        }
        assert.ok(frames > config.sampleRate);
        const decodeMs = performance.now() - start;
        if (process.env.PANO_PLAYER_FFMPEG) {
          const { execFileSync } = require('node:child_process');
          const reference = execFileSync(process.env.PANO_PLAYER_FFMPEG,
            ['-v', 'error', '-i', file, '-t', '2.1', '-map', '0:a:0', '-f', 'f32le', '-'], { maxBuffer: 8 * 1024 * 1024 });
          assert.ok(reference.length >= frames * channels * 4);
          for (let ch = 0; ch < channels; ch++) {
            let error = 0, energy = 0;
            for (let i = 0; i < frames; i++) {
              const expected = reference.readFloatLE((i * channels + ch) * 4);
              error += (planes[ch][i] - expected) ** 2; energy += expected ** 2;
            }
            assert.ok(error / Math.max(energy, 1e-20) < 1e-6, `Channel ${ch} differs from independent FFmpeg PCM`);
          }
        }
        console.log(JSON.stringify({ file, channels, frames, decodeMs, bytes, size,
          rms: planes.map(plane => Math.sqrt(plane.reduce((sum, value) => sum + value * value, 0) / plane.length)) }));
        if (process.env.PANO_PLAYER_PCM_DIR) {
          const pcm = new Float32Array(frames * channels);
          for (let i = 0; i < frames; i++) for (let ch = 0; ch < channels; ch++) pcm[i * channels + ch] = planes[ch][i];
          await fs.writeFile(path.join(process.env.PANO_PLAYER_PCM_DIR, path.basename(file) + '.f32'), Buffer.from(pcm.buffer));
        }
      } finally { input.dispose(); await handle.close(); }
    }
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
