import type { Tier } from "@prisma/client";
import { equivalentGameIds, uniqueGameOptions, type GameExternalIds } from "@/lib/game-search";

/** Ordre d'affichage S en haut, D en bas — cohérent avec une tierlist classique. */
export const TIER_ORDER: Tier[] = ["S", "A", "B", "C", "D"];

/**
 * Réduit une bibliothèque à une carte par jeu visible et reporte le rang
 * existant de n'importe quelle ligne équivalente (Steam / IGDB) sur la carte
 * conservée. Sans ce report, un jeu classé sur la ligne que le sélecteur
 * masque réapparaîtrait « non classé ».
 */
export function dedupeTierlistGames<
  T extends { id: string; name: string } & GameExternalIds,
>(
  games: readonly T[],
  entries: readonly { gameId: string; tier: Tier }[]
): { games: T[]; initialTiers: Partial<Record<string, Tier>> } {
  const tierByGameId = new Map(entries.map((entry) => [entry.gameId, entry.tier]));
  const kept = uniqueGameOptions(games);
  const initialTiers: Partial<Record<string, Tier>> = {};

  for (const game of kept) {
    // Le rang de la ligne conservée gagne s'il existe ; sinon on reprend
    // celui d'une ligne équivalente (même jeu importé deux fois).
    for (const id of equivalentGameIds(games, game.id)) {
      const tier = tierByGameId.get(id);
      if (tier) {
        initialTiers[game.id] = tier;
        break;
      }
    }
  }

  return { games: kept, initialTiers };
}

/**
 * Une seule teinte (l'accent violet de l'app) déclinée en intensité
 * décroissante de S à D, plutôt qu'un jeu de 5 couleurs arbitraires — le
 * rouge/destructive est volontairement réservé aux actions destructives
 * ailleurs dans l'app (voir le commentaire sur `--accent` dans
 * globals.css), donc pas de rouge/vert ici.
 */
export const TIER_INTENSITY_CLASSES: Record<Tier, string> = {
  S: "bg-accent text-accent-foreground",
  A: "bg-accent/70 text-accent-foreground",
  B: "bg-accent/45 text-foreground",
  C: "bg-accent/25 text-foreground",
  D: "bg-accent/10 text-foreground",
};
