// Service worker: rede primeiro, cache como reserva (funciona offline sem servir versão velha).
const CACHE = 'gif-maker-v2';
const ASSETS = [
  './', 'index.html', 'css/style.css',
  'js/app.js', 'js/render.js', 'js/encoder.js', 'js/video.js', 'js/gifdecode.js', 'js/videoexport.js', 'js/camera.js',
  'vendor/gif.js', 'vendor/gif.worker.js', 'vendor/cropper.min.js', 'vendor/cropper.min.css',
  'assets/icon.svg', 'assets/icon-192.png', 'manifest.webmanifest',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }))
  );
});
