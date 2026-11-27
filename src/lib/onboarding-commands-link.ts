import { towerGuildId } from "@/lib/tower-config";

const SNOWFLAKE = /^\d{17,20}$/;

/**
 * Lien vers le salon des commandes du bot, pour la communauté active qui
 * correspond au serveur The Tower configuré (`TOWER_DISCORD_GUILD_ID`) et au
 * salon `TOWER_DISCORD_COMMANDS_CHANNEL_ID`. Aucun slug ni identifiant de
 * serveur n'est codé en dur : une autre communauté, même active, ne reçoit
 * jamais un lien vers le serveur Tower.
 */
export function onboardingCommandsChannelUrl(
  community: { status: string; discordGuildId: string | null } | null | undefined,
  env: Record<string, string | undefined> = process.env
): string | null {
  if (community?.status !== "ACTIVE") return null;
  const guildId = community.discordGuildId?.trim() ?? "";
  const channelId = env.TOWER_DISCORD_COMMANDS_CHANNEL_ID?.trim() ?? "";
  if (!SNOWFLAKE.test(guildId) || !SNOWFLAKE.test(channelId)) return null;
  if (guildId !== towerGuildId(env)) return null;
  return `https://discord.com/channels/${guildId}/${channelId}`;
}
