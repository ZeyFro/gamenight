import { scopedPrismaForCommunityId, scopedTransactionPrisma } from "@/lib/community-scoped-client";
import { listCronCommunityIds } from "@/lib/community-isolation";
import { getDefaultCommunityId } from "@/lib/default-community";
import { writeCommunityIdForUser } from "@/lib/community-stats";
import { prisma } from "@/lib/prisma";
import { wallClockNow, endOfMonthUTC } from "@/lib/wallclock";
import { levelForXp, rankForLevel } from "@/lib/xp";
import { ACCENT_COLOR } from "@/lib/discord";
import { postToCommunity } from "@/lib/community-announce";
import { isUniqueConstraintViolation } from "@/lib/xp-actions";
import { logger } from "@/lib/logger";

/**
 * Sprint 4 (FEATURE 3, Saisons mensuelles) — reset mensuel du classement
 * XP. Une seule saison `isActive` par communauté à la fois (invariant applicatif). Voir
 * le commentaire sur `Season` (prisma/schema.prisma) pour le contexte
 * complet.
 */
export async function getActiveSeason(communityId?: string) {
  const id = communityId ?? await getDefaultCommunityId();
  const scopedDb = await scopedPrismaForCommunityId(id);
  return scopedDb.season.findFirst({ where: { communityId: id, isActive: true } });
}

/** Pure — numéro de la prochaine saison à créer, extrait pour rester testable sans Prisma. `null` = aucune saison n'a jamais existé (tout premier bootstrap). */
export function nextSeasonNumber(currentMaxNumber: number | null): number {
  return (currentMaxNumber ?? 0) + 1;
}

/**
 * Pure — classe des users par XP décroissant et assigne les positions
 * (1-indexées). Extrait pour rester testable sans Prisma (PR "Fiabilise la
 * clôture des saisons").
 *
 * Utilisé avec des valeurs déjà lues sous verrou (`SELECT ... FOR UPDATE`,
 * voir `finalizeSeasonIfDue`) — jamais avec un `ORDER BY` SQL : sous
 * `FOR UPDATE`, une ligne pour laquelle il a fallu attendre un verrou
 * concurrent est retournée dans sa version la plus récente, mais l'
 * `ORDER BY` SQL a été évalué AVANT cette attente — le tri SQL peut donc ne
 * plus correspondre aux valeurs réellement renvoyées. Trier ici, après
 * coup, sur les valeurs effectives élimine ce risque.
 *
 * Égalités : `Array.prototype.sort` est stable (garanti par le spec
 * ECMAScript) — deux users à XP égal gardent leur ordre relatif d'entrée,
 * qui reste non spécifié (aucune clé de tri secondaire), exactement comme
 * le `ORDER BY xpTotal DESC` sans clé secondaire qu'il remplace. Chacun
 * reçoit malgré tout une position strictement croissante (jamais deux users
 * à la position 1).
 */
export function rankUsersByXp<T extends { xpTotal: number }>(
  users: T[]
): (T & { position: number })[] {
  return [...users]
    .sort((a, b) => b.xpTotal - a.xpTotal)
    .map((u, i) => ({ ...u, position: i + 1 }));
}

/** Aucun user en base au moment de la clôture — annule tout (voir `finalizeSeasonIfDue`), pas une vraie erreur. */
class NoUsersToCloseSeasonError extends Error {}

/**
 * Garde-fou idempotent qui garantit une saison active — appelé à la
 * volée (Home, cron `close-sessions`) : ne coûte qu'un `findFirst` tant
 * qu'une saison active existe déjà (99.9% des appels), et répare l'état
 * sinon.
 *
 * Renommée depuis `ensureFirstSeasonExists` (PR "Atomicité saisons +
 * tournois") — corrige un bug remonté à la reconnaissance : l'ancienne
 * version recréait TOUJOURS "Saison 1" en dur dès qu'aucune saison
 * n'était active, quelle qu'en soit la cause. Ça fonctionnait pour le
 * tout premier bootstrap (base vierge), mais échouait silencieusement
 * pour toute autre cause survenant APRÈS qu'un vrai cycle de saisons ait
 * commencé (ex. un crash entre la clôture d'une saison et la création de
 * la suivante — désormais structurellement impossible grâce à la
 * transaction de `finalizeSeasonIfDue` ci-dessous, mais ce garde-fou
 * reste la seule protection pour toute AUTRE cause, ex. une suppression
 * accidentelle en base) : `number: 1` percutait la contrainte unique
 * `Season(communityId, number)` dès qu'une vraie saison 1 existait déjà dans
 * l'historique, l'erreur était catchée silencieusement par le
 * `isUniqueConstraintViolation` ci-dessous, et l'app restait SANS
 * saison active indéfiniment.
 *
 * Calcule maintenant le bon numéro à reprendre (`nextSeasonNumber`, MAX
 * existant + 1) au lieu de le hardcoder — fonctionne aussi bien pour le
 * tout premier bootstrap (`MAX` = `null` → 1) que pour une réparation en
 * plein cycle.
 *
 * Idempotent par construction : `getActiveSeason()` retrouve la saison
 * dès qu'une existe, et la contrainte unique sur `Season(communityId, number)` empêche
 * une double création en cas d'appels concurrents (retombe
 * silencieusement, même filet de sécurité que `unlockBadge`) — désormais
 * sur le bon numéro dans tous les cas, donc un appel concurrent retombe
 * proprement au lieu de rester bloqué.
 */
export async function ensureActiveSeasonExists(communityId?: string): Promise<void> {
  const id = communityId ?? await getDefaultCommunityId();
  const scopedDb = await scopedPrismaForCommunityId(id);
  const active = await getActiveSeason(id);
  if (active) return;

  const lastSeason = await scopedDb.season.findFirst({ where: { communityId: id }, orderBy: { number: "desc" } });
  const number = nextSeasonNumber(lastSeason?.number ?? null);

  const now = wallClockNow();
  try {
    await scopedDb.season.create({
      data: {
        communityId: id,
        number,
        name: `Saison ${number}`,
        startDate: now,
        endDate: endOfMonthUTC(now),
        isActive: true,
      },
    });
  } catch (error) {
    if (isUniqueConstraintViolation(error)) return;
    throw error;
  }
}

/** Snapshot, remise à zéro et saison suivante partagent la transaction et le verrou de communauté. */
export async function finalizeSeasonIfDue(): Promise<void> {
  for (const communityId of await listCronCommunityIds()) await finalizeCommunitySeasonIfDue(communityId);
}

async function finalizeCommunitySeasonIfDue(communityId: string): Promise<void> {
  const season = await getActiveSeason(communityId);
  if (!season || wallClockNow() < season.endDate) return;
  const now = wallClockNow();
  const outcome = await prisma.$transaction(async (tx) => {
    // Tous les writers de progression prennent FOR SHARE sur la communauté.
    // FOR UPDATE couvre aussi un membre dont la ligne stats n'existe pas encore.
    const communities = await tx.$queryRaw<{ status: string }[]>`
      SELECT status FROM "Community" WHERE id = ${communityId} FOR UPDATE
    `;
    if (communities[0]?.status !== "ACTIVE") return null;
    const scopedDb = scopedTransactionPrisma(tx, { communityIds: [communityId], includesDefault: false });
    const claim = await scopedDb.season.updateMany({ where: { id: season.id, isActive: true }, data: { isActive: false } });
    if (claim.count !== 1) return null;
    const progress = await scopedDb.communityMemberStats.findMany({
      where: { communityId }, include: { user: { select: { id: true, discordId: true, discordName: true,
        memberships: { where: { communityId, status: "ACTIVE" }, select: { userId: true } },
      } } },
    });
    if (progress.length === 0) throw new NoUsersToCloseSeasonError();
    const ranked = rankUsersByXp(progress.map((p) => ({ ...p.user, xpTotal: p.xpTotal })));
    await scopedDb.seasonSnapshot.createMany({ data: ranked.map((u) => ({
      seasonId: season.id, userId: u.id, xp: u.xpTotal,
      level: levelForXp(u.xpTotal), rank: rankForLevel(levelForXp(u.xpTotal)).name, position: u.position,
    })) });
    await scopedDb.communityMemberStats.updateMany({ where: { communityId }, data: { xpTotal: 0 } });
    await scopedDb.season.create({ data: {
      communityId, number: season.number + 1, name: `Saison ${season.number + 1}`,
      startDate: now, endDate: endOfMonthUTC(now), isActive: true,
    } });
    // Le snapshot conserve l'historique des départs. Seul un membre encore actif est annoncé.
    return ranked.find((u) => u.memberships.length > 0) ?? null;
  }).catch((error: unknown) => {
    if (error instanceof NoUsersToCloseSeasonError) return null;
    throw error;
  });
  if (!outcome) return;
  const result = await postToCommunity(communityId, {
    title: `🏆 ${season.name} terminée !`,
    description: `Champion : <@${outcome.discordId}> avec ${outcome.xpTotal} XP !\nL'XP du serveur repart à 0 — nouvelle saison lancée.`,
    color: ACCENT_COLOR,
  });
  if (!result.ok) logger.warn("seasons", "Notif Discord fin de saison non envoyée.", { seasonId: season.id });
}

/** Home — "Saison X — Jour Y/30" avec barre de progression. `null` si aucune saison active (ne devrait pas arriver post-bootstrap). */
export async function getSeasonProgress(viewerId: string): Promise<{
  number: number;
  name: string;
  dayOfMonth: number;
  totalDays: number;
} | null> {
  const communityId = await writeCommunityIdForUser(viewerId);
  if (communityId === null) return null;
  const season = await getActiveSeason(communityId);
  if (!season) return null;

  const now = wallClockNow();
  const dayOfMonth = now.getUTCDate();
  const totalDays = endOfMonthUTC(now).getUTCDate();

  return { number: season.number, name: season.name, dayOfMonth, totalDays };
}

export async function ensureActiveSeasonExistsForViewer(viewerId: string): Promise<void> {
  const communityId = await writeCommunityIdForUser(viewerId);
  if (communityId !== null) await ensureActiveSeasonExists(communityId);
}

export async function ensureActiveSeasonsExist(): Promise<void> {
  for (const communityId of await listCronCommunityIds()) await ensureActiveSeasonExists(communityId);
}
