'use strict';
const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const defaultRoot = path.resolve(__dirname, '../output/web');
function createServer(root = defaultRoot) {
  const directory = fs.realpathSync(root);
  // Mirror the single global Pages header rule during local validation.
  const headers = Object.fromEntries(fs.readFileSync(path.join(directory, '_headers'), 'utf8')
    .split('\n').filter(line => /^\s+\S[^:]*:/.test(line))
    .map(line => { const i = line.indexOf(':'); return [line.slice(0, i).trim(), line.slice(i + 1).trim()]; }));
  return http.createServer(async (req, res) => {
    for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return; }
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      const requested = path.resolve(directory, '.' + (pathname.endsWith('/') ? pathname + 'index.html' : pathname));
      if (!requested.startsWith(directory + path.sep)) { res.writeHead(403); res.end(); return; }
      const file = await fsp.realpath(requested);
      if (!file.startsWith(directory + path.sep) || !(await fsp.stat(file)).isFile() || path.basename(file).startsWith('_')) {
        res.writeHead(404); res.end(); return;
      }
      res.setHeader('Content-Type', { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8', '.wasm': 'application/wasm', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8' }[path.extname(file)] || 'application/octet-stream');
      res.setHeader('Content-Length', (await fsp.stat(file)).size);
      if (req.method === 'HEAD') { res.end(); return; }
      const stream = fs.createReadStream(file);
      stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy()); stream.pipe(res);
    } catch (error) {
      res.writeHead(error instanceof URIError ? 400 : 404); res.end();
    }
  });
}
module.exports = { createServer };
if (require.main === module) {
  if (!fs.existsSync(path.join(defaultRoot, 'index.html'))) {
    console.error('Run npm run build:web first.'); process.exitCode = 1;
  } else {
    const port = Number(process.env.PORT || 4173);
    const server = createServer();
    server.on('error', error => {
      if (error.code === 'EADDRINUSE') server.listen(0, '127.0.0.1');
      else { console.error(error); process.exitCode = 1; }
    });
    server.listen(port, '127.0.0.1', () => console.log(`PanoPlayer: http://127.0.0.1:${server.address().port}`));
  }
}
