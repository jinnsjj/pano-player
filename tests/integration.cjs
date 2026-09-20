// Run explicitly with PANO_PLAYER_TEST_VIDEO pointing at a four-channel WAV or video fixture.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { runProcess, prepareMedia, probeFile, AnalyzerClient } = require('../src/media.cjs');
(async () => {
  const input = process.env.PANO_PLAYER_TEST_VIDEO;
  if (!input) throw new Error('Set PANO_PLAYER_TEST_VIDEO');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pano-player-integration-'));
  const settings = { ffmpegPath: process.env.FFMPEG || 'ffmpeg', ffprobePath: process.env.FFPROBE || 'ffprobe', pythonPath: process.env.PYTHON || 'python3' };
  let client;
  const order = process.env.PANO_PLAYER_TEST_ORDER || 'WYZX';
  try {
    const media = await prepareMedia(input, root, settings, order);
    const proxy = await probeFile(media.proxy, settings);
    assert.equal(proxy.streams.find(s => s.codec_type === 'audio').channels, 2);
    if (media.hasVideo) assert.equal(proxy.streams.find(s => s.codec_type === 'video').codec_name, 'h264');
    else {
      assert.ok(!proxy.streams.some(s => s.codec_type === 'video'));
      assert.equal(proxy.streams.find(s => s.codec_type === 'audio').codec_name, 'mp3');
    }
    const pcm = await fs.readFile(media.pcm);
    const foaProbe = await probeFile(media.foa, settings);
    assert.equal(foaProbe.streams[0].channels, 4);
    const decodedFoa = path.join(root, 'foa-decoded.f32');
    await runProcess(settings.ffmpegPath, ['-v', 'error', '-y', '-i', media.foa, '-c:a', 'pcm_f32le', '-f', 'f32le', decodedFoa]);
    const foaPcm = await fs.readFile(decodedFoa);
    assert.equal(foaPcm.length, pcm.length);
    const channelMap = order === 'WYZX' ? [0, 1, 2, 3] : [0, 2, 3, 1];
    for (let frame = 0; frame < pcm.length; frame += 16) {
      for (let channel = 0; channel < 4; channel++) {
        assert.equal(foaPcm.readFloatLE(frame + channel * 4), pcm.readFloatLE(frame + channelMap[channel] * 4));
      }
    }
    assert.ok(Math.abs(pcm.length / 16 / media.sampleRate - media.duration) < .001);
    const stat = await fs.stat(media.proxy);
    const cached = await prepareMedia(input, root, settings, order);
    assert.equal(cached.proxy, media.proxy);
    assert.equal((await fs.stat(cached.proxy)).mtimeMs, stat.mtimeMs);
    // Raw decoding drops timestamps. Restore the first decoded frame's offset
    // before comparing samples; packet start_time includes codec priming.
    const reference = path.join(root, 'reference.f32');
    await runProcess(settings.ffmpegPath, ['-v', 'error', '-y', '-i', input, '-map', `0:${media.audioIndex}`, '-t', String(3 + media.videoStart), '-c:a', 'pcm_f32le', '-f', 'f32le', reference]);
    const expected = await fs.readFile(reference);
    const decoded = JSON.parse(await runProcess(settings.ffprobePath, ['-v', 'error', '-select_streams', String(media.audioIndex), '-read_intervals', '%+#3', '-show_frames', '-show_entries', 'frame=pts_time', '-of', 'json', input]));
    const offset = Math.round((Number(decoded.frames[0].pts_time) - media.videoStart) * media.sampleRate) * 16;
    const startSample = media.sampleRate * 16 + Math.max(0, -offset);
    const count = Math.min(expected.length, pcm.length - offset, startSample + media.sampleRate * 16);
    assert.ok(count > startSample, 'Reference comparison must include samples');
    let maxError = 0;
    for (let i = startSample; i < count; i += 4) maxError = Math.max(maxError, Math.abs(expected.readFloatLE(i) - pcm.readFloatLE(i + offset)));
    assert.ok(maxError < 1e-6, `Four-channel decode changed: ${maxError}`);
    client = new AnalyzerClient(settings.pythonPath, path.join(__dirname, '../python/analyzer.py'), media, order);
    await client.ready;
    const first = await client.analyze({ id: 1, time: 1, generation: 1 });
    const second = await client.analyze({ id: 2, time: 1.14, generation: 1 });
    const reset = await client.analyze({ id: 3, time: 1, generation: 2 });
    assert.equal(first.rgba, reset.rgba);
    assert.equal(Buffer.from(second.rgba, 'base64').length, 39200);
    assert.ok(Buffer.from(first.rgba, 'base64').some((v, i) => i % 4 === 3 && v > 0));
    console.log(JSON.stringify({ duration: media.duration, sampleRate: media.sampleRate, pcmBytes: pcm.length, offsetSamples: offset / 16, maxError, computeMs: [first.computeMs, second.computeMs, reset.computeMs], cacheReused: true }));
  } finally { client?.dispose(); await fs.rm(root, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
