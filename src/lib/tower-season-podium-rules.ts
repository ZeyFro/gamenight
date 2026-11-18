import { getTowerSchoolSeason, type TowerSchoolSeason } from "./tower-challenge-seasons";

/** Intersaisons keep the completed season; an active season exposes its predecessor. */
export function getLastCompletedTowerSeason(current = new Date()): TowerSchoolSeason {
  const season = getTowerSchoolSeason(current);
  const completed = season.endAt.getTime() <= current.getTime()
    ? season
    : getTowerSchoolSeason(new Date(season.startAt.getTime() - 1));
  return { ...completed, active: false };
}

/** Nombre maximal de saisons proposées à la consultation (trois ans de calendrier). */
export const TOWER_ENDED_SEASONS_LIMIT = 12;

/**
 * Saisons FINIES à `current`, de la plus récente à la plus ancienne, en remontant jusqu'à celle qui
 * contient (ou suit) le premier crédit `earliest`. Sans aucun crédit : la dernière saison finie seule.
 * Calendrier de `tower-challenge-seasons.ts` (fin exclusive, été actif) ; aucune règle ajoutée.
 */
export function listEndedTowerSeasons(current: Date, earliest: Date | null, limit = TOWER_ENDED_SEASONS_LIMIT): TowerSchoolSeason[] {
  if (earliest !== null && !Number.isFinite(earliest.getTime())) throw new RangeError("Date de premier crédit invalide");
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError("Nombre de saisons invalide");
  const seasons = [getLastCompletedTowerSeason(current)];
  while (earliest !== null && seasons.length < limit) {
    const oldest = seasons[seasons.length - 1];
    if (oldest.startAt.getTime() <= earliest.getTime()) break;
    seasons.push({ ...getTowerSchoolSeason(new Date(oldest.startAt.getTime() - 1)), active: false });
  }
  return seasons;
}
