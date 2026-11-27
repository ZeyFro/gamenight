import { describe, expect, it } from "vitest";
import { onboardingCommandsChannelUrl } from "@/lib/onboarding-commands-link";

const TOWER_GUILD = "123456789012345678";
const TOWER_CHANNEL = "234567890123456789";
const ENV = {
  TOWER_DISCORD_GUILD_ID: TOWER_GUILD,
  TOWER_DISCORD_COMMANDS_CHANNEL_ID: TOWER_CHANNEL,
};

describe("onboardingCommandsChannelUrl", () => {
  it("construit le lien de The Tower sans dépendre du slug `default`", () => {
    // Ancien comportement : `slug === "default"` et `DISCORD_BOT_GUILD_ID`
    // étaient exigés, donc The Tower (autre slug) n'obtenait aucun lien.
    expect(onboardingCommandsChannelUrl({ status: "ACTIVE", discordGuildId: TOWER_GUILD }, ENV))
      .toBe(`https://discord.com/channels/${TOWER_GUILD}/${TOWER_CHANNEL}`);
  });

  it("n'utilise pas DISCORD_BOT_GUILD_ID comme condition", () => {
    expect(onboardingCommandsChannelUrl(
      { status: "ACTIVE", discordGuildId: TOWER_GUILD },
      { ...ENV, DISCORD_BOT_GUILD_ID: "999999999999999999" }
    )).toBe(`https://discord.com/channels/${TOWER_GUILD}/${TOWER_CHANNEL}`);
  });

  it("refuse une autre communauté, un statut inactif ou un identifiant invalide", () => {
    expect(onboardingCommandsChannelUrl({ status: "ACTIVE", discordGuildId: "345678901234567890" }, ENV)).toBeNull();
    expect(onboardingCommandsChannelUrl({ status: "SUSPENDED", discordGuildId: TOWER_GUILD }, ENV)).toBeNull();
    expect(onboardingCommandsChannelUrl({ status: "ACTIVE", discordGuildId: TOWER_GUILD }, { ...ENV, TOWER_DISCORD_COMMANDS_CHANNEL_ID: "pas-un-salon" })).toBeNull();
    expect(onboardingCommandsChannelUrl(null, ENV)).toBeNull();
  });
});
