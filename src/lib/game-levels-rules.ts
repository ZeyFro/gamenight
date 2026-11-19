import { z } from "zod";

/** Niveaux par jeu (cahier §12.4). OFF par défaut : actif seulement si la valeur vaut exactement `true`. */
export function isGameLevelsEnabled(): boolean {
  return process.env.GAME_LEVELS_ENABLED === "true";
}

/** Du plus faible au plus fort : l'ordre sert aux comparaisons « niveau minimum ». */
export const GAME_LEVELS = ["DEBUTANT", "INTERMEDIAIRE", "CONFIRME", "COMPETITIF"] as const;
export type GameLevel = (typeof GAME_LEVELS)[number];

export const GAME_LEVEL_LABELS: Record<GameLevel, string> = {
  DEBUTANT: "Débutant", INTERMEDIAIRE: "Intermédiaire", CONFIRME: "Confirmé", COMPETITIF: "Compétitif",
};

/** Nombre maximal de jeux avec un niveau déclaré, par utilisateur. */
export const MAX_GAME_LEVELS_PER_USER = 30;

export const gameLevelSchema = z.object({
  gameId: z.string().trim().min(1).max(191),
  level: z.enum(GAME_LEVELS),
}).strict();

export const gameLevelRemovalSchema = z.object({
  gameId: z.string().trim().min(1).max(191),
}).strict();

export function isGameLevel(value: unknown): value is GameLevel {
  return typeof value === "string" && (GAME_LEVELS as readonly string[]).includes(value);
}

/** Vrai si `level` atteint au moins `minimum`. */
export function gameLevelAtLeast(level: GameLevel, minimum: GameLevel): boolean {
  return GAME_LEVELS.indexOf(level) >= GAME_LEVELS.indexOf(minimum);
}

/** Niveaux qui satisfont « au moins `minimum` » (utile pour un filtre `level: { in }`). */
export function gameLevelsFrom(minimum: GameLevel): GameLevel[] {
  return GAME_LEVELS.slice(GAME_LEVELS.indexOf(minimum));
}

/**
 * Niveau par jeu utilisé par le matchmaking et l'équilibrage de tournoi (GAME_LEVELS_MATCHMAKING_ENABLED, OFF par défaut).
 * Exige aussi GAME_LEVELS_ENABLED : sans niveaux déclarés il n'y a rien à utiliser.
 */
export function isGameLevelsMatchmakingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.GAME_LEVELS_MATCHMAKING_ENABLED === "true" && env.GAME_LEVELS_ENABLED === "true";
}

/**
 * Origine d'un niveau. Seul DECLARED existe aujourd'hui (auto-déclaré). IMPORTED est réservé à un futur rang importé
 * par API officielle (V2, Riot, Hypixel…) : aucune donnée importée n'est lue ni stockée, aucune colonne n'existe.
 */
export type GameLevelSource = "DECLARED" | "IMPORTED";

/** Niveau d'un joueur pour un jeu, tel que le consomment matchmaking et tournois. */
export type ResolvedGameLevel = { level: GameLevel; source: GameLevelSource };

/**
 * Point d'extension du rang importé : un niveau importé, s'il existe un jour, prime sur le déclaré (donnée vérifiée).
 * Aujourd'hui l'appelant ne fournit jamais `imported`, le résultat est donc toujours le niveau déclaré.
 */
export function resolveGameLevel(declared: GameLevel | null | undefined, imported?: GameLevel | null): ResolvedGameLevel | null {
  if (imported) return { level: imported, source: "IMPORTED" };
  if (declared) return { level: declared, source: "DECLARED" };
  return null;
}

/** Valeur numérique 1..4 d'un niveau (équilibrage). */
export function gameLevelScore(level: GameLevel): number {
  return GAME_LEVELS.indexOf(level) + 1;
}

/** Score d'un joueur sans niveau déclaré : le milieu de l'échelle, ni favorisé ni pénalisé. */
export const UNDECLARED_LEVEL_SCORE = 2.5;

export type LevelledPlayer<T> = { player: T; level: GameLevel | null };

const scoreOf = (level: GameLevel | null): number => (level ? gameLevelScore(level) : UNDECLARED_LEVEL_SCORE);

/**
 * Forme des équipes de 2 : le plus fort avec le plus faible, le deuxième plus fort avec le deuxième plus faible…
 * Départage stable par ordre d'entrée. `null` sous les conditions de `pairTournamentParticipants` (au moins 4, pair).
 */
export function pairByLevel<T>(players: readonly LevelledPlayer<T>[]): T[][] | null {
  if (players.length < 4 || players.length % 2 !== 0) return null;
  const sorted = players.map((entry, index) => ({ ...entry, index })).sort((a, b) => scoreOf(b.level) - scoreOf(a.level) || a.index - b.index);
  return Array.from({ length: sorted.length / 2 }, (_, i) => [sorted[i].player, sorted[sorted.length - 1 - i].player]);
}

/**
 * Répartit des joueurs en `teamCount` équipes de niveau comparable (tirage en serpentin sur l'ordre décroissant des scores).
 * Les tailles diffèrent d'au plus 1.
 */
export function balanceTeamsByLevel<T>(players: readonly LevelledPlayer<T>[], teamCount: number): T[][] {
  if (!Number.isInteger(teamCount) || teamCount < 2 || teamCount > players.length) {
    throw new RangeError("teamCount doit être compris entre 2 et le nombre de joueurs.");
  }
  const sorted = players.map((entry, index) => ({ ...entry, index })).sort((a, b) => scoreOf(b.level) - scoreOf(a.level) || a.index - b.index);
  const teams = Array.from({ length: teamCount }, () => [] as T[]);
  sorted.forEach((entry, i) => {
    const round = Math.floor(i / teamCount);
    const slot = i % teamCount;
    teams[round % 2 === 0 ? slot : teamCount - 1 - slot].push(entry.player);
  });
  return teams;
}

/** Niveau moyen (1..4) d'un groupe ; joueurs sans niveau comptés au milieu de l'échelle. */
export function averageLevelScore(levels: readonly (GameLevel | null)[]): number {
  if (!levels.length) return UNDECLARED_LEVEL_SCORE;
  return levels.reduce((total, level) => total + scoreOf(level), 0) / levels.length;
}

/** Ordre de tête de série : niveaux moyens décroissants, départage stable. */
export function seedByAverageLevel<T>(groups: readonly { group: T; levels: readonly (GameLevel | null)[] }[]): T[] {
  return groups.map((entry, index) => ({ ...entry, index, score: averageLevelScore(entry.levels) }))
    .sort((a, b) => b.score - a.score || a.index - b.index).map((entry) => entry.group);
}
