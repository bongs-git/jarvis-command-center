// Offline shell for the installed app. Market data, fonts and voice models always go to the network
// (the voice models are cached by the browser's own model cache after the first download).
const CACHE = 'indai-v3';
const SHELL = ['./', './index.html', './manifest.webmanifest', './vendor/three.module.js', './vendor/three.core.js',
  './js/main.js', './js/ui.js', './js/hud.js', './js/panels.js', './js/feeds.js', './js/market.js', './js/store.js',
  './js/indai.js', './js/voice.js', './js/relay.js', './js/options.js', './js/analysis.js', './js/gestures.js', './js/signals.js', './js/scenes.js',
  './icons/icon-192.png', './icons/icon-512.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // The big on-device voice runtime is fetched straight from the network (and the HTTP cache).
  if (url.pathname.includes('/vendor/ort/') || url.pathname.endsWith('voice-worker.js')) return;
  // network first so updates show up right away; cache is the offline fallback
  e.respondWith(fetch(e.request).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return res; }).catch(() => caches.match(e.request).then(r => r || caches.match('./index.html'))));
});
