import { getTowerSchoolSeason, type TowerSchoolSeason } from "./tower-challenge-seasons";

/** Intersaisons keep the completed season; an active season exposes its predecessor. */
export function getLastCompletedTowerSeason(current = new Date()): TowerSchoolSeason {
  const season = getTowerSchoolSeason(current);
  const completed = season.endAt.getTime() <= current.getTime()
    ? season
    : getTowerSchoolSeason(new Date(season.startAt.getTime() - 1));
  return { ...completed, active: false };
}
