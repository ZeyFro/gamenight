import type { CommunityChannelCategory } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { DEFAULT_COMMUNITY_SLUG } from "@/lib/default-community";
import { isCommunityIsolationEnabled, isMemberOfCommunity, resolveActiveCommunityId } from "@/lib/community-isolation";
import {
  getSessionAnnounceConfig,
  getTournamentAnnounceConfig,
  type SessionAnnounceConfig,
  type TournamentAnnounceConfig,
} from "@/lib/discord-bot-config";

/**
 * Multi-communautés, PR3 — salons Discord par communauté, derrière
 * `COMMUNITY_CHANNELS_ENABLED` (exactement `true`, éteint par défaut).
 *
 * Éteint : EXACTEMENT la configuration d'environnement historique
 * (`DISCORD_BOT_GUILD_ID` + `DISCORD_BOT_*_CHANNEL_ID`), la communauté est
 * ignorée et aucune lecture en base n'a lieu.
 *
 * Allumé : la destination vient de `CommunityChannelConfig` (serveur =
 * `Community.discordGuildId`). Règles, toutes fail-closed :
 *  - communauté non ACTIVE ou introuvable : aucune destination ;
 *  - salon désactivé (`enabled=false`) : aucune destination, pas de repli ;
 *  - pas de salon configuré : repli sur l'environnement UNIQUEMENT pour la
 *    communauté `default` ; pour toute autre communauté, aucune destination.
 *    Jamais un repli vers le salon d'une autre communauté.
 * `communityId === null` désigne la communauté par défaut (lignes historiques).
 */

export type AnnounceConfig = SessionAnnounceConfig & TournamentAnnounceConfig;

export function isCommunityChannelsEnabled(): boolean {
  return process.env.COMMUNITY_CHANNELS_ENABLED === "true";
}

async function resolveAnnounceConfig(
  category: CommunityChannelCategory,
  communityId: string | null,
  legacy: () => AnnounceConfig | null
): Promise<AnnounceConfig | null> {
  if (!isCommunityChannelsEnabled()) {
    // Un parent nondefault reste identifié même après extinction des flags.
    if (communityId) {
      const community = await prisma.community.findUnique({ where: { id: communityId }, select: { slug: true, status: true } });
      return community?.slug === DEFAULT_COMMUNITY_SLUG && community.status === "ACTIVE" ? legacy() : null;
    }
    if (isCommunityIsolationEnabled()) {
      const community = await prisma.community.findUnique({ where: { slug: DEFAULT_COMMUNITY_SLUG }, select: { status: true } });
      if (community?.status !== "ACTIVE") return null;
    }
    return legacy();
  }

  const include = { channelConfigs: { where: { category } } };
  const community = communityId
    ? await prisma.community.findUnique({ where: { id: communityId }, include })
    : await prisma.community.findUnique({ where: { slug: DEFAULT_COMMUNITY_SLUG }, include });
  if (!community) return communityId || isCommunityIsolationEnabled() ? null : legacy();
  if (community.status !== "ACTIVE") return null;

  const isDefault = community.slug === DEFAULT_COMMUNITY_SLUG;
  const row = community.channelConfigs[0];
  if (!row) return isDefault ? legacy() : null;
  if (!row.enabled) return null;

  // La communauté par défaut peut ne pas encore avoir son serveur en base
  // (`DISCORD_BOT_GUILD_ID` historique) ; une autre ne l'emprunte jamais.
  const guildId = community.discordGuildId ?? (isDefault ? process.env.DISCORD_BOT_GUILD_ID?.trim() : undefined);
  if (!guildId) return null;
  return { guildId, channelId: row.discordChannelId };
}

export function resolveSessionAnnounceConfig(communityId: string | null) {
  return resolveAnnounceConfig("SESSION", communityId, getSessionAnnounceConfig);
}

export function resolveTournamentAnnounceConfig(communityId: string | null) {
  return resolveAnnounceConfig("TOURNAMENT", communityId, getTournamentAnnounceConfig);
}

export async function resolveFreeGamesAnnounceConfig(communityId: string | null) {
  if (!isCommunityChannelsEnabled()) return null;
  const include = { channelConfigs: { where: { category: "FREE_GAMES" as const } } };
  const community = communityId
    ? await prisma.community.findUnique({ where: { id: communityId }, include })
    : await prisma.community.findUnique({ where: { slug: DEFAULT_COMMUNITY_SLUG }, include });
  if (!community || community.status !== "ACTIVE") return null;
  const config = community.channelConfigs[0];
  if (!config?.enabled) return null;
  const guildId = community.discordGuildId ?? (community.slug === DEFAULT_COMMUNITY_SLUG ? process.env.DISCORD_BOT_GUILD_ID?.trim() : null);
  if (!guildId || !/^\d{17,20}$/.test(guildId) || !/^\d{17,20}$/.test(config.discordChannelId)) return null;
  return { guildId, channelId: config.discordChannelId };
}

export async function resolveVoiceChannelUrl(communityId: string | null): Promise<string | null> {
  if (!isCommunityChannelsEnabled()) return null;
  const include = { channelConfigs: { where: { category: "VOICE" as const } } };
  const community = communityId
    ? await prisma.community.findUnique({ where: { id: communityId }, include })
    : await prisma.community.findUnique({ where: { slug: DEFAULT_COMMUNITY_SLUG }, include });
  if (!community || community.status !== "ACTIVE") return null;
  const config = community.channelConfigs[0];
  if (!config?.enabled) return null;
  const guildId = community.discordGuildId ?? (community.slug === DEFAULT_COMMUNITY_SLUG ? process.env.DISCORD_BOT_GUILD_ID?.trim() : null);
  if (!guildId || !/^\d{17,20}$/.test(guildId) || !/^\d{17,20}$/.test(config.discordChannelId)) return null;
  return `https://discord.com/channels/${guildId}/${config.discordChannelId}`;
}

/** Équivalent de `isSessionAnnounceViaBotEnabled` (discord-bot-config.ts) pour une communauté. */
export async function isSessionAnnounceViaBotEnabledFor(communityId: string | null): Promise<boolean> {
  return (
    process.env.DISCORD_BOT_SESSION_ANNOUNCE_ENABLED === "true" &&
    (await resolveSessionAnnounceConfig(communityId)) !== null
  );
}

/** Équivalent de `isTournamentAnnounceViaBotEnabled` (discord-bot-config.ts) pour une communauté. */
export async function isTournamentAnnounceViaBotEnabledFor(communityId: string | null): Promise<boolean> {
  return (
    process.env.DISCORD_BOT_TOURNAMENT_ANNOUNCE_ENABLED === "true" &&
    (await resolveTournamentAnnounceConfig(communityId)) !== null
  );
}

/**
 * Communauté d'une NOUVELLE soirée/tournoi. Salons par communauté ET
 * isolation éteints : les membres de `default` gardent le rattachement
 * historique `null`; les autres doivent avoir une communauté ACTIVE, qui est
 * persistée explicitement. Sinon : la seule communauté ACTIVE du créateur ;
 * s'il en a plusieurs, la communauté choisie, puis `default` ou la plus ancienne.
 * Aucune : `null` — l'appelant doit refuser la création. Provisoire : l'écran de choix explicite du
 * serveur (PR5) remplacera cette heuristique.
 */
export async function pickCreationCommunityId(userId: string): Promise<string | null> {
  if (!isCommunityChannelsEnabled() && !isCommunityIsolationEnabled() && await isMemberOfCommunity(userId, null)) {
    return null;
  }
  return resolveActiveCommunityId(userId);
}
