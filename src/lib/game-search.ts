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

/** Identifiants externes connus d'une ligne `Game` (tous deux uniques en base, mais chacun peut être nul). */
export interface GameExternalIds {
  igdbId?: number | null;
  steamAppId?: number | null;
}

/**
 * Deux lignes de la biblio désignent-elles le même jeu ? Le nom seul ne
 * tranche jamais : on ne replie que si aucun identifiant externe connu ne
 * contredit l'autre ligne. Une ligne importée de Steam (`steamAppId`, `igdbId`
 * nul) et sa fiche IGDB (`igdbId`, `steamAppId` nul) sont donc bien le même
 * jeu, alors que deux fiches IGDB distinctes portant le même titre (remake,
 * réédition) restent deux jeux différents.
 */
function isSameGame(a: GameExternalIds, b: GameExternalIds): boolean {
  if (a.igdbId != null && b.igdbId != null) return a.igdbId === b.igdbId;
  if (a.steamAppId != null && b.steamAppId != null) return a.steamAppId === b.steamAppId;
  return true;
}

/**
 * Options d'un `<select>` de jeux sans doublon VISIBLE : replie les lignes qui
 * désignent le même jeu (même nom normalisé, identifiants externes
 * compatibles) sur la PREMIÈRE rencontrée. C'est son `id` que le formulaire
 * soumet, donc l'ordre d'entrée doit être stable (nom puis id) pour que la
 * création garde toujours le même jeu. Ne modifie ni les lignes ni le tableau
 * reçu : aucune fusion de jeux en base.
 */
export function uniqueGameOptions<T extends { name: string } & GameExternalIds>(games: readonly T[]): T[] {
  const kept: T[] = [];
  const byName = new Map<string, T[]>();
  for (const game of games) {
    const key = normalizeForSearch(game.name).replace(/\s+/g, " ");
    const sameName = byName.get(key) ?? [];
    if (sameName.some((existing) => isSameGame(existing, game))) continue;
    sameName.push(game);
    byName.set(key, sameName);
    kept.push(game);
  }
  return kept;
}
