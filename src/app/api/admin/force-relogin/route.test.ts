import { beforeEach, describe, expect, it, vi } from "vitest";

const triggerGlobalRelogin = vi.fn();
vi.mock("@/lib/force-relogin", () => ({ triggerGlobalRelogin: () => triggerGlobalRelogin() }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
// Espion sur `timingSafeEqual` tel qu'importé par `cron-auth` (export ESM non espionnable par vi.spyOn).
const timingSafeEqual = vi.hoisted(() => vi.fn());
vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  timingSafeEqual.mockImplementation(actual.timingSafeEqual);
  return { ...actual, timingSafeEqual };
});

import { POST } from "./route";

function req(authorization?: string) {
  return new Request("https://example.test/api/admin/force-relogin", {
    method: "POST",
    headers: authorization ? { authorization } : {},
  });
}

describe("POST /api/admin/force-relogin", () => {
  beforeEach(() => {
    triggerGlobalRelogin.mockReset().mockResolvedValue({ forcedAt: "2026-01-01T00:00:00.000Z" });
    timingSafeEqual.mockClear();
    vi.stubEnv("CRON_SECRET", "s3cret");
  });

  it("mauvais secret → 401, comparaison à temps constant", async () => {
    const res = await POST(req("Bearer faux"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(timingSafeEqual).toHaveBeenCalled();
    expect(triggerGlobalRelogin).not.toHaveBeenCalled();
  });

  it("sans CRON_SECRET → 503", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const res = await POST(req("Bearer s3cret"));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "not_configured" });
    expect(triggerGlobalRelogin).not.toHaveBeenCalled();
  });

  it("bon secret → 200 avec le résultat", async () => {
    const res = await POST(req("Bearer s3cret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ forcedAt: "2026-01-01T00:00:00.000Z" });
  });

  it("erreur interne → 500 sans le message d'erreur", async () => {
    triggerGlobalRelogin.mockRejectedValue(new Error("détail interne secret"));
    const res = await POST(req("Bearer s3cret"));
    expect(res.status).toBe(500);
    const body = await res.text();
    expect(body).not.toContain("détail interne secret");
    expect(JSON.parse(body)).toEqual({ error: "internal_error" });
  });
});
