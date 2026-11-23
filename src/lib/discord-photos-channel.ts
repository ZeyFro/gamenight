/**
 * Photos des soirées sur Discord (décision de Maxime du 23/11, Q6) : pas de galerie dans l'application ; la page d'une
 * soirée renvoie vers le salon 📸・photos-soirées du serveur. Lien affiché seulement si `DISCORD_BOT_GUILD_ID` et
 * `DISCORD_PHOTOS_CHANNEL_ID` sont des identifiants Discord valides. L'accès au salon reste réglé par Discord.
 */
export const DISCORD_PHOTOS_CHANNEL_NAME = "📸・photos-soirées";

const SNOWFLAKE = /^\d{17,20}$/;

export function discordPhotosChannelUrl(env: Record<string, string | undefined> = process.env): string | null {
  const guildId = env.DISCORD_BOT_GUILD_ID?.trim() ?? "";
  const channelId = env.DISCORD_PHOTOS_CHANNEL_ID?.trim() ?? "";
  if (!SNOWFLAKE.test(guildId) || !SNOWFLAKE.test(channelId)) return null;
  return `https://discord.com/channels/${guildId}/${channelId}`;
}
