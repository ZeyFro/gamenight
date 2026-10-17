import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

const workerSource = readFileSync(fileURLToPath(new URL("../../public/service-worker.js", import.meta.url)), "utf8");

function loadWorker(fetchImpl: ReturnType<typeof vi.fn>, offlinePage = "offline page") {
  const handlers: Record<string, (event: never) => void> = {};
  const cache = { add: vi.fn(), match: vi.fn().mockResolvedValue(offlinePage) };
  const caches = {
    open: vi.fn().mockResolvedValue(cache),
    keys: vi.fn().mockResolvedValue(["gamenight-offline-v0", "unrelated-cache"]),
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
    addEventListener: vi.fn((type: string, listener: (event: never) => void) => { handlers[type] = listener; }),
  };
  runInNewContext(workerSource, { self, caches, fetch: fetchImpl, URL, Promise });
  return { handlers, caches, cache, self, showNotification, client, openWindow };
}

describe("offline service worker", () => {
  it("precaches only the static offline page and removes only its previous cache on activation", async () => {
    const worker = loadWorker(vi.fn());
    let install: Promise<unknown> | undefined;
    worker.handlers.install({ waitUntil: (promise: Promise<unknown>) => { install = promise; } } as never);
    await install;
    expect(worker.caches.open).toHaveBeenCalledWith("gamenight-offline-v1");
    expect(worker.cache.add).toHaveBeenCalledWith("/offline.html");
    expect(worker.self.skipWaiting).toHaveBeenCalled();

    let activate: Promise<unknown> | undefined;
    worker.handlers.activate({ waitUntil: (promise: Promise<unknown>) => { activate = promise; } } as never);
    await activate;
    expect(worker.caches.delete).toHaveBeenCalledExactlyOnceWith("gamenight-offline-v0");
    expect(worker.self.clients.claim).toHaveBeenCalled();
  });

  it("uses the static fallback after a failed same-origin page navigation without caching the page", async () => {
    const network = vi.fn().mockRejectedValue(new TypeError("offline"));
    const worker = loadWorker(network);
    let response: Promise<unknown> | undefined;
    worker.handlers.fetch({
      request: { method: "GET", mode: "navigate", url: "https://gamenight.example/bibliotheque" },
      respondWith: (promise: Promise<unknown>) => { response = promise; },
    } as never);
    await expect(response).resolves.toBe("offline page");
    expect(network).toHaveBeenCalledOnce();
    expect(worker.cache.match).toHaveBeenCalledWith("/offline.html");
    expect("put" in worker.cache).toBe(false);
  });

  it("returns online authenticated pages directly without storing their response", async () => {
    const privatePage = { body: "private account page" };
    const network = vi.fn().mockResolvedValue(privatePage);
    const worker = loadWorker(network);
    let response: Promise<unknown> | undefined;
    worker.handlers.fetch({
      request: { method: "GET", mode: "navigate", url: "https://gamenight.example/bibliotheque" },
      respondWith: (promise: Promise<unknown>) => { response = promise; },
    } as never);
    await expect(response).resolves.toBe(privatePage);
    expect(worker.cache.match).not.toHaveBeenCalled();
    expect("put" in worker.cache).toBe(false);
  });

  it("shows push notifications and rejects external click destinations", async () => {
    const worker = loadWorker(vi.fn());
    let push: Promise<unknown> | undefined;
    worker.handlers.push({ data: { json: () => ({ title: "Soirée", body: "Invitation", url: "//evil.example" }) }, waitUntil: (promise: Promise<unknown>) => { push = promise; } } as never);
    await push;
    expect(worker.showNotification).toHaveBeenCalledWith("Soirée", { body: "Invitation", data: { url: "/" } });

    let click: Promise<unknown> | undefined;
    worker.handlers.notificationclick({ notification: { data: { url: "//evil.example" }, close: vi.fn() }, waitUntil: (promise: Promise<unknown>) => { click = promise; } } as never);
    await click;
    expect(worker.client.navigate).toHaveBeenCalledWith("https://gamenight.example/");
    expect(worker.client.focus).toHaveBeenCalledOnce();
  });

  it("handles empty or malformed push data with a safe default", async () => {
    const worker = loadWorker(vi.fn());
    let push: Promise<unknown> | undefined;
    worker.handlers.push({ data: { json: () => null }, waitUntil: (promise: Promise<unknown>) => { push = promise; } } as never);
    await push;
    expect(worker.showNotification).toHaveBeenCalledWith("GameNight", { body: "Nouvelle notification", data: { url: "/" } });
  });

  it.each([
    { method: "POST", mode: "navigate", url: "https://gamenight.example/session" },
    { method: "GET", mode: "same-origin", url: "https://gamenight.example/api/profile" },
    { method: "GET", mode: "navigate", url: "https://gamenight.example/api/profile" },
    { method: "GET", mode: "no-cors", url: "https://gamenight.example/_next/static/chunk.js" },
    { method: "GET", mode: "navigate", url: "https://external.example/" },
  ])("does not intercept non-navigation or cross-origin requests: $method $url", (request) => {
    const network = vi.fn();
    const worker = loadWorker(network);
    const event = { request, respondWith: vi.fn() };
    worker.handlers.fetch(event as never);
    expect(event.respondWith).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
  });
});
