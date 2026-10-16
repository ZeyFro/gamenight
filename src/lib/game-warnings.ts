import { z } from "zod";

const declaredRisk = z.enum(["unknown", "present", "absent"]).transform(value => value === "unknown" ? null : value === "present");
const languages = z.string().trim().max(120).transform(value => value || null);
export const gameWarningsSchema = z.object({
  gameId: z.string().min(1).max(100),
  jumpscares: declaredRisk, motionSickness: declaredRisk,
  textLanguages: languages, audioLanguages: languages,
});
export interface GameWarningsData {
  jumpscares?: boolean | null;
  motionSickness?: boolean | null;
  textLanguages?: string | null;
  audioLanguages?: string | null;
  warningsUpdatedAt?: Date | string | null;
}
export const gameWarningsSelect = {
  jumpscares: true, motionSickness: true, textLanguages: true,
  audioLanguages: true, warningsUpdatedAt: true,
} as const;
