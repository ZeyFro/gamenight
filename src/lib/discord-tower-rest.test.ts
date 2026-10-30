import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { editSetupResponse, getTowerProofMessage } from "./discord-rest";
const now = new Date("2026-10-28T12:00:00Z"), deadline = new Date(now.getTime() + 10000);
const channelId = "100000000000000003", messageId = "100000000000000005";
const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("DISCORD_BOT_TOKEN", "simulation-bot-token");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("lecture ciblée d'une preuve Discord", () => {
  it("ne retourne que l'identité et la référence du message sélectionné", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: messageId, channel_id: channelId, author: { id: "100000000000000004" }, content: "contenu non retourné" }), { status: 200 }));
    expect(await getTowerProofMessage({ channelId, messageId, now, deadline })).toEqual({ ok: true, data: { messageId, channelId, authorId: "100000000000000004" } });
    expect(fetchMock.mock.calls[0][0]).toBe(`https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`);
    expect(fetchMock.mock.calls[0][1].method).toBe("GET");
  });
  it("refuse des identifiants pouvant modifier le chemin réseau", async () => {
    expect(await getTowerProofMessage({ channelId: "../other", messageId, now, deadline })).toMatchObject({ ok: false, kind: "invalid_request" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("refuse une réponse dont l'identifiant ne correspond pas", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "999999999999999999", channel_id: channelId, author: { id: "100000000000000004" } }), { status: 200 }));
    expect(await getTowerProofMessage({ channelId, messageId, now, deadline })).toMatchObject({ ok: false });
  });
  it("n'appelle pas Discord sans configuration ou budget", async () => {
    vi.stubEnv("DISCORD_BOT_TOKEN", "");
    expect(await getTowerProofMessage({ channelId, messageId, now, deadline })).toMatchObject({ ok: false, kind: "not_configured" });
    vi.stubEnv("DISCORD_BOT_TOKEN", "simulation");
    expect(await getTowerProofMessage({ channelId, messageId, now, deadline: now })).toMatchObject({ ok: false, kind: "insufficient_lease" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("édite une réponse privée avec boutons sans autoriser de mentions", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: messageId, channel_id: channelId }), { status: 200 }));
    await editSetupResponse({ applicationId: "100000000000000001", token: "simulated", content: "@everyone", components: [], deadline: new Date(Date.now() + 10000) });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ content: "@everyone", components: [], allowed_mentions: { parse: [] } });
    expect(new Headers(fetchMock.mock.calls[0][1].headers).has("Authorization")).toBe(false);
  });
});
