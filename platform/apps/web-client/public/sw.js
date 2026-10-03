// App-shell service worker: the built client works offline as an installed
// app shell. API, game server and content responses are never cached, so
// the server's answers are always live.
const CACHE = "platform-shell-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(["/", "/manifest.webmanifest", "/icon.svg"])));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== location.origin) return;
  if (/^\/(api|ws|platform)\//.test(url.pathname)) return;
  if (url.pathname.startsWith("/assets/")) {
    // Hashed build files never change: cache first.
    event.respondWith(
      caches.match(event.request).then(
        (hit) =>
          hit ??
          fetch(event.request).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(event.request, copy));
            return res;
          }),
      ),
    );
    return;
  }
  // The page itself: network first, cached copy when offline.
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request).then((hit) => hit ?? caches.match("/"))));
});
