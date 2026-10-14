import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCENT_COLOR, postToDiscord } from "./discord";

const fetchMock = vi.fn();
const embed = { title: "t", color: ACCENT_COLOR };

async function sentBody(content?: string) {
  await postToDiscord(embed, content);
  return JSON.parse(fetchMock.mock.calls[0][1].body as string);
}

describe("postToDiscord — allowed_mentions explicite", () => {
  beforeEach(() => {
    fetchMock.mockReset().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("DISCORD_WEBHOOK_URL", "https://discord.com/api/webhooks/1/x");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("sans contenu : aucune mention autorisée", async () => {
    expect((await sentBody()).allowed_mentions).toEqual({ parse: [] });
  });

  it("@everyone, @here et rôles ne pingent jamais", async () => {
    const body = await sentBody("@everyone @here <@&555> salut");
    expect(body.allowed_mentions).toEqual({ parse: [] });
  });

  it("seuls les utilisateurs mentionnés dans le contenu sont listés (dédoublonnés)", async () => {
    const body = await sentBody("GG <@123> et <@!456> ; encore <@123> @everyone");
    expect(body.allowed_mentions).toEqual({ parse: [], users: ["123", "456"] });
  });

  it("jamais plus de 100 utilisateurs (limite Discord)", async () => {
    const content = Array.from({ length: 150 }, (_, i) => `<@${1000 + i}>`).join(" ");
    const body = await sentBody(content);
    expect(body.allowed_mentions.users).toHaveLength(100);
    expect(body.allowed_mentions.parse).toEqual([]);
  });
});
