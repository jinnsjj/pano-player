const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { build } = require('esbuild');

test('real HEVC Main/Main 10 frames and seek output match independent FFmpeg pixels', async t => {
  const files = process.env.PANO_PLAYER_HEVC_FILES?.split('|');
  if (!files) { t.skip('Set PANO_PLAYER_HEVC_FILES to HEVC fixtures; optionally PANO_PLAYER_FFMPEG for pixel comparison.'); return; }
  const root = path.resolve(__dirname, '..');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pano-hevc-test-'));
  try {
    const output = path.join(dir, 'decode.cjs');
    await build({ stdin: { contents: `export * from './src/hevc-decoder.js'; export * from 'mediabunny';`, resolveDir: root },
      bundle: true, platform: 'node', format: 'cjs', minify: true, outfile: output });
    const { Input, CustomSource, ALL_FORMATS, VideoSampleSink, EncodedPacketSink, prepareVideoDecoder } = require(output);
    const wrapper = require('../media/libav-6.10.7.1.5-decoder-hevc.js');
    for (const file of files) {
      const handle = await fs.open(file); const size = (await handle.stat()).size;
      const input = new Input({ formats: ALL_FORMATS, source: new CustomSource({
        getSize: () => size, read: async (start, end) => {
          const buffer = new Uint8Array(end - start);
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
          return buffer.subarray(0, bytesRead);
        }, maxCacheSize: 8 * 1024 * 1024,
      }) });
      try {
        const track = await input.getPrimaryVideoTrack();
        const config = await track.getDecoderConfig();
        assert.equal(track.codec, 'hevc');
        assert.equal(await prepareVideoDecoder(track.codec, config, null, async () => ({ wrapper })), 'FFmpeg/WASM');
        const packet = await new EncodedPacketSink(track).getFirstPacket();
        const count = Number(process.env.PANO_PLAYER_HEVC_FRAMES || 8);
        const hashes = [], times = [], formats = [];
        const start = performance.now();
        for await (const sample of new VideoSampleSink(track).samples(0)) {
          try {
            const data = new Uint8Array(sample.allocationSize());
            await sample.copyTo(data);
            hashes.push(createHash('md5').update(data).digest('hex'));
            times.push(sample.timestamp); formats.push(sample.format);
          } finally { sample.close(); }
          if (hashes.length === count) break;
        }
        assert.equal(hashes.length, count);
        assert.ok(times.every((time, i) => i === 0 || time > times[i - 1]), 'B-frames are emitted in presentation order');
        if (process.env.PANO_PLAYER_FFMPEG) {
          const reference = execFileSync(process.env.PANO_PLAYER_FFMPEG,
            ['-v', 'error', '-noautorotate', '-i', file, '-map', '0:v:0', '-frames:v', String(count), '-f', 'framemd5', '-'],
            { encoding: 'utf8', maxBuffer: 1024 * 1024 });
          const expected = reference.split('\n').filter(line => line && !line.startsWith('#')).map(line => line.split(',').at(-1).trim());
          assert.deepEqual(hashes, expected, 'WASM must preserve every decoded pixel, including Main 10 precision');
        }
        const sink = new VideoSampleSink(track);
        const seek = Math.min(.2, packet.duration * (count - 1));
        for await (const sample of sink.samples(seek, seek + packet.duration)) {
          try {
            const data = new Uint8Array(sample.allocationSize());
            await sample.copyTo(data);
            assert.ok(sample.timestamp <= seek + packet.duration);
            assert.ok(hashes.includes(createHash('md5').update(data).digest('hex')), 'A fresh seek decoder reproduces the same frame pixels');
          } finally { sample.close(); }
        }
        console.log(JSON.stringify({ file, frames: hashes.length, formats: [...new Set(formats)],
          decodeAndVerifyMs: performance.now() - start, times }));
      } finally { input.dispose(); await handle.close(); }
    }
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
