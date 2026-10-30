import { levelForXp, xpForLevel } from "@/lib/xp";

export function getTowerProgress(xpTotal: number, levelsPerFloor = 10) {
  const xp = Math.max(0, Math.floor(xpTotal));
  const size = Number.isInteger(levelsPerFloor) && levelsPerFloor >= 5 && levelsPerFloor <= 20 ? levelsPerFloor : 10;
  const level = levelForXp(xp);
  const floor = Math.floor((level - 1) / size) + 1;
  const floorStartXp = xpForLevel((floor - 1) * size + 1);
  const nextFloorXp = xpForLevel(floor * size + 1);

  return {
    floor,
    level,
    progress: Math.min(1, Math.max(0, (xp - floorStartXp) / (nextFloorXp - floorStartXp))),
    xpToNextFloor: Math.max(0, nextFloorXp - xp),
  };
}
