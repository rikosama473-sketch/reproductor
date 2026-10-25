const CACHE_NAME = "ritmo-shell-v97";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./src/app.js",
  "./src/library-search.js",
  "./src/library-filters.js",
  "./src/storage.js",
  "./src/playlist-editing.js",
  "./src/youtube-history.js",
  "./src/audio-output-volume.js",
  "./src/media-session-state.js",
  "./src/equalizer-presets.js",
  "./src/import-fingerprint.js",
  "./src/id3-tags.js",
  "./src/vorbis-comments.js",
  "./src/audio-converter.js",
  "./src/async-generation-gate.js",
  "./src/playback-position.js",
  "./src/audio-preferences.js",
  "./src/youtube-player-errors.js",
  "./src/online-services.js",
  "./src/character-companion.js",
  "./src/music-recognition.js",
  "./src/music-finder-ui.js",
  "./src/backup.js",
  "./src/backup-ui.js",
  "./src/external-navigation.js",
  "./src/ui-sounds.js",
  "./src/voice-studio.js",
  "./manifest.webmanifest",
  "./assets/icon.svg",
  "./assets/pibara-avatar.webp"
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
    // These files have stable, un-hashed URLs. Prefer the network so fixes can
    // reach clients even if a cache-version bump was accidentally omitted.
    // Keep cache-first for image assets where an old copy is generally harmless.
    const preferNetwork = request.mode === "navigate" ||
      ["document", "script", "style", "manifest"].includes(request.destination);
    if (!preferNetwork) {
      const cached = await caches.match(request);
      if (cached) return cached;
    }
    try {
      const response = await fetch(request);
      // A deployment can briefly return 404/5xx for a shell asset. HTTP errors
      // do not enter catch(), so prefer the last known-good cache copy for those.
      if (response && !response.ok && (response.status === 404 || response.status >= 500)) {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (request.mode === "navigate") {
          const offlinePage = await caches.match("./index.html");
          if (offlinePage) return offlinePage;
        }
      }
      if (response && response.ok && (request.destination === "document" || request.destination === "script" || request.destination === "style" || request.destination === "image" || request.destination === "manifest")) {
        const copy = response.clone();
        // Keep the service worker alive while a runtime cache write completes,
        // and swallow quota/storage errors instead of creating an unhandled rejection.
        const cacheWrite = caches.open(CACHE_NAME).then(cache => cache.put(request, copy)).catch(() => {});
        event.waitUntil(cacheWrite);
      }
      return response;
    } catch {
      // Network-first resources still fall back to the most recently cached
      // copy on flaky/offline connections.
      const cached = await caches.match(request);
      if (cached) return cached;
      if (request.mode === "navigate") {
        const offlinePage = await caches.match("./index.html");
        if (offlinePage) return offlinePage;
      }
      throw new Error("Recurso no disponible sin conexión");
    }
  })());
});