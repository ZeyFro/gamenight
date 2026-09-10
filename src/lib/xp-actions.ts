import { Prisma } from "@prisma/client";
import type { XpReason } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { announceLevelUp } from "@/lib/discord-level-up";
import { computeAwardedAmount, didLevelUp, levelForXp, rankForLevel, titleForLevel } from "@/lib/xp";
import { createNotification } from "@/lib/notifications";
import { logger } from "@/lib/logger";

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
 * Fix bug remonté (XP non-transactionnelle) — la création du `XpEvent` et
 * l'incrément de `User.xpTotal` (+ `LevelUpEvent` s'il y a lieu) vivent
 * maintenant dans une seule `prisma.$transaction` : soit les deux/trois
 * écritures réussissent ensemble, soit aucune ne persiste. Une violation
 * de la contrainte unique à l'intérieur fait échouer (rollback) toute la
 * transaction — l'erreur remonte hors de `$transaction` sans être
 * interceptée à l'intérieur, pour ne jamais dépendre de la sémantique
 * implicite "COMMIT sur une transaction déjà avortée côté Postgres" ; elle
 * est catchée ICI, après coup, et convertie en retour silencieux comme
 * avant. Avant ce fix, un crash entre les deux écritures laissait
 * l'événement en base sans l'XP correspondante, et un réessai était
 * bloqué pour toujours par cette même contrainte unique — XP perdue sans
 * recours.
 *
 * Pas de paramètre de transaction injectable dans cette PR : aucun
 * appelant actuel n'a de transaction à rejoindre, et un `tx` fourni par un
 * appelant dont la transaction englobante échouerait sur cette même
 * contrainte unique donnerait un résultat trompeur (impossible de garantir
 * un retour silencieux propre sans risquer de laisser croire que la
 * transaction de l'appelant reste utilisable après coup). `awardXp` ouvre
 * systématiquement sa propre transaction — à revoir seulement le jour où
 * un appelant en aura réellement besoin.
 *
 * Détection de passage de niveau : `beforeXpTotal` est dérivé du résultat
 * de l'incrément ATOMIQUE lui-même (`updated.xpTotal - amount`), jamais
 * d'une lecture séparée faite avant l'écriture — protège correctement
 * deux gains d'XP simultanés pour le même user (sur des `reason`/
 * `sourceId` différents), qui restent chacun détectés correctement sans
 * fenêtre de course.
 *
 * Effets post-commit (webhook Discord, notification in-app) : best-effort,
 * chacun dans son propre `try/catch` — un échec de l'un n'empêche pas
 * l'autre, et aucun des deux ne doit jamais faire croire à un échec de
 * l'attribution XP elle-même, déjà commitée par la transaction à ce stade.
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
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { streakCount: true },
  });
  if (!user) return { leveledUp: false };

  const amount = computeAwardedAmount(baseAmount, user.streakCount, applyStreak);

  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.xpEvent.create({ data: { userId, reason, sourceId, amount } });

      const updated = await tx.user.update({
        where: { id: userId },
        data: { xpTotal: { increment: amount } },
        select: { xpTotal: true, discordId: true },
      });

      const beforeXpTotal = updated.xpTotal - amount;
      const beforeLevel = levelForXp(beforeXpTotal);
      const afterLevel = levelForXp(updated.xpTotal);
      const leveledUp = didLevelUp(beforeXpTotal, updated.xpTotal);

      if (leveledUp) {
        // Refonte home ("Activité récente") — persisté dans la même
        // transaction que l'XP : jamais de passage de niveau "orphelin"
        // sans l'XP qui l'a déclenché, ni l'inverse. Jamais écrit par le
        // backfill (prisma/backfill-xp.mjs), qui ne passe pas par
        // `awardXp` — voir le commentaire sur `LevelUpEvent` dans le
        // schéma.
        await tx.levelUpEvent.create({ data: { userId, level: afterLevel } });
      }

      return { leveledUp, beforeLevel, afterLevel, discordId: updated.discordId };
    });

    if (result.leveledUp) {
      try {
        await announceLevelUp(
          { discordId: result.discordId },
          result.beforeLevel,
          result.afterLevel
        );
      } catch (error) {
        logger.error("xp-actions", error, { userId, reason, sourceId, effect: "discord" });
      }
      try {
        // Notification in-app (Sprint 2 PR-C, U3) — même événement que le
        // webhook Discord ci-dessus.
        await createNotification({
          userId,
          type: "LEVEL_UP",
          title: "🎉 Level up !",
          message: `Niveau ${result.beforeLevel} → ${result.afterLevel} · ${titleForLevel(result.afterLevel)} · ${rankForLevel(result.afterLevel).name}`,
        });
      } catch (error) {
        logger.error("xp-actions", error, { userId, reason, sourceId, effect: "notification" });
      }
    }

    return { leveledUp: result.leveledUp };
  } catch (error) {
    if (isUniqueConstraintViolation(error)) return { leveledUp: false };
    throw error;
  }
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
  bestStreakCount: number;
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

  // Amélioration profil (stats) — `streakCount` repart à 1 dès qu'un
  // streak casse, donc `bestStreakCount` doit être maintenu à part pour
  // garder l'historique du meilleur streak (jamais décrémenté).
  await prisma.user.update({
    where: { id: user.id },
    data: {
      streakCount: nextStreakCount,
      streakLastActiveAt: now,
      bestStreakCount: Math.max(user.bestStreakCount, nextStreakCount),
    },
  });

  return { streakCount: nextStreakCount, streakLastActiveAt: now };
}
