import { getTowerSchoolSeason, type TowerSchoolSeason } from "@/lib/tower-challenge-seasons";

/**
 * Titres et cadres cosmétiques saisonniers (cahier 15, décisions du 17/11/2026 : récompenses uniquement
 * cosmétiques, durée = saison suivante). Règles pures. OFF par défaut : actif seulement si la valeur vaut
 * exactement `true`.
 */
export function isTowerSeasonAwardsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.TOWER_SEASON_AWARDS_ENABLED === "true";
}

/** Places récompensées : le podium (les ex æquo d'une place la partagent, aucun n'est écarté). */
export const TOWER_AWARD_PLACES = 3;
const DAY_MS = 86400000;

/**
 * Saison qui suit `season` : première saison dont le début n'est pas antérieur à la fin (exclusive) de `season`,
 * en sautant l'intersaison (1er-3 janvier, 29-31 mars).
 */
export function nextTowerSeason(season: TowerSchoolSeason): TowerSchoolSeason {
  for (let days = 0; days <= 7; days++) {
    const candidate = getTowerSchoolSeason(new Date(season.endAt.getTime() + days * DAY_MS));
    if (candidate.startAt.getTime() >= season.endAt.getTime()) return candidate;
  }
  throw new RangeError("Saison suivante introuvable");
}

/** Fin de validité : fin (exclusive) de la saison suivante. */
export function towerAwardExpiry(season: TowerSchoolSeason): Date {
  return nextTowerSeason(season).endAt;
}

export type TowerAwardPresentation = { title: string; frameColorName: string; frameHex: string };

/** Valeurs hexadécimales provisoires (comme les couleurs de grades) jusqu'à validation du propriétaire. */
const PRESENTATION = {
  1: { prefix: "Champion", frameColorName: "or", frameHex: "#f59e0b" },
  2: { prefix: "Vice-champion", frameColorName: "argent", frameHex: "#9ca3af" },
  3: { prefix: "Podium", frameColorName: "bronze", frameHex: "#b45309" },
} as const;

export function towerAwardPresentation(place: number, seasonName: string): TowerAwardPresentation {
  if (place !== 1 && place !== 2 && place !== 3) throw new RangeError("Place hors podium");
  const entry = PRESENTATION[place];
  return { title: `${entry.prefix} · ${seasonName}`, frameColorName: entry.frameColorName, frameHex: entry.frameHex };
}

export type TowerAwardDraft = { userId: string; place: number };

/** Récompenses à créer à partir des groupes de co-lauréats du palmarès (places 1 à 3). */
export function buildTowerSeasonAwards(groups: readonly { startRank: number; members: readonly { userId: string }[] }[]): TowerAwardDraft[] {
  return groups
    .filter(group => group.startRank >= 1 && group.startRank <= TOWER_AWARD_PLACES)
    .flatMap(group => group.members.map(member => ({ userId: member.userId, place: group.startRank })));
}

/**
 * Q7 : une contestation ouverte susceptible de modifier le podium retarde l'attribution. Jugement prudent :
 * toute contestation ouverte sur une tentative attribuée pendant la saison retarde la communauté.
 */
export function shouldDelayTowerAwards(input: { openAppealsInSeason: number }): boolean {
  return input.openAppealsInSeason > 0;
}

export type ActiveAward = { place: number; seasonName: string; expiresAt: Date };

/** Distinctions encore valables à `current` (fin exclusive), la plus haute place d'abord puis la plus récente. */
export function activeTowerAwards<T extends ActiveAward & { seasonStartAt?: Date }>(awards: readonly T[], current: Date): T[] {
  return awards
    .filter(award => award.expiresAt.getTime() > current.getTime())
    .sort((a, b) => a.place - b.place || (b.seasonStartAt?.getTime() ?? 0) - (a.seasonStartAt?.getTime() ?? 0));
}
