// The service worker: keeps a copy of every file of the app, so that Acari
// opens — and can be installed — with no network at all. It never touches
// anything off this origin; the remote control's own connections go around it.
//
// VERSION names the cache. It must equal <meta name="version"> in index.html
// (scripts/gates.sh checks): a new version is a new file here, which is what
// makes a browser fetch the new app, all of it at once, and drop the old.
const VERSION = '0.4.0';
const CACHE = 'tick-' + VERSION;
// Every file the app is made of. The gates fail if app/ and this list differ.
const FILES = [
  './',
  'tick.css',
  'manifest.webmanifest',
  'js/main.js',
  'js/timer.js',
  'js/pad.js',
  'js/util.js',
  'js/queue.js',
  'js/transport.js',
  'js/qr.js',
  'vendor/peerjs.min.js',
  'icons/icon.svg',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', e => {
  // All or nothing: addAll rejects if any file fails, and the old copy stays.
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('tick-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // The copy first — a timer on stage shouldn't wait on a weak connection —
  // and the network only for what isn't in it.
  e.respondWith(caches.match(e.request, {ignoreSearch: true}).then(hit => hit ?? fetch(e.request)));
});
