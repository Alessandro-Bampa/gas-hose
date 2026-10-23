/*
 * sw.js — service worker: rende Hose installabile e utilizzabile senza connessione.
 *
 * Strategia "prima la rete": online si carica sempre l'ultima versione pubblicata,
 * offline si usa la copia salvata. Qui passano solo i file dell'app: i dati non
 * transitano mai dal service worker (restano nella cartella scelta o nel browser).
 * Se cambi l'elenco dei file, aumenta il numero di versione di CACHE.
 */
const CACHE = 'hose-v2';
const FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/style.css',
  'js/xlsx-lite.js',
  'js/xls-lite.js',
  'js/model.js',
  'js/bank-import.js',
  'js/store.js',
  'js/charts.js',
  'js/app.js',
  'icons/favicon-32.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-192.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(cache => cache.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true })
        .then(hit => hit || (req.mode === 'navigate' ? caches.match('index.html') : Response.error())))
  );
});
