import { z } from "zod";
import { parseDateAndTime } from "@/lib/wallclock";
import { PLAYER_PLATFORMS } from "@/lib/player-equipment";

export const PLAYER_CLASSIFIED_LIFETIME_MS = 24 * 60 * 60 * 1000;
export const PLAYER_CLASSIFIED_PARTY_TYPES = [
  { value: "CASUAL", label: "Détente" },
  { value: "COMPETITIVE", label: "Compétitif" },
  { value: "COOPERATIVE", label: "Coopératif" },
] as const;
export const PLAYER_CLASSIFIED_MICROPHONE_REQUIREMENTS = [
  { value: "REQUIRED", label: "Micro requis" },
  { value: "OPTIONAL", label: "Micro facultatif" },
  { value: "NONE", label: "Sans micro" },
] as const;

const localDatePattern = /^(\d{4})-(\d{2})-(\d{2})$/;
const localTimePattern = /^(\d{2}):(\d{2})$/;

/** Les dates de session stockent déjà l’heure murale Paris dans un Date UTC. */
export function parsePlayerClassifiedDateTime(date: string, time: string): Date | null {
  const dateParts = localDatePattern.exec(date);
  const timeParts = localTimePattern.exec(time);
  if (!dateParts || !timeParts) return null;
  const [, year, month, day] = dateParts.map(Number);
  const [, hour, minute] = timeParts.map(Number);
  const check = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day
    || check.getUTCHours() !== hour || check.getUTCMinutes() !== minute) return null;
  return parseDateAndTime(date, time);
}

const optionalLocalDate = z.string().max(10).optional().transform(value => value ?? "");
const optionalLocalTime = z.string().max(5).optional().transform(value => value ?? "");

export const playerClassifiedSchema = z.object({
  gameId: z.string().trim().min(1).max(191),
  message: z.string().trim().min(1).max(240),
  platform: z.enum(["", ...PLAYER_PLATFORMS.map(option => option.key)]).optional().transform(value => value || null),
  microphoneRequirement: z.enum(["", ...PLAYER_CLASSIFIED_MICROPHONE_REQUIREMENTS.map(option => option.value)]).optional().transform(value => value || null),
  partyType: z.enum(["", ...PLAYER_CLASSIFIED_PARTY_TYPES.map(option => option.value)]).optional().transform(value => value || null),
  startsDate: optionalLocalDate,
  startsTime: optionalLocalTime,
  durationMinutes: z.preprocess(value => value === "" || value === undefined || value === null ? null : Number(value),
    z.number().int().min(1).max(10_080).nullable()),
}).superRefine((value, context) => {
  const hasDate = Boolean(value.startsDate);
  const hasTime = Boolean(value.startsTime);
  const startsAt = hasDate && hasTime ? parsePlayerClassifiedDateTime(value.startsDate, value.startsTime) : null;
  if ((hasDate !== hasTime) || ((hasDate || hasTime) && !startsAt)) {
    context.addIssue({ code: "custom", path: [hasDate ? "startsTime" : "startsDate"], message: "Date ou heure invalide" });
  }
  if (Boolean(startsAt) !== Boolean(value.durationMinutes)) {
    context.addIssue({ code: "custom", path: [startsAt ? "durationMinutes" : "startsDate"], message: "Renseigne l’horaire et la durée ensemble" });
  }
}).transform(({ startsDate, startsTime, ...value }) => ({
  ...value,
  startsAt: startsDate && startsTime ? parsePlayerClassifiedDateTime(startsDate, startsTime) : null,
}));

export function playerClassifiedExpiresAt(createdAt: Date): Date {
  return new Date(createdAt.getTime() + PLAYER_CLASSIFIED_LIFETIME_MS);
}
