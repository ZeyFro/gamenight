import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const discord = vi.hoisted(() => ({ getChannel: vi.fn(), listChannelMessages: vi.fn(), sendChannelMessage: vi.fn() }));
vi.mock("@/lib/discord-rest", () => ({ ...discord }));

import { publishTowerWelcomePanel, towerWelcomePanel, welcomeActionUrl } from "./tower-onboarding-panel";

const DEADLINE = new Date(Date.now() + 30_000);
const GUILD = "553922938101825536";
const CHANNEL = "553922938101825539";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("TOWER_ONBOARDING_PANEL_ENABLED", "true");
  vi.stubEnv("TOWER_DISCORD_GUILD_ID", GUILD);
  vi.stubEnv("TOWER_DISCORD_WELCOME_CHANNEL_ID", CHANNEL);
  discord.getChannel.mockResolvedValue({ ok: true, data: { guildId: GUILD, type: 0 } });
  discord.listChannelMessages.mockResolvedValue({ ok: true, data: { messages: [] } });
  discord.sendChannelMessage.mockResolvedValue({ ok: true, data: { messageId: "900000000000000001", channelId: CHANNEL } });
});

afterEach(() => vi.unstubAllEnvs());
describe("panneau accueil Tower", () => {
  it("propose exactement trois actions connues", () => {
    expect(towerWelcomePanel().components[0].components.map(x => x.label)).toEqual([
      "Trouver des joueurs", "Rejoindre une soirée", "Commencer l'Ascension",
    ]);
    expect(welcomeActionUrl("unknown")).toBeNull();
    expect(welcomeActionUrl("players")).toBe("https://gamenight-zeyfro.vercel.app/joueurs");
  });
  it("publie une seule fois dans le bon salon et utilise le nonce Discord anti-doublon", async () => {
    const first = await publishTowerWelcomePanel({ guildId: GUILD, channelId: CHANNEL, deadline: DEADLINE });
    expect(first).toMatchObject({ ok: true, data: { alreadyPublished: false, channelId: CHANNEL } });
    expect(discord.getChannel).toHaveBeenCalledOnce();
    expect(discord.listChannelMessages).toHaveBeenCalledOnce();
    expect(discord.sendChannelMessage).toHaveBeenCalledOnce();
    expect(discord.sendChannelMessage).toHaveBeenCalledWith(expect.objectContaining({ nonce: "tower-welcome-v1" }));
  });

  it("réutilise le panneau existant sans envoyer un doublon", async () => {
    const panel = towerWelcomePanel();
    discord.listChannelMessages.mockResolvedValue({
      ok: true,
      data: { messages: [{
        messageId: "900000000000000002",
        channelId: CHANNEL,
        content: panel.content,
        authorIsBot: true,
        componentIds: panel.components.flatMap(row => row.components.map(component => component.custom_id)),
      }] },
    });
    await expect(publishTowerWelcomePanel({ guildId: GUILD, channelId: CHANNEL, deadline: DEADLINE }))
      .resolves.toMatchObject({ ok: true, data: { alreadyPublished: true, messageId: "900000000000000002" } });
    expect(discord.sendChannelMessage).not.toHaveBeenCalled();
  });

  it("échoue fermé si le salon appartient à un autre serveur ou n'est pas textuel", async () => {
    discord.getChannel.mockResolvedValue({ ok: true, data: { guildId: "999999999999999999", type: 0 } });
    await expect(publishTowerWelcomePanel({ guildId: GUILD, channelId: CHANNEL, deadline: DEADLINE }))
      .resolves.toMatchObject({ ok: false, kind: "destination_mismatch" });
    expect(discord.listChannelMessages).not.toHaveBeenCalled();
    expect(discord.sendChannelMessage).not.toHaveBeenCalled();
  });

  it("n'envoie rien si la lecture de l'historique échoue", async () => {
    discord.listChannelMessages.mockResolvedValue({ ok: false, kind: "auth_or_permission", message: "denied", retryable: false });
    await expect(publishTowerWelcomePanel({ guildId: GUILD, channelId: CHANNEL, deadline: DEADLINE }))
      .resolves.toMatchObject({ ok: false, kind: "auth_or_permission" });
    expect(discord.sendChannelMessage).not.toHaveBeenCalled();
  });

  it("n'introduit ni mentions ni identifiants privés", () => {
    expect(towerWelcomePanel().allowedMentions.parse).toEqual([]);
    expect(JSON.stringify(towerWelcomePanel())).not.toContain("@everyone");
  });
});
