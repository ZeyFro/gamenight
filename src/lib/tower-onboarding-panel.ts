import { sendChannelMessage, type DiscordActionRow } from "@/lib/discord-rest";

const DESTINATIONS = {
  players: { label: "Trouver des joueurs", url: "https://gamenight-zeyfro.vercel.app/joueurs" },
  evening: { label: "Rejoindre une soirée", url: "https://gamenight-zeyfro.vercel.app/sessions" },
  tower: { label: "Commencer l'Ascension", url: "https://gamenight-zeyfro.vercel.app/tower" },
} as const;
export type OnboardingAction = keyof typeof DESTINATIONS;
export function welcomeActionUrl(action: string): string | null {
  return action in DESTINATIONS ? DESTINATIONS[action as OnboardingAction].url : null;
}

export function towerWelcomePanel() {
  const components: DiscordActionRow[] = [{
    type: 1, components: (Object.entries(DESTINATIONS) as [OnboardingAction, typeof DESTINATIONS[OnboardingAction]][])
      .map(([key, value]) => ({ type: 2 as const, style: 1 as const, label: value.label, custom_id: `gn:welcome:${key}` })),
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
