import { prisma } from "@/lib/prisma";
import { fetchIgdbGameDetails, type IgdbGameDetails } from "@/lib/igdb";
import type { Game } from "@prisma/client";

export interface GameDetailsResult {
  details: IgdbGameDetails | null;
  fetchedAt: Date | null;
  /** `not_found` : pas d'igdbId, ou IGDB ne connaît pas ce jeu. `fetch_failed` : erreur réseau/API (et pas de cache existant à retomber dessus). */
  error: "not_found" | "fetch_failed" | null;
}

/**
 * Fiche IGDB détaillée d'un jeu (F : fiche jeu), avec cache en base
 * (`Game.igdbDetails`) — l'appel réel à IGDB ne se fait qu'à la demande
 * (premier affichage de `/jeux/[id]`, ou refresh forcé), jamais à l'import
 * Steam. Un échec réseau/API ne casse jamais la fiche : si un cache
 * existant (même périmé) est disponible on le renvoie, sinon `error`
 * indique au composant d'afficher un message propre plutôt que de planter.
 */
export async function getGameDetails(
  game: Pick<Game, "id" | "igdbId" | "igdbDetails" | "igdbDetailsFetchedAt">,
  { forceRefresh = false }: { forceRefresh?: boolean } = {}
): Promise<GameDetailsResult> {
  if (!game.igdbId) {
    return { details: null, fetchedAt: null, error: "not_found" };
  }

  if (!forceRefresh && game.igdbDetails) {
    return {
      details: game.igdbDetails as unknown as IgdbGameDetails,
      fetchedAt: game.igdbDetailsFetchedAt,
      error: null,
    };
  }

  try {
    const details = await fetchIgdbGameDetails(game.igdbId);
    if (!details) {
      return { details: null, fetchedAt: null, error: "not_found" };
    }

    const fetchedAt = new Date();
    await prisma.game.update({
      where: { id: game.id },
      data: {
        igdbDetails: details as unknown as object,
        igdbDetailsFetchedAt: fetchedAt,
      },
    });

    return { details, fetchedAt, error: null };
  } catch (err) {
    console.error("[igdb] Fiche jeu : échec de récupération", err);
    if (game.igdbDetails) {
      return {
        details: game.igdbDetails as unknown as IgdbGameDetails,
        fetchedAt: game.igdbDetailsFetchedAt,
        error: null,
      };
    }
    return { details: null, fetchedAt: null, error: "fetch_failed" };
  }
}
