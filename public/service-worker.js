/* global self, caches, fetch, URL */
const CACHE_NAME = "gamenight-offline-v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.add(OFFLINE_URL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith("gamenight-offline-") && key !== CACHE_NAME)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || request.mode !== "navigate" || url.origin !== self.location.origin || url.pathname === "/api" || url.pathname.startsWith("/api/")) return;

  event.respondWith(
    fetch(request).catch(() =>
      caches.open(CACHE_NAME).then((cache) => cache.match(OFFLINE_URL))
    )
  );
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    const received = event.data ? event.data.json() : null;
    if (received && typeof received === "object") payload = received;
  } catch { payload = {}; }
  const title = typeof payload.title === "string" ? payload.title.slice(0, 120) : "GameNight";
  const body = typeof payload.body === "string" ? payload.body.slice(0, 500) : "Nouvelle notification";
  const path = typeof payload.url === "string" && payload.url.startsWith("/") && !payload.url.startsWith("//")
    ? payload.url
    : "/";
  const destination = new URL(path, self.location.origin);
  event.waitUntil(self.registration.showNotification(title || "GameNight", {
    body: body || "Nouvelle notification",
    data: { url: destination.origin === self.location.origin ? destination.pathname + destination.search + destination.hash : "/" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = typeof event.notification.data?.url === "string" && event.notification.data.url.startsWith("/") && !event.notification.data.url.startsWith("//")
    ? event.notification.data.url
    : "/";
  const destination = new URL(path, self.location.origin);
  const target = destination.origin === self.location.origin ? destination.href : new URL("/", self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
    const existing = clients.find((client) => new URL(client.url).origin === self.location.origin);
    if (existing) return existing.navigate(target).then(() => existing.focus());
    return self.clients.openWindow(target);
  }));
});
