import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirst = vi.fn();
const update = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: { user: { findFirst: (a: unknown) => findFirst(a), update: (a: unknown) => update(a) } },
}));
const importSteamLibrary = vi.fn();
vi.mock("@/lib/steam", () => ({
  importSteamLibrary: (...a: unknown[]) => importSteamLibrary(...a),
}));
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: (cb: () => void) => void cb() };
});

import { GET, maxDuration } from "./route";

function req(authorization?: string) {
  return new Request("https://example.test/api/cron/steam-library-full-sync", {
    headers: authorization ? { authorization } : {},
  });
}

describe("/api/cron/steam-library-full-sync", () => {
  beforeEach(() => {
    findFirst.mockReset().mockResolvedValue({ id: "u1", steamId64: "7656" });
    update.mockReset().mockResolvedValue({});
    importSteamLibrary.mockReset().mockResolvedValue({ status: "imported", count: 3, newCount: 1 });
    vi.stubEnv("CRON_SECRET", "s3cret");
  });

  it("déclare maxDuration = 300", () => {
    expect(maxDuration).toBe(300);
  });

  it("202, pose steamFullSyncAttemptedAt puis importe avec un deadline", async () => {
    const res = await GET(req("Bearer s3cret"));
    expect(res.status).toBe(202);
    expect(update).toHaveBeenCalledTimes(1);
    expect(importSteamLibrary).toHaveBeenCalledTimes(1);
    const [userId, steamId, opts] = importSteamLibrary.mock.calls[0];
    expect([userId, steamId]).toEqual(["u1", "7656"]);
    expect(opts.deadlineMs).toBeGreaterThan(Date.now());
  });

  it("aucun compte lié → 200 attempted:false, rien importé", async () => {
    findFirst.mockResolvedValue(null);
    const res = await GET(req("Bearer s3cret"));
    expect(await res.json()).toEqual({ attempted: false });
    expect(importSteamLibrary).not.toHaveBeenCalled();
  });

  it("import en erreur → toujours 202 (l'erreur va dans les logs)", async () => {
    importSteamLibrary.mockRejectedValue(new Error("steam down"));
    expect((await GET(req("Bearer s3cret"))).status).toBe(202);
  });

  it("import partial → 202", async () => {
    importSteamLibrary.mockResolvedValue({ status: "partial", processed: 2, total: 9 });
    expect((await GET(req("Bearer s3cret"))).status).toBe(202);
  });

  it("401 sans/avec mauvais Bearer, 503 sans CRON_SECRET, rien lancé", async () => {
    expect((await GET(req())).status).toBe(401);
    expect((await GET(req("Bearer nope"))).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(req("Bearer s3cret"))).status).toBe(503);
    expect(findFirst).not.toHaveBeenCalled();
    expect(importSteamLibrary).not.toHaveBeenCalled();
  });
});
