import { z } from "zod";
import { parsePlayerClassifiedDateTime, PLAYER_CLASSIFIED_MICROPHONE_REQUIREMENTS, PLAYER_CLASSIFIED_PARTY_TYPES } from "@/lib/player-classifieds-rules";
import { PLAYER_PLATFORMS } from "./player-equipment";

const dateField = z.string().max(10).optional().refine(value => !value || /^\d{4}-\d{2}-\d{2}$/.test(value));
const timeField = z.string().max(5).optional().refine(value => !value || /^([01]\d|2[0-3]):[0-5]\d$/.test(value));

export const playerClassifiedFiltersSchema = z.object({
  gameId: z.string().trim().max(191).optional(),
  platform: z.enum(["", ...PLAYER_PLATFORMS.map(option => option.key)]).optional(),
  microphone: z.enum(["", "yes", "no", "unknown"]).optional(),
  partyPlatform: z.enum(["", ...PLAYER_PLATFORMS.map(option => option.key)]).optional(),
  microphoneRequirement: z.enum(["", ...PLAYER_CLASSIFIED_MICROPHONE_REQUIREMENTS.map(option => option.value)]).optional(),
  partyType: z.enum(["", ...PLAYER_CLASSIFIED_PARTY_TYPES.map(option => option.value)]).optional(),
  startsAfterDate: dateField,
  startsAfterTime: timeField,
  startsBeforeDate: dateField,
  startsBeforeTime: timeField,
}).superRefine((filters, context) => {
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
    startsAfterDate: params.startsAfterDate,
    startsAfterTime: params.startsAfterTime,
    startsBeforeDate: params.startsBeforeDate,
    startsBeforeTime: params.startsBeforeTime,
  });
}

/** Conditions ajoutées aux gardes communautaires, jamais utilisées seules. */
export function playerClassifiedFilterWhere(filters: PlayerClassifiedFilters) {
  const startsAt = {
    ...(filters.startsAfterDate && filters.startsAfterTime ? { gte: parsePlayerClassifiedDateTime(filters.startsAfterDate, filters.startsAfterTime)! } : {}),
    ...(filters.startsBeforeDate && filters.startsBeforeTime ? { lte: parsePlayerClassifiedDateTime(filters.startsBeforeDate, filters.startsBeforeTime)! } : {}),
  };
  return {
    ...(filters.gameId ? { gameId: filters.gameId } : {}),
    ...(filters.partyPlatform ? { platform: filters.partyPlatform } : {}),
    ...(filters.microphoneRequirement ? { microphoneRequirement: filters.microphoneRequirement } : {}),
    ...(filters.partyType ? { partyType: filters.partyType } : {}),
    ...(Object.keys(startsAt).length ? { startsAt } : {}),
    createdBy: {
      ...(filters.platform ? { availablePlatforms: { has: filters.platform } } : {}),
      ...(filters.microphone ? {
        microphoneAvailable: filters.microphone === "unknown" ? null : filters.microphone === "yes",
      } : {}),
    },
  };
}
