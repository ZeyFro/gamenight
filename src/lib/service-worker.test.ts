import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

const workerSource = readFileSync(fileURLToPath(new URL("../../public/service-worker.js", import.meta.url)), "utf8");

const OFFLINE_PAGE = "page hors ligne";

type FetchEventLike = { request: ReturnType<typeof request>; respondWith: ReturnType<typeof vi.fn> };

function request(init: { url: string; method?: string; mode?: string; authorization?: string }) {
  return {
    url: init.url,
    method: init.method ?? "GET",
    mode: init.mode ?? "same-origin",
    headers: {
      get: (name: string) => (name.toLowerCase() === "authorization" ? init.authorization ?? null : null),
    },
  };
}

function response(body: string, headers: Record<string, string> = {}) {
  const value = {
    body,
    ok: true,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    clone: () => value,
  };
  return value;
}

function loadWorker(fetchImpl: ReturnType<typeof vi.fn>) {
  const handlers: Record<string, (event: never) => void> = {};
  const store = new Map<string, unknown>([["/offline.html", OFFLINE_PAGE]]);
  const cache = {
    store,
    addAll: vi.fn(async (urls: string[]) => {
      for (const url of urls) store.set(url, `précaché:${url}`);
    }),
    match: vi.fn(async (input: string | { url: string }) => store.get(typeof input === "string" ? input : input.url)),
    put: vi.fn(async (input: { url: string }, value: unknown) => {
      store.set(input.url, value);
    }),
  };
  const caches = {
    open: vi.fn().mockResolvedValue(cache),
    keys: vi.fn().mockResolvedValue(["gamenight-offline-v0", "gamenight-public-v1", "unrelated-cache"]),
    delete: vi.fn().mockResolvedValue(true),
  };
  const showNotification = vi.fn().mockResolvedValue(undefined);
  const client = { url: "https://gamenight.example/", navigate: vi.fn().mockResolvedValue(undefined), focus: vi.fn().mockResolvedValue(undefined) };
  const openWindow = vi.fn().mockResolvedValue(client);
  const self = {
    location: { origin: "https://gamenight.example" },
    clients: { claim: vi.fn(), matchAll: vi.fn().mockResolvedValue([client]), openWindow },
    registration: { showNotification },
    skipWaiting: vi.fn(),
    addEventListener: vi.fn((type: string, listener: (event: never) => void) => {
      handlers[type] = listener;
    }),
  };
  runInNewContext(workerSource, { self, caches, fetch: fetchImpl, URL, Promise });
  return { handlers, caches, cache, self, showNotification, client, openWindow };
}

function fire(worker: ReturnType<typeof loadWorker>, req: ReturnType<typeof request>) {
  const event: FetchEventLike = { request: req, respondWith: vi.fn() };
  worker.handlers.fetch(event as never);
  return event;
}

async function runInstall(worker: ReturnType<typeof loadWorker>) {
  let install: Promise<unknown> | undefined;
  worker.handlers.install({ waitUntil: (promise: Promise<unknown>) => { install = promise; } } as never);
  await install;
}

describe("service worker hors ligne (L7-13)", () => {
  it("précache uniquement la liste blanche publique", async () => {
    const worker = loadWorker(vi.fn());
    await runInstall(worker);
    expect(worker.caches.open).toHaveBeenCalledWith("gamenight-public-v2");
    expect(worker.cache.addAll).toHaveBeenCalledExactlyOnceWith([
      "/offline.html",
      "/manifest.json",
      "/icon-192.png",
      "/icon-512.png",
    ]);
    expect(worker.self.skipWaiting).toHaveBeenCalled();
  });

  it("supprime seulement les anciens caches GameNight à l'activation", async () => {
    const worker = loadWorker(vi.fn());
    let activate: Promise<unknown> | undefined;
    worker.handlers.activate({ waitUntil: (promise: Promise<unknown>) => { activate = promise; } } as never);
    await activate;
    expect(worker.caches.delete.mock.calls.map(([key]) => key)).toEqual(["gamenight-offline-v0", "gamenight-public-v1"]);
    expect(worker.self.clients.claim).toHaveBeenCalled();
  });

  it("sert une ressource publique depuis le cache sans rappeler le réseau", async () => {
    const network = vi.fn().mockResolvedValue(response("manifeste"));
    const worker = loadWorker(network);
    const first = fire(worker, request({ url: "https://gamenight.example/manifest.json" }));
    await expect(first.respondWith.mock.calls[0][0]).resolves.toBeDefined();
    expect(network).toHaveBeenCalledOnce();
    expect(worker.cache.put).toHaveBeenCalledOnce();

    const second = fire(worker, request({ url: "https://gamenight.example/manifest.json" }));
    await expect(second.respondWith.mock.calls[0][0]).resolves.toBeDefined();
    expect(network).toHaveBeenCalledOnce();
  });

  it("ne stocke pas une ressource publique servie avec un cookie de session", async () => {
    const network = vi.fn().mockResolvedValue(response("manifeste", { "set-cookie": "authjs.session-token=secret" }));
    const worker = loadWorker(network);
    const event = fire(worker, request({ url: "https://gamenight.example/manifest.json" }));
    await expect(event.respondWith.mock.calls[0][0]).resolves.toBeDefined();
    expect(worker.cache.put).not.toHaveBeenCalled();
    expect([...worker.cache.store.values()]).not.toContainEqual(expect.objectContaining({ body: "manifeste" }));
  });

  it.each([{ "cache-control": "private, max-age=0" }, { "cache-control": "no-store" }])(
    "ne stocke pas une réponse marquée %o",
    async (headers) => {
      const network = vi.fn().mockResolvedValue(response("manifeste", headers));
      const worker = loadWorker(network);
      const event = fire(worker, request({ url: "https://gamenight.example/manifest.json" }));
      await expect(event.respondWith.mock.calls[0][0]).resolves.toBeDefined();
      expect(worker.cache.put).not.toHaveBeenCalled();
    }
  );

  it("n'intercepte ni ne cache une requête authentifiée", () => {
    const network = vi.fn();
    const worker = loadWorker(network);
    const event = fire(worker, request({ url: "https://gamenight.example/offline.html", authorization: "Bearer secret" }));
    expect(event.respondWith).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
    expect(worker.cache.put).not.toHaveBeenCalled();
  });

  it("sert les pages privées par le réseau et ne les stocke jamais", async () => {
    const privatePage = response("compte de Maxime");
    const network = vi.fn().mockResolvedValue(privatePage);
    const worker = loadWorker(network);
    const event = fire(worker, request({ url: "https://gamenight.example/bibliotheque", mode: "navigate" }));
    await expect(event.respondWith.mock.calls[0][0]).resolves.toBe(privatePage);
    expect(network).toHaveBeenCalledOnce();
    expect(worker.cache.put).not.toHaveBeenCalled();
    expect(worker.cache.match).not.toHaveBeenCalled();
  });

  it("affiche la page hors ligne quand une page privée échoue, sans la stocker", async () => {
    const network = vi.fn().mockRejectedValue(new TypeError("offline"));
    const worker = loadWorker(network);
    const event = fire(worker, request({ url: "https://gamenight.example/sessions", mode: "navigate" }));
    await expect(event.respondWith.mock.calls[0][0]).resolves.toBe(OFFLINE_PAGE);
    expect(worker.cache.match).toHaveBeenCalledWith("/offline.html");
    expect(worker.cache.put).not.toHaveBeenCalled();
  });

  it.each([
    { method: "POST", mode: "navigate", url: "https://gamenight.example/session" },
    { method: "GET", mode: "same-origin", url: "https://gamenight.example/api/profile" },
    { method: "GET", mode: "navigate", url: "https://gamenight.example/api/profile" },
    { method: "GET", mode: "navigate", url: "https://external.example/" },
  ])("n'intercepte pas $method $url", (init) => {
    const network = vi.fn();
    const worker = loadWorker(network);
    const event = fire(worker, request(init));
    expect(event.respondWith).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
    expect(worker.cache.put).not.toHaveBeenCalled();
  });

  it("appareil partagé : après déconnexion, le cache ne contient que des ressources publiques", async () => {
    // Parcours : joueur connecté → page privée → API → déconnexion → hors ligne.
    const network = vi.fn().mockRejectedValue(new TypeError("offline"));
    const worker = loadWorker(network);
    await runInstall(worker);
    const routes = [
      { url: "https://gamenight.example/bibliotheque", mode: "navigate" },
      { url: "https://gamenight.example/profil", mode: "navigate" },
      { url: "https://gamenight.example/api/profile" },
      { url: "https://gamenight.example/sessions/42", mode: "navigate" },
      { url: "https://gamenight.example/", mode: "navigate" },
    ];
    for (const route of routes) fire(worker, request(route));

    expect(worker.cache.put).not.toHaveBeenCalled();
    const stored = [...worker.cache.store.keys()].sort();
    expect(stored).toEqual(["/icon-192.png", "/icon-512.png", "/manifest.json", "/offline.html"]);
    expect(JSON.stringify([...worker.cache.store.values()])).not.toContain("compte de Maxime");
  });

  it("affiche les notifications et refuse une destination externe", async () => {
    const worker = loadWorker(vi.fn());
    let push: Promise<unknown> | undefined;
    worker.handlers.push({ data: { json: () => ({ title: "Soirée", body: "Invitation", url: "//evil.example" }) }, waitUntil: (promise: Promise<unknown>) => { push = promise; } } as never);
    await push;
    expect(worker.showNotification).toHaveBeenCalledWith("Soirée", { body: "Invitation", icon: "/icon-192.png", data: { url: "/" } });

    let click: Promise<unknown> | undefined;
    worker.handlers.notificationclick({ notification: { data: { url: "//evil.example" }, close: vi.fn() }, waitUntil: (promise: Promise<unknown>) => { click = promise; } } as never);
    await click;
    expect(worker.client.navigate).toHaveBeenCalledWith("https://gamenight.example/");
    expect(worker.client.focus).toHaveBeenCalledOnce();
  });

  it("tolère une charge push vide ou mal formée", async () => {
    const worker = loadWorker(vi.fn());
    let push: Promise<unknown> | undefined;
    worker.handlers.push({ data: { json: () => null }, waitUntil: (promise: Promise<unknown>) => { push = promise; } } as never);
    await push;
    expect(worker.showNotification).toHaveBeenCalledWith("GameNight", { body: "Nouvelle notification", icon: "/icon-192.png", data: { url: "/" } });
  });
});
