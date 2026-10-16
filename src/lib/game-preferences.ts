import { z } from "zod";

export const GAME_CATEGORIES = [
  { key: "COOP", label: "Coopération" }, { key: "SHOOTER", label: "Tir / FPS" },
  { key: "STRATEGY", label: "Stratégie" }, { key: "RPG", label: "Jeu de rôle" },
  { key: "PUZZLE", label: "Réflexion" }, { key: "RACING", label: "Course" },
  { key: "SPORT", label: "Sport" }, { key: "HORROR", label: "Horreur" },
] as const;
type Category = typeof GAME_CATEGORIES[number]["key"];
const categories = z.array(z.enum(GAME_CATEGORIES.map(category => category.key))).max(GAME_CATEGORIES.length).transform(values => [...new Set(values)]);
export const gamePreferencesSchema = z.object({
  preferredGameCategories: categories, refusedGameCategories: categories,
}).refine(value => !value.preferredGameCategories.some(key => value.refusedGameCategories.includes(key)), "Une catégorie ne peut pas être à la fois préférée et refusée.");
export const gameParticipantsSchema = z.array(z.string().min(1).max(100)).max(100).transform(ids => [...new Set(ids)]);

export interface GameTaste { preferredGameCategories: string[]; refusedGameCategories: string[]; }
export interface SuggestibleGame {
  id: string; name: string; isCoop: boolean; playInfoManual: boolean;
  minPlayers: number | null; maxPlayers: number | null; igdbDetails: unknown;
}
const GENRES: Partial<Record<Category, string[]>> = {
  SHOOTER: ["shooter"], STRATEGY: ["strategy", "real time strategy (rts)", "turn-based strategy (tbs)"],
  RPG: ["role-playing (rpg)"], PUZZLE: ["puzzle"], RACING: ["racing"], SPORT: ["sport"],
};
function stringList(value: unknown): string[] | null {
  return Array.isArray(value) && value.every(item => typeof item === "string") ? value.map(item => item.trim().toLowerCase()) : null;
}
/** null = données insuffisantes : un refus ne peut pas être vérifié. */
export function matchesGameCategory(game: SuggestibleGame, category: string): boolean | null {
  const details = game.igdbDetails && typeof game.igdbDetails === "object" ? game.igdbDetails as Record<string, unknown> : {};
  if (category === "COOP") {
    if (game.playInfoManual) return game.isCoop;
    if (typeof details.isCoop === "boolean") return details.isCoop;
    return game.isCoop ? true : null;
  }
  const values = stringList(category === "HORROR" ? details.themes : details.genres);
  if (values === null) return null;
  const expected = category === "HORROR" ? ["horror"] : GENRES[category as Category];
  return expected ? expected.some(value => values.includes(value)) : null;
}
/** Les refus de jeux nommés sont filtrés en SQL avant ce classement. */
export function rankGameSuggestions(games: SuggestibleGame[], tastes: GameTaste[]) {
  const suggestions: Array<{ id: string; name: string; preferredByCount: number; capacityKnown: boolean }> = [];
  let unknownMetadataCount = 0;
  if (!tastes.length) return { suggestions, unknownMetadataCount };
  const refusedCategories = [...new Set(tastes.flatMap(taste => taste.refusedGameCategories))];
  const relevantCategories = [...new Set([...refusedCategories, ...tastes.flatMap(taste => taste.preferredGameCategories)])];
  for (const game of games) {
    if ((game.minPlayers !== null && tastes.length < game.minPlayers) || (game.maxPlayers !== null && tastes.length > game.maxPlayers)) continue;
    const matches = new Map(relevantCategories.map(category => [category, matchesGameCategory(game, category)]));
    const checks = refusedCategories.map(category => matches.get(category) ?? null);
    if (checks.includes(true)) continue;
    if (checks.includes(null)) { unknownMetadataCount++; continue; }
    suggestions.push({ id: game.id, name: game.name,
      preferredByCount: tastes.filter(taste => taste.preferredGameCategories.some(category => matches.get(category) === true)).length,
      capacityKnown: game.minPlayers !== null && game.maxPlayers !== null,
    });
  }
  suggestions.sort((a, b) => b.preferredByCount - a.preferredByCount || a.name.localeCompare(b.name, "fr") || a.id.localeCompare(b.id));
  return { suggestions, unknownMetadataCount };
}
