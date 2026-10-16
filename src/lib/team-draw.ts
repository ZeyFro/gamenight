import { shuffle } from "@/lib/shuffle";

export function splitIntoTeams<T>(players: T[], teamCount: number): T[][] {
  if (!Number.isInteger(teamCount) || teamCount < 2 || teamCount > players.length) {
    throw new RangeError("teamCount doit être compris entre 2 et le nombre de joueurs.");
  }

  const teams = Array.from({ length: teamCount }, () => [] as T[]);
  const shuffled = shuffle(players);
  const styled = shuffled as (T & { styleProfile?: number[] })[];
  if (styled.some((player) => player.styleProfile)) {
    let bestScore = Number.POSITIVE_INFINITY;
    for (let attempt = 0; attempt < 128; attempt++) {
      const candidate = Array.from({ length: teamCount }, () => [] as (T & { styleProfile?: number[] })[]);
      shuffle(styled).forEach((player, index) => candidate[index % teamCount].push(player));
      const axes = [0, 1, 2, 3].map((axis) => candidate.map((team) => team.reduce((sum, player) => sum + (player.styleProfile?.[axis] ?? 0), 0)));
      const score = axes.reduce((total, sums) => {
        const mean = sums.reduce((sum, value) => sum + value, 0) / teamCount;
        return total + sums.reduce((variance, value) => variance + (value - mean) ** 2, 0);
      }, 0);
      if (score < bestScore) {
        bestScore = score;
        candidate.forEach((team, index) => { teams[index] = team; });
      }
    }
  } else {
    shuffled.forEach((player, index) => teams[index % teamCount].push(player));
  }
  return teams;
}
