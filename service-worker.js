const STATIC_CACHE = 'salud-mental-static-v1';
const STATIC_ASSETS = [
  '/manifest.webmanifest',
  '/styles.css',
  '/organization-v055.css',
  '/report-v056.css?v=20260909-4',
  '/icons/app-icon-192.png',
  '/icons/app-icon-512.png',
  '/icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== STATIC_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  // Las navegaciones y el HTML siempre pasan por la red: ninguna entrevista ni
  // estado clínico se guarda en la caché de instalación.
  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(fetch(request));
    return;
  }

  if (!STATIC_ASSETS.includes(`${url.pathname}${url.search}`) && !STATIC_ASSETS.includes(url.pathname)) return;

  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request))
  );
});
