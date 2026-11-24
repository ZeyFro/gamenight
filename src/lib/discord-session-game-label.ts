/** Jeu décidé ; sinon le ou les jeux proposés au vote (« Deadlock (proposé) ») ; sinon « jeu à définir ». Module pur partagé par la liste et l'autocomplétion de /soiree. */
export function gameLabel(session: { game: string | null; proposedGames: string[] }): string {
  if (session.game) return session.game;
  if (session.proposedGames.length === 1) return `${session.proposedGames[0]} (proposé)`;
  if (session.proposedGames.length > 1) return `${session.proposedGames.join(", ")} (proposés)`;
  return "jeu à définir";
}
