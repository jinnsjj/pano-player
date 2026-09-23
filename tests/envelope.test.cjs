const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { buildSync } = require('esbuild');
function load(file, extra = {}) {
  const context = { module: { exports: {} }, exports: {}, performance, setTimeout, ...extra };
  vm.runInNewContext(buildSync({ entryPoints: [require.resolve(file)], bundle: true,
    platform: 'node', format: 'cjs', write: false }).outputFiles[0].text, context);
  return context.module.exports;
}
test('envelope retains every channel, sample peak and timestamp with bounded output', async () => {
  const { scanEnvelope } = load('../src/envelope.js');
  for (const count of [1, 2, 3, 4, 6, 8, 16, 32, 64]) {
    let closed = 0, result, done;
    const sink = { async *samples() {
      yield { timestamp: .5, numberOfFrames: 4, numberOfChannels: count, sampleRate: 8,
        copyTo(pcm, { planeIndex }) { pcm.set([-(planeIndex + 1) / 4, NaN, .125, 0]); },
        close() { closed++; } };
    } };
    await scanEnvelope(sink, 1, count, (channels, complete) => { result = channels; done = complete; });
    assert.equal(closed, 1); assert.equal(done, true); assert.equal(result.length, count);
    result.forEach((peaks, ch) => {
      assert.equal(peaks.length, 2048); assert.equal(peaks[1024], (ch + 1) / 4);
      assert.equal(peaks[1536], .125); assert.equal(peaks[0], 0);
      assert.ok(peaks.every(Number.isFinite));
    });
  }
  await scanEnvelope(null, 1, 0, () => assert.fail('No audio'));
  await scanEnvelope({}, NaN, 4, () => assert.fail('Unknown duration'));
});
test('envelope survives seeks but cancels on track changes and disposal; errors do not stop playback', async () => {
  const workers = [];
  const { StreamPlayer } = load('../src/stream-player.js', {
    window: {}, EventTarget, Event, AbortController, fetch, URL, Blob,
    Worker: class {
      constructor() { workers.push(this); }
      postMessage(data) { this.open = data; }
      terminate() { this.terminated = true; }
    },
  });
  StreamPlayer.prototype.load = () => {};
  const p = new StreamPlayer({ dataset: { decoder: 'https://example.test/stream-worker.js' } });
  p.decoderSource = ''; p.channels = 4; p.duration = 2; p.audioTrackIndex = 0;
  p.startEnvelope(); const old = workers[0];
  assert.equal(old.open.audioTrackIndex, 0); assert.equal(old.open.envelope, true);
  p.metadataReady(); p.sampleRate = 48000; p.worker = { postMessage() {}, terminate() {} };
  await p.seek(1);
  old.onmessage({ data: { type: 'envelope', channels: [[.5]], done: false } });
  assert.equal(p.envelope[0][0], .5);
  p.audioTracks = [{ supported: true }, { supported: true }];
  p.load = () => p.metadataReady();
  await p.selectAudioTrack(1);
  assert.equal(old.terminated, true); assert.equal(p.envelope, undefined);
  old.onmessage({ data: { type: 'envelope', channels: [[1]] } });
  assert.equal(p.envelope, undefined);
  p.startEnvelope(); const next = workers[1];
  assert.equal(next.open.audioTrackIndex, 1);
  next.onmessage({ data: { type: 'error' } });
  assert.equal(p.error, undefined); assert.equal(next.terminated, true);
  p.dispose(); assert.equal(p.envelopeAbort.signal.aborted, true);
});
test('dense envelope rows stay inside the unchanged height without overlapping', () => {
  const { attachEnvelope } = load('../media/envelope.js', { window: { devicePixelRatio: 1, addEventListener() {} } });
  for (const count of [1, 3, 6, 8, 16, 32, 64]) {
    const player = new EventTarget();
    player.envelope = Array.from({ length: count }, () => Float32Array.of(0, .25, 1));
    player.currentTime = 0; player.duration = 1;
    const rects = [], ctx = { fillRect(x, y, w, h) { rects.push({ x, y, w, h }); } };
    const canvas = { getBoundingClientRect: () => ({ width: 30, height: 32 }), getContext: () => ctx };
    attachEnvelope(player, canvas); player.dispatchEvent(new Event('envelope'));
    assert.equal(canvas.height, 32); assert.equal(rects.length, count * 30);
    rects.forEach(({ y, h }, i) => {
      const ch = Math.floor(i / 30), row = 32 / count;
      assert.ok(y >= ch * row && y + h <= (ch + 1) * row + 1e-10);
    });
  }
});
