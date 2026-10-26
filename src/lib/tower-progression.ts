import { levelForXp, xpForLevel } from "@/lib/xp";

const LEVELS_PER_FLOOR = 10;

export function getTowerProgress(xpTotal: number) {
  const xp = Math.max(0, Math.floor(xpTotal));
  const level = levelForXp(xp);
  const floor = Math.floor((level - 1) / LEVELS_PER_FLOOR) + 1;
  const floorStartXp = xpForLevel((floor - 1) * LEVELS_PER_FLOOR + 1);
  const nextFloorXp = xpForLevel(floor * LEVELS_PER_FLOOR + 1);

  return {
    floor,
    level,
    progress: Math.min(1, Math.max(0, (xp - floorStartXp) / (nextFloorXp - floorStartXp))),
    xpToNextFloor: Math.max(0, nextFloorXp - xp),
  };
}
