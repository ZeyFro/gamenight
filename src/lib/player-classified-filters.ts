import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { parsePlayerClassifiedDateTime, PLAYER_CLASSIFIED_MICROPHONE_REQUIREMENTS, PLAYER_CLASSIFIED_PARTY_TYPES } from "@/lib/player-classifieds-rules";
import { PLAYER_PLATFORMS } from "./player-equipment";
import { GAME_LEVELS, isGameLevelsEnabled } from "./game-levels-rules";
import { GAME_LEVEL_MATCHES, gameLevelUserWhere } from "./game-level-filter";

const dateField = z.string().max(10).optional().refine(value => !value || /^\d{4}-\d{2}-\d{2}$/.test(value));
const timeField = z.string().max(5).optional().refine(value => !value || /^([01]\d|2[0-3]):[0-5]\d$/.test(value));

export const playerClassifiedFiltersSchema = z.object({
  gameId: z.string().trim().max(191).optional(),
  // Lignes équivalentes d'un jeu replié dans le sélecteur : calculées par la
  // page depuis la biblio, jamais lues depuis l'URL.
  gameIds: z.array(z.string().trim().min(1).max(191)).max(50).optional(),
  platform: z.enum(["", ...PLAYER_PLATFORMS.map(option => option.key)]).optional(),
  microphone: z.enum(["", "yes", "no", "unknown"]).optional(),
  partyPlatform: z.enum(["", ...PLAYER_PLATFORMS.map(option => option.key)]).optional(),
  microphoneRequirement: z.enum(["", ...PLAYER_CLASSIFIED_MICROPHONE_REQUIREMENTS.map(option => option.value)]).optional(),
  partyType: z.enum(["", ...PLAYER_CLASSIFIED_PARTY_TYPES.map(option => option.value)]).optional(),
  // Niveau minimum de l'auteur pour le jeu de l'annonce (GAME_LEVELS_MATCHMAKING_ENABLED) ; appliqué après lecture, pas en SQL.
  level: z.enum(["", ...GAME_LEVELS]).optional(),
  levelMatch: z.enum(["", ...GAME_LEVEL_MATCHES]).optional(),
  startsAfterDate: dateField,
  startsAfterTime: timeField,
  startsBeforeDate: dateField,
  startsBeforeTime: timeField,
}).superRefine((filters, context) => {
  // Niveau : exige un jeu choisi et le drapeau allumé ; sinon requête invalide (jamais élargie en silence).
  if (filters.level && (!filters.gameId || !isGameLevelsEnabled())) {
    context.addIssue({ code: "custom", path: ["level"], message: "Le niveau exige un jeu choisi" });
  }
  const afterHasDate = Boolean(filters.startsAfterDate);
  const afterHasTime = Boolean(filters.startsAfterTime);
  const beforeHasDate = Boolean(filters.startsBeforeDate);
  const beforeHasTime = Boolean(filters.startsBeforeTime);
  const after = afterHasDate && afterHasTime ? parsePlayerClassifiedDateTime(filters.startsAfterDate!, filters.startsAfterTime!) : null;
  const before = beforeHasDate && beforeHasTime ? parsePlayerClassifiedDateTime(filters.startsBeforeDate!, filters.startsBeforeTime!) : null;
  if (afterHasDate !== afterHasTime || (afterHasDate && !after)) {
    context.addIssue({ code: "custom", path: [afterHasDate ? "startsAfterTime" : "startsAfterDate"], message: "Date ou heure invalide" });
  }
  if (beforeHasDate !== beforeHasTime || (beforeHasDate && !before)) {
    context.addIssue({ code: "custom", path: [beforeHasDate ? "startsBeforeTime" : "startsBeforeDate"], message: "Date ou heure invalide" });
  }
  if (after && before && after > before) {
    context.addIssue({ code: "custom", path: ["startsBeforeDate"], message: "La fin précède le début" });
  }
});

export type PlayerClassifiedFilters = z.infer<typeof playerClassifiedFiltersSchema>;
export type PlayerClassifiedSearchParams = Record<string, string | string[] | undefined>;

export function parsePlayerClassifiedFilters(params: PlayerClassifiedSearchParams) {
  return playerClassifiedFiltersSchema.safeParse({
    gameId: params.gameId,
    platform: params.platform,
    microphone: params.microphone,
    partyPlatform: params.partyPlatform,
    microphoneRequirement: params.microphoneRequirement,
    partyType: params.partyType,
    level: params.level,
    levelMatch: params.levelMatch,
    startsAfterDate: params.startsAfterDate,
    startsAfterTime: params.startsAfterTime,
    startsBeforeDate: params.startsBeforeDate,
    startsBeforeTime: params.startsBeforeTime,
  });
}

/** `createdBy` est toujours un filtre de champs (jamais une relation complète). */
export interface PlayerClassifiedFilterWhere
  extends Omit<Prisma.PlayerClassifiedWhereInput, "createdBy"> {
  createdBy: Prisma.UserWhereInput;
}

/** Conditions ajoutées aux gardes communautaires, jamais utilisées seules. */
export function playerClassifiedFilterWhere(filters: PlayerClassifiedFilters): PlayerClassifiedFilterWhere {
  const startsAt = {
    ...(filters.startsAfterDate && filters.startsAfterTime ? { gte: parsePlayerClassifiedDateTime(filters.startsAfterDate, filters.startsAfterTime)! } : {}),
    ...(filters.startsBeforeDate && filters.startsBeforeTime ? { lte: parsePlayerClassifiedDateTime(filters.startsBeforeDate, filters.startsBeforeTime)! } : {}),
  };
  const gameIds = filters.gameIds?.length ? filters.gameIds : filters.gameId ? [filters.gameId] : [];
  return {
    ...(gameIds.length === 1 ? { gameId: gameIds[0] } : gameIds.length ? { gameId: { in: gameIds } } : {}),
    ...(filters.partyPlatform ? { platform: filters.partyPlatform } : {}),
    ...(filters.microphoneRequirement ? { microphoneRequirement: filters.microphoneRequirement } : {}),
    ...(filters.partyType ? { partyType: filters.partyType } : {}),
    ...(Object.keys(startsAt).length ? { startsAt } : {}),
    createdBy: {
      ...gameLevelUserWhere(filters),
      ...(filters.platform ? { availablePlatforms: { has: filters.platform } } : {}),
      ...(filters.microphone ? {
        microphoneAvailable: filters.microphone === "unknown" ? null : filters.microphone === "yes",
      } : {}),
    },
  };
}
