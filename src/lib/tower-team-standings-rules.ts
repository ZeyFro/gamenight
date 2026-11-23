/**
 * Classement des équipes (cahier §14.3), partie pure : ordre et places ex æquo.
 * Départage : étages remportés, puis défis d'équipe validés, puis première équipe arrivée à ce total.
 * Des équipes strictement égales sur ces trois critères partagent la même place.
 */
export type TowerTeamStandingInput = {
  teamId: string; name: string; color: string | null; emblem: string | null;
  floors: number; wins: number; reachedAt: Date;
};
export type TowerTeamStanding = TowerTeamStandingInput & { rank: number; exAequo: boolean };

function same(a: TowerTeamStandingInput, b: TowerTeamStandingInput): boolean {
  return a.floors === b.floors && a.wins === b.wins && a.reachedAt.getTime() === b.reachedAt.getTime();
}

export function rankTowerTeams(entries: readonly TowerTeamStandingInput[]): TowerTeamStanding[] {
  const sorted = [...entries].filter(entry => entry.floors > 0).sort((a, b) =>
    b.floors - a.floors || b.wins - a.wins || a.reachedAt.getTime() - b.reachedAt.getTime() || a.teamId.localeCompare(b.teamId));
  return sorted.map((entry, index) => {
    let start = index;
    while (start > 0 && same(sorted[start - 1], entry)) start -= 1;
    const tied = (index > 0 && same(sorted[index - 1], entry)) || (index + 1 < sorted.length && same(sorted[index + 1], entry));
    return { ...entry, rank: start + 1, exAequo: tied };
  });
}
