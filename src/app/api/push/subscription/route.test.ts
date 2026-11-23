import { beforeEach, describe, expect, it, vi } from "vitest";

const { getValidSession, findUnique } = vi.hoisted(() => ({ getValidSession: vi.fn(), findUnique: vi.fn() }));
vi.mock("@/lib/valid-session", () => ({ getValidSession }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique }, webPushSubscription: { findUnique: vi.fn(), count: vi.fn(), deleteMany: vi.fn() } } }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { DELETE, POST } from "./route";

/** Audit du 23/11/2026 (A04) : l'enregistrement d'abonnements push n'avait aucune limite de débit. */
const request = (method: string) => new Request("https://gamenight.test/api/push/subscription", { method, body: "{}", headers: { "content-type": "application/json" } });

describe("/api/push/subscription : limite de débit par membre", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getValidSession.mockResolvedValue({ user: { discordId: "42" } });
    findUnique.mockResolvedValue({ id: "limite-push-" + Math.random() });
  });

  it("au-delà de 10 appels par minute : 429 avec Retry-After, sans toucher à la configuration ni à la base", async () => {
    // Un identifiant propre au test : le compteur est en mémoire de l'instance.
    findUnique.mockResolvedValue({ id: "limite-push-A" });
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await DELETE(request("DELETE"))).status);
    expect(statuses.slice(0, 10).every((s) => s === 400)).toBe(true); // corps invalide : refusé après le contrôle de débit
    expect(statuses.slice(10)).toEqual([429, 429]);
    const limited = await POST(request("POST"));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("10");
    expect((await limited.json()).error).toBe("rate_limited");
  });

  it("le compteur est propre à chaque membre", async () => {
    findUnique.mockResolvedValue({ id: "limite-push-B" });
    expect((await DELETE(request("DELETE"))).status).toBe(400);
  });

  it("non authentifié : 401, avant tout comptage", async () => {
    getValidSession.mockResolvedValue(null);
    expect((await POST(request("POST"))).status).toBe(401);
  });
});
