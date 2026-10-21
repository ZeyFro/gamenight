import { prisma } from "@/lib/prisma";
import { writeCommunityIdForUser } from "@/lib/community-stats";
import { scopedPrismaForCommunityId, scopedTransactionPrisma } from "@/lib/community-scoped-client";
import { lockCommunityProgress } from "@/lib/member-stats";
import { levelForXp, rankForLevel, titleForLevel } from "@/lib/xp";

/**
 * Correction manuelle de l'XP d'un joueur (onglet « Joueurs » de /admin).
 *
 * L'XP vit PAR COMMUNAUTÉ (`CommunityMemberStats.xpTotal`) ; le niveau et le rang
 * se calculent à la volée depuis ce solde (`levelForXp`), rien d'autre à mettre à
 * jour. Une correction :
 *  - remplace le solde de la communauté ACTUELLE de l'admin (jamais une autre),
 *  - ajoute un `XpEvent` ADMIN_ADJUSTMENT de l'écart, pour que les classements par
 *    période (qui additionnent le ledger) restent cohérents avec le solde,
 *  - est journalisée dans `XpAdjustment` (qui, quand, avant, après, raison).
 */

export const XP_ADJUSTMENT_MAX = 10_000_000;
export const XP_ADJUSTMENT_REASON_MAX = 500;
const SEARCH_LIMIT = 10;
const HISTORY_LIMIT = 20;
const ADJUSTMENTS_LIMIT = 5;

export interface AdminCommunity {
  id: string;
  name: string;
}

/** Communauté « actuelle » de l'admin (même règle que le reste de l'app), `null` s'il n'en a aucune. */
export async function getAdminCurrentCommunity(adminId: string): Promise<AdminCommunity | null> {
  const communityId = await writeCommunityIdForUser(adminId);
  if (communityId === null) return null;
  const community = await prisma.community.findUnique({ where: { id: communityId }, select: { id: true, name: true } });
  return community;
}

export interface AdminPlayerSummary {
  id: string;
  discordName: string;
  discordAvatar: string | null;
  xpTotal: number;
}

/** Membres ACTIFS de la communauté dont le pseudo Discord contient `query` (insensible à la casse). */
export async function searchAdminPlayers(communityId: string, query: string): Promise<AdminPlayerSummary[]> {
  const q = query.trim();
  if (q === "") return [];
  const users = await prisma.user.findMany({
    where: {
      discordName: { contains: q, mode: "insensitive" },
      memberships: { some: { communityId, status: "ACTIVE" } },
    },
    select: { id: true, discordName: true, discordAvatar: true },
    orderBy: { discordName: "asc" },
    take: SEARCH_LIMIT,
  });
  if (users.length === 0) return [];
  const scopedDb = await scopedPrismaForCommunityId(communityId);
  const stats = await scopedDb.communityMemberStats.findMany({
    where: { communityId, userId: { in: users.map((u) => u.id) } },
    select: { userId: true, xpTotal: true },
  });
  const xpByUser = new Map(stats.map((row) => [row.userId, row.xpTotal]));
  return users.map((u) => ({ ...u, xpTotal: xpByUser.get(u.id) ?? 0 }));
}

export interface AdminPlayerEvent {
  id: string;
  reason: string;
  amount: number;
  createdAt: Date;
  /** Vrai pour un gain de création dont la soirée n'existe plus (indice d'abus : création puis suppression). */
  sessionDeleted: boolean;
}

export interface AdminPlayerAdjustment {
  id: string;
  adminName: string;
  oldXp: number;
  newXp: number;
  reason: string | null;
  createdAt: Date;
}

export interface AdminPlayerDetail extends AdminPlayerSummary {
  level: number;
  rankName: string;
  title: string;
  recentEvents: AdminPlayerEvent[];
  /** Gains « soirée créée » et part dont la soirée a été supprimée (tout l'historique de la communauté). */
  creations: { paid: number; deleted: number };
  adjustments: AdminPlayerAdjustment[];
}

/** Fiche d'un joueur dans la communauté ; `null` s'il n'en est pas membre actif. */
export async function getAdminPlayerDetail(communityId: string, userId: string): Promise<AdminPlayerDetail | null> {
  const user = await prisma.user.findFirst({
    where: { id: userId, memberships: { some: { communityId, status: "ACTIVE" } } },
    select: { id: true, discordName: true, discordAvatar: true },
  });
  if (!user) return null;
  const scopedDb = await scopedPrismaForCommunityId(communityId);
  const [stats, events, creationEvents, adjustments] = await Promise.all([
    scopedDb.communityMemberStats.findUnique({
      where: { communityId_userId: { communityId, userId } },
      select: { xpTotal: true },
    }),
    scopedDb.xpEvent.findMany({
      where: { communityId, userId },
      orderBy: { createdAt: "desc" },
      take: HISTORY_LIMIT,
      select: { id: true, reason: true, amount: true, createdAt: true, sourceId: true },
    }),
    scopedDb.xpEvent.findMany({
      where: { communityId, userId, reason: "CREATE_SESSION" },
      select: { sourceId: true },
    }),
    scopedDb.xpAdjustment.findMany({
      where: { communityId, userId },
      orderBy: { createdAt: "desc" },
      take: ADJUSTMENTS_LIMIT,
      select: { id: true, adminName: true, oldXp: true, newXp: true, reason: true, createdAt: true },
    }),
  ]);
  const creationSourceIds = [...new Set([...creationEvents.map((e) => e.sourceId), ...events.filter((e) => e.reason === "CREATE_SESSION").map((e) => e.sourceId)])];
  const existingSessions = creationSourceIds.length
    ? new Set((await scopedDb.session.findMany({ where: { id: { in: creationSourceIds } }, select: { id: true } })).map((s) => s.id))
    : new Set<string>();
  const xpTotal = stats?.xpTotal ?? 0;
  const level = levelForXp(xpTotal);
  return {
    ...user,
    xpTotal,
    level,
    rankName: rankForLevel(level).name,
    title: titleForLevel(level),
    recentEvents: events.map((e) => ({
      id: e.id,
      reason: e.reason,
      amount: e.amount,
      createdAt: e.createdAt,
      sessionDeleted: e.reason === "CREATE_SESSION" && !existingSessions.has(e.sourceId),
    })),
    creations: {
      paid: creationEvents.length,
      deleted: creationEvents.filter((e) => !existingSessions.has(e.sourceId)).length,
    },
    adjustments,
  };
}

/** Raison libre : espaces retirés, `null` si vide, refus au-delà de la limite. */
export function normalizeAdjustmentReason(raw: unknown): { ok: true; reason: string | null } | { ok: false } {
  if (raw === null || raw === undefined) return { ok: true, reason: null };
  if (typeof raw !== "string") return { ok: false };
  const reason = raw.trim();
  if (reason.length > XP_ADJUSTMENT_REASON_MAX) return { ok: false };
  return { ok: true, reason: reason === "" ? null : reason };
}

/** Entier d'XP valide (0 à `XP_ADJUSTMENT_MAX`) depuis un champ de formulaire ; `null` sinon. */
export function parseXpValue(raw: unknown): number | null {
  if (typeof raw !== "string" || !/^\d{1,8}$/.test(raw.trim())) return null;
  const value = Number(raw.trim());
  return value <= XP_ADJUSTMENT_MAX ? value : null;
}

export type ApplyXpAdjustmentResult =
  | { ok: true; oldXp: number; newXp: number }
  | { ok: false; reason: "invalid" | "not_member" | "unchanged" | "stale" };

/**
 * Applique la correction dans UNE transaction : verrou de la communauté et du
 * membre (comme les gains d'XP), puis verrou de la ligne de stats. `expectedOldXp`
 * est le solde que l'admin a vu avant de confirmer : s'il a bougé entre-temps (gain
 * simultané, autre admin), rien n'est écrit (`stale`) et l'admin revoit la valeur.
 */
export async function applyXpAdjustment(input: {
  adminId: string;
  adminName: string;
  communityId: string;
  userId: string;
  newXp: number;
  expectedOldXp: number;
  reason: string | null;
}): Promise<ApplyXpAdjustmentResult> {
  const { adminId, adminName, communityId, userId, newXp, expectedOldXp, reason } = input;
  if (!Number.isInteger(newXp) || newXp < 0 || newXp > XP_ADJUSTMENT_MAX) return { ok: false, reason: "invalid" };
  if (!Number.isInteger(expectedOldXp) || expectedOldXp < 0) return { ok: false, reason: "invalid" };
  if (reason !== null && reason.length > XP_ADJUSTMENT_REASON_MAX) return { ok: false, reason: "invalid" };

  return prisma.$transaction(async (tx): Promise<ApplyXpAdjustmentResult> => {
    if (!(await lockCommunityProgress(tx, communityId, userId))) return { ok: false, reason: "not_member" };
    const target = await tx.user.findUnique({ where: { id: userId }, select: { discordName: true } });
    if (!target) return { ok: false, reason: "not_member" };

    const scopedDb = scopedTransactionPrisma(tx, { communityIds: [communityId], includesDefault: false });
    await scopedDb.communityMemberStats.createMany({ data: [{ communityId, userId }], skipDuplicates: true });
    await tx.$queryRaw`SELECT "userId" FROM "CommunityMemberStats" WHERE "communityId" = ${communityId} AND "userId" = ${userId} FOR UPDATE`;
    const stats = await scopedDb.communityMemberStats.findUniqueOrThrow({
      where: { communityId_userId: { communityId, userId } },
      select: { xpTotal: true },
    });
    if (stats.xpTotal !== expectedOldXp) return { ok: false, reason: "stale" };
    if (stats.xpTotal === newXp) return { ok: false, reason: "unchanged" };

    const adjustment = await scopedDb.xpAdjustment.create({
      data: { communityId, userId, userName: target.discordName, adminId, adminName, oldXp: stats.xpTotal, newXp, reason },
      select: { id: true },
    });
    await scopedDb.xpEvent.create({
      data: { communityId, userId, reason: "ADMIN_ADJUSTMENT", sourceId: adjustment.id, amount: newXp - stats.xpTotal },
    });
    await scopedDb.communityMemberStats.update({
      where: { communityId_userId: { communityId, userId } },
      data: { xpTotal: newXp },
    });
    return { ok: true, oldXp: stats.xpTotal, newXp };
  });
}
