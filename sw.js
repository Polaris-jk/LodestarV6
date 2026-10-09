// Lodestar service worker — makes the app open with no signal.
// When you change any file, bump VERSION so phones download the new app.

const VERSION = 'geo-v0.6.0';
const SHELL_CACHE = `${VERSION}-shell`;
const TILE_CACHE = 'geo-tiles-v1';
const MAX_TILES = 2500; // roughly 40–60 MB of map you have viewed while online

const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'icons/lodestar.svg',
  'css/app.css',
  'css/fonts.css',
  'js/app.js',
  'js/ui.js',
  'js/util.js',
  'js/icons.js',
  'js/geomath.js',
  'js/utm.js',
  'js/geoid-th.js',
  'js/gps.js',
  'js/compass.js',
  'js/db.js',
  'js/store.js',
  'js/vocab.js',
  'js/export.js',
  'js/map.js',
  'js/coords.js',
  'js/gallery.js',
  'js/swipe.js',
  'js/summary.js',
  'js/xlsx.js',
  'js/attitude.js',
  'js/exif.js',
  'js/draw.js',
  'js/smartphoto.js',
  'js/smartauto.js',
  'js/rockcolors.js',
  'js/views/gps-view.js',
  'js/views/station-view.js',
  'js/views/stations-view.js',
  'js/views/map-view.js',
  'js/views/settings-view.js',
  'js/views/projects-view.js',
  'js/views/station-detail.js',
  'js/views/clino.js',
  'js/views/camera.js',
  'js/views/summary-view.js',
  'js/views/export-sheet.js',
  'vendor/leaflet/leaflet.js',
  'vendor/leaflet/leaflet.css',
  'vendor/fflate.js',
  'fonts/ibm-plex-sans-thai-thai-400-normal.woff2',
  'fonts/ibm-plex-sans-thai-latin-400-normal.woff2',
  'fonts/ibm-plex-sans-thai-thai-500-normal.woff2',
  'fonts/ibm-plex-sans-thai-latin-500-normal.woff2',
  'fonts/ibm-plex-sans-thai-thai-600-normal.woff2',
  'fonts/ibm-plex-sans-thai-latin-600-normal.woff2',
  'fonts/ibm-plex-mono-latin-400-normal.woff2',
  'fonts/ibm-plex-mono-latin-500-normal.woff2',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('geo-v') && k !== SHELL_CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.hostname.endsWith('tile.openstreetmap.org')) {
    event.respondWith(tile(req));
    return;
  }
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(caches.match('index.html').then((r) => r || fetch(req)));
    return;
  }
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((r) => r || fetch(req)),
  );
});

let puts = 0;
async function tile(req) {
  const cache = await caches.open(TILE_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    // Only CORS responses: opaque ones are padded to megabytes each and would eat the
    // storage quota that the field notebook itself needs.
    if (res.ok && res.type === 'cors') {
      cache.put(req, res.clone()).then(() => { if (++puts % 50 === 0) trim(cache); }).catch(() => {});
    }
    return res;
  } catch {
    return new Response('', { status: 504, statusText: 'Offline' });
  }
}

async function trim(cache) {
  const keys = await cache.keys();
  const extra = keys.length - MAX_TILES;
  for (let i = 0; i < extra; i++) await cache.delete(keys[i]);
}
