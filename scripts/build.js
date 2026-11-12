// Builds dist/index.html (single file) and dist/pwa/* (installable, offline-capable PWA).
// Usage: node scripts/build.js
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), src = p => fs.readFileSync(path.join(root, 'src', p), 'utf8');
const core = src('core.js'), app = src('app.html'), NAME = 'DoseTuner';
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const mk = pwa => app.replace('/*__CORE__*/', () => core)
  .replace('<!--__PWA_HEAD__-->', pwa ? `<link rel="manifest" href="manifest.webmanifest"><link rel="icon" href="icon.svg"><link rel="apple-touch-icon" href="icon.svg"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="${NAME}">` : '')
  .replace('/*__PWA_SW__*/', pwa ? "try{if('serviceWorker' in navigator)navigator.serviceWorker.register('sw.js');}catch(e){}" : '');
const out = path.join(root, 'dist'), pwaDir = path.join(out, 'pwa');
fs.mkdirSync(pwaDir, { recursive: true });
fs.writeFileSync(path.join(out, 'index.html'), mk(false));
fs.writeFileSync(path.join(pwaDir, 'index.html'), mk(true));
fs.writeFileSync(path.join(pwaDir, 'manifest.webmanifest'), JSON.stringify({ name: NAME, short_name: NAME, start_url: './index.html', scope: './', display: 'standalone', background_color: '#08090b', theme_color: '#06080a', icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }] }, null, 2));
fs.copyFileSync(path.join(root, 'src', 'icon.svg'), path.join(pwaDir, 'icon.svg'));
const V = 'dosetuner-v' + pkg.version;
fs.writeFileSync(path.join(pwaDir, 'sw.js'), `const V='${V}',F=['./','./index.html','./manifest.webmanifest','./icon.svg'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(V).then(c=>c.addAll(F)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==V).map(x=>caches.delete(x)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)));});
`);
console.log('built dist/ (' + fs.statSync(path.join(out, 'index.html')).size + ' bytes), cache ' + V);
