'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { build } = require('esbuild');
const { buildMedia } = require('../build.cjs');
const { renderHtml } = require('../src/webview.cjs');

const root = path.resolve(__dirname, '..');
const outdir = path.join(root, 'output/web');
async function buildWeb() {
  await fs.mkdir(outdir, { recursive: true });
  await fs.cp(path.join(root, 'media'), path.join(outdir, 'media'), { recursive: true });
  await buildMedia(path.join(outdir, 'media'));
  for (const name of ['index.html', 'app.css', 'player.css', '_headers', '404.html']) {
    await fs.copyFile(path.join(__dirname, name), path.join(outdir, name));
  }
  for (const name of ['app', 'bootstrap']) {
    await build({ entryPoints: [path.join(__dirname, `${name}.js`)], bundle: true,
      outfile: path.join(outdir, `${name}.js`), format: 'iife', platform: 'browser',
      target: 'chrome114', minify: true, legalComments: 'inline' });
  }
  const assets = { script: 'player.js', style: 'player.css', icons: 'lucide.min.js', logo: 'icon.png',
    omnitone: 'omnitone.min.js', monitor: 'monitor.js', view: 'view.js', worker: 'powermap-worker.js',
    worklet: 'foa-capture-processor.js', decoder: 'stream-worker.js', pcm: 'pcm-processor.js', stream: 'stream-player.js' };
  await fs.writeFile(path.join(outdir, 'player.html'), renderHtml({ title: 'Local media', cspSource: "'self'",
    bootstrap: './bootstrap.js', extraStyle: './player.css',
    ...Object.fromEntries(Object.entries(assets).map(([key, name]) => [key, `./media/${name}`])),
  }));
  await fs.copyFile(path.join(root, 'LICENSE'), path.join(outdir, 'LICENSE.txt'));
  console.log(`Static web build: ${outdir}`);
}
module.exports = { buildWeb };
if (require.main === module) buildWeb().catch(error => { console.error(error); process.exitCode = 1; });
