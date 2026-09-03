import { prisma } from "@/lib/prisma";
import { awardXp } from "@/lib/xp-actions";
import { createNotification } from "@/lib/notifications";
import { checkBetBadges } from "@/lib/badges";
import { postToDiscord, ACCENT_COLOR } from "@/lib/discord";
import { logger } from "@/lib/logger";

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

/**
 * Pose un pari — 1 par personne et par soirée (`@@unique([sessionId,
 * voterId])`). La mise est déduite du solde IMMÉDIATEMENT (mise "en jeu",
 * jamais négative : `isValidBetAmount` garantit `amount <= 50% du solde`
 * avant tout écriture). `allIn` fige si la mise valait le max autorisé au
 * moment du pari — nécessaire pour le badge "All In", `xpTotal` pouvant
 * changer après coup (cf. commentaire sur le modèle `XpBet`).
 */
export async function placeBet(
  sessionId: string,
  voterId: string,
  targetUserId: string,
  amount: number
): Promise<boolean> {
  const voter = await prisma.user.findUnique({
    where: { id: voterId },
    select: { xpTotal: true },
  });
  if (!voter || !isValidBetAmount(amount, voter.xpTotal)) return false;

  const allIn = amount === maxBetAmount(voter.xpTotal);

  try {
    await prisma.$transaction([
      prisma.xpBet.create({
        data: { sessionId, voterId, targetUserId, amount, allIn },
      }),
      prisma.user.update({
        where: { id: voterId },
        data: { xpTotal: { decrement: amount } },
      }),
    ]);
    return true;
  } catch {
    // Contrainte unique (déjà parié pour cette soirée) : on ignore.
    return false;
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
  const bets = await prisma.xpBet.findMany({
    where: { sessionId },
    include: { voter: true, target: true },
  });

  for (const bet of bets) {
    const won = carryMvpWinnerIds.has(bet.targetUserId);
    await prisma.xpBet.update({ where: { id: bet.id }, data: { won } });
    if (!won) continue;

    await awardXp(bet.voterId, "XP_BET_WON", bet.id, bet.amount * 2, {
      applyStreak: false,
    });
    await checkBetBadges(bet.voterId);

    await createNotification({
      userId: bet.voterId,
      type: "XP_BET",
      title: "🎲 Pari gagné !",
      message: `Ton pari sur ${bet.target.discordName} était le bon — +${bet.amount * 2} XP`,
      relatedSessionId: sessionId,
    });

    const result = await postToDiscord({
      title: "🎲 Pari gagné !",
      description: `<@${bet.voter.discordId}> avait misé sur le bon carry — +${bet.amount * 2} XP`,
      color: ACCENT_COLOR,
    });
    if (!result.ok) {
      logger.warn("xp-bets", "Notif Discord pari gagné non envoyée.", { betId: bet.id });
    }
  }
}
