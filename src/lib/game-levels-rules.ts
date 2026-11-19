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
