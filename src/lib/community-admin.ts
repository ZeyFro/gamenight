import type { CommunityChannelCategory } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { DEFAULT_COMMUNITY_SLUG } from "@/lib/default-community";
import { listGuildChannels, verifyChannelDestination, verifyVoiceChannelDestination, type GuildChannel } from "@/lib/discord-rest";
import { parseSteamPriceAlertThreshold } from "@/lib/wishlist-price-alerts";
import { parseAttendanceXpSettings } from "@/lib/session-attendance";

/**
 * Multi-communautés — écran d'administration (onglet « Communautés » de
 * `/admin`), derrière `COMMUNITY_ADMIN_ENABLED` (exactement `true`, éteint par
 * défaut). Éteint : aucun onglet, aucune action, aucune lecture.
 *
 * Deux écritures seulement, toutes revalidées en base à chaque appel :
 *  - `activateCommunity` : PENDING → ACTIVE (jamais depuis un autre statut) ;
 *  - `setCommunityChannel` : salon SESSION / TOURNAMENT / FREE_GAMES et
 *    canal vocal d'une communauté. Le
 *    salon n'est enregistré qu'après un `GET` Discord réel
 *    (`verifyChannelDestination`) confirmant qu'il appartient au serveur de la
 *    communauté et accepte les fils. Aucun message n'est envoyé.
 * L'accès admin lui-même (`requireAdmin`) est contrôlé par l'appelant.
 */

export function isCommunityAdminEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.COMMUNITY_ADMIN_ENABLED === "true";
}

export const ADMIN_CHANNEL_CATEGORIES: readonly CommunityChannelCategory[] = ["SESSION", "TOURNAMENT", "VOICE", "FREE_GAMES"];

export function parseChannelCategory(value: unknown): CommunityChannelCategory | null {
  return ADMIN_CHANNEL_CATEGORIES.find((c) => c === value) ?? null;
}

export async function setCommunityGuide(input: { communityId: unknown; rules: unknown; contacts: unknown }) {
  if (
    typeof input.communityId !== "string" || !input.communityId ||
    (input.rules !== null && typeof input.rules !== "string") ||
    (input.contacts !== null && typeof input.contacts !== "string")
  ) return "invalid" as const;
  const rules = typeof input.rules === "string" ? input.rules.trim() : "";
  const contacts = typeof input.contacts === "string" ? input.contacts.trim() : "";
  if (rules.length > 4000 || contacts.length > 2000) return "invalid" as const;
  const result = await prisma.community.updateMany({
    where: { id: input.communityId, status: { in: ["PENDING", "ACTIVE"] } },
    data: { guideRules: rules || null, guideContacts: contacts || null },
  });
  return result.count ? "saved" as const : "unavailable" as const;
}

export async function setCommunityFreeGames(input: { communityId: unknown; enabled: unknown }) {
  if (typeof input.communityId !== "string" || !input.communityId || typeof input.enabled !== "boolean") return "invalid" as const;
  const result = await prisma.community.updateMany({
    where: { id: input.communityId, status: "ACTIVE" },
    data: { freeGamesEnabled: input.enabled },
  });
  return result.count ? "saved" as const : "unavailable" as const;
}

export async function setCommunitySteamPriceAlerts(input: { communityId: unknown; enabled: unknown; threshold: unknown }) {
  if (typeof input.communityId !== "string" || !input.communityId || typeof input.enabled !== "boolean") return "invalid" as const;
  const threshold = parseSteamPriceAlertThreshold(input.threshold);
  if (threshold === null) return "invalid" as const;
  const result = await prisma.community.updateMany({
    where: { id: input.communityId, status: { in: ["PENDING", "ACTIVE"] } },
    data: { steamPriceAlertsEnabled: input.enabled, steamPriceAlertThreshold: threshold },
  });
  return result.count ? "saved" as const : "unavailable" as const;
}

export async function setCommunityGroupPurchasePlans(input: { communityId: unknown; enabled: unknown }) {
  if (typeof input.communityId !== "string" || !input.communityId || typeof input.enabled !== "boolean") return "invalid" as const;
  const result = await prisma.community.updateMany({
    where: { id: input.communityId, status: { in: ["PENDING", "ACTIVE"] } },
    data: { groupPurchasePlansEnabled: input.enabled },
  });
  return result.count ? "saved" as const : "unavailable" as const;
}

export async function setCommunityAttendanceXp(input: {
  communityId: unknown;
  enabled: unknown;
  bonusXp: unknown;
  absencePenaltyXp: unknown;
}) {
  if (typeof input.communityId !== "string" || !input.communityId) return "invalid" as const;
  const settings = parseAttendanceXpSettings(input);
  if (!settings) return "invalid" as const;
  const result = await prisma.community.updateMany({
    where: { id: input.communityId, status: { in: ["PENDING", "ACTIVE"] } },
    data: settings,
  });
  return result.count ? "saved" as const : "unavailable" as const;
}

export async function setCommunityPlayerClassifieds(input: { communityId: unknown; enabled: unknown }) {
  if (typeof input.communityId !== "string" || !input.communityId || typeof input.enabled !== "boolean") {
    return "invalid" as const;
  }
  const result = await prisma.community.updateMany({
    where: { id: input.communityId, status: "ACTIVE" },
    data: { playerClassifiedsEnabled: input.enabled },
  });
  return result.count ? "saved" as const : "unavailable" as const;
}

export async function setCommunityTeams(input: { communityId: unknown; enabled: unknown }) {
  if (typeof input.communityId !== "string" || !input.communityId || typeof input.enabled !== "boolean") return "invalid" as const;
  const result = await prisma.community.updateMany({
    where: { id: input.communityId, status: "ACTIVE" },
    data: { communityTeamsEnabled: input.enabled },
  });
  return result.count ? "saved" as const : "unavailable" as const;
}

/** Identifiant Discord (snowflake) : chiffres seuls, jamais d'espace. */
function isSnowflake(value: string): boolean {
  return /^\d{17,20}$/.test(value);
}

const DISCORD_BUDGET_MS = 8_000;

/** Même règle que `community-channels.ts` : seule `default` emprunte le serveur de l'environnement. */
function guildIdOf(community: { slug: string; discordGuildId: string | null }): string | null {
  if (community.discordGuildId) return community.discordGuildId;
  return community.slug === DEFAULT_COMMUNITY_SLUG ? process.env.DISCORD_BOT_GUILD_ID?.trim() || null : null;
}

export type ActivateResult = "activated" | "not_found" | "not_pending" | "no_guild";

export async function activateCommunity(communityId: string, adminId: string): Promise<ActivateResult> {
  const community = await prisma.community.findUnique({ where: { id: communityId } });
  if (!community) return "not_found";
  if (community.status !== "PENDING") return "not_pending";
  if (!community.discordGuildId) return "no_guild";

  // `status: "PENDING"` dans le where : deux admins qui cliquent ensemble ne
  // réécrivent pas `activatedAt` / `activatedById`.
  const { count } = await prisma.community.updateMany({
    where: { id: communityId, status: "PENDING" },
    data: { status: "ACTIVE", activatedAt: new Date(), activatedById: adminId },
  });
  return count === 1 ? "activated" : "not_pending";
}

export type SetChannelFailure =
  | "invalid_channel"
  | "not_found"
  | "inactive"
  | "no_guild"
  | "unusable_channel"
  | "verification_failed";
export type SetChannelResult = { ok: true } | { ok: false; reason: SetChannelFailure };

export async function setCommunityChannel(input: {
  communityId: string;
  category: CommunityChannelCategory;
  channelId: string;
}): Promise<SetChannelResult> {
  if (!isSnowflake(input.channelId)) return { ok: false, reason: "invalid_channel" };

  const community = await prisma.community.findUnique({ where: { id: input.communityId } });
  if (!community) return { ok: false, reason: "not_found" };
  if (community.status !== "PENDING" && community.status !== "ACTIVE") return { ok: false, reason: "inactive" };
  const guildId = guildIdOf(community);
  if (!guildId) return { ok: false, reason: "no_guild" };

  const verified = await (input.category === "VOICE" ? verifyVoiceChannelDestination : verifyChannelDestination)({
    channelId: input.channelId,
    guildId,
    deadline: new Date(Date.now() + DISCORD_BUDGET_MS),
  });
  if (!verified.ok) {
    return { ok: false, reason: verified.kind === "destination_mismatch" ? "unusable_channel" : "verification_failed" };
  }

  await prisma.communityChannelConfig.upsert({
    where: { communityId_category: { communityId: community.id, category: input.category } },
    create: { communityId: community.id, category: input.category, discordChannelId: input.channelId, enabled: true },
    update: { discordChannelId: input.channelId, enabled: true },
  });
  return { ok: true };
}

export interface AdminCommunityRow {
  id: string;
  slug: string;
  name: string;
  guideRules: string | null;
  guideContacts: string | null;
  freeGamesEnabled: boolean;
  steamPriceAlertsEnabled: boolean;
  steamPriceAlertThreshold: number;
  groupPurchasePlansEnabled: boolean;
  attendanceXpEnabled: boolean;
  attendanceBonusXp: number;
  absencePenaltyXp: number;
  playerClassifiedsEnabled: boolean;
  communityTeamsEnabled: boolean;
  status: string;
  discordGuildId: string | null;
  activeMembers: number;
  sessionGalleryEnabled: boolean;
  channels: Partial<Record<CommunityChannelCategory, { discordChannelId: string; enabled: boolean }>>;
  /** Salons texte du serveur (liste Discord) ; `null` = indisponible, motif dans `channelsError`. */
  guildChannels: GuildChannel[] | null;
  channelsError: string | null;
}

/** Toutes les communautés, avec leurs salons configurés et, pour les PENDING/ACTIVE, les salons proposés par Discord. */
export async function listAdminCommunities(): Promise<AdminCommunityRow[]> {
  const communities = await prisma.community.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      channelConfigs: true,
      _count: { select: { memberships: { where: { status: "ACTIVE" } } } },
    },
  });

  return Promise.all(
    communities.map(async (c) => {
      const editable = c.status === "PENDING" || c.status === "ACTIVE";
      const guildId = guildIdOf(c);
      let guildChannels: GuildChannel[] | null = null;
      let channelsError: string | null = null;
      if (editable && guildId) {
        const res = await listGuildChannels({ guildId, deadline: new Date(Date.now() + DISCORD_BUDGET_MS) });
        if (res.ok) guildChannels = res.data.channels;
        else channelsError = res.message;
      }
      return {
        id: c.id,
        slug: c.slug,
        name: c.name,
        guideRules: c.guideRules,
        guideContacts: c.guideContacts,
        freeGamesEnabled: c.freeGamesEnabled,
        steamPriceAlertsEnabled: c.steamPriceAlertsEnabled,
        steamPriceAlertThreshold: c.steamPriceAlertThreshold,
        groupPurchasePlansEnabled: c.groupPurchasePlansEnabled,
        attendanceXpEnabled: c.attendanceXpEnabled,
        attendanceBonusXp: c.attendanceBonusXp,
        absencePenaltyXp: c.absencePenaltyXp,
        playerClassifiedsEnabled: c.playerClassifiedsEnabled,
        communityTeamsEnabled: c.communityTeamsEnabled,
        status: c.status,
        discordGuildId: guildId,
        activeMembers: c._count.memberships,
        sessionGalleryEnabled: c.sessionGalleryEnabled,
        channels: Object.fromEntries(
          c.channelConfigs.map((r) => [r.category, { discordChannelId: r.discordChannelId, enabled: r.enabled }])
        ),
        guildChannels,
        channelsError,
      };
    })
  );
}

export async function setCommunitySessionGallery(input: { communityId: unknown; enabled: unknown }) {
  if (typeof input.communityId !== "string" || !input.communityId || typeof input.enabled !== "boolean") {
    return "invalid" as const;
  }
  const result = await prisma.community.updateMany({
    where: { id: input.communityId, status: "ACTIVE" },
    data: { sessionGalleryEnabled: input.enabled },
  });
  return result.count ? "saved" as const : "unavailable" as const;
}
