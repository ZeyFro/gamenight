import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { profileVisibilityWhere } from "@/lib/profile-visibility";
import {
  gameLevelAtLeast, isGameLevelsMatchmakingEnabled, pairByLevel, resolveGameLevel, type GameLevel, type ResolvedGameLevel,
} from "@/lib/game-levels-rules";

/**
 * Niveaux par jeu au service du matchmaking (annonces « chercher un joueur ») et de l'équilibrage de tournoi.
 * Lecture seule des niveaux déclarés (#468). Aucun niveau n'est lu flag éteint. Les profils masqués par leur
 * propriétaire (PROFILE_VISIBILITY_ENABLED) n'exposent ni ne filtrent jamais leur niveau.
 */

type Db = Pick<typeof prisma, "userGameLevel"> | Prisma.TransactionClient;

/** Niveau de chaque joueur pour UN jeu, joueurs au profil masqué exclus. Vide si le drapeau est éteint. */
export async function loadGameLevels(userIds: readonly string[], gameId: string, db: Db = prisma): Promise<Map<string, ResolvedGameLevel>> {
  const levels = new Map<string, ResolvedGameLevel>();
  if (!isGameLevelsMatchmakingEnabled() || !userIds.length) return levels;
  const rows = await db.userGameLevel.findMany({
    where: { gameId, userId: { in: [...new Set(userIds)] }, user: profileVisibilityWhere() },
    select: { userId: true, level: true },
  });
  for (const row of rows) {
    // Le rang importé (V2) sera fourni ici ; rien n'est importé aujourd'hui.
    const resolved = resolveGameLevel(row.level);
    if (resolved) levels.set(row.userId, resolved);
  }
  return levels;
}

type Classified = { game: { id: string }; createdBy: { id: string } };

/**
 * Ajoute à chaque annonce le niveau déclaré de son auteur pour SON jeu (`posterLevel`, null si non déclaré ou masqué) et, si
 * `minimum` est donné, ne garde que les annonces dont l'auteur atteint au moins ce niveau (sans niveau déclaré : écarté).
 * Drapeau éteint : annonces renvoyées telles quelles, `posterLevel` null, aucun filtre.
 */
export async function withPosterLevels<T extends Classified>(
  listings: readonly T[], minimum?: GameLevel | null, gameIds?: readonly string[],
): Promise<(T & { posterLevel: ResolvedGameLevel | null })[]> {
  if (!isGameLevelsMatchmakingEnabled()) return listings.map((listing) => ({ ...listing, posterLevel: null }));
  const byGame = new Map<string, string[]>();
  for (const listing of listings) byGame.set(listing.game.id, [...(byGame.get(listing.game.id) ?? []), listing.createdBy.id]);
  const perGame = new Map<string, Map<string, ResolvedGameLevel>>();
  const authors = [...new Set(listings.map((listing) => listing.createdBy.id))];
  // Jeu replié : le niveau peut être déclaré sur une autre ligne équivalente.
  // On lit alors toutes les lignes du groupe avec tous les auteurs, et le tag
  // retient la première valeur trouvée pour l'annonce.
  const groupIds = gameIds?.length ? [...new Set(gameIds)] : null;
  for (const [gameId, userIds] of byGame) perGame.set(gameId, await loadGameLevels(userIds, gameId));
  if (groupIds) for (const gameId of groupIds) perGame.set(gameId, await loadGameLevels(authors, gameId));
  const posterLevelOf = (listing: T) => {
    for (const gameId of groupIds ?? [listing.game.id]) {
      const level = perGame.get(gameId)?.get(listing.createdBy.id);
      if (level) return level;
    }
    return null;
  };
  const annotated = listings.map((listing) => ({ ...listing, posterLevel: posterLevelOf(listing) }));
  if (!minimum) return annotated;
  return annotated.filter((listing) => listing.posterLevel !== null && gameLevelAtLeast(listing.posterLevel.level, minimum));
}

/**
 * Équipes de 2 d'un tournoi par équipes : le plus fort avec le plus faible selon le niveau déclaré pour le jeu du tournoi.
 * `null` si le drapeau est éteint ou si aucun participant n'a de niveau (l'appelant garde alors l'appariement aléatoire), ou
 * sous les conditions de `pairTournamentParticipants` (au moins 4 inscrits, nombre pair).
 */
export async function pairParticipantsByLevel<T extends { userId: string }>(
  tx: Prisma.TransactionClient, gameId: string, participants: readonly T[],
): Promise<T[][] | null> {
  if (!isGameLevelsMatchmakingEnabled()) return null;
  const levels = await loadGameLevels(participants.map((participant) => participant.userId), gameId, tx);
  if (levels.size === 0) return null;
  return pairByLevel(participants.map((participant) => ({ player: participant, level: levels.get(participant.userId)?.level ?? null })));
}
