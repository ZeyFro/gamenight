/* global self, caches, fetch, URL */

// L7-13 — hors ligne « shell public uniquement ».
//
// Règle produit : le service worker ne met JAMAIS en cache une page HTML de
// l'application, une réponse /api/ ou une réponse liée à une session. Seules
// les ressources listées ci-dessous, publiques et statiques, sont stockées.
// Sur un appareil partagé, rien de ce qui est en cache n'appartient à un
// joueur : la déconnexion n'a donc aucune donnée privée à effacer.
const CACHE_NAME = "gamenight-public-v2";
const OFFLINE_URL = "/offline.html";
const PUBLIC_ASSETS = ["/offline.html", "/manifest.json", "/icon-192.png", "/icon-512.png"];

function isPublicAsset(pathname) {
  return PUBLIC_ASSETS.indexOf(pathname) !== -1;
}

// Autorisation explicite : liste blanche + GET + même origine + jamais l'API
// + jamais une requête authentifiée (en-tête Authorization).
function isCacheableRequest(request, origin) {
  if (!request || request.method !== "GET") return false;
  const url = new URL(request.url);
  if (url.origin !== origin) return false;
  if (url.pathname === "/api" || url.pathname.indexOf("/api/") === 0) return false;
  const headers = request.headers;
  if (headers && typeof headers.get === "function" && headers.get("authorization")) return false;
  return isPublicAsset(url.pathname);
}

function isApiPath(pathname) {
  return pathname === "/api" || pathname.indexOf("/api/") === 0;
}

// Défense en profondeur : même une ressource autorisée n'est stockée que si
// la réponse est publique (pas de cookie de session, pas de no-store/private).
function canStoreResponse(response) {
  if (!response || response.ok !== true) return false;
  const headers = response.headers;
  if (!headers || typeof headers.get !== "function") return true;
  if (headers.get("set-cookie")) return false;
  const cacheControl = headers.get("cache-control") || "";
  if (cacheControl.indexOf("no-store") !== -1 || cacheControl.indexOf("private") !== -1) return false;
  return true;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PUBLIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.indexOf("gamenight-") === 0 && key !== CACHE_NAME)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // 1. Ressource publique de la liste blanche : cache d'abord, réseau sinon.
  if (isCacheableRequest(request, self.location.origin)) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        cache.match(request).then((cached) => cached || fetch(request).then((response) => {
          if (canStoreResponse(response)) return cache.put(request, response.clone()).then(() => response);
          return response;
        }))
      )
    );
    return;
  }

  // 2. Navigation : réseau uniquement, la page n'est jamais stockée.
  //    Hors ligne, la page statique prend le relais (aucun écran blanc).
  if (request.method !== "GET" || request.mode !== "navigate" || url.origin !== self.location.origin) return;
  if (isApiPath(url.pathname)) return;

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
