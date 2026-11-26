/**
 * Poule unique des tournois d'équipes (décision du 26/11/2026), logique pure sans base.
 *
 * - Un tournoi d'équipes lancé avec EXACTEMENT 5 équipes se joue en poule unique : chaque équipe rencontre une fois chacune des
 *   autres, soit 10 matchs répartis en 5 journées de 2 matchs ; à chaque journée, une équipe est au repos (nombre impair).
 * - Les autres effectifs gardent l'arbre éliminatoire existant. La règle au-delà de 6 équipes n'est pas validée : rien ici.
 * - Classement : victoires, puis confrontation directe entre deux équipes à égalité, puis différence de score (si les scores sont
 *   saisis), puis ordre du tirage au lancement (`position`, tiré au hasard), pour qu'il n'y ait jamais deux équipes au même rang.
 * - Litige : si les deux capitaines ne s'accordent pas (ou si l'un ne déclare pas), l'arbitre ne tranche qu'après 24 h.
 */

export const ROUND_ROBIN_TEAM_COUNT = 5;
export const ARBITRATION_DELAY_MS = 24 * 60 * 60 * 1000;

/** Poule unique seulement pour exactement 5 équipes jouables au lancement. */
export function usesRoundRobin(teamCount: number): boolean {
  return teamCount === ROUND_ROBIN_TEAM_COUNT;
}

export type RoundRobinDay<T> = { round: number; matches: [T, T][]; resting: T | null };

/**
 * Calendrier par la méthode du cercle : la première équipe reste fixe, les autres tournent. Avec un nombre impair d'équipes, une
 * place « repos » complète le cercle : l'équipe qui la rencontre ne joue pas cette journée-là. Chaque paire se rencontre une fois.
 */
export function roundRobinSchedule<T>(teams: readonly T[]): RoundRobinDay<T>[] {
  if (teams.length < 2) return [];
  const slots: (T | null)[] = teams.length % 2 === 0 ? [...teams] : [...teams, null];
  const size = slots.length;
  const days: RoundRobinDay<T>[] = [];
  for (let round = 1; round < size; round++) {
    const matches: [T, T][] = [];
    let resting: T | null = null;
    for (let index = 0; index < size / 2; index++) {
      const home = slots[index];
      const away = slots[size - 1 - index];
      if (home === null) resting = away;
      else if (away === null) resting = home;
      else matches.push([home, away]);
    }
    days.push({ round, matches, resting });
    // Rotation : la première place reste fixe, la dernière remonte en deuxième position.
    slots.splice(1, 0, slots.pop() as T | null);
  }
  return days;
}

export type StandingTeam = { id: string; name: string; position: number };
export type StandingMatch = { team1Id: string | null; team2Id: string | null; winnerTeamId: string | null; score1: number | null; score2: number | null };
export type StandingRow = {
  teamId: string; name: string; rank: number; played: number; wins: number; losses: number;
  pointsFor: number; pointsAgainst: number; difference: number;
};

/** Classement de la poule à partir des matchs tranchés (les matchs non tranchés ne comptent pas). */
export function roundRobinStandings(teams: readonly StandingTeam[], matches: readonly StandingMatch[]): StandingRow[] {
  const rows = new Map(teams.map((team) => [team.id, { teamId: team.id, name: team.name, position: team.position, played: 0, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0 }]));
  const headToHead = new Map<string, string>(); // « a|b » trié → vainqueur
  for (const match of matches) {
    if (!match.winnerTeamId || !match.team1Id || !match.team2Id) continue;
    const one = rows.get(match.team1Id);
    const two = rows.get(match.team2Id);
    if (!one || !two) continue;
    const loserId = match.winnerTeamId === match.team1Id ? match.team2Id : match.team1Id;
    for (const row of [one, two]) row.played += 1;
    rows.get(match.winnerTeamId)!.wins += 1;
    rows.get(loserId)!.losses += 1;
    if (match.score1 !== null && match.score2 !== null) {
      one.pointsFor += match.score1; one.pointsAgainst += match.score2;
      two.pointsFor += match.score2; two.pointsAgainst += match.score1;
    }
    headToHead.set([match.team1Id, match.team2Id].sort().join("|"), match.winnerTeamId);
  }
  const list = [...rows.values()];
  const tiedOnWins = (wins: number) => list.filter((row) => row.wins === wins).length;
  list.sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    // Confrontation directe : seulement quand exactement deux équipes sont à égalité de victoires (sinon elle peut tourner en rond).
    if (tiedOnWins(a.wins) === 2) {
      const winner = headToHead.get([a.teamId, b.teamId].sort().join("|"));
      if (winner === a.teamId) return -1;
      if (winner === b.teamId) return 1;
    }
    const diff = (b.pointsFor - b.pointsAgainst) - (a.pointsFor - a.pointsAgainst);
    if (diff !== 0) return diff;
    return a.position - b.position;
  });
  return list.map((row, index) => ({
    teamId: row.teamId, name: row.name, rank: index + 1, played: row.played, wins: row.wins, losses: row.losses,
    pointsFor: row.pointsFor, pointsAgainst: row.pointsAgainst, difference: row.pointsFor - row.pointsAgainst,
  }));
}

/** Toutes les rencontres de la poule sont tranchées : le tournoi peut se clore sur le classement. */
export function roundRobinComplete(matches: readonly { completedAt: Date | null }[]): boolean {
  return matches.length > 0 && matches.every((match) => match.completedAt !== null);
}

/**
 * Moment à partir duquel l'arbitre peut trancher : 24 h après la dernière déclaration d'un capitaine (désaccord, ou capitaine adverse
 * qui ne confirme pas). Sans aucune déclaration, rien n'est à arbitrer (null).
 */
export function arbitrationOpensAt(reportDates: readonly Date[]): Date | null {
  if (reportDates.length === 0) return null;
  const latest = Math.max(...reportDates.map((date) => date.getTime()));
  return new Date(latest + ARBITRATION_DELAY_MS);
}

export function arbitrationOpen(reportDates: readonly Date[], now: Date): boolean {
  const opensAt = arbitrationOpensAt(reportDates);
  return opensAt !== null && opensAt.getTime() <= now.getTime();
}
