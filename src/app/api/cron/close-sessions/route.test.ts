import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Budget de temps du cron close-sessions : au-delà de TIME_BUDGET_MS, aucune
 * nouvelle clôture n'est entamée et les passes suivantes reçoivent un
 * `shouldContinue` déjà faux. Tout est simulé, aucune base ni Discord.
 */

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  closeSession: vi.fn(),
  closeOverdueScheduledSessions: vi.fn(),
  processOpenRoulettes: vi.fn(),
  settleAllDueInstantSessions: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({ prisma: { session: { findMany: mocks.findMany } } }));
vi.mock("@/lib/sessions", () => ({
  closeSession: mocks.closeSession,
  closeOverdueScheduledSessions: mocks.closeOverdueScheduledSessions,
}));
vi.mock("@/lib/roulette", () => ({ processOpenRoulettes: mocks.processOpenRoulettes }));
vi.mock("@/lib/instant-sessions", () => ({ settleAllDueInstantSessions: mocks.settleAllDueInstantSessions }));
vi.mock("@/lib/seasons", () => ({ ensureActiveSeasonsExist: vi.fn(async () => undefined) }));
vi.mock("@/lib/logger", () => ({ logger: mocks.logger }));

import { GET, TIME_BUDGET_MS } from "./route";

const req = () =>
  new Request("https://example.test/api/cron/close-sessions", { headers: { authorization: "Bearer s3cret" } });

type ShouldContinue = { shouldContinue: () => boolean };

describe("/api/cron/close-sessions — budget de temps", () => {
  let now: number;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CRON_SECRET", "s3cret");
    now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    mocks.findMany.mockResolvedValue([
      { id: "s1", date: new Date() },
      { id: "s2", date: new Date() },
      { id: "s3", date: new Date() },
    ]);
    mocks.closeSession.mockResolvedValue({ discord: null });
    mocks.closeOverdueScheduledSessions.mockResolvedValue([]);
    mocks.processOpenRoulettes.mockResolvedValue({ checked: 0 });
    mocks.settleAllDueInstantSessions.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("chemin nominal : tout est traité, pas de budgetExhausted, shouldContinue transmis aux passes", async () => {
    const res = await GET(req());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.closed).toEqual(["s1", "s2", "s3"]);
    expect(body.budgetExhausted).toBeUndefined();
    for (const pass of [mocks.closeOverdueScheduledSessions, mocks.processOpenRoulettes, mocks.settleAllDueInstantSessions]) {
      const [options] = pass.mock.calls[0] as [ShouldContinue];
      expect(options.shouldContinue()).toBe(true);
    }
  });

  it("budget dépassé pendant les clôtures : arrêt entre deux soirées, passes suivantes à shouldContinue=false", async () => {
    mocks.closeSession.mockImplementation(async () => {
      now += TIME_BUDGET_MS / 2 + 1; // la 2e clôture fait dépasser le budget
      return { discord: null };
    });

    const res = await GET(req());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.closed).toEqual(["s1", "s2"]);
    expect(mocks.closeSession).toHaveBeenCalledTimes(2);
    expect(body.budgetExhausted).toBe(true);
    const [options] = mocks.processOpenRoulettes.mock.calls[0] as [ShouldContinue];
    expect(options.shouldContinue()).toBe(false);
    expect(mocks.logger.warn).toHaveBeenCalled();
  });

  it("TIME_BUDGET_MS laisse une marge sous maxDuration", async () => {
    const { maxDuration } = await import("./route");
    expect(TIME_BUDGET_MS).toBeLessThan(maxDuration * 1000 - 10_000);
  });
});
