import { beforeEach, describe, expect, it, vi } from "vitest";

const queryRaw = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: { $queryRaw: (...args: unknown[]) => queryRaw(...args) },
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { GET } from "./route";

const req = (authorization?: string) =>
  new Request("https://example.test/api/health", {
    headers: authorization ? { authorization } : {},
  });

describe("/api/health", () => {
  beforeEach(() => {
    queryRaw.mockReset().mockResolvedValue([{ "?column?": 1 }]);
    vi.stubEnv("CRON_SECRET", "s3cret");
  });

  it("bon Bearer et base joignable → 200", async () => {
    const res = await GET(req("Bearer s3cret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, db: "ok" });
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it("base injoignable → 503 sans fuite de l'erreur", async () => {
    queryRaw.mockRejectedValue(new Error("connexion refusée postgres://secret"));
    const res = await GET(req("Bearer s3cret"));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, db: "error" });
  });

  it("sans en-tête ou mauvais Bearer → 401, base jamais interrogée", async () => {
    expect((await GET(req())).status).toBe(401);
    expect((await GET(req("Bearer autre"))).status).toBe(401);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it("CRON_SECRET absente → 503 route désactivée (fail-closed)", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const res = await GET(req("Bearer "));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "not_configured" });
    expect(queryRaw).not.toHaveBeenCalled();
  });
});
