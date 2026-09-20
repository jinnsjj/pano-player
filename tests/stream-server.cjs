const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { renderHtml } = require('../src/webview.cjs');
const { normalize } = require('../src/preferences.cjs');
let preferences = normalize();
const files = process.argv.slice(2).map(file => path.resolve(file));
const server = http.createServer((req, res) => {
  const origin = `http://127.0.0.1:${server.address().port}`;
  const url = new URL(req.url, origin);
  if (url.pathname === '/diagnostic') {
    let text = ''; req.on('data', chunk => { if (text.length < 8192) text += chunk; });
    req.on('end', () => {
      try { const message = JSON.parse(text); if (message.type === 'preferences') preferences = normalize({ ...preferences, ...message.patch }); } catch {}
      console.log(text); res.end();
    }); return;
  }
  if (url.pathname === '/projection-test') {
    res.setHeader('Content-Type', 'text/html');
    res.end(fs.readFileSync(path.join(__dirname, 'projection-browser.html'))); return;
  }
  if (url.pathname === '/') {
    const index = Number(url.searchParams.get('file') || 0);
    if (!files[index]) { res.writeHead(404); res.end(); return; }
    const html = renderHtml({ title: path.basename(files[index]), cspSource: origin, nonce: 'qa', source: `${origin}/source/${index}`, preferences,
      ...Object.fromEntries(Object.entries({ script: 'player.js', style: 'player.css', icons: 'lucide.min.js',
        monitor: 'monitor.js', omnitone: 'omnitone.min.js', view: 'view.js', worker: 'powermap-worker.js',
        worklet: 'foa-capture-processor.js', decoder: 'stream-worker.js', pcm: 'pcm-processor.js', stream: 'stream-player.js',
      }).map(([key, value]) => [key, `${origin}/${value}`])) });
    res.setHeader('Content-Type', 'text/html');
    res.end(html.replace('<body>', `<body><script nonce="qa">window.acquireVsCodeApi=()=>({getState:()=>null,setState:()=>{},postMessage:m=>fetch('/diagnostic',{method:'POST',body:JSON.stringify(m)})});window.addEventListener('error',e=>fetch('/diagnostic',{method:'POST',body:e.message}));</script>`)); return;
  }
  const file = url.pathname.startsWith('/source/') ? files[Number(url.pathname.slice(8))] : path.join(__dirname, '../media', path.basename(url.pathname));
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
  const size = fs.statSync(file).size;
  res.setHeader('Content-Type', { '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm' }[path.extname(file)] || 'application/octet-stream');
  const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
  const start = range ? Number(range[1]) : 0, end = range?.[2] ? Math.min(size - 1, Number(range[2])) : size - 1;
  if (start > end || start >= size) { res.writeHead(416); res.end(); return; }
  res.setHeader('Accept-Ranges', 'bytes'); res.setHeader('Content-Length', end - start + 1);
  if (range) res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${size}` });
  const stream = fs.createReadStream(file, { start, end }); res.on('close', () => stream.destroy()); stream.pipe(res);
});
server.listen(0, '127.0.0.1', () => console.log(`http://127.0.0.1:${server.address().port}`));
