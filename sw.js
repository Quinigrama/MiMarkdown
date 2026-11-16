// Mi Markdown — service worker: funciona sin conexión
const CACHE = 'mi-markdown-v4';
const SHELL = ['./', './index.html', './convert.js', './manifest.json', './icon.svg', './icon-192.png', './icon-512.png'];
const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/';
const CDN = 'https://cdn.jsdelivr.net/npm/';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(async c => {
    await c.addAll(SHELL);
    // Intenta dejar pdf.js guardado desde el principio (si falla, se guardará al usarlo)
    await Promise.allSettled(['pdf.min.mjs', 'pdf.worker.min.mjs'].map(f => c.add(PDFJS + f)));
  }));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = e.request.url;
  // Librerías del CDN (versiones fijas: pdf.js, OCR, ZIP): primero la caché
  if (url.startsWith(CDN)) {
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(res => {
      const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return res;
    })));
    return;
  }
  // Archivos propios: primero la red (para recibir actualizaciones), si no hay conexión, la caché
  if (new URL(url).origin === location.origin) {
    e.respondWith(fetch(e.request).then(res => {
      const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true })));
  }
});
