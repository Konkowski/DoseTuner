// Tiny static server for dist/pwa (no dependencies). Usage: npm run serve  -> http://localhost:8765
const http = require('http'), fs = require('fs'), path = require('path');
const dir = path.join(__dirname, '..', 'dist', 'pwa'), port = process.env.PORT || 8765;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
http.createServer((q, r) => { let f = path.join(dir, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0]); if (!f.startsWith(dir) || !fs.existsSync(f)) { r.writeHead(404); return r.end('Not found'); } r.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); }).listen(port, () => console.log('DoseTuner on http://localhost:' + port));
