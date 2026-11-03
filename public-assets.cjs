'use strict';

const bundledMedia = require('./plugins/catalog.cjs').flatMap(plugin => [plugin.script, plugin.style].map(file => file.slice('media/'.length)));

// Both distribution targets use this allowlist; unrelated local assets are never copied.
const media = [
  'audio-switch.js', 'channel-mapper.js', 'channel-routing.js', 'codec-info.js', 'direction-grid.js', 'envelope.js',
  'floating-overlay.js', 'foa-capture-processor.js', 'icon.png', 'level-meter-processor.js',
  'libav-6.10.7.1.5-decoder-aac.js', 'libav-6.10.7.1.5-decoder-aac.wasm.js', 'libav-6.10.7.1.5-decoder-aac.wasm.wasm',
  'libav-6.10.7.1.5-decoder-hevc.js', 'libav-6.10.7.1.5-decoder-hevc.wasm.js', 'libav-6.10.7.1.5-decoder-hevc.wasm.wasm',
  'loop-range.js', 'lucide.min.js', 'meter.js', 'monitor.js', 'omnitone.min.js', 'overlay-controls.js', 'overlay-layer.js',
  'pcm-processor.js', 'player.css', 'player.js', 'plugin-package.js', 'plugins.js', 'powermap-worker.js',
  'projection.js', 'stream-player.js', 'stream-worker.js', 'three.core.min.js', 'three.module.js',
  'view.js', 'view-footprint.js', 'view-settings.js', 'viewport-resize.js',
  'LICENSE-ffmpeg.txt', 'LICENSE-libopus.txt', 'LICENSE-loudness-meter.txt', 'LICENSE-lucide.txt',
  'LICENSE-mediabunny.txt', 'LICENSE-omnitone.txt', 'LICENSE-opus-decoder.txt', 'LICENSE-puff.txt',
  'LICENSE-simple-yenc.txt', 'LICENSE-three.txt',
  ...bundledMedia,
];
module.exports = { media, bundledMedia };
