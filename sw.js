/*
 * Offline support. Serves the app's own files from a cache and refreshes them in the background.
 * It never touches cross-origin requests (the AI providers) and never stores any of your data:
 * your data lives in IndexedDB, which this file cannot read.
 */
'use strict';
const CACHE = 'regoal-shell-v24';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/engine.js', 'js/diet.js', 'js/goals.js', 'js/util.js', 'js/crypto.js', 'js/store.js', 'js/llm.js', 'js/foods.js', 'js/foodai.js', 'js/liftai.js', 'js/photoalignai.js', 'js/coach.js', 'js/ui.js',
  'js/screens-diet.js', 'js/screens-goals.js', 'js/screens-onboard.js', 'js/screens-today.js', 'js/screens-water.js', 'js/screens-activity.js', 'js/screens-fuel.js', 'js/screens-progress.js', 'js/screens-profile.js', 'js/library.js', 'js/screens-library.js', 'js/mediaexport.js', 'js/screens-trend.js', 'js/screens-export.js', 'js/reel.js', 'js/screens-reel.js', 'js/screens-coach.js', 'js/screens-settings.js', 'js/app.js',
  'data/foods.json', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
  'fonts/big-shoulders-display-700.woff2', 'fonts/big-shoulders-display-800.woff2', 'fonts/dm-sans-400.woff2', 'fonts/dm-sans-500.woff2', 'fonts/dm-sans-700.woff2',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never intercept AI provider calls
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    const refresh = fetch(req).then((res) => { if (res && res.ok && res.type === 'basic') cache.put(req, res.clone()); return res; }).catch(() => null);
    if (hit) { e.waitUntil(refresh); return hit; }
    const res = await refresh;
    if (res) return res;
    if (req.mode === 'navigate') { const idx = await cache.match('index.html'); if (idx) return idx; }
    return new Response('Offline', { status: 503, headers: { 'content-type': 'text/plain' } });
  })());
});
