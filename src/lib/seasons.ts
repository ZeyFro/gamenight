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

/** Pure — numéro de la prochaine saison à créer, extrait pour rester testable sans Prisma. `null` = aucune saison n'a jamais existé (tout premier bootstrap). */
export function nextSeasonNumber(currentMaxNumber: number | null): number {
  return (currentMaxNumber ?? 0) + 1;
}

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
 * `Season.number` dès qu'une vraie saison 1 existait déjà dans
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
 * dès qu'une existe, et la contrainte unique sur `Season.number` empêche
 * une double création en cas d'appels concurrents (retombe
 * silencieusement, même filet de sécurité que `unlockBadge`) — désormais
 * sur le bon numéro dans tous les cas, donc un appel concurrent retombe
 * proprement au lieu de rester bloqué.
 */
export async function ensureActiveSeasonExists(): Promise<void> {
  const active = await getActiveSeason();
  if (active) return;

  const lastSeason = await prisma.season.findFirst({ orderBy: { number: "desc" } });
  const number = nextSeasonNumber(lastSeason?.number ?? null);

  const now = wallClockNow();
  try {
    await prisma.season.create({
      data: {
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

/**
 * Clôture la saison active si sa `endDate` est dépassée : snapshot du
 * classement (`SeasonSnapshot`, AVANT le reset — seule façon de consulter
 * "qui était où" une fois l'XP remis à zéro), reset `xpTotal` à 0 pour
 * TOUT LE MONDE (badges/achievements/streak jamais touchés — cf. spec
 * "conservés"), puis ouverture immédiate de la saison suivante (jamais de
 * trou sans saison active) — annonce Discord du champion après coup.
 *
 * Fix bug remonté (atomicité saisons, PR "Atomicité saisons + tournois")
 * — ces 4 écritures vivent maintenant dans UNE seule transaction, ouverte
 * par un claim atomique (`updateMany` conditionné sur `isActive: true`,
 * même pattern que `claimSessionClose`, `src/lib/sessions.ts`). Avant ce
 * fix : un crash entre le reset XP et la création de la nouvelle saison
 * laissait l'app SANS AUCUNE saison active — `ensureActiveSeasonExists`
 * ne savait pas réparer ce cas précis avant son propre fix ci-dessus
 * (elle retombait toujours sur `number: 1`, en conflit avec l'historique
 * réel). Un crash APRÈS les snapshots mais AVANT l'ancienne transaction
 * partielle faisait aussi replanter le cron TOUS LES JOURS sur la
 * contrainte unique `SeasonSnapshot(seasonId, userId)` en retentant un
 * `createMany` déjà à moitié appliqué. Désormais, un crash en cours de
 * transaction annule TOUT (y compris les snapshots) : un rejeu repart
 * toujours d'un état propre, plus de boucle de replantage possible.
 *
 * Le claim lui-même (`isActive: true → false`) rend une double exécution
 * concurrente du cron inoffensive : la 2e trouve `count !== 1` et
 * s'arrête sans rien lire ni recalculer.
 *
 * Appelée depuis le cron `monthly-tasks` (quotidien) — pas de
 * vérification "déjà traité aujourd'hui" nécessaire : une fois `endDate`
 * dépassée, la saison est immédiatement remplacée par une nouvelle dont
 * `endDate` est dans le futur, donc un second appel le même jour ne
 * retrouve plus rien à clôturer (idempotent par construction, pas besoin
 * d'un flag dédié).
 */
export async function finalizeSeasonIfDue(): Promise<void> {
  const season = await getActiveSeason();
  if (!season) return; // Bootstrapée par ensureActiveSeasonExists (ci-dessus) ou seedInitialSeason (src/lib/seed-season.ts).
  if (wallClockNow() < season.endDate) return;

  const users = await prisma.user.findMany({
    select: { id: true, discordId: true, discordName: true, xpTotal: true },
    orderBy: { xpTotal: "desc" },
  });
  if (users.length === 0) return;

  const snapshotRows = users.map((u, i) => {
    const level = levelForXp(u.xpTotal);
    return {
      seasonId: season.id,
      userId: u.id,
      xp: u.xpTotal,
      level,
      rank: rankForLevel(level).name,
      position: i + 1,
    };
  });

  const champion = users[0];
  const now = wallClockNow();
  const nextNumber = season.number + 1;

  let claimed = false;
  await prisma.$transaction(async (tx) => {
    const claim = await tx.season.updateMany({
      where: { id: season.id, isActive: true },
      data: { isActive: false },
    });
    if (claim.count !== 1) return; // déjà clôturée par une exécution concurrente

    claimed = true;

    await tx.seasonSnapshot.createMany({ data: snapshotRows });
    await tx.user.updateMany({ data: { xpTotal: 0 } });
    await tx.season.create({
      data: {
        number: nextNumber,
        name: `Saison ${nextNumber}`,
        startDate: now,
        endDate: endOfMonthUTC(now),
        isActive: true,
      },
    });
  });

  if (!claimed) return;

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
