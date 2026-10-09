import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { performDiscordAction } from "./notification-executor";
import { sessionRsvpComponents } from "./session-rsvp-components";
import { wallClockNow } from "./wallclock";

describe("transport réel des composants avec HTTP Discord simulé", () => {
  const fetchMock = vi.fn();
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); vi.stubEnv("DISCORD_BOT_TOKEN", "test-only"); vi.stubEnv("DISCORD_APP_PUBLIC_KEY", "ab".repeat(32)); vi.stubEnv("DISCORD_CLIENT_ID", "555"); });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  const message = () => ({ content: "Soirée", components: sessionRsvpComponents({ id: "s", status: "SCHEDULED", date: new Date(wallClockNow().getTime() + 86_400_000), attendanceCapacity: 2 }), allowedMentions: { parse: [] as [] } });
  const lastBody = () => JSON.parse(fetchMock.mock.calls.at(-1)![1].body as string);
  it("executor → fil privé vérifié → POST : conserve les boutons et interdit les pings implicites", async () => {
    fetchMock.mockResolvedValueOnce(json({ id: "222", type: 12 })).mockResolvedValueOnce(json({ id: "333", channel_id: "222" }));
    const result = await performDiscordAction({ kind: "send_thread_message_verified", threadId: "222", message: message() }, new Date(Date.now() + 10_000), new Date());
    expect(result.ok).toBe(true); expect(lastBody()).toMatchObject({ components: message().components, allowed_mentions: { parse: [] } });
    expect(lastBody().flags).toBeUndefined();
  });
  it("executor → ouverture MP → POST : mêmes boutons, sans mention", async () => {
    fetchMock.mockResolvedValueOnce(json({ id: "222" })).mockResolvedValueOnce(json({ id: "333", channel_id: "222" }));
    expect((await performDiscordAction({ kind: "send_direct_message", userId: "777", message: message() }, new Date(Date.now() + 10_000), new Date())).ok).toBe(true);
    expect(lastBody().components).toEqual(message().components); expect(lastBody().allowed_mentions.parse).toEqual([]);
  });
  it("EDIT à la fin : components=[] retire les boutons sans renvoyer un MP", async () => {
    fetchMock.mockResolvedValueOnce(json({ id: "333", channel_id: "222" }));
    expect((await performDiscordAction({ kind: "edit_channel_message", channelId: "222", messageId: "333", isDirectMessage: true, message: { ...message(), components: [] } }, new Date(Date.now() + 10_000), new Date())).ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1); expect(fetchMock.mock.calls[0][1].method).toBe("PATCH"); expect(lastBody().components).toEqual([]);
  });
  it("fil public ou destination refusée : aucun message ni boutons envoyés", async () => {
    fetchMock.mockResolvedValueOnce(json({ id: "222", type: 11 }));
    expect(await performDiscordAction({ kind: "send_thread_message_verified", threadId: "222", message: message() }, new Date(Date.now() + 10_000), new Date())).toMatchObject({ ok: false, kind: "destination_mismatch" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
