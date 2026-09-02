import { Prisma } from "@prisma/client";
import type { XpReason } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { announceLevelUp } from "@/lib/discord-level-up";
import { levelForXp, streakMultiplier } from "@/lib/xp";

export function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
  );
}

/**
 * Attribue de l'XP à un user pour une action donnée — idempotent via la
 * contrainte unique `@@unique([userId, reason, sourceId])` sur `XpEvent` :
 * un second appel avec le même trio ne fait rien (silencieusement), ce qui
 * permet au script de backfill (prisma/backfill-xp.mjs) de tourner à
 * volonté sans jamais doubler une récompense déjà attribuée par le chemin
 * "live" (et vice-versa) — même mécanisme de prudence que le bug de seed
 * corrigé dans une PR précédente.
 *
 * `applyStreak = false` pour le backfill : le streak n'a pas de sens pour
 * de l'historique reconstruit après coup (cf. limite documentée dans le
 * script de backfill), donc pas de multiplicateur appliqué là-dessus —
 * uniquement pour l'XP gagnée en direct, aujourd'hui.
 *
 * `User.xpTotal` est incrémenté de façon atomique (`increment`, pas
 * lecture-puis-écriture) pour rester correct même sous accès concurrents ;
 * la détection de passage de niveau (pour la notif) se base sur une
 * lecture juste avant, avec une fenêtre de course très étroite et sans
 * conséquence sur les données (au pire, une notif de level up manquée
 * dans un cas extrêmement rare de deux actions simultanées du même user).
 *
 * Valeur de retour `{ leveledUp }` (Sprint 2 PR-B, U9) — ajoutée pour que
 * les quelques appelants qui redirigent vers une page vue par LE MÊME
 * user (ex. `createSession`) puissent déclencher les confettis de level
 * up (`?celebrate=levelup`) sans requête supplémentaire. Ignorée par tous
 * les autres appelants (boucles sur plusieurs participants, backfill) —
 * un `Promise` dont la valeur résolue n'est pas utilisée reste valide.
 */
export async function awardXp(
  userId: string,
  reason: XpReason,
  sourceId: string,
  baseAmount: number,
  { applyStreak = true }: { applyStreak?: boolean } = {}
): Promise<{ leveledUp: boolean }> {
  const before = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      xpTotal: true,
      streakCount: true,
      discordId: true,
      silenceReminders: true,
    },
  });
  if (!before) return { leveledUp: false };

  const multiplier = applyStreak ? streakMultiplier(before.streakCount) : 1;
  const amount = Math.round(baseAmount * multiplier);

  try {
    await prisma.xpEvent.create({ data: { userId, reason, sourceId, amount } });
  } catch (error) {
    if (isUniqueConstraintViolation(error)) return { leveledUp: false };
    throw error;
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { xpTotal: { increment: amount } },
    select: { xpTotal: true, discordId: true },
  });

  const beforeLevel = levelForXp(before.xpTotal);
  const afterLevel = levelForXp(updated.xpTotal);
  const leveledUp = afterLevel > beforeLevel;
  if (leveledUp) {
    // Refonte home ("Activité récente") : même détection que la notif
    // Discord ci-dessous, persistée cette fois pour pouvoir l'afficher.
    // Jamais écrit par le backfill (prisma/backfill-xp.mjs), qui ne passe
    // pas par `awardXp` — voir le commentaire sur `LevelUpEvent` dans le
    // schéma.
    await prisma.levelUpEvent.create({ data: { userId, level: afterLevel } });
    await announceLevelUp({ discordId: updated.discordId }, beforeLevel, afterLevel);
  }

  return { leveledUp };
}

const STREAK_MIN_GAP_MS = 12 * 60 * 60 * 1000;
const STREAK_BREAK_MS = 24 * 60 * 60 * 1000;

/**
 * Met à jour le streak de connexion d'un user si nécessaire — appelé
 * depuis `getCurrentUser()` (donc à chaque page protégée). Fenêtre
 * glissante de 24h (pas de notion de "jour calendaire") : se casse après
 * 24h sans passage, comme demandé. Un minimum de 12h entre deux
 * incréments évite qu'une simple série de clics dans la même journée ne
 * fasse gonfler le streak — sans ce throttle, `streakCount` grimperait à
 * chaque `getCurrentUser()` au lieu d'une fois par vraie "journée
 * d'activité". Écrit en base seulement quand un changement réel a lieu
 * (pas à chaque requête).
 */
export async function touchStreak(user: {
  id: string;
  streakCount: number;
  streakLastActiveAt: Date | null;
}): Promise<{ streakCount: number; streakLastActiveAt: Date }> {
  const now = new Date();

  if (
    user.streakLastActiveAt &&
    now.getTime() - user.streakLastActiveAt.getTime() < STREAK_MIN_GAP_MS
  ) {
    return {
      streakCount: user.streakCount,
      streakLastActiveAt: user.streakLastActiveAt,
    };
  }

  const withinStreakWindow =
    user.streakLastActiveAt !== null &&
    now.getTime() - user.streakLastActiveAt.getTime() <= STREAK_BREAK_MS;

  const nextStreakCount = withinStreakWindow ? user.streakCount + 1 : 1;

  await prisma.user.update({
    where: { id: user.id },
    data: { streakCount: nextStreakCount, streakLastActiveAt: now },
  });

  return { streakCount: nextStreakCount, streakLastActiveAt: now };
}
