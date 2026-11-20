import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ run: vi.fn(), info: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { info: mocks.info, error: mocks.error } }));
vi.mock("@/lib/tower-steam-measure", () => ({ runTowerSteamAutovalidation: mocks.run }));
vi.mock("next/server", async importOriginal => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: (callback: () => void) => void callback() };
});

import { GET, POST, maxDuration } from "./route";

const request = (authorization?: string, method = "GET") => new Request("https://example.invalid/api/cron/tower-steam-autovalidate", {
  method, headers: authorization ? { authorization } : {},
});

describe("/api/cron/tower-steam-autovalidate", () => {
  beforeEach(() => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("CRON_SECRET", "cron-test-secret");
    vi.stubEnv("TOWER_STEAM_AUTOVALIDATE_ENABLED", "true");
    mocks.run.mockReset().mockResolvedValue({ enabled: true, checked: 2 });
    mocks.info.mockReset();
    mocks.error.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("échoue fermé : 503 sans CRON_SECRET, 401 sans ou avec un mauvais secret, rien n'est lancé", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(request("Bearer cron-test-secret"))).status).toBe(503);
    vi.stubEnv("CRON_SECRET", "cron-test-secret");
    expect((await GET(request())).status).toBe(401);
    expect((await POST(request("Bearer incorrect", "POST"))).status).toBe(401);
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("est bloquée en Preview", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    expect((await GET(request("Bearer cron-test-secret"))).status).toBe(503);
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("reste OFF par défaut : 200 {enabled:false}, aucun appel Steam", async () => {
    for (const value of ["", "false", "TRUE", "1"]) {
      vi.stubEnv("TOWER_STEAM_AUTOVALIDATE_ENABLED", value);
      const response = await GET(request("Bearer cron-test-secret"));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ enabled: false });
    }
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("répond 202 puis travaille avec une échéance bornée (GET et POST)", async () => {
    const before = Date.now();
    expect(maxDuration).toBe(60);
    const response = await GET(request("Bearer cron-test-secret"));
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ enabled: true, status: "accepted" });
    expect((await POST(request("Bearer cron-test-secret", "POST"))).status).toBe(202);
    expect(mocks.run).toHaveBeenCalledTimes(2);
    const deadline = mocks.run.mock.calls[0][0] as Date;
    expect(deadline.getTime()).toBeGreaterThan(before);
    expect(deadline.getTime() - before).toBeLessThanOrEqual(51_000);
  });

  it("journalise l'échec du traitement sans changer le 202", async () => {
    mocks.run.mockRejectedValue(new Error("steam"));
    expect((await GET(request("Bearer cron-test-secret"))).status).toBe(202);
    expect(mocks.error).toHaveBeenCalledOnce();
  });
});
