const CACHE_NAME = "changeplace-pwa-v42";
const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./assets/icon.svg",
  "./assets/avatars/cat-1.svg",
  "./assets/avatars/cat-2.svg",
  "./assets/avatars/cat-3.svg",
  "./assets/avatars/cat-4.svg",
  "./assets/avatars/cat-5.svg",
  "./assets/vendor/leaflet/leaflet.css",
  "./assets/vendor/leaflet/leaflet.js",
  "./assets/vendor/leaflet/layers.png",
  "./assets/vendor/leaflet/layers-2x.png",
  "./assets/vendor/leaflet/marker-icon.png",
  "./assets/vendor/leaflet/marker-icon-2x.png",
  "./assets/vendor/leaflet/marker-shadow.png",
  "./assets/vendor/leaflet-markercluster/MarkerCluster.css",
  "./assets/vendor/leaflet-markercluster/MarkerCluster.Default.css",
  "./assets/vendor/leaflet-markercluster/leaflet.markercluster.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const requestUrl = new URL(request.url);
  if (requestUrl.origin === self.location.origin && requestUrl.pathname.startsWith("/api/")) {
    event.respondWith(fetch(request));
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request)
        .then((response) => {
          const shouldCache =
            response.ok &&
            !request.url.endsWith("/config.js") &&
            (request.url.startsWith(self.location.origin) ||
              request.url.includes("cartocdn.com"));

          if (shouldCache) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }

          return response;
        })
        .catch(() => {
          if (request.mode === "navigate") return caches.match("./index.html");
          return new Response("", { status: 503, statusText: "Offline" });
        });
    }),
  );
});
