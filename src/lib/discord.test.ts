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

  it("renvoie le Retry-After en millisecondes sans deuxième envoi", async () => {
    fetchMock.mockResolvedValue(new Response('{"retry_after":9}', {
      status: 429, headers: { "Retry-After": "1.25" },
    }));
    expect(await postToDiscord(embed)).toEqual({ ok: false, error: "rate_limited", retryAfterMs: 1250 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("utilise retry_after si l'en-tête est absent ou invalide", async () => {
    for (const headers of [new Headers(), new Headers({ "Retry-After": "invalide" }), new Headers({ "Retry-After": "-1" })]) {
      fetchMock.mockClear().mockResolvedValue(new Response('{"retry_after":0.125}', { status: 429, headers }));
      expect(await postToDiscord(embed)).toEqual({ ok: false, error: "rate_limited", retryAfterMs: 125 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  it("reste en échec sans délai inventé si la réponse 429 est inexploitable", async () => {
    for (const body of ["invalide", '{"retry_after":-1}', '{"retry_after":"2"}', '{"retry_after":1e100}']) {
      fetchMock.mockClear().mockResolvedValue(new Response(body, { status: 429 }));
      expect(await postToDiscord(embed)).toEqual({ ok: false, error: "rate_limited" });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  it("ne relance pas non plus une autre erreur HTTP", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 500 }));
    expect(await postToDiscord(embed)).toEqual({ ok: false, error: "http_error" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
