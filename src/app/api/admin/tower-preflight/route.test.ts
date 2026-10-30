import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireAdmin = vi.fn();
vi.mock("@/lib/admin", () => ({ requireAdmin: () => requireAdmin() }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { GET } from "./route";

const fetchMock = vi.fn();

describe("GET /api/admin/tower-preflight", () => {
  beforeEach(() => {
    requireAdmin.mockReset().mockResolvedValue({ id: "u1" });
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("DISCORD_BOT_TOKEN", "tok");
    vi.stubEnv("DISCORD_BOT_GUILD_ID", "g1");
    vi.stubEnv("TOWER_DISCORD_PREFLIGHT_ENABLED", "true");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("non-admin → 403 sans appel Discord", async () => {
    requireAdmin.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["", "enabled", "TRUE"])("interrupteur %j → 404 sans appel Discord", async (value) => {
    vi.stubEnv("TOWER_DISCORD_PREFLIGHT_ENABLED", value);
    const res = await GET();
    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allumé → GET en lecture seule sur le serveur de DISCORD_BOT_GUILD_ID", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify([
      { id: "c1", name: "cat", type: 4, parent_id: null },
      { id: "t1", name: "general", type: 0, parent_id: "c1" },
    ])));
    const res = await GET();
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://discord.com/api/v10/guilds/g1/channels");
    expect(init.method).toBe("GET");
    const body = await res.json();
    expect(body).toMatchObject({ guildId: "g1", totalChannels: 2, writesApplied: false });
  });
});
