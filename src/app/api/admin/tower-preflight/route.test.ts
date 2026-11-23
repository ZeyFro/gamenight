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

  it("Preview → 503 sans appel Discord, même si le flag et le bot sont configurés", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    const res = await GET();
    expect(res.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
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

  const discord = (botRolePermissions: string) => (url: string) => {
    const json = (value: unknown) => Promise.resolve(new Response(JSON.stringify(value)));
    if (url.endsWith("/guilds/g1/channels")) return json([
      { id: "c1", name: "cat", type: 4, parent_id: null },
      { id: "t1", name: "general", type: 0, parent_id: "c1" },
    ]);
    if (url.endsWith("/users/@me")) return json({ id: "bot1" });
    if (url.endsWith("/guilds/g1/members/bot1")) return json({ roles: ["r-bot"] });
    if (url.endsWith("/guilds/g1/roles")) return json([{ id: "g1", permissions: "0" }, { id: "r-bot", permissions: botRolePermissions }, { id: "r-autre", permissions: "8" }]);
    return Promise.resolve(new Response("{}", { status: 404 }));
  };

  it("allumé → GET en lecture seule sur le serveur de DISCORD_BOT_GUILD_ID, permissions du bot complètes", async () => {
    fetchMock.mockImplementation(discord("395408788496"));
    const res = await GET();
    expect(res.status).toBe(200);
    expect(fetchMock.mock.calls.every(([, init]) => init.method === "GET")).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe("https://discord.com/api/v10/guilds/g1/channels");
    const body = await res.json();
    expect(body).toMatchObject({ guildId: "g1", totalChannels: 2, writesApplied: false, botPermissions: { status: "checked", administrator: false, missing: [] } });
  });

  it("signale « Mentionner @everyone, @here et tous les rôles » s'il manque après le retrait d'Administrateur", async () => {
    fetchMock.mockImplementation(discord("395408657424"));
    const body = await (await GET()).json();
    expect(body.botPermissions).toEqual({ status: "checked", administrator: false, missing: ["Mentionner @everyone, @here et tous les rôles"] });
    expect(JSON.stringify(body)).not.toContain("tok");
  });
});
