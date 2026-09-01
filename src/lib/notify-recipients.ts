/**
 * Ping sélectif à la création d'une soirée : le créateur choisit, parmi
 * les potes du groupe, qui recevoir la mention Discord (création,
 * clôture/validation, rappels). Stocké sur `Session.notifiedUserIds`
 * (`Json?`) — voir le commentaire du schéma pour le choix `null` vs
 * tableau.
 */

/**
 * Lit la sélection stockée en base et la ramène à un type exploitable —
 * même garde défensive que `parseRemindersSent`
 * (`src/app/api/cron/reminders/route.ts`) pour un champ `Json`.
 * `null`/valeur inattendue → `null` (pas de restriction, comportement
 * historique). Un tableau, même vide, est renvoyé tel quel.
 */
export function resolveNotifiedUserIds(value: unknown): string[] | null {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) return null;
  return value.filter((v): v is string => typeof v === "string");
}

/**
 * Parse la sélection brute du formulaire de création. Aucun repli sur
 * "tout le monde" ici si le tableau ressort vide : si le créateur décoche
 * tous les potes, le tableau vide doit être stocké et respecté
 * littéralement (aucune mention nulle part pour cette soirée) — même
 * philosophie que `parseReminderTimingsFromFormData`.
 */
export function parseNotifyRecipientsFromFormData(formData: FormData): string[] {
  return formData.getAll("notifyUserId").map(String);
}
