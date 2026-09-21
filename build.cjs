const { build } = require('esbuild');
const path = require('node:path');
const fs = require('node:fs/promises');

async function main() {
  for (const [input, output] of [
    ['src/icons.js', 'lucide.min.js'],
    ['src/browser-monitor.js', 'monitor.js'],
    ['src/level-meter-processor.js', 'level-meter-processor.js'],
    ['src/stream-player.js', 'stream-player.js'],
    ['src/stream-worker.js', 'stream-worker.js'],
    ['src/powermap/wav-stream-processor.js', 'pcm-processor.js'],
    ['src/powermap/powermap-worker.js', 'powermap-worker.js'],
    ['src/powermap/foa-capture-processor.js', 'foa-capture-processor.js'],
  ]) {
    await build({ entryPoints: [path.join(__dirname, input)], bundle: true,
      outfile: path.join(__dirname, 'media', output), format: output === 'monitor.js' ? 'esm' : 'iife',
      platform: 'browser', target: 'chrome114', minify: true, legalComments: 'inline' });
  }
  await fs.copyFile(path.join(__dirname, 'node_modules/lucide/LICENSE'), path.join(__dirname, 'media/LICENSE-lucide.txt'));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
