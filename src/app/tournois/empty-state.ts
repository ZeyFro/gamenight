/** Titre de l'état vide d'un onglet de /tournois : ne prétend jamais qu'aucun tournoi n'existe quand seul cet onglet est vide. */
export const TOURNAMENT_EMPTY_TITLES = {
  "en-cours": "Aucun tournoi en cours",
  "a-venir": "Aucun tournoi à venir",
  termines: "Aucun tournoi terminé",
  annules: "Aucun tournoi annulé",
} as const;

export type TournamentTabKey = keyof typeof TOURNAMENT_EMPTY_TITLES;

export function tournamentEmptyTitle(tab: TournamentTabKey): string {
  return TOURNAMENT_EMPTY_TITLES[tab];
}
