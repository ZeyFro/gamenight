import { sendChannelMessage, type DiscordActionRow } from "@/lib/discord-rest";
import { TOWER_ONBOARDING_ACTIONS } from "@/lib/tower-onboarding-actions";

export type OnboardingAction = (typeof TOWER_ONBOARDING_ACTIONS)[number]["id"];

export function welcomeActionUrl(action: string): string | null {
  const destination = TOWER_ONBOARDING_ACTIONS.find(({ id }) => id === action);
  return destination ? new URL(destination.path, "https://gamenight-zeyfro.vercel.app").href : null;
}

export function towerWelcomePanel() {
  const components: DiscordActionRow[] = [{
    type: 1, components: TOWER_ONBOARDING_ACTIONS
      .map(({ id, label }) => ({ type: 2 as const, style: 1 as const, label, custom_id: `gn:welcome:${id}` })),
  }];
  return {
    content: "🏰 **Bienvenue dans The Tower**\nChoisis comment commencer. GameNight est le compagnon du serveur, les permissions restent gérées par Discord.",
    components, allowedMentions: { parse: [] as [] },
  };
}

/** Deliberately not wired to an admin route or scheduled task.
 * A separate permission-checked workflow must call it after owner approval.
 */
export async function publishTowerWelcomePanel(input: { guildId: string; channelId: string; deadline: Date }) {
  if (process.env.VERCEL_ENV === "preview" ||
      process.env.TOWER_ONBOARDING_PANEL_ENABLED !== "true" ||
      !input.guildId || input.guildId !== process.env.TOWER_DISCORD_GUILD_ID ||
      !input.channelId || input.channelId !== process.env.TOWER_DISCORD_WELCOME_CHANNEL_ID) {
    return { ok: false, kind: "not_configured" as const };
  }
  return sendChannelMessage({ channelId: input.channelId, ...towerWelcomePanel(), deadline: input.deadline });
}
