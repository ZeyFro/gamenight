import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isGuildMember } from "./guild-member";

const fetchMock = vi.fn();

function discordJson(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status });
}

describe("isGuildMember", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("DISCORD_BOT_TOKEN", "bot-secret");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("200 → true, GET /guilds/{guild}/members/{user} avec le jeton du bot", async () => {
    fetchMock.mockResolvedValue(discordJson(200, { user: { id: "222" } }));

    await expect(isGuildMember("222", "111")).resolves.toBe(true);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://discord.com/api/v10/guilds/111/members/222");
    expect(init.method).toBe("GET");
    expect(init.headers.Authorization).toBe("Bot bot-secret");
  });

  it("404 avec code 10007 (Unknown Member) → false", async () => {
    fetchMock.mockResolvedValue(discordJson(404, { code: 10007, message: "Unknown Member" }));
    await expect(isGuildMember("222", "111")).resolves.toBe(false);
  });

  it.each([
    ["404 code 10004 (Unknown Guild : config cassée, pas un non-membre)", 404, { code: 10004 }],
    ["404 sans code", 404, {}],
    ["403 Missing Access", 403, { code: 50001 }],
    ["401", 401, { code: 0 }],
    ["429", 429, { retry_after: 1 }],
    ["500", 500, {}],
  ])("%s → lève (jamais « non membre » par défaut)", async (_label, status, body) => {
    fetchMock.mockResolvedValue(discordJson(status, body));
    await expect(isGuildMember("222", "111")).rejects.toThrow();
  });

  it("erreur réseau → lève", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNRESET"));
    await expect(isGuildMember("222", "111")).rejects.toThrow();
  });

  it("DISCORD_BOT_TOKEN absent → lève, aucun appel", async () => {
    vi.stubEnv("DISCORD_BOT_TOKEN", "");
    await expect(isGuildMember("222", "111")).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("identifiants non numériques → lève, aucun appel (pas d'injection de chemin)", async () => {
    await expect(isGuildMember("../x", "111")).rejects.toThrow();
    await expect(isGuildMember("222", "1/../2")).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
