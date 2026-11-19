import { canViewPote } from "@/lib/community-isolation";
import { prisma } from "@/lib/prisma";
import { isGameLevelsEnabled, MAX_GAME_LEVELS_PER_USER, type GameLevel } from "@/lib/game-levels-rules";

export type GameLevelEntry = { gameId: string; gameName: string; level: GameLevel };

export type SetGameLevelResult = "saved" | "invalid_game" | "limit" | "unavailable";

/** Déclare ou modifie son propre niveau pour un jeu. Rien n'est lu ni écrit flag éteint. */
export async function setUserGameLevel(userId: string, gameId: string, level: GameLevel): Promise<SetGameLevelResult> {
  if (!isGameLevelsEnabled()) return "unavailable";
  const game = await prisma.game.findUnique({ where: { id: gameId }, select: { id: true } });
  if (!game) return "invalid_game";
  const existing = await prisma.userGameLevel.findUnique({ where: { userId_gameId: { userId, gameId } }, select: { gameId: true } });
  if (!existing && await prisma.userGameLevel.count({ where: { userId } }) >= MAX_GAME_LEVELS_PER_USER) return "limit";
  await prisma.userGameLevel.upsert({
    where: { userId_gameId: { userId, gameId } },
    create: { userId, gameId, level },
    update: { level },
  });
  return "saved";
}

export async function removeUserGameLevel(userId: string, gameId: string): Promise<"removed" | "unavailable"> {
  if (!isGameLevelsEnabled()) return "unavailable";
  await prisma.userGameLevel.deleteMany({ where: { userId, gameId } });
  return "removed";
}

async function readLevels(userId: string): Promise<GameLevelEntry[]> {
  const rows = await prisma.userGameLevel.findMany({
    where: { userId },
    select: { gameId: true, level: true, game: { select: { name: true } } },
    orderBy: [{ game: { name: "asc" } }, { gameId: "asc" }],
  });
  return rows.map((row) => ({ gameId: row.gameId, gameName: row.game.name, level: row.level }));
}

/** Ses propres niveaux. */
export async function listOwnGameLevels(userId: string): Promise<GameLevelEntry[]> {
  if (!isGameLevelsEnabled()) return [];
  return readLevels(userId);
}

/**
 * Niveaux d'un autre membre, tels que `viewerId` peut les voir : mêmes règles que sa fiche (`canViewPote` :
 * membre d'une communauté du lecteur, profil non masqué). Vide sinon, sans distinguer « masqué » d'« inconnu ».
 */
export async function listVisibleGameLevels(viewerId: string, poteId: string): Promise<GameLevelEntry[]> {
  if (!isGameLevelsEnabled()) return [];
  if (!(await canViewPote(viewerId, poteId))) return [];
  return readLevels(poteId);
}

/** Jeux proposables dans le formulaire : ceux de sa bibliothèque, plus ceux déjà notés (liste dédoublonnée). */
export async function listGameLevelChoices(userId: string): Promise<{ id: string; name: string }[]> {
  if (!isGameLevelsEnabled()) return [];
  const games = await prisma.game.findMany({
    where: { OR: [{ userGames: { some: { userId, owned: true } } }, { userLevels: { some: { userId } } }] },
    select: { id: true, name: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: 300,
  });
  return games;
}
