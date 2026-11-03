import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** La route transmet un budget de temps au parcours de nettoyage (aucune base, aucun Discord). */

const mocks = vi.hoisted(() => ({
  runDiscordThreadCleanup: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/discord-thread-cleanup", () => ({ runDiscordThreadCleanup: mocks.runDiscordThreadCleanup }));
vi.mock("@/lib/logger", () => ({ logger: mocks.logger }));

import { GET, TIME_BUDGET_MS, maxDuration } from "./route";

const emptyKind = { archiveEnqueued: [], deleteEnqueued: [], archiveFailed: [], waiting: 0 };
const req = () =>
  new Request("https://example.test/api/cron/discord-thread-cleanup", { headers: { authorization: "Bearer s3cret" } });

describe("/api/cron/discord-thread-cleanup — budget de temps", () => {
  let now: number;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CRON_SECRET", "s3cret");
    vi.stubEnv("DISCORD_THREAD_CLEANUP_ENABLED", "true");
    now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    mocks.runDiscordThreadCleanup.mockResolvedValue({
      dryRun: true,
      sessions: emptyKind,
      tournaments: emptyKind,
      truncated: false,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("shouldContinue vrai au départ, faux une fois TIME_BUDGET_MS écoulé", async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);

    const [opts] = mocks.runDiscordThreadCleanup.mock.calls[0] as [{ dryRun: boolean; shouldContinue: () => boolean }];
    expect(opts.dryRun).toBe(true);
    expect(opts.shouldContinue()).toBe(true);
    now += TIME_BUDGET_MS;
    expect(opts.shouldContinue()).toBe(false);
  });

  it("le budget laisse une marge sous maxDuration", () => {
    expect(TIME_BUDGET_MS).toBeLessThan(maxDuration * 1000 - 10_000);
  });
});
