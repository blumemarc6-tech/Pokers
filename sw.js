/* POKETA – Service Worker: App öffnet auch offline (letzter Stand), Daten kommen weiter live */
const CACHE = 'poketa-__BUILD__';
const SHELL = ['/', '/config.js', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if(e.request.method !== 'GET' || url.origin !== location.origin) return;   // Supabase, TCGdex usw. immer live
  if(url.pathname.startsWith('/icons/')){
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
    return;
  }
  // Seite & config.js: zuerst Netz (immer aktuell), offline aus dem Cache
  e.respondWith(
    fetch(e.request).then(r => {
      if(r.ok){ const copy = r.clone(); caches.open(CACHE).then(c => c.put(url.pathname === '/index.html' ? '/' : e.request, copy)); }
      return r;
    }).catch(() => caches.match(e.request, {ignoreSearch: true}).then(r => r || caches.match('/')))
  );
});
