import { beforeEach, describe, expect, it, vi } from "vitest";

const refreshAllDiscordProfiles = vi.fn();
vi.mock("@/lib/discord-profile", () => ({ refreshAllDiscordProfiles: (...a: unknown[]) => refreshAllDiscordProfiles(...a) }));
const logger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger }));
const afterTasks: Array<() => Promise<void>> = [];
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: (cb: () => Promise<void>) => void afterTasks.push(cb) };
});

import { GET, maxDuration } from "./route";

const req = (authorization?: string) =>
  new Request("https://example.test/api/cron/refresh-discord-profiles", { headers: authorization ? { authorization } : {} });

describe("/api/cron/refresh-discord-profiles", () => {
  beforeEach(() => {
    afterTasks.length = 0;
    vi.clearAllMocks();
    refreshAllDiscordProfiles.mockResolvedValue({
      oauth: { updated: 1, checked: 2, skipped: 1, failed: 0 },
      bot: { updated: 0, checked: 0 },
    });
    vi.stubEnv("CRON_SECRET", "s3cret");
  });

  it("202 immédiat, rafraîchissement seulement dans after(), maxDuration 300", async () => {
    expect(maxDuration).toBe(300);
    const res = await GET(req("Bearer s3cret"));
    expect(res.status).toBe(202);
    expect(refreshAllDiscordProfiles).not.toHaveBeenCalled();
    await afterTasks[0]();
    expect(refreshAllDiscordProfiles).toHaveBeenCalledTimes(1);
  });

  it("erreur journalisée, jamais avalée", async () => {
    refreshAllDiscordProfiles.mockRejectedValue(new Error("boom"));
    await GET(req("Bearer s3cret"));
    await afterTasks[0]();
    expect(logger.error).toHaveBeenCalledWith("cron:refresh-discord-profiles", expect.any(Error), expect.any(Object));
  });

  it("401 / 503, rien lancé", async () => {
    expect((await GET(req("Bearer nope"))).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(req("Bearer s3cret"))).status).toBe(503);
    expect(afterTasks).toHaveLength(0);
  });
});
