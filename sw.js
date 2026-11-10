/* Pecan Pie service worker: keeps the app's own files on the phone so it opens instantly and on a weak signal.
   Only same-origin files are handled. Map tiles, OpenStreetMap lookups and logging always go to the network. */
const CACHE = 'pecan-shell-v2.3';
const SHELL = [
  './', 'index.html', 'guide.html', 'survey.html', 'report.html', 'manifest.webmanifest',
  'css/engine.css?v=2.3', 'css/pilot.css?v=2.3', 'css/forms.css?v=2.3',
  'js/mapstyle.js?v=2.3', 'js/engine.js?v=2.3', 'js/pilot.js?v=2.3', 'js/forms.js?v=2.3', 'js/config.js',
  'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css',
  'vendor/maplibre/maplibre-gl.js', 'vendor/maplibre/maplibre-gl.css', 'vendor/maplibre/leaflet-maplibre-gl.js',
  'icons/icon-192.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png'
];

self.addEventListener('install', e => {
  // cache:'reload' skips the browser's HTTP cache (GitHub Pages lets it keep files for 10 minutes), so a new version never stores stale copies.
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, {cache:'reload'})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  const path = url.pathname;
  // The page and the hand-edited config: network first so updates and endpoint changes arrive immediately.
  if (req.mode === 'navigate' || path.endsWith('/') || path.endsWith('index.html') || path.endsWith('js/config.js')){
    const key = path.endsWith('js/config.js') ? new URL('js/config.js', self.registration.scope).href : req;
    // cache:'no-cache' asks the server every time (a cheap 304 when nothing changed) instead of reusing a page the browser kept.
    const net = () => fetch(req, {cache:'no-cache'}).catch(err => req.mode === 'navigate' ? fetch(req) : Promise.reject(err));
    e.respondWith(net().then(res => {
      if (res.ok){ const copy = res.clone(); caches.open(CACHE).then(c => c.put(key, copy)); }
      return res;
    }).catch(() => caches.match(key, {ignoreSearch:true}).then(r => r || caches.match('index.html'))));
    return;
  }
  // Everything else is versioned or rarely changes: cache first, then network, and keep what we fetch.
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
    if (res.ok){ const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  })));
});
