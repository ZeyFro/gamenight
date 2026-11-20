import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { resolveActiveCommunityId } from "@/lib/community-isolation";

/**
 * Plateformes des jeux et crossplay (sujet J). Interrupteur `GAME_PLATFORMS_ENABLED`, OFF par
 * défaut : actif seulement si la valeur vaut exactement `true`.
 *
 * Les clés de plateforme sont celles de `PLAYER_PLATFORMS` (matériel déclaré par le joueur). Un
 * jeu sans plateforme déclarée, ou un joueur sans matériel déclaré, est INCONNU : jamais exclu.
 */
export function isGamePlatformsEnabled(): boolean {
  return process.env.GAME_PLATFORMS_ENABLED === "true";
}

export const PLATFORM_FAMILIES = [
  { key: "PC", label: "PC", platforms: ["WINDOWS", "MACOS", "LINUX"] },
  { key: "PLAYSTATION", label: "PlayStation", platforms: ["PLAYSTATION"] },
  { key: "XBOX", label: "Xbox", platforms: ["XBOX"] },
  { key: "SWITCH", label: "Switch", platforms: ["SWITCH"] },
] as const;
export type PlatformFamilyKey = (typeof PLATFORM_FAMILIES)[number]["key"];

const MOBILE = ["ANDROID", "IOS"];

/** Famille d'une clé de plateforme (PC regroupe Windows, macOS, Linux ; le mobile est sa propre famille). */
export function platformFamily(platform: string): string {
  const found = PLATFORM_FAMILIES.find((family) => (family.platforms as readonly string[]).includes(platform));
  if (found) return found.key;
  return MOBILE.includes(platform) ? "MOBILE" : platform;
}

export function isPlatformFamilyKey(value: string): value is PlatformFamilyKey {
  return PLATFORM_FAMILIES.some((family) => family.key === value);
}

/** Familles de plateformes d'une liste de clés. */
export function platformFamilies(platforms: readonly string[]): Set<string> {
  return new Set(platforms.map(platformFamily));
}

/**
 * Un jeu est jouable par un joueur s'il existe une famille commune. Inconnu d'un côté ou de l'autre
 * = jouable (on n'écarte jamais sans information). Le crossplay n'y change rien : il permet de jouer
 * ENSEMBLE entre plateformes, pas de posséder le jeu sur une plateforme qu'on n'a pas.
 */
export function isPlayableOnPlayerPlatforms(gamePlatforms: readonly string[], playerPlatforms: readonly string[]): boolean {
  if (gamePlatforms.length === 0 || playerPlatforms.length === 0) return true;
  const playerFamilies = platformFamilies(playerPlatforms);
  return [...platformFamilies(gamePlatforms)].some((family) => playerFamilies.has(family));
}

/** Libellé du crossplay d'une fiche jeu : `null` = inconnu. */
export function crossplayLabel(crossplay: boolean | null): string {
  return crossplay === null ? "Crossplay inconnu" : crossplay ? "Crossplay entre plateformes" : "Pas de crossplay";
}

export const gamePlatformsSchema = z.object({
  gameId: z.string().min(1).max(191),
  platforms: z.array(z.enum(["WINDOWS", "MACOS", "LINUX", "PLAYSTATION", "XBOX", "SWITCH", "ANDROID", "IOS"])).max(8)
    .transform((values) => [...new Set(values)]),
  crossplay: z.enum(["", "yes", "no"]).transform((value) => (value === "" ? null : value === "yes")),
});

export interface PopularGame {
  id: string;
  name: string;
  coverUrl: string | null;
  owners: number;
  crossplay: boolean | null;
}

/**
 * « Populaires sur ta plateforme » : jeux déclarés sur cette famille, classés par nombre de membres
 * ACTIFS de ta communauté qui les possèdent, hors ceux que tu possèdes déjà.
 */
export async function listPopularGamesForFamily(userId: string, family: PlatformFamilyKey, limit = 24): Promise<PopularGame[]> {
  const communityId = await resolveActiveCommunityId(userId);
  if (!communityId) return [];
  const platforms = PLATFORM_FAMILIES.find((entry) => entry.key === family)!.platforms as readonly string[];
  const games = await prisma.game.findMany({
    where: {
      platforms: { hasSome: [...platforms] },
      userGames: { none: { userId, owned: true } },
    },
    select: {
      id: true, name: true, coverUrl: true, crossplay: true,
      userGames: { where: { owned: true, user: { memberships: { some: { communityId, status: "ACTIVE" } } } }, select: { userId: true } },
    },
    take: 300,
  });
  return games
    .map((game) => ({ id: game.id, name: game.name, coverUrl: game.coverUrl, crossplay: game.crossplay, owners: game.userGames.length }))
    .sort((a, b) => b.owners - a.owners || a.name.localeCompare(b.name, "fr"))
    .slice(0, limit);
}

/** Au moins `minPlayers` membres peuvent jouer ce jeu (plateforme inconnue = peut jouer). */
export function isPlayableByGroup(gamePlatforms: readonly string[], membersPlatforms: readonly (readonly string[])[], minPlayers = 2): boolean {
  const required = Math.min(minPlayers, membersPlatforms.length);
  return membersPlatforms.filter((platforms) => isPlayableOnPlayerPlatforms(gamePlatforms, platforms)).length >= required;
}

/**
 * Retire les défis liés à un jeu impossible sur les plateformes données. Un défi sans jeu, ou dont
 * le jeu n'a pas de plateforme déclarée, reste proposé (information inconnue : jamais exclu).
 */
export function filterChallengesPlayable<T extends { gameId: string | null }>(
  candidates: readonly T[],
  platformsByGameId: ReadonlyMap<string, readonly string[]>,
  isPlayable: (gamePlatforms: readonly string[]) => boolean,
): T[] {
  return candidates.filter((candidate) => candidate.gameId === null || isPlayable(platformsByGameId.get(candidate.gameId) ?? []));
}

/** Charge les plateformes déclarées des jeux (une seule requête). */
export async function loadGamePlatforms(gameIds: readonly string[]): Promise<Map<string, string[]>> {
  const ids = [...new Set(gameIds)];
  if (ids.length === 0) return new Map();
  const games = await prisma.game.findMany({ where: { id: { in: ids } }, select: { id: true, platforms: true } });
  return new Map(games.map((game) => [game.id, game.platforms]));
}
