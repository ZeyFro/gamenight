/**
 * Règles de saison Tower décidées par le propriétaire : module PUR (sans Prisma, sans I/O, sans appelant).
 * Les dates et compteurs sont fournis par l'appelant.
 *
 * Alignement sur le code existant (ne pas modifier ces fichiers) : les bornes de fin de saison sont
 * EXCLUSIVES (src/lib/tower-challenge-seasons.ts:19 ; `rewardedAt >= startAt AND rewardedAt < endAt`
 * dans src/lib/tower-season-podium.ts:32). L'été est une saison active (tower-challenge-seasons.ts:33).
 */

function assertDate(value: Date, label: string): void {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new RangeError(`${label} invalide`);
}

function assertCount(value: bigint | number, label: string): void {
  if (typeof value === "bigint") {
    if (value < BigInt(0)) throw new RangeError(`${label} invalide`);
    return;
  }
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${label} invalide`);
}

/**
 * Q2 : saison terminée = date de fin passée ET au moins un étage crédité pendant la saison.
 * Fin exclusive : à `now === endsAt` la saison est terminée (l'instant endsAt n'appartient plus à la saison).
 */
export function isTowerSeasonCompleted(input: { endsAt: Date; now: Date; creditedFloors: bigint | number }): boolean {
  assertDate(input.endsAt, "Fin de saison");
  assertDate(input.now, "Date courante");
  assertCount(input.creditedFloors, "Étages crédités");
  return input.now.getTime() >= input.endsAt.getTime() && input.creditedFloors > 0;
}

export type TowerSeasonWindow = { startsAt: Date; endsAt: Date };

/**
 * Q7 : un crédit tardif appartient à la saison dont l'intervalle [startsAt, endsAt) contient `rewardedAt`
 * (jamais à la saison dans laquelle il est constaté). Renvoie null si aucune saison ne le contient.
 * Des saisons qui se chevauchent rendraient le rattachement ambigu : RangeError.
 */
export function towerSeasonContaining<T extends TowerSeasonWindow>(rewardedAt: Date, seasons: readonly T[]): T | null {
  assertDate(rewardedAt, "Date de crédit");
  for (const season of seasons) {
    assertDate(season.startsAt, "Début de saison");
    assertDate(season.endsAt, "Fin de saison");
    if (season.startsAt.getTime() >= season.endsAt.getTime()) throw new RangeError("Intervalle de saison invalide");
  }
  const sorted = [...seasons].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].startsAt.getTime() < sorted[i - 1].endsAt.getTime()) throw new RangeError("Saisons qui se chevauchent");
  }
  const time = rewardedAt.getTime();
  return sorted.find(season => time >= season.startsAt.getTime() && time < season.endsAt.getTime()) ?? null;
}

/**
 * Q7 : si une contestation susceptible de modifier le podium est ouverte au gel, la publication du
 * palmarès est retardée jusqu'à sa résolution. Le jugement « susceptible de modifier le podium » est fourni
 * par l'appelant ; il n'est pas défini ici.
 */
export function shouldDelayPalmaresPublication(input: { openContestationMayChangePodium: boolean }): boolean {
  if (typeof input.openContestationMayChangePodium !== "boolean") throw new RangeError("Contestation invalide");
  return input.openContestationMayChangePodium;
}

export const TOWER_SEASON_VOTE_MIN_VOTERS = 2;

/**
 * Q9 : quorum minimal de 2 votants éligibles DISTINCTS ; sinon aucune distinction de vote.
 * Accepte un nombre déjà dédoublonné ou un tableau d'identifiants (dédoublonné ici). Ce résultat
 * n'alimente pas le Hall of Fame (rien à coder à ce niveau).
 */
export function evaluateSeasonVoteQuorum(input: { distinctEligibleVoters: number | readonly string[] }): {
  quorumReached: boolean;
  distinctionAllowed: boolean;
} {
  const voters = input.distinctEligibleVoters;
  let count: number;
  if (typeof voters === "number") {
    assertCount(voters, "Votants");
    count = voters;
  } else {
    if (!Array.isArray(voters) || voters.some(id => typeof id !== "string" || id.length === 0)) {
      throw new RangeError("Votants invalides");
    }
    count = new Set(voters).size;
  }
  const quorumReached = count >= TOWER_SEASON_VOTE_MIN_VOTERS;
  return { quorumReached, distinctionAllowed: quorumReached };
}

/**
 * Q5 : titre de champion actif de la publication du palmarès de la saison gagnée (incluse) jusqu'à la
 * publication du palmarès de la saison SUIVANTE (exclue). Pas de publication suivante : actif. Palmarès
 * gagné jamais publié (null/undefined) ou pas encore atteint : inactif. Le badge permanent n'est pas codé.
 */
export function isChampionTitleActive(input: {
  earnedSeasonPalmaresPublishedAt: Date | null | undefined;
  nextSeasonPalmaresPublishedAt?: Date | null;
  now: Date;
}): boolean {
  const { earnedSeasonPalmaresPublishedAt: earned, nextSeasonPalmaresPublishedAt: next, now } = input;
  assertDate(now, "Date courante");
  if (earned != null) assertDate(earned, "Publication du palmarès");
  if (next != null) assertDate(next, "Publication du palmarès suivant");
  if (earned == null) {
    if (next != null) throw new RangeError("Palmarès suivant publié sans palmarès gagné");
    return false;
  }
  if (next != null && next.getTime() < earned.getTime()) throw new RangeError("Palmarès suivant antérieur");
  if (now.getTime() < earned.getTime()) return false;
  return next == null || now.getTime() < next.getTime();
}
