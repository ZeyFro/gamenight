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

import { readFileSync } from "node:fs";
describe("lien « photos » sur la page d'une soirée (production du 24/11/2026)", () => {
  it("est rendu sans condition de statut : une soirée passée (DONE) porte aussi le lien", () => {
    const page = readFileSync("src/app/sessions/[id]/page.tsx", "utf8");
    const line = page.split("\n").find((l) => l.includes("<SessionPhotosLink"));
    expect(line).toBeTruthy();
    expect(line).toMatch(/^\s*\{discordPhotosChannelUrl\(\) && <SessionPhotosLink url=\{discordPhotosChannelUrl\(\)!\} \/>\}\s*$/);
  });
  it("exige DEUX variables : DISCORD_BOT_GUILD_ID et DISCORD_PHOTOS_CHANNEL_ID (sans l'identifiant du serveur, aucun lien)", () => {
    expect(discordPhotosChannelUrl({ DISCORD_PHOTOS_CHANNEL_ID: "123456789012345678" })).toBeNull();
    expect(discordPhotosChannelUrl({ DISCORD_BOT_GUILD_ID: "223456789012345678", DISCORD_PHOTOS_CHANNEL_ID: "123456789012345678" }))
      .toBe("https://discord.com/channels/223456789012345678/123456789012345678");
  });
});
