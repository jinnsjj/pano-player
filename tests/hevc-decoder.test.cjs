const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { buildSync } = require('esbuild');

const source = buildSync({ entryPoints: [require.resolve('../src/hevc-decoder.js')],
  bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text;

function setup(native, failedFetch = false) {
  const calls = [], packets = [], samples = [];
  const libav = {
    async ff_init_decoder(codec, config) { calls.push(['init', codec, config]); return [1, 2, 3, 4]; },
    async ff_decode_multi(context, pkt, frame, values, config) {
      packets.push(...values); calls.push(['decode', config]);
      return values.map(packet => ({ data: new Uint8Array(48), format: 0, width: 8, height: 4,
        layout: [{ offset: 0, stride: 8 }, { offset: 32, stride: 4 }, { offset: 40, stride: 4 }],
        pts: packet.pts, ptshi: packet.ptshi, time_base_num: 1, time_base_den: 1000000 }));
    },
    async avcodec_flush_buffers() { calls.push(['flush']); },
    async ff_free_decoder() { calls.push(['free']); },
    terminate() { calls.push(['terminate']); },
  };
  const context = { module: { exports: {} }, exports: {}, Blob, URL, Uint8Array, ArrayBuffer, setTimeout,
    VideoDecoder: native === undefined ? undefined : { isConfigSupported: async () => {
      if (native === 'throw') throw new Error('Unsupported codec');
      return { supported: native };
    } },
    async fetch(url) {
      calls.push(['fetch', url]);
      return { ok: !failedFetch, status: 404, text: async () => '', arrayBuffer: async () => new ArrayBuffer(0) };
    },
    importScripts() {
      context.LibAV = { LibAV: async () => libav }; context.LibAVFactory = () => {};
    },
  };
  vm.runInNewContext(source, context);
  const api = context.module.exports;
  const decoder = new api.HevcVideoDecoder();
  decoder.codec = 'hevc'; decoder.config = { codedWidth: 8, codedHeight: 4 };
  decoder.onSample = sample => samples.push(sample);
  return { ...api, decoder, libav, calls, packets, samples };
}

test('native HEVC keeps WebCodecs and never downloads the software codec', async () => {
  const s = setup(true);
  assert.equal(await s.prepareVideoDecoder('hevc', s.decoder.config, 'hevc.js'), 'WebCodecs');
  assert.equal(s.HevcVideoDecoder.supports('hevc'), false);
  assert.equal(s.calls.length, 0);
  assert.equal(await s.prepareVideoDecoder('avc', {}, 'hevc.js'), 'WebCodecs');
});

test('unsupported, absent and throwing WebCodecs checks activate only the bundled HEVC fallback', async () => {
  for (const native of [false, undefined, 'throw']) {
    const s = setup(native);
    assert.equal(await s.prepareVideoDecoder('hevc', s.decoder.config, 'hevc.js'), 'FFmpeg/WASM');
    assert.equal(s.HevcVideoDecoder.supports('hevc'), true);
    assert.equal(s.HevcVideoDecoder.supports('avc'), false);
    assert.equal(s.calls.filter(call => call[0] === 'fetch').length, 3);
    await s.prepareVideoDecoder('hevc', s.decoder.config, 'hevc.js');
    assert.equal(s.calls.filter(call => call[0] === 'fetch').length, 3, 'Cache the loaded variant, not its decoder context');
    await s.prepareVideoDecoder('avc', {}, 'hevc.js');
    assert.equal(s.HevcVideoDecoder.supports('hevc'), false);
  }
});

test('HEVC packets retain signed 64-bit PTS, duration, plane layout and flush/close lifetimes', async () => {
  const s = setup(false);
  await s.prepareVideoDecoder('hevc', s.decoder.config, 'hevc.js');
  await s.decoder.init();
  for (const timestamp of [-.04, 0, 5000.12]) {
    await s.decoder.decode({ data: new Uint8Array([1]), type: 'key', timestamp, duration: .04 });
  }
  assert.deepEqual(s.samples.map(sample => sample.timestamp), [-.04, 0, 5000.12]);
  assert.ok(s.samples.every(sample => sample.duration === .04 && sample.format === 'I420'));
  assert.equal(s.packets[0].ptshi, -1);
  assert.equal(s.packets[2].ptshi, 1);
  await s.decoder.flush();
  assert.ok(s.calls.some(call => call[0] === 'decode' && call[1]?.fin === true));
  assert.ok(s.calls.some(call => call[0] === 'flush'));
  await s.decoder.decode({ data: new Uint8Array([1]), type: 'key', timestamp: 0, duration: .04 });
  assert.equal(s.samples.at(-1).timestamp, 0, 'Flush leaves the decoder ready for another batch');
  await s.decoder.close(); await s.decoder.close();
  assert.equal(s.calls.filter(call => call[0] === 'free').length, 1);
  assert.equal(s.calls.filter(call => call[0] === 'terminate').length, 1);
  s.samples.forEach(sample => sample.close());
});

test('HEVC Main 10 retains 10-bit planes, color space and cropping', async () => {
  const s = setup(false);
  s.decoder.config.colorSpace = { primaries: 'bt2020', transfer: 'pq', matrix: 'bt2020-ncl', fullRange: false };
  await s.prepareVideoDecoder('hevc', s.decoder.config, 'hevc.js');
  await s.decoder.init();
  s.decoder.output([{ data: new Uint8Array(96), width: 8, height: 4, format: 62,
    layout: [{ offset: 0, stride: 16 }, { offset: 64, stride: 8 }, { offset: 80, stride: 8 }],
    crop: { left: 0, top: 0, right: 2, bottom: 0 }, pts: 0 }]);
  assert.equal(s.samples[0].format, 'I420P10');
  assert.equal(s.samples[0].visibleRect.width, 6);
  assert.equal(s.samples[0].colorSpace.primaries, 'bt2020');
  assert.throws(() => s.decoder.output([{ format: 999 }]), /Unsupported HEVC pixel format/);
  s.samples[0].close(); await s.decoder.close();
});

test('seeking cancels queued software work before decoding and still frees its context', async () => {
  const s = setup(false);
  await s.prepareVideoDecoder('hevc', s.decoder.config, 'hevc.js');
  await s.decoder.init();
  const pending = s.decoder.decode({ data: new Uint8Array([1]), type: 'key', timestamp: 0, duration: .04 });
  s.cancelHevcDecoding();
  await pending;
  await s.decoder.decode({ data: new Uint8Array([1]), type: 'delta', timestamp: .04, duration: .04 });
  await s.decoder.flush(); await s.decoder.close();
  assert.equal(s.calls.filter(call => call[0] === 'decode').length, 0);
  assert.equal(s.samples.length, 0);
  assert.equal(s.calls.filter(call => call[0] === 'free').length, 1);
});

test('failed HEVC asset loading remains an actionable error, not silent black video', async () => {
  const s = setup(false, true);
  await assert.rejects(s.prepareVideoDecoder('hevc', s.decoder.config, 'hevc.js'), /Cannot load bundled FFmpeg decoder \(404\)/);
  assert.equal(s.HevcVideoDecoder.supports('hevc'), false);
});

test('the shipped release WASM really contains an HEVC decoder, independent of the AAC variant', async () => {
  const bytes = fs.readFileSync(require.resolve('../media/libav-6.10.7.1.5-decoder-hevc.wasm.wasm'));
  assert.equal(WebAssembly.validate(bytes), true);
  const hevc = await require('../media/libav-6.10.7.1.5-decoder-hevc.js').LibAV({ noworker: true });
  const aac = await require('../media/libav-6.10.7.1.5-decoder-aac.js').LibAV({ noworker: true });
  try {
    const decoder = await hevc.ff_init_decoder('hevc');
    await hevc.ff_free_decoder(...decoder.slice(1));
    await assert.rejects(aac.ff_init_decoder('hevc'), /Codec not found/);
  } finally { hevc.terminate(); aac.terminate(); }
});
