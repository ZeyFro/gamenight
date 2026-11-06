import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ assign: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { error: mocks.error } }));
vi.mock("@/lib/tower-team-daily", () => ({ assignDailyTowerTeamChallenges: mocks.assign }));

import { GET } from "./route";

describe("GET /api/cron/tower-team-daily", () => {
  beforeEach(() => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("CRON_SECRET", "cron-test-secret");
    vi.stubEnv("TOWER_TEAM_DAILY_ENABLED", "false");
    mocks.assign.mockReset().mockResolvedValue({ checked: 3, failed: 0, complete: true });
    mocks.error.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  const request = (secret = "cron-test-secret") => new Request("https://example.invalid/api/cron/tower-team-daily", {
    headers: { authorization: `Bearer ${secret}` },
  });

  it("reste OFF par défaut même avec un secret cron valide", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ enabled: false, checked: 0, failed: 0 });
    expect(mocks.assign).not.toHaveBeenCalled();
  });

  it("refuse un secret incorrect", async () => {
    const response = await GET(request("incorrect"));
    expect(response.status).toBe(401);
    expect(mocks.assign).not.toHaveBeenCalled();
  });

  it("est bloqué en Preview avant toute attribution", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("TOWER_TEAM_DAILY_ENABLED", "true");
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(mocks.assign).not.toHaveBeenCalled();
  });

  it("exécute le lot avec une fenêtre bornée quand le flag est ON", async () => {
    vi.stubEnv("TOWER_TEAM_DAILY_ENABLED", "true");
    const before = Date.now();
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ enabled: true, checked: 3, failed: 0, complete: true });
    expect(mocks.assign).toHaveBeenCalledOnce();
    const deadline = mocks.assign.mock.calls[0][0] as Date;
    expect(deadline.getTime()).toBeGreaterThanOrEqual(before + 19_000);
    expect(deadline.getTime()).toBeLessThanOrEqual(Date.now() + 20_100);
  });

  it("signale les échecs partiels en HTTP 503 pour permettre une relance idempotente", async () => {
    vi.stubEnv("TOWER_TEAM_DAILY_ENABLED", "true");
    mocks.assign.mockResolvedValueOnce({ checked: 2, failed: 1, complete: false });

    const response = await GET(request());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ enabled: true, checked: 2, failed: 1, complete: false });
  });

  it("refuse de déclarer réussi un lot incomplet sans erreur d'attribution", async () => {
    vi.stubEnv("TOWER_TEAM_DAILY_ENABLED", "true");
    mocks.assign.mockResolvedValueOnce({ checked: 100, failed: 0, complete: false });
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ checked: 100, failed: 0, complete: false });
  });

  it("rend une sélection interrompue réessayable sans exposer l'erreur brute", async () => {
    vi.stubEnv("TOWER_TEAM_DAILY_ENABLED", "true");
    mocks.assign.mockRejectedValueOnce(new Error("contenu privé"));
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ enabled: true, checked: 0, failed: 1, complete: false });
    expect(mocks.error).toHaveBeenCalledOnce();
  });
});
