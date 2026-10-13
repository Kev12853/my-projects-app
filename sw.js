
const CACHE_NAME = 'my-projects-offline-v7';
const SHELL = [
  './',
  './index.html',
  './config.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(SHELL.map(async url => {
      try {
        const response = await fetch(url, { cache: 'reload' });
        if (response.ok) await cache.put(url, response);
      } catch (_) {}
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter(key =>
        key.startsWith('my-projects-offline-') &&
        key !== CACHE_NAME
      )
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.protocol === 'chrome-extension:') return;

  // Never cache Supabase API or authentication traffic.
  if (url.hostname.endsWith('.supabase.co')) return;

  // Cache the Supabase JavaScript library for offline use.
  if (url.hostname === 'cdn.jsdelivr.net') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(event.request);
      if (cached) return cached;

      const response = await fetch(event.request);
      if (response.ok) {
        await cache.put(event.request, response.clone());
      }
      return response;
    })());
    return;
  }

  if (url.origin !== self.location.origin) return;

  // Prefer current app files from the network; use cache offline.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      const response = await fetch(event.request, {
        cache: 'no-store'
      });
      if (response.ok) {
        await cache.put(event.request, response.clone());
      }
      return response;
    } catch (_) {
      const cached = await cache.match(event.request);
      if (cached) return cached;

      if (event.request.mode === 'navigate') {
        const appShell = await cache.match('./index.html');
        if (appShell) return appShell;
      }
      throw _;
    }
  })());
});
