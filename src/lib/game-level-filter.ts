import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { profileVisibilityWhere } from "@/lib/profile-visibility";
import { GAME_LEVELS, gameLevelsFrom, isGameLevel, isGameLevelsEnabled, type GameLevel } from "@/lib/game-levels-rules";

export const GAME_LEVEL_MATCHES = ["min", "exact"] as const;
export type GameLevelMatch = (typeof GAME_LEVEL_MATCHES)[number];

const gameLevelFilterSchema = z.object({
  gameId: z.string().trim().max(191).optional(),
  level: z.enum(["", ...GAME_LEVELS]).optional(),
  levelMatch: z.enum(["", ...GAME_LEVEL_MATCHES]).optional(),
}).refine((filter) => !filter.level || (Boolean(filter.gameId) && isGameLevelsEnabled()), { path: ["level"], message: "Le niveau exige un jeu choisi" });

/** Paramètres d'URL → filtre validé (page Potes). Une valeur invalide donne `success: false`, jamais un filtre élargi. */
export function parseGameLevelFilter(params: Record<string, string | string[] | undefined>) {
  return gameLevelFilterSchema.safeParse({ gameId: params.gameId, level: params.level, levelMatch: params.levelMatch });
}

export type GameLevelFilter = { gameId?: string; gameIds?: readonly string[]; level?: string; levelMatch?: string };

/**
 * Condition sur un utilisateur : a déclaré, pour le jeu choisi, un niveau minimum (par défaut) ou exact.
 * Vide si aucun niveau n'est demandé. Sans jeu ou drapeau éteint, aucun utilisateur ne correspond (jamais
 * d'élargissement silencieux). Les profils masqués sont exclus : un filtre ne doit pas révéler leur niveau.
 */
export function gameLevelUserWhere(filter: GameLevelFilter): Prisma.UserWhereInput {
  if (!filter.level) return {};
  // Un jeu replié dans le sélecteur garde plusieurs lignes équivalentes : le
  // niveau déclaré sur l'une d'elles vaut pour les annonces de toutes.
  const gameIds = filter.gameIds?.length
    ? [...new Set(filter.gameIds)]
    : filter.gameId ? [filter.gameId] : [];
  if (!isGameLevelsEnabled() || !gameIds.length || !isGameLevel(filter.level)) return { id: { in: [] } };
  const level: GameLevel = filter.level;
  return {
    gameLevels: { some: { gameId: gameIds.length === 1 ? gameIds[0] : { in: gameIds }, level: filter.levelMatch === "exact" ? level : { in: gameLevelsFrom(level) } } },
    ...profileVisibilityWhere(),
  };
}

/**
 * Niveaux visibles pour des paires (utilisateur, jeu) : tag « niveau » des résultats. Seuls les auteurs que le
 * lecteur peut voir (lui-même, ou profil non masqué) apparaissent. Vide, sans requête, drapeau éteint.
 */
export async function loadVisibleLevels(
  viewerId: string, pairs: { userId: string; gameId: string }[],
): Promise<Map<string, GameLevel>> {
  const result = new Map<string, GameLevel>();
  if (!isGameLevelsEnabled() || !pairs.length) return result;
  const rows = await prisma.userGameLevel.findMany({
    where: {
      OR: pairs.map(({ userId, gameId }) => ({ userId, gameId })),
      user: { OR: [{ id: viewerId }, profileVisibilityWhere()] },
    },
    select: { userId: true, gameId: true, level: true },
  });
  for (const row of rows) result.set(levelKey(row.userId, row.gameId), row.level);
  return result;
}

export const levelKey = (userId: string, gameId: string) => `${userId}:${gameId}`;
