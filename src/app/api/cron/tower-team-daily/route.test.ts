import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ assign: vi.fn() }));
vi.mock("@/lib/tower-team-daily", () => ({ assignDailyTowerTeamChallenges: mocks.assign }));

import { GET } from "./route";

describe("GET /api/cron/tower-team-daily", () => {
  beforeEach(() => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("CRON_SECRET", "cron-test-secret");
    vi.stubEnv("TOWER_TEAM_DAILY_ENABLED", "false");
    mocks.assign.mockReset().mockResolvedValue({ checked: 3, failed: 0 });
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
    expect(await response.json()).toEqual({ enabled: true, checked: 3, failed: 0 });
    expect(mocks.assign).toHaveBeenCalledOnce();
    const deadline = mocks.assign.mock.calls[0][0] as Date;
    expect(deadline.getTime()).toBeGreaterThanOrEqual(before + 19_000);
    expect(deadline.getTime()).toBeLessThanOrEqual(Date.now() + 20_100);
  });
});
