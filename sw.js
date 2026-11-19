// Offline shell for the installed app. Market data, fonts and voice models always go to the network
// (the voice models are cached by the browser's own model cache after the first download).
const CACHE = 'indai-v7';
const SHELL = ['./', './index.html', './manifest.webmanifest', './vendor/three.module.js', './vendor/three.core.js',
  './js/main.js', './js/ui.js', './js/hud.js', './js/panels.js', './js/feeds.js', './js/market.js', './js/store.js',
  './js/indai.js', './js/voice.js', './js/relay.js', './js/options.js', './js/analysis.js', './js/gestures.js', './js/speech.js', './js/signals.js', './js/scenes.js',
  './icons/icon-192.png', './icons/icon-512.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
// Cross-origin isolation: with these two headers the browser lets the voice models run on several CPU cores
// (about 3x faster listening and speaking on the headset). Browsers that don't know "credentialless" ignore it.
function isolate(res) {
  if (!res || res.status === 0 || res.type === 'opaque' || res.type === 'opaqueredirect') return res;
  const h = new Headers(res.headers);
  h.set('Cross-Origin-Opener-Policy', 'same-origin');
  h.set('Cross-Origin-Embedder-Policy', 'credentialless');
  h.set('Cross-Origin-Resource-Policy', 'cross-origin');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // The big on-device voice runtime is fetched straight from the network (and the HTTP cache).
  if (url.pathname.includes('/vendor/ort/') || url.pathname.endsWith('voice-worker.js')) { e.respondWith(fetch(e.request).then(isolate)); return; }
  // network first, always revalidated, so a new version shows up on the very next launch; cache is the offline fallback
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return isolate(res); }).catch(() => caches.match(e.request).then(r => isolate(r) || caches.match('./index.html').then(isolate))));
});
