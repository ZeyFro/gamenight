import { statsCommunityIdForSession } from "@/lib/community-stats";
import { lockCommunityProgress } from "@/lib/member-stats";
import { isUniqueConstraintViolation } from "@/lib/xp-actions";
import { getScopedPrisma, scopedPrisma, scopedTransactionPrisma } from "@/lib/community-scoped-client";
import { cronCommunityScope, isCommunityIsolationEnabled } from "@/lib/community-isolation";
import { canAccessSession } from "@/lib/session-access";
import { prisma } from "@/lib/prisma";
import { awardXp } from "@/lib/xp-actions";
import { checkBetBadges } from "@/lib/badges";
import { ACCENT_COLOR } from "@/lib/discord";

/** Mise minimale, et pas de mise au-delà de 50% du solde actuel — par tranches de 10 (spec). */
export const XP_BET_MIN = 10;
export const XP_BET_STEP = 10;
export const XP_BET_MAX_RATIO = 0.5;

/** Mise max autorisée pour un solde donné, arrondie au multiple de 10 inférieur. */
export function maxBetAmount(xpTotal: number): number {
  return Math.floor((xpTotal * XP_BET_MAX_RATIO) / XP_BET_STEP) * XP_BET_STEP;
}

export function isValidBetAmount(amount: number, xpTotal: number): boolean {
  if (!Number.isInteger(amount)) return false;
  if (amount < XP_BET_MIN) return false;
  if (amount % XP_BET_STEP !== 0) return false;
  return amount <= maxBetAmount(xpTotal);
}

/** Débit refusé faute de solde suffisant AU MOMENT du débit — voir `placeBet`. */
class InsufficientBalanceError extends Error {}

/**
 * Pose un pari — 1 par personne et par soirée (`@@unique([sessionId,
 * voterId])`). La mise est déduite du solde IMMÉDIATEMENT (mise "en jeu",
 * jamais négative : `isValidBetAmount` garantit `amount <= 50% du solde`
 * avant tout écriture). `allIn` fige si la mise valait le max autorisé au
 * moment du pari — nécessaire pour le badge "All In", `xpTotal` pouvant
 * changer après coup (cf. commentaire sur le modèle `XpBet`).
 *
 * Fix bug remonté (solde négatif, PR "Fiabilise la clôture des saisons")
 * — la vérification ci-dessus (`isValidBetAmount(amount, voter.xpTotal)`)
 * lit `xpTotal` HORS transaction, donc potentiellement périmée si le solde
 * change avant l'écriture réelle (autre pari, ou clôture de saison —
 * `finalizeSeasonIfDue`, `src/lib/seasons.ts`, qui verrouille les lignes
 * `User` via `SELECT ... FOR UPDATE`). Un pari dont le débit attend ce
 * verrou puis s'exécute APRÈS un reset à 0 appliquerait `decrement`
 * inconditionnellement — solde négatif garanti, sans aucune règle qui
 * l'empêche. La transaction ci-dessous revérifie donc `isValidBetAmount`
 * sur la valeur RÉELLE, verrouillée, au moment du débit — mêmes règles que
 * la vérification initiale (pas seulement "solde non négatif", la vraie
 * règle métier mise <= 50% du solde). Un refus à ce stade fait échouer
 * TOUTE la transaction, y compris le `xpBet.create` déjà exécuté : jamais
 * de pari orphelin sans débit correspondant.
 */
export async function placeBet(
  sessionId: string,
  voterId: string,
  targetUserId: string,
  amount: number
): Promise<boolean> {
  if (isCommunityIsolationEnabled() && (!(await canAccessSession(voterId, sessionId)) || !(await canAccessSession(targetUserId, sessionId)))) return false;
  const scopedDb = await getScopedPrisma(voterId);
  const session = await scopedDb.session.findUnique({ where: { id: sessionId }, select: { communityId: true, decidedGame: { select: { name: true } } } });
  if (!session) return false;
  const communityId = await statsCommunityIdForSession(session.communityId);
  try {
    return await prisma.$transaction(async (tx) => {
      if (!(await lockCommunityProgress(tx, communityId, voterId))) return false;
      if (isCommunityIsolationEnabled() && !(await lockCommunityProgress(tx, communityId, targetUserId))) return false;
      const scopedDb = scopedTransactionPrisma(tx, isCommunityIsolationEnabled() ? { communityIds: [communityId], includesDefault: false } : null);
      await scopedDb.communityMemberStats.createMany({ data: [{ communityId, userId: voterId }], skipDuplicates: true });
      const locked = await tx.$queryRaw<{ xpTotal: number }[]>`
        SELECT "xpTotal" FROM "CommunityMemberStats" WHERE "communityId" = ${communityId} AND "userId" = ${voterId} FOR UPDATE
      `;
      const currentXpTotal = locked[0]?.xpTotal;
      if (currentXpTotal === undefined || !isValidBetAmount(amount, currentXpTotal)) throw new InsufficientBalanceError();
      await scopedDb.xpBet.create({ data: {
        communityId, sessionId, voterId, targetUserId, amount,
        allIn: amount === maxBetAmount(currentXpTotal), gameName: session.decidedGame?.name ?? null,
      } });
      await scopedDb.communityMemberStats.update({
        where: { communityId_userId: { communityId, userId: voterId } }, data: { xpTotal: { decrement: amount } },
      });
      return true;
    });
  } catch (error) {
    if (error instanceof InsufficientBalanceError || isUniqueConstraintViolation(error)) return false;
    throw error;
  }
}

/**
 * Résout tous les paris d'une session en même temps que les pronostics
 * (appelée depuis `finalizeSuperlativeVoting`, mêmes 3 branches de sortie).
 * Gagné = `targetUserId` a gagné une catégorie carry/mvp → double mise
 * créditée via `awardXp` (reason `XP_BET_WON`, `applyStreak: false` —
 * rendre une mise + gains n'est pas un "gain" au sens streak). Perdu = rien
 * de plus, la mise a déjà été déduite à la pose du pari.
 */
export async function resolveBets(
  sessionId: string,
  carryMvpWinnerIds: Set<string>
): Promise<void> {
  const scopedDb = scopedPrisma(await cronCommunityScope());
  const session = await scopedDb.session.findUnique({ where: { id: sessionId }, select: { communityId: true } });
  if (!session) return;
  const bets = await scopedDb.xpBet.findMany({
    where: { sessionId },
    include: { voter: true, target: true },
  });

  for (const bet of bets) {
    const won = carryMvpWinnerIds.has(bet.targetUserId);
    await scopedDb.xpBet.update({ where: { id: bet.id }, data: { won } });
    if (!won) continue;

    await awardXp(bet.voterId, session.communityId, "XP_BET_WON", bet.id, bet.amount * 2, {
      applyStreak: false,
      rewardNotice: {
        type: "XP_BET", title: "🎲 Pari gagné !",
        message: `Ton pari sur ${bet.target.discordName} était le bon — +${bet.amount * 2} XP`,
        relatedSessionId: sessionId,
        embed: { title: "🎲 Pari gagné !",
          description: `<@${bet.voter.discordId}> avait misé sur le bon carry — +${bet.amount * 2} XP`, color: ACCENT_COLOR },
      },
    });
    await checkBetBadges(bet.voterId, session.communityId);
  }
}
