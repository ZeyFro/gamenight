import { shuffle } from "@/lib/shuffle";

export function splitIntoTeams<T>(players: T[], teamCount: number): T[][] {
  if (!Number.isInteger(teamCount) || teamCount < 2 || teamCount > players.length) {
    throw new RangeError("teamCount doit être compris entre 2 et le nombre de joueurs.");
  }

  const teams = Array.from({ length: teamCount }, () => [] as T[]);
  shuffle(players).forEach((player, index) => teams[index % teamCount].push(player));
  return teams;
}
