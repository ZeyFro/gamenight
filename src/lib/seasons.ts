import { prisma } from "@/lib/prisma";
import { wallClockNow, endOfMonthUTC } from "@/lib/wallclock";
import { levelForXp, rankForLevel } from "@/lib/xp";
import { postToDiscord, ACCENT_COLOR } from "@/lib/discord";
import { isUniqueConstraintViolation } from "@/lib/xp-actions";
import { logger } from "@/lib/logger";

/**
 * Sprint 4 (FEATURE 3, Saisons mensuelles) — reset mensuel du classement
 * XP. Une seule saison `isActive` à la fois (invariant applicatif). Voir
 * le commentaire sur `Season` (prisma/schema.prisma) pour le contexte
 * complet.
 */
export async function getActiveSeason() {
  return prisma.season.findFirst({ where: { isActive: true } });
}

/**
 * Fix bug remonté (Saison 1 jamais créée au déploiement) — `prisma/
 * seed-season.mjs` ne tourne qu'au `npm run build`, ce qui suppose que le
 * script s'exécute correctement à CHAQUE déploiement de la base
 * concernée ; en pratique le premier déploiement de ce chantier ne l'a
 * pas fait (migration appliquée après coup, script jamais rejoué). Plutôt
 * que de dépendre uniquement d'un script de build, cette fonction est
 * appelée à la volée (Home, cron `close-sessions`) : garde-fou
 * idempotent qui ne coûte qu'un `findFirst` tant qu'une saison active
 * existe déjà (99.9% des appels), et qui répare l'état sinon — y compris
 * après un bug ou une purge accidentelle de la table `Season`.
 *
 * Idempotent par construction : `getActiveSeason()` retrouve la saison
 * dès qu'une existe, et la contrainte unique sur `Season.number` empêche
 * une double création en cas d'appels concurrents (retombe
 * silencieusement, même filet de sécurité que `unlockBadge`).
 */
export async function ensureFirstSeasonExists(): Promise<void> {
  const active = await getActiveSeason();
  if (active) return;

  const now = wallClockNow();
  try {
    await prisma.season.create({
      data: {
        number: 1,
        name: "Saison 1",
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

/**
 * Clôture la saison active si sa `endDate` est dépassée : snapshot du
 * classement (`SeasonSnapshot`, AVANT le reset — seule façon de consulter
 * "qui était où" une fois l'XP remis à zéro), annonce Discord du champion,
 * reset `xpTotal` à 0 pour TOUT LE MONDE (badges/achievements/streak
 * jamais touchés — cf. spec "conservés"), puis ouverture immédiate de la
 * saison suivante (jamais de trou sans saison active).
 *
 * Appelée depuis le cron `monthly-tasks` (quotidien) — pas de vérification
 * "déjà traité aujourd'hui" nécessaire : une fois `endDate` dépassée, la
 * saison est immédiatement remplacée par une nouvelle dont `endDate` est
 * dans le futur, donc un second appel le même jour ne retrouve plus rien
 * à clôturer (idempotent par construction, pas besoin d'un flag dédié).
 */
export async function finalizeSeasonIfDue(): Promise<void> {
  const season = await getActiveSeason();
  if (!season) return; // Bootstrapée par prisma/seed-season.mjs au déploiement.
  if (wallClockNow() < season.endDate) return;

  const users = await prisma.user.findMany({
    select: { id: true, discordId: true, discordName: true, xpTotal: true },
    orderBy: { xpTotal: "desc" },
  });
  if (users.length === 0) return;

  await prisma.seasonSnapshot.createMany({
    data: users.map((u, i) => {
      const level = levelForXp(u.xpTotal);
      return {
        seasonId: season.id,
        userId: u.id,
        xp: u.xpTotal,
        level,
        rank: rankForLevel(level).name,
        position: i + 1,
      };
    }),
  });

  const champion = users[0];

  await prisma.$transaction([
    prisma.season.update({ where: { id: season.id }, data: { isActive: false } }),
    prisma.user.updateMany({ data: { xpTotal: 0 } }),
  ]);

  const now = wallClockNow();
  await prisma.season.create({
    data: {
      number: season.number + 1,
      name: `Saison ${season.number + 1}`,
      startDate: now,
      endDate: endOfMonthUTC(now),
      isActive: true,
    },
  });

  const result = await postToDiscord({
    title: `🏆 ${season.name} terminée !`,
    description: `Champion : <@${champion.discordId}> avec ${champion.xpTotal} XP !\nL'XP de tout le monde repart à 0 — nouvelle saison lancée.`,
    color: ACCENT_COLOR,
  });
  if (!result.ok) {
    logger.warn("seasons", "Notif Discord fin de saison non envoyée.", { seasonId: season.id });
  }
}

/** Home — "Saison X — Jour Y/30" avec barre de progression. `null` si aucune saison active (ne devrait pas arriver post-bootstrap). */
export async function getSeasonProgress(): Promise<{
  number: number;
  name: string;
  dayOfMonth: number;
  totalDays: number;
} | null> {
  const season = await getActiveSeason();
  if (!season) return null;

  const now = wallClockNow();
  const dayOfMonth = now.getUTCDate();
  const totalDays = endOfMonthUTC(now).getUTCDate();

  return { number: season.number, name: season.name, dayOfMonth, totalDays };
}
