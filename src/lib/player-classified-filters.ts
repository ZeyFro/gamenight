import { z } from "zod";
import { PLAYER_PLATFORMS } from "./player-equipment";

export const playerClassifiedFiltersSchema = z.object({
  gameId: z.string().trim().max(191).optional(),
  platform: z.enum(["", ...PLAYER_PLATFORMS.map(option => option.key)]).optional(),
  microphone: z.enum(["", "yes", "no", "unknown"]).optional(),
});

export type PlayerClassifiedFilters = z.infer<typeof playerClassifiedFiltersSchema>;
export type PlayerClassifiedSearchParams = Record<string, string | string[] | undefined>;

export function parsePlayerClassifiedFilters(params: PlayerClassifiedSearchParams) {
  return playerClassifiedFiltersSchema.safeParse({
    gameId: params.gameId,
    platform: params.platform,
    microphone: params.microphone,
  });
}

/** Conditions ajoutées aux gardes communautaires, jamais utilisées seules. */
export function playerClassifiedFilterWhere(filters: PlayerClassifiedFilters) {
  return {
    ...(filters.gameId ? { gameId: filters.gameId } : {}),
    createdBy: {
      ...(filters.platform ? { availablePlatforms: { has: filters.platform } } : {}),
      ...(filters.microphone ? {
        microphoneAvailable: filters.microphone === "unknown" ? null : filters.microphone === "yes",
      } : {}),
    },
  };
}
