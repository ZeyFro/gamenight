/**
 * Classement Tower : module PUR (sans Prisma, sans I/O, sans appelant applicatif).
 *
 * Il ne code que l'ordre déjà validé (docs/TOWER_DECISIONS_26_20261104.md) et déjà exprimé en SQL
 * dans `towerSeasonTotals` (tower-challenges.ts) et dans le podium (tower-season-podium.ts) :
 *   ORDER BY rewardFloors DESC, difficultWins DESC, reachedAt ASC, userId ASC
 *
 * Volontairement HORS PÉRIMÈTRE (aucune règle ici) : top 3, saison terminée, récompense, titre, badge,
 * et la politique des égalités parfaites (voir `findExactTies`).
 *
 * Note : `userId ASC` est comparé ici par unités de code UTF-16 (ordre déterministe indépendant de la
 * locale). Le SQL utilise l'interclassement de la base ; pour des identifiants ASCII (cuid) les deux
 * ordres coïncident.
 */

export type TowerStandingInput = {
  userId: string;
  /** Étages gagnés (rewardFloors cumulés), entier >= 0. */
  floors: bigint | number;
  /** Nombre de défis à 3 étages gagnés, entier >= 0. */
  hardWins: number;
  /** Heure d'arrivée au total courant (dernier gain). Le plus tôt départage. */
  reachedAt: Date;
};

export type TowerStanding = TowerStandingInput & {
  /** Rang 1..n dans l'ordre total (jamais d'ex æquo : le départage final est userId). */
  rank: number;
};

function toFloors(value: bigint | number): bigint {
  if (typeof value === "bigint") {
    if (value < BigInt(0)) throw new RangeError("Étage invalide");
    return value;
  }
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError("Étage invalide");
  return BigInt(value);
}

function validate(entry: TowerStandingInput): void {
  if (typeof entry.userId !== "string" || entry.userId.length === 0) throw new RangeError("Identifiant invalide");
  toFloors(entry.floors);
  if (!Number.isSafeInteger(entry.hardWins) || entry.hardWins < 0) throw new RangeError("Défis difficiles invalides");
  if (!(entry.reachedAt instanceof Date) || Number.isNaN(entry.reachedAt.getTime())) {
    throw new RangeError("Heure d'arrivée invalide");
  }
}

function cmp<T extends bigint | number | string>(a: T, b: T): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Ordre total : étages DESC, défis à 3 étages DESC, reachedAt ASC, userId ASC. Valide ses deux entrées. */
export function compareTowerStandings(a: TowerStandingInput, b: TowerStandingInput): number {
  validate(a);
  validate(b);
  return (
    cmp(toFloors(b.floors), toFloors(a.floors)) ||
    cmp(b.hardWins, a.hardWins) ||
    cmp(a.reachedAt.getTime(), b.reachedAt.getTime()) ||
    cmp(a.userId, b.userId)
  );
}

/** Renvoie un NOUVEAU tableau trié avec le rang 1..n ; l'entrée n'est ni triée ni modifiée. */
export function rankTowerStandings(entries: readonly TowerStandingInput[]): TowerStanding[] {
  entries.forEach(validate);
  return [...entries]
    .sort(compareTowerStandings)
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}

/**
 * Groupes (taille >= 2) d'entrées STRICTEMENT égales sur (floors, hardWins, reachedAt), c'est-à-dire
 * départagées uniquement par userId. Chaque groupe est trié par userId ASC ; les groupes suivent l'ordre
 * du classement.
 *
 * DÉCISION Q7 NON PRISE (propriétaire) : faut-il traiter ces égalités comme des co-lauréats ou garder le
 * départage par userId ? Cette fonction ne tranche PAS : elle ne fait que les signaler. Ne pas en déduire
 * de politique ici.
 */
export function findExactTies(entries: readonly TowerStandingInput[]): TowerStandingInput[][] {
  entries.forEach(validate);
  const groups = new Map<string, TowerStandingInput[]>();
  for (const entry of [...entries].sort(compareTowerStandings)) {
    const key = `${toFloors(entry.floors)}|${entry.hardWins}|${entry.reachedAt.getTime()}`;
    const group = groups.get(key);
    if (group) group.push(entry);
    else groups.set(key, [entry]);
  }
  return [...groups.values()].filter(group => group.length > 1);
}

export type TowerCoWinnerGroup = {
  /** Rang 1-based, dans l'ordre total, du premier membre du groupe. */
  startRank: number;
  /** Membres strictement égaux sur (floors, hardWins, reachedAt), dans l'ordre total (userId ASC). */
  members: TowerStanding[];
};

function sameStanding(a: TowerStandingInput, b: TowerStandingInput): boolean {
  return (
    toFloors(a.floors) === toFloors(b.floors) &&
    a.hardWins === b.hardWins &&
    a.reachedAt.getTime() === b.reachedAt.getTime()
  );
}

/**
 * Groupes CONSÉCUTIFS, dans l'ordre du classement, d'entrées strictement égales sur
 * (floors, hardWins, reachedAt). Tous les groupes sont renvoyés, y compris ceux d'un seul membre ;
 * `startRank` est le rang de l'ordre total (userId inclus), donc deux groupes successifs de tailles
 * 2 et 1 ont pour startRank 1 et 3 : ce n'est ni un rang « dense » ni un rang « ex æquo ».
 * Un groupe de plus d'un membre est un candidat co-lauréat (Q7 : « peuvent être enregistrés »,
 * le Hall of Fame n'est pas codé ici).
 */
export function groupCoWinners(entries: readonly TowerStandingInput[]): TowerCoWinnerGroup[] {
  const groups: TowerCoWinnerGroup[] = [];
  for (const entry of rankTowerStandings(entries)) {
    const last = groups[groups.length - 1];
    if (last && sameStanding(last.members[0], entry)) last.members.push(entry);
    else groups.push({ startRank: entry.rank, members: [entry] });
  }
  return groups;
}

export type TowerTopThree = {
  /** Les 3 premières entrées de l'ordre total (moins si moins de 3 entrées). */
  top: TowerStanding[];
  /** Groupes de 2 membres ou plus dont le premier rang est <= 3 ; leurs membres peuvent dépasser le rang 3. */
  coWinnerGroups: TowerCoWinnerGroup[];
  /**
   * Vrai si la 3e et la 4e entrée sont strictement égales sur (floors, hardWins, reachedAt).
   * Cas NON TRANCHÉ : l'ordre total (userId) désignerait arbitrairement l'une des deux. À résoudre par
   * validation admin ; aucune convention (rang dense, co-lauréat étendu au 4e) n'est choisie ici.
   */
  boundaryTie: boolean;
};

/** Les 3 premiers de l'ordre total + groupes de co-lauréats candidats + drapeau d'égalité à la frontière. */
export function selectTopThree(entries: readonly TowerStandingInput[]): TowerTopThree {
  const ranked = rankTowerStandings(entries);
  return {
    top: ranked.slice(0, 3),
    coWinnerGroups: groupCoWinners(entries).filter(group => group.startRank <= 3 && group.members.length > 1),
    boundaryTie: ranked.length >= 4 && sameStanding(ranked[2], ranked[3]),
  };
}
