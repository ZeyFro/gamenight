/**
 * Chantier sélecteur de jeu (création de tournoi) — logique de recherche
 * PURE (aucun accès DB/IGDB ici), extraite pour être testable sans mock :
 * filtrage local insensible à la casse/aux accents, et dédoublonnage des
 * résultats IGDB déjà présents dans la bibliothèque commune (par
 * `igdbId`, seul identifiant fiable — deux jeux peuvent avoir un nom
 * proche sans être le même titre).
 */

export interface LocalGameOption {
  id: string;
  name: string;
  igdbId: number | null;
}

/** Aplatit casse + diacritiques ("Pokémon" / "pokemon" doivent matcher). */
export function normalizeForSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** Jeux déjà dans l'appli dont le nom contient la recherche (substring, insensible casse/accents). Requête vide : tous les jeux. */
export function filterLocalGames<T extends { name: string }>(games: T[], query: string): T[] {
  const q = normalizeForSearch(query);
  if (!q) return games;
  return games.filter((g) => normalizeForSearch(g.name).includes(q));
}

/**
 * Retire des résultats IGDB tout candidat dont l'`igdbId` correspond déjà
 * à un jeu de la biblio commune — évite d'afficher le même jeu sous "Dans
 * l'application" ET "Résultats IGDB" (sélectionner l'une ou l'autre entrée
 * doit de toute façon résoudre vers la même ligne `Game`, cf.
 * `resolveIgdbGameAction`, mais les lister deux fois prêterait à
 * confusion).
 */
export function excludeLocalIgdbIds<T extends { igdbId: number }>(
  candidates: T[],
  localIgdbIds: ReadonlySet<number>
): T[] {
  return candidates.filter((c) => !localIgdbIds.has(c.igdbId));
}
