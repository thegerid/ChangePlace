const CACHE_NAME = "changeplace-pwa-v32";
const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./assets/icon.svg",
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

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request)
        .then((response) => {
          const shouldCache =
            response.ok &&
            !request.url.endsWith("/config.js") &&
            (request.url.startsWith(self.location.origin) ||
              request.url.includes("unpkg.com") ||
              request.url.includes("jsdelivr.net") ||
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
