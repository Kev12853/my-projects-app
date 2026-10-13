const CACHE_NAME = 'my-projects-offline-v3';
const SHELL = ['./', './index.html', './config.js', './manifest.json', './icon-192.png', './icon-512.png', 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'];
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(SHELL.map(async url => { try { await cache.add(url); } catch (_) {} }));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => { const keys=await caches.keys(); await Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k))); await self.clients.claim(); })());
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.protocol === 'chrome-extension:') return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(event.request);
    if (cached) {
      if (url.origin === self.location.origin) fetch(event.request).then(r=>{if(r.ok)cache.put(event.request,r.clone())}).catch(()=>{});
      return cached;
    }
    try { const response=await fetch(event.request); if(response.ok && (url.origin===self.location.origin || url.hostname==='cdn.jsdelivr.net')) cache.put(event.request,response.clone()); return response; }
    catch (_) { if (url.origin===self.location.origin) return (await cache.match('./index.html')); throw _; }
  })());
});
