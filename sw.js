// ─── VERSION : à changer ici uniquement ───────────────────
const VERSION    = '1.6';
const CACHE_NAME = 'anomalies-kit-v' + VERSION;
// ──────────────────────────────────────────────────────────

const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[SW] Cache ouvert — version', VERSION);
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => {
          console.log('[SW] Suppression ancien cache :', key);
          return caches.delete(key);
        })
      )
    )
  );
  self.clients.claim();
});

// ── Répond aux demandes de version depuis le HTML ──
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'GET_VERSION') {
    event.source.postMessage({ type: 'VERSION', version: VERSION });
  }
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (
    request.url.includes('firebaseio.com') ||
    request.url.includes('googleapis.com') ||
    request.url.includes('firestore.googleapis.com') ||
    request.url.includes('identitytoolkit.googleapis.com') ||
    request.url.includes('securetoken.googleapis.com')
  ) { return; }

  event.respondWith(
    fetch(request)
      .then(response => {
        if (response && response.status === 200 && response.type === 'basic') {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, responseClone));
        }
        return response;
      })
      .catch(() =>
        caches.match(request).then(cached => {
          if (cached) return cached;
          if (request.mode === 'navigate') return caches.match('/index.html');
        })
      )
  );
});
