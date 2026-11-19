import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ run: vi.fn(), after: vi.fn(), lock: vi.fn() }));
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), after: mocks.after }));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/booster-support", () => ({ boostersEnabled: () => process.env.DISCORD_BOOSTERS_ENABLED === "true", runBoosterSync: mocks.run }));
vi.mock("@/lib/discord-role-lock", () => ({ withRoleCreationLock: mocks.lock }));

import { GET } from "./route";

const call = (secret?: string) =>
  GET(new Request("https://example.test/api/cron/booster-sync", { headers: secret ? { authorization: `Bearer ${secret}` } : {} }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.lock.mockImplementation(async ({ run }: { run: () => Promise<unknown> }) => ({ status: "acquired", value: await run() }));
  mocks.run.mockResolvedValue({ checked: 1 });
});
afterEach(() => vi.unstubAllEnvs());

describe("GET /api/cron/booster-sync", () => {
  it("fail-closed : 503 sans CRON_SECRET, 401 avec un mauvais secret, rien n'est lancé", async () => {
    vi.stubEnv("DISCORD_BOOSTERS_ENABLED", "true");
    expect((await call("x")).status).toBe(503);
    vi.stubEnv("CRON_SECRET", "secret");
    expect((await call("mauvais")).status).toBe(401);
    expect((await call()).status).toBe(401);
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it("éteint : 200 {enabled:false}, aucune lecture", async () => {
    vi.stubEnv("CRON_SECRET", "secret");
    const response = await call("secret");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ enabled: false });
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it("allumé : 202 immédiat, le travail tourne dans after() sous verrou", async () => {
    vi.stubEnv("CRON_SECRET", "secret");
    vi.stubEnv("DISCORD_BOOSTERS_ENABLED", "true");
    const response = await call("secret");
    expect(response.status).toBe(202);
    expect(mocks.run).not.toHaveBeenCalled();
    await (mocks.after.mock.calls[0][0] as () => Promise<void>)();
    expect(mocks.run).toHaveBeenCalledTimes(1);
  });

  it("passage déjà en cours : ignoré", async () => {
    vi.stubEnv("CRON_SECRET", "secret");
    vi.stubEnv("DISCORD_BOOSTERS_ENABLED", "true");
    mocks.lock.mockResolvedValue({ status: "busy" });
    await call("secret");
    await (mocks.after.mock.calls[0][0] as () => Promise<void>)();
    expect(mocks.run).not.toHaveBeenCalled();
  });
});
