import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ verify: vi.fn(), respond: vi.fn(), respondInstant: vi.fn(), respondTournament: vi.fn(), edit: vi.fn(), setup: vi.fn() }));
vi.mock("@/lib/discord-signature", () => ({ verifyDiscordSignature: mocks.verify }));
vi.mock("@/lib/discord-session-rsvp", () => ({ respondToSessionRsvp: mocks.respond }));
vi.mock("@/lib/discord-instant-session-rsvp", () => ({ respondToInstantSessionRsvp: mocks.respondInstant }));
vi.mock("@/lib/discord-tournament-rsvp", () => ({ respondToTournamentRsvp: mocks.respondTournament }));
vi.mock("@/lib/community-setup", () => ({ setupCommunityFromGuild: mocks.setup }));
vi.mock("@/lib/discord-rest", () => ({ editSetupResponse: mocks.edit }));
import { handleDiscordInteraction } from "./discord-interactions";
const payload = (over = {}) => ({ type: 3, id: "100", application_id: "555", token: "simulated-token", guild_id: "111", channel_id: "222", member: { user: { id: "777" } }, message: { id: "333" }, data: { custom_id: "gn:seat:join:s", component_type: 2 }, ...over });
const handle = (over = {}, timestamp = String(Math.floor(Date.now() / 1000))) => handleDiscordInteraction({ rawBody: JSON.stringify(payload(over)), signature: "sig", timestamp });
describe("interactions de présence : signature, ACK et confidentialité", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.verify.mockReturnValue(true); mocks.respond.mockResolvedValue("✅ Ta place est confirmée."); mocks.edit.mockResolvedValue({ ok: true }); vi.stubEnv("DISCORD_APP_PUBLIC_KEY", "ab".repeat(32)); vi.stubEnv("DISCORD_CLIENT_ID", "555"); });
  afterEach(() => vi.unstubAllEnvs());
  it("ACK privé immédiat avant mutation et avant réponse HTTP Discord", async () => {
    const out = await handle(); expect(out.body).toEqual({ type: 5, data: { flags: 64 } });
    expect(mocks.respond).not.toHaveBeenCalled(); expect(mocks.edit).not.toHaveBeenCalled();
    await out.runRsvp!();
    expect(mocks.respond).toHaveBeenCalledWith("s", "join", { interactionId: "100", discordId: "777", guildId: "111", channelId: "222", messageId: "333" });
    expect(mocks.edit).toHaveBeenCalledWith(expect.objectContaining({ content: "✅ Ta place est confirmée.", token: "simulated-token" }));
    expect(mocks.setup).not.toHaveBeenCalled();
  });
  it("MP : identité user plutôt que member ; désistement", async () => {
    const out = await handle({ guild_id: undefined, member: undefined, user: { id: "888" }, data: { custom_id: "gn:seat:leave:s", component_type: 2 } });
    await out.runRsvp!(); expect(mocks.respond).toHaveBeenCalledWith("s", "leave", expect.objectContaining({ discordId: "888", guildId: undefined }));
  });
  it("signature invalide : rien n'est exécuté, même si le corps est valide", async () => {
    mocks.verify.mockReturnValue(false); expect(await handle()).toEqual({ status: 401 }); expect(mocks.respond).not.toHaveBeenCalled();
  });
  it.each([{ application_id: "999" }, { application_id: undefined }, { id: undefined }, { token: undefined }, { message: undefined }, { channel_id: undefined }, { member: undefined }, { guild_id: "abc" }, { data: { custom_id: "gn:seat:capacity:s", component_type: 2 } }, { data: { custom_id: "gn:seat:join:s", component_type: 3 } }])("payload incomplet/étranger refusé : %j", async over => {
    expect(await handle(over)).toEqual({ status: 400 }); expect(mocks.respond).not.toHaveBeenCalled();
  });
  it("signature trop ancienne, future ou horodatage invalide : refus", async () => {
    for (const timestamp of ["123", "NaN", String(Date.now() / 1000 + 600)]) expect(await handle({}, timestamp)).toEqual({ status: 400 });
    expect(mocks.respond).not.toHaveBeenCalled();
  });
  it("erreur métier : aucun secret révélé ; invite à vérifier avant de recliquer", async () => {
    mocks.respond.mockRejectedValue(new Error("database-secret")); const out = await handle(); await out.runRsvp!();
    expect(mocks.edit.mock.calls[0][0].content).not.toContain("secret"); expect(mocks.edit.mock.calls[0][0].content).toContain("Vérifie ton inscription");
  });
});
