const CACHE_NAME = "ritmo-shell-v6";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./src/app.js",
  "./src/storage.js",
  "./manifest.webmanifest",
  "./assets/icon.svg"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith("ritmo-shell-") && key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response && response.ok && (request.destination === "document" || request.destination === "script" || request.destination === "style" || request.destination === "image" || request.destination === "manifest")) {
        const copy = response.clone();
        // Keep the service worker alive while a runtime cache write completes,
        // and swallow quota/storage errors instead of creating an unhandled rejection.
        const cacheWrite = caches.open(CACHE_NAME).then(cache => cache.put(request, copy)).catch(() => {});
        event.waitUntil(cacheWrite);
      }
      return response;
    } catch {
      if (request.mode === "navigate") {
        const offlinePage = await caches.match("./index.html");
        if (offlinePage) return offlinePage;
      }
      throw new Error("Recurso no disponible sin conexión");
    }
  })());
});