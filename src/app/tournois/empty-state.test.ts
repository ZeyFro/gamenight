import { describe, expect, it } from "vitest";
import { TOURNAMENT_EMPTY_TITLES, tournamentEmptyTitle, type TournamentTabKey } from "./empty-state";

// Bug démontré en recette navigateur : l'onglet « En cours » vide annonçait « Lance le premier tournoi entre
// potes » alors que des tournois existaient dans « À venir ».
describe("titres d'état vide de /tournois", () => {
  const tabs: TournamentTabKey[] = ["en-cours", "a-venir", "termines", "annules"];

  it("chaque onglet a son propre titre, en français, qui ne prétend pas qu'aucun tournoi n'existe", () => {
    const titles = tabs.map(tournamentEmptyTitle);
    expect(new Set(titles).size).toBe(tabs.length);
    for (const title of titles) {
      expect(title).toMatch(/^Aucun tournoi (en cours|à venir|terminé|annulé)$/);
      expect(title).not.toMatch(/premier/i);
    }
  });

  it("couvre exactement les onglets de la page", () => {
    expect(Object.keys(TOURNAMENT_EMPTY_TITLES).sort()).toEqual([...tabs].sort());
  });
});
