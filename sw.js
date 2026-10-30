/* Offline cache: app shell + generated command data. */
/* Bump VERSION whenever data/*.json or the shell changes, so returning visitors drop the
   old cache. `npm run check:cache` fails CI when a rebuilt dataset ships a stale name. */
const VERSION = "oscp-cheat-v9";
const CACHE = VERSION;
const SHELL = [
  "./",
  "./index.html",
  "./assets/app.css",
  "./assets/app.js",
  "./assets/engine.js",
  "./data/commands.json",
  "./data/variables.json",
  "./data/meta.json",
  "./manifest.webmanifest",
  "./icons/icon.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      // Cache what we can; one missing optional asset must not break install.
      await Promise.allSettled(SHELL.map((url) => cache.add(url)));
      self.skipWaiting();
    })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Retire older caches only once this version has something cached. An
      // install that ran with no network leaves CACHE empty; deleting the
      // previous cache at that point would destroy the user's only offline copy.
      const primed = (await (await caches.open(CACHE)).keys()).length > 0;
      if (primed) {
        const keys = await caches.keys();
        await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      }
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((c) => c.put("./index.html", copy)).catch(() => {});
          return response;
        })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  if (url.pathname.endsWith(".json")) {
    // stale-while-revalidate: instant offline data, fresh data next load
    event.respondWith(
      caches.match(request).then((cached) => {
        const network = fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
          }
          return response;
        }).catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) =>
      cached || fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
        }
        return response;
      })
    )
  );
});
