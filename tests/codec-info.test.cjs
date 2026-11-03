const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSync } = require('esbuild');
const vm = require('node:vm');

const moduleValue = { exports: {} };
vm.runInNewContext(buildSync({ entryPoints: [require.resolve('../media/codec-info.js')],
  bundle: true, format: 'cjs', write: false }).outputFiles[0].text,
{ module: moduleValue, exports: moduleValue.exports });
const { codecInfo } = moduleValue.exports;

test('playback codec information identifies video, active audio and the actual video backend', () => {
  assert.equal(codecInfo({ videoCodec: 'hevc', videoDecoder: 'FFmpeg/WASM', codec: 'aac', channels: 6 }).join(' / '),
    'Video: HEVC (H.265) / FFmpeg/WASM / Audio: AAC');
  assert.equal(codecInfo({ videoCodec: 'avc', videoDecoder: 'WebCodecs', codec: 'opus', channels: 2 }).join(' / '),
    'Video: H.264 / WebCodecs / Audio: Opus');
  assert.equal(codecInfo({ codec: 'pcm-s16', channels: 2 }).join(''), 'Audio: PCM');
  assert.equal(codecInfo({ videoCodec: 'vp9', codec: 'aac', channels: 0 }).join(''), 'Video: VP9');
  assert.equal(codecInfo({}).length, 0);
});
