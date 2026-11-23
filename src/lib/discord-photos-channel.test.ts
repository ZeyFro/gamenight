import { describe, expect, it } from "vitest";
import { DISCORD_PHOTOS_CHANNEL_NAME, discordPhotosChannelUrl } from "./discord-photos-channel";

describe("lien vers le salon des photos (Q6)", () => {
  it("construit l'adresse du salon quand le serveur et le salon sont valides", () => {
    expect(discordPhotosChannelUrl({ DISCORD_BOT_GUILD_ID: "553922938101825536", DISCORD_PHOTOS_CHANNEL_ID: " 1234567890123456789 " }))
      .toBe("https://discord.com/channels/553922938101825536/1234567890123456789");
    expect(DISCORD_PHOTOS_CHANNEL_NAME).toBe("📸・photos-soirées");
  });
  it("aucun lien si une valeur manque ou n'est pas un identifiant Discord", () => {
    expect(discordPhotosChannelUrl({})).toBeNull();
    expect(discordPhotosChannelUrl({ DISCORD_BOT_GUILD_ID: "553922938101825536" })).toBeNull();
    expect(discordPhotosChannelUrl({ DISCORD_BOT_GUILD_ID: "553922938101825536", DISCORD_PHOTOS_CHANNEL_ID: "javascript:alert(1)" })).toBeNull();
    expect(discordPhotosChannelUrl({ DISCORD_BOT_GUILD_ID: "abc", DISCORD_PHOTOS_CHANNEL_ID: "1234567890123456789" })).toBeNull();
  });
});
