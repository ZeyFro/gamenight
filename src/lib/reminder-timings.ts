/**
 * Timing des rappels Discord (F7), configurable par le créateur à la
 * création d'une session (PR 31, 2/4 — Bloc A). Remplace les deux
 * fenêtres fixes (24h/2h) par une liste de minutes avant la session,
 * stockée dans `Session.reminderTimings` (`Int[]`, défaut `[1440, 120]` =
 * comportement F7 d'origine préservé).
 */

export interface ReminderPreset {
  minutes: number;
  label: string;
}

/** 8 préréglages proposés à la création — ordre d'affichage = ordre de cette liste. */
export const REMINDER_PRESETS: ReminderPreset[] = [
  { minutes: 1440, label: "24h avant" },
  { minutes: 720, label: "12h avant" },
  { minutes: 360, label: "6h avant" },
  { minutes: 120, label: "2h avant" },
  { minutes: 60, label: "1h avant" },
  { minutes: 45, label: "45 min avant" },
  { minutes: 30, label: "30 min avant" },
  { minutes: 15, label: "15 min avant" },
];

/** Défaut coché à la création = comportement F7 d'origine (24h + 2h). */
export const DEFAULT_REMINDER_TIMINGS = [1440, 120];

/** Nombre max de rappels par session (préréglages + custom confondus) — anti-spam. */
export const MAX_REMINDERS_PER_SESSION = 5;

export type ReminderCustomUnit = "minutes" | "heures" | "jours";

export const REMINDER_CUSTOM_UNIT_MINUTES: Record<ReminderCustomUnit, number> = {
  minutes: 1,
  heures: 60,
  jours: 1440,
};

/**
 * Libellé compact d'un timing en minutes, sans "avant" — utilisé dans le titre de
 * l'embed Discord ("⏰ Rappel — dans {label} !").
 */
export function formatReminderTimingShort(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${Math.floor(minutes / 60)}h${minutes % 60}`;
}

/**
 * Seuil sous lequel un rappel utilise le ton "proche"/urgent
 * (`REMINDER_2H`) plutôt que "loin"/hype (`REMINDER_24H`) pour tirer son
 * message dans `MessageTemplate` — décision assumée : le schéma de
 * messages n'a que 2 catégories de rappel (pas une par préréglage), un
 * rappel custom ou un préréglage intermédiaire (6h, 1h…) doit donc être
 * rattaché à l'une des deux. 3h est le point médian naturel entre "2h"
 * (le plus proche des deux réglages d'origine) et "6h" (le premier
 * préréglage "loin").
 */
const CLOSE_REMINDER_THRESHOLD_MINUTES = 180;

export function isCloseReminder(minutes: number): boolean {
  return minutes < CLOSE_REMINDER_THRESHOLD_MINUTES;
}

/**
 * Parse une liste de minutes depuis les valeurs FormData brutes du
 * formulaire de création. **Aucun repli sur `DEFAULT_REMINDER_TIMINGS`
 * ici** : le défaut 24h+2h n'est qu'un état initial de cases cochées
 * côté formulaire (`defaultChecked`) — si le créateur décoche tout
 * explicitement, le tableau vide doit être respecté littéralement
 * (aucun rappel envoyé pour cette session), pas silencieusement
 * remplacé. C'est le comportement explicitement attendu et testé :
 * "je crée une session, je décoche tous les rappels, je vérifie
 * qu'aucun cron ne part."
 */
export function parseReminderTimingsFromFormData(formData: FormData): number[] {
  const presetValues = formData
    .getAll("reminderPreset")
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n) && n > 0);

  const customAmounts = formData.getAll("reminderCustomAmount");
  const customUnits = formData.getAll("reminderCustomUnit");
  const customValues: number[] = [];
  for (let i = 0; i < customAmounts.length; i++) {
    const amount = Number(customAmounts[i]);
    const unit = String(customUnits[i] ?? "minutes") as ReminderCustomUnit;
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const unitMinutes = REMINDER_CUSTOM_UNIT_MINUTES[unit] ?? 1;
    customValues.push(Math.round(amount * unitMinutes));
  }

  return Array.from(new Set([...presetValues, ...customValues]))
    .filter((n) => n > 0)
    .sort((a, b) => b - a)
    .slice(0, MAX_REMINDERS_PER_SESSION);
}
