'use strict';

const CACHE_NAME = 'ferrisoluciones-inventario-0.2.0-20260906.9';
const APP_SHELL = [
  '/',
  '/index.html',
  '/styles.css',
  '/provider-base.css',
  '/app.js',
  '/js/comparador.js',
  '/js/facturas.js',
  '/js/ocr-clave.js',
  '/version.json',
  '/manifest.webmanifest',
  '/img/brand/ferrisoluciones.png',
  '/vendor/fontawesome/css/all-6.5.2.min.css',
  '/vendor/supabase/supabase-2.45.4.min.js',
  '/vendor/jspdf/jspdf-2.5.1.umd.min.js',
  '/vendor/jspdf/autotable-3.5.29.min.js',
  '/vendor/zxing/zxing-browser-0.2.1.min.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  event.respondWith(
    fetch(request, { cache: 'no-store' })
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (request.mode === 'navigate') return caches.match('/index.html');
        throw new Error('Recurso no disponible sin conexión');
      })
  );
});
