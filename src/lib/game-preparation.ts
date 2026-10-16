import { z } from "zod";
const optionalText = (max: number) => z.string().trim().max(max).transform(value => value || null);
const sourceUrl = optionalText(500).refine(value => {
  if (value === null) return true;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password; } catch { return false; }
}, "Utilise un lien HTTPS vers la source.");
const downloadSize = z.string().trim().max(16)
  .refine(value => value === "" || /^\d+(?:[.,]\d{1,2})?$/.test(value))
  .transform(value => value === "" ? null : Number(value.replace(",", ".")))
  .pipe(z.number().finite().positive().max(5000).nullable());
export const gamePreparationSchema = z.object({
  gameId: z.string().min(1).max(100),
  preparationCost: z.enum(["unknown", "FREE", "PAID"]).transform(value => value === "unknown" ? null : value),
  preparationPrice: optionalText(120), downloadSizeGb: downloadSize,
  preparationPlatform: optionalText(80), preparationSourceUrl: sourceUrl,
}).refine(value => !value.preparationPrice || value.preparationCost === "PAID", "Un prix déclaré exige le statut payant.")
  .refine(value => !(value.preparationCost || value.downloadSizeGb !== null) || !!(value.preparationPlatform && value.preparationSourceUrl), "Indique une plateforme et une source pour tout coût ou téléchargement renseigné.");
export interface GamePreparationData {
  preparationCost: string | null; preparationPrice: string | null;
  downloadSizeGb: number | null; preparationPlatform: string | null;
  preparationSourceUrl: string | null; preparationUpdatedAt: Date | null;
}
