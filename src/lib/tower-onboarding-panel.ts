import { getChannel, listChannelMessages, sendChannelMessage, type DiscordActionRow, type DiscordRestResult, type SentMessage } from "@/lib/discord-rest";
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

/**
 * Explicitly invoked by the owner-only admin route after typed confirmation.
 * The recent-history check makes retries idempotent beyond Discord's short nonce
 * window; enforce_nonce also collapses concurrent retries within that window.
 * If Discord cannot verify the destination/history, this fails closed.
 */
export async function publishTowerWelcomePanel(input: {
  guildId: string;
  channelId: string;
  deadline: Date;
}): Promise<DiscordRestResult<SentMessage & { alreadyPublished: boolean }>> {
  if (process.env.VERCEL_ENV === "preview" ||
      process.env.TOWER_ONBOARDING_PANEL_ENABLED !== "true" ||
      !input.guildId || input.guildId !== process.env.TOWER_DISCORD_GUILD_ID ||
      !input.channelId || input.channelId !== process.env.TOWER_DISCORD_WELCOME_CHANNEL_ID) {
    return { ok: false, kind: "not_configured", message: "Panneau non configuré.", retryable: false };
  }

  const channel = await getChannel({ channelId: input.channelId, deadline: input.deadline });
  if (!channel.ok) return channel;
  if (channel.data.guildId !== input.guildId || ![0, 5].includes(channel.data.type)) {
    return { ok: false, kind: "destination_mismatch", message: "Le salon cible n'est pas un salon textuel du serveur Tower configuré.", retryable: false };
  }

  const recent = await listChannelMessages({ channelId: input.channelId, limit: 100, deadline: input.deadline });
  if (!recent.ok) return recent;

  const panel = towerWelcomePanel();
  const expectedIds = panel.components.flatMap(row => row.components.map(component => component.custom_id));
  const existing = recent.data.messages.find(message =>
    message.channelId === input.channelId &&
    message.authorIsBot &&
    message.content === panel.content &&
    message.componentIds.length === expectedIds.length &&
    message.componentIds.every((id, index) => id === expectedIds[index])
  );
  if (existing) {
    return { ok: true, data: { messageId: existing.messageId, channelId: existing.channelId, alreadyPublished: true } };
  }

  const sent = await sendChannelMessage({
    channelId: input.channelId,
    ...panel,
    nonce: "tower-welcome-v1",
    deadline: input.deadline,
  });
  return sent.ok ? { ok: true, data: { ...sent.data, alreadyPublished: false } } : sent;
}
