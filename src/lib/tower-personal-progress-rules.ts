import { getTowerSchoolSeason } from "./tower-challenge-seasons";
import { isTowerSeasonCompleted } from "./tower-season-rules";

/** Un crédit d'étages réellement attribué à un joueur (défi solo ou participation d'équipe). */
export type TowerFloorCredit = { rewardedAt: Date; floors: number };

/**
 * Nombre de saisons Tower TERMINÉES par un joueur (décision Q2 du propriétaire, 9 novembre 2026) :
 * la date de fin de la saison est passée ET au moins un étage lui a été crédité pendant cette saison.
 *
 * - Un crédit appartient à la saison qui contient son `rewardedAt` (Q7, crédit tardif), fin EXCLUSIVE.
 * - Un crédit daté d'une intersaison (1er–3 janvier, 29–31 mars) n'appartient à aucune saison.
 * - L'été est une saison comme les autres (le calendrier de `tower-challenge-seasons.ts` fait foi).
 */
export function countCompletedTowerSeasons(credits: readonly TowerFloorCredit[], now: Date): number {
  const seasons = new Map<number, { endsAt: Date; floors: number }>();
  for (const credit of credits) {
    if (!Number.isSafeInteger(credit.floors) || credit.floors < 0) throw new RangeError("Étages crédités invalides");
    const season = getTowerSchoolSeason(credit.rewardedAt);
    const time = credit.rewardedAt.getTime();
    if (time < season.startAt.getTime() || time >= season.endAt.getTime()) continue;
    const key = season.startAt.getTime();
    const total = seasons.get(key) ?? { endsAt: season.endAt, floors: 0 };
    total.floors += credit.floors;
    seasons.set(key, total);
  }
  let completed = 0;
  for (const season of seasons.values()) {
    if (isTowerSeasonCompleted({ endsAt: season.endsAt, now, creditedFloors: season.floors })) completed += 1;
  }
  return completed;
}
