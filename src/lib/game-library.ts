import type { Game, UserGameSource } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { memberUserWhere, resolveActiveCommunityScope } from "@/lib/community-isolation";
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

/** Même communauté active pour les jeux, leurs possesseurs et les compteurs. */
async function libraryMemberWhere(viewerId: string) {
  return memberUserWhere(await resolveActiveCommunityScope(viewerId));
}

export async function getGroupLibraryGames(viewerId: string) {
  const user = await libraryMemberWhere(viewerId);
  return prisma.game.findMany({
    where: { userGames: { some: { owned: true, user } } },
    include: {
      userGames: {
        where: { owned: true, user },
        include: { user: { select: { id: true, discordName: true, discordAvatar: true } } },
      },
    },
    orderBy: { name: "asc" },
  });
}

/** Nombre de possesseurs actifs par jeu dans la communauté affichée. */
export async function getGameOwnerCounts(viewerId: string): Promise<Map<string, number>> {
  const rows = await prisma.userGame.groupBy({
    by: ["gameId"],
    where: { owned: true, user: await libraryMemberWhere(viewerId) },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.gameId, r._count._all]));
}

/** Borne haute du slider "possédé par N potes" — nombre total de membres du groupe. */
export async function getTotalUserCount(viewerId: string): Promise<number> {
  return prisma.user.count({ where: await libraryMemberWhere(viewerId) });
}
