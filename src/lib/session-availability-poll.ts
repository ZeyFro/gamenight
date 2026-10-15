import { z } from "zod";
import { dateStringSchema, idSchema, timeStringSchema } from "@/lib/validations";
import { parseDateAndTime, toDateInputValue } from "@/lib/wallclock";

export const availabilityPollAnswerSchema = z.enum(["AVAILABLE", "MAYBE", "UNAVAILABLE"]);
export type AvailabilityPollAnswer = z.infer<typeof availabilityPollAnswerSchema>;

const optionSchema = z.object({
  date: dateStringSchema,
  time: timeStringSchema,
  durationMinutes: z.union([z.literal(60), z.literal(90), z.literal(120), z.literal(180)]),
});

const inputSchema = z.object({
  title: z.string().trim().min(1).max(120),
  participantIds: z.array(idSchema.max(128)).min(1).max(100),
  options: z.array(optionSchema).min(2).max(28),
});

/** Horloge murale de l'application, comme les soirées et plannings.
 * La sélection des membres autorisés reste une vérification transactionnelle.
 * Aucune option ne vaut inscription ou réponse implicite d'un participant. */
export function parseAvailabilityPollInput(value: unknown, now: Date) {
  const parsed = inputSchema.safeParse(value);
  if (!parsed.success || !Number.isFinite(now.getTime())) return { ok: false as const };
  const { title, participantIds, options } = parsed.data;
  if (new Set(participantIds).size !== participantIds.length) return { ok: false as const };
  const slots = options.map(option => {
    const start = parseDateAndTime(option.date, option.time);
    return { start, end: new Date(start.getTime() + option.durationMinutes * 60_000), date: option.date };
  });
  const horizon = now.getTime() + 90 * 86_400_000;
  if (slots.some(slot => toDateInputValue(slot.start) !== slot.date || slot.start.getTime() <= now.getTime() || slot.end.getTime() > horizon)) {
    return { ok: false as const };
  }
  if (new Set(slots.map(slot => `${slot.start.getTime()}/${slot.end.getTime()}`)).size !== slots.length) return { ok: false as const };
  return { ok: true as const, title, participantIds, slots: slots.map(({ start, end }) => ({ start, end })) };
}

export interface AvailabilityPollSlot {
  id: string;
  start: Date;
  end: Date;
  responses: { userId: string; answer: AvailabilityPollAnswer }[];
}

/** Classement explicite : plus de oui, puis plus de peut-être. Les ex æquo
 * partagent leur rang ; date et ID assurent uniquement un affichage stable.
 * Le planning sert à suggérer, jamais à fabriquer une réponse au sondage. */
export function rankAvailabilityPollSlots(slots: AvailabilityPollSlot[], participantIds: string[]) {
  const participants = new Set(participantIds);
  const rows = slots.map(slot => {
    const responses = new Map(slot.responses.filter(row => participants.has(row.userId)).map(row => [row.userId, row.answer]));
    const answers = [...responses.values()];
    return {
      ...slot,
      responses: [...responses].map(([userId, answer]) => ({ userId, answer })),
      available: answers.filter(answer => answer === "AVAILABLE").length,
      maybe: answers.filter(answer => answer === "MAYBE").length,
      unavailable: answers.filter(answer => answer === "UNAVAILABLE").length,
      unanswered: participants.size - responses.size,
    };
  }).sort((a, b) => b.available - a.available || b.maybe - a.maybe || a.start.getTime() - b.start.getTime() || a.id.localeCompare(b.id));
  let rank = 0;
  return rows.map((row, index) => {
    if (index === 0 || row.available !== rows[index - 1].available || row.maybe !== rows[index - 1].maybe) rank = index + 1;
    return { ...row, rank };
  });
}
