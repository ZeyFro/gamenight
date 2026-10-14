import type { Game, UserGameSource } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { FilterableGame } from "@/lib/game-filters";
import type { IgdbGameDetails } from "@/lib/igdb";

/**
 * `Game.igdbDetails` est un `Json?` en base — même pattern de cast que
 * `src/lib/game-details.ts`. `ownershipSource` optionnel : renseigné
 * uniquement par `/bibliotheque` (biblio perso, un seul possesseur par
 * jeu dans ce contexte), voir `FilterableGame.ownershipSource`.
 */
export function toFilterableGame(
  game: Game,
  ownershipSource?: UserGameSource
): FilterableGame {
  return {
    id: game.id,
    source: game.source,
    isCoop: game.isCoop,
    minPlayers: game.minPlayers,
    maxPlayers: game.maxPlayers,
    igdbDetails: game.igdbDetails as unknown as IgdbGameDetails | null,
    ownershipSource,
  };
}

/** Nombre de possesseurs (`UserGame.owned`) par jeu, tout le groupe confondu — filtre "possédé par N potes" (PR 31, 2/4). */
export async function getGameOwnerCounts(): Promise<Map<string, number>> {
  const rows = await prisma.userGame.groupBy({
    by: ["gameId"],
    where: { owned: true },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.gameId, r._count._all]));
}

/** Borne haute du slider "possédé par N potes" — nombre total de membres du groupe. */
export async function getTotalUserCount(): Promise<number> {
  return prisma.user.count();
}
