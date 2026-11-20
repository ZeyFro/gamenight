import { z } from "zod";

/** Objectifs et critères de recrutement d'équipe (cahier §11.2). OFF par défaut : actif seulement si la valeur vaut exactement `true`. */
export function isTeamRecruitmentCriteriaEnabled(): boolean {
  return process.env.TEAM_RECRUITMENT_CRITERIA_ENABLED === "true";
}

export const TEAM_GOALS = ["DETENTE", "COMPETITIF", "PROGRESSION", "DECOUVERTE", "SOCIAL"] as const;
export const TEAM_MIC_REQUIREMENTS = ["REQUIRED", "PREFERRED", "NOT_NEEDED"] as const;
export const TEAM_AVAILABILITY_SLOTS = ["WEEKDAY_DAY", "WEEKDAY_EVENING", "WEEKEND_DAY", "WEEKEND_EVENING", "NIGHT"] as const;
/** Niveaux de jeu auto-déclarés (même échelle que les niveaux par jeu du profil, cahier §12.4). Colonne texte indépendante. */
export const TEAM_MIN_LEVELS = ["DEBUTANT", "INTERMEDIAIRE", "AVANCE", "EXPERT"] as const;

export type TeamGoal = (typeof TEAM_GOALS)[number];
export type TeamMicRequirement = (typeof TEAM_MIC_REQUIREMENTS)[number];
export type TeamAvailabilitySlot = (typeof TEAM_AVAILABILITY_SLOTS)[number];
export type TeamMinLevel = (typeof TEAM_MIN_LEVELS)[number];

export const TEAM_GOAL_LABELS: Record<TeamGoal, string> = {
  DETENTE: "Détente", COMPETITIF: "Compétitif", PROGRESSION: "Progression", DECOUVERTE: "Découverte", SOCIAL: "Convivialité",
};
export const TEAM_MIC_LABELS: Record<TeamMicRequirement, string> = {
  REQUIRED: "Micro requis", PREFERRED: "Micro souhaité", NOT_NEEDED: "Micro facultatif",
};
export const TEAM_SLOT_LABELS: Record<TeamAvailabilitySlot, string> = {
  WEEKDAY_DAY: "Semaine, journée", WEEKDAY_EVENING: "Semaine, soir", WEEKEND_DAY: "Week-end, journée", WEEKEND_EVENING: "Week-end, soir", NIGHT: "Nuit",
};
export const TEAM_LEVEL_LABELS: Record<TeamMinLevel, string> = {
  DEBUTANT: "Débutant", INTERMEDIAIRE: "Intermédiaire", AVANCE: "Avancé", EXPERT: "Expert",
};

export const TEAM_CRITERIA_MAX_PLATFORMS = 5;
export const TEAM_CRITERIA_NOTE_MAX = 300;

/** Liste d'énumérations sans doublon (l'ordre de saisie est conservé). */
const enumList = <T extends readonly [string, ...string[]]>(values: T, max: number) =>
  z.array(z.enum(values)).max(max).transform((items) => [...new Set(items)]);

export const teamRecruitmentCriteriaSchema = z.object({
  teamId: z.string().trim().min(1).max(191),
  goals: enumList(TEAM_GOALS, TEAM_GOALS.length),
  minLevel: z.enum(TEAM_MIN_LEVELS).nullable(),
  mic: z.enum(TEAM_MIC_REQUIREMENTS).nullable(),
  slots: enumList(TEAM_AVAILABILITY_SLOTS, TEAM_AVAILABILITY_SLOTS.length),
  platforms: z.array(z.string().trim().min(1).max(40)).max(TEAM_CRITERIA_MAX_PLATFORMS)
    .transform((items) => items.filter((item, index) => items.findIndex((other) => other.toLowerCase() === item.toLowerCase()) === index)),
  note: z.string().trim().max(TEAM_CRITERIA_NOTE_MAX).nullable(),
}).strict();

export type TeamRecruitmentCriteriaInput = z.infer<typeof teamRecruitmentCriteriaSchema>;

export type TeamRecruitmentCriteriaView = {
  goals: TeamGoal[];
  minLevel: TeamMinLevel | null;
  mic: TeamMicRequirement | null;
  slots: TeamAvailabilitySlot[];
  platforms: string[];
  note: string | null;
};

/**
 * Lit le formulaire du capitaine (cases à cocher multiples, champs facultatifs vides = non renseigné).
 * Les plateformes sont séparées par des virgules. Valeurs hors énumération : rejetées par le schéma.
 */
export function parseTeamRecruitmentCriteriaForm(formData: FormData) {
  const text = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" && value.trim() ? value : null;
  };
  const platformsRaw = text("platforms");
  return teamRecruitmentCriteriaSchema.safeParse({
    teamId: formData.get("teamId"),
    goals: formData.getAll("goals"),
    minLevel: text("minLevel"),
    mic: text("mic"),
    slots: formData.getAll("slots"),
    platforms: platformsRaw ? platformsRaw.split(",").map((item) => item.trim()).filter(Boolean) : [],
    note: text("note"),
  });
}

/** Vrai si le capitaine n'a rien renseigné (rien à afficher). */
export function isEmptyTeamCriteria(criteria: TeamRecruitmentCriteriaView | null | undefined): boolean {
  return !criteria || (!criteria.goals.length && !criteria.minLevel && !criteria.mic && !criteria.slots.length && !criteria.platforms.length && !criteria.note);
}

/** Étiquettes d'affichage, dans un ordre stable. */
export function describeTeamCriteria(criteria: TeamRecruitmentCriteriaView): { label: string; values: string[] }[] {
  const rows: { label: string; values: string[] }[] = [];
  if (criteria.goals.length) rows.push({ label: "Objectifs", values: criteria.goals.map((goal) => TEAM_GOAL_LABELS[goal]) });
  if (criteria.minLevel) rows.push({ label: "Niveau minimum", values: [TEAM_LEVEL_LABELS[criteria.minLevel]] });
  if (criteria.mic) rows.push({ label: "Micro", values: [TEAM_MIC_LABELS[criteria.mic]] });
  if (criteria.slots.length) rows.push({ label: "Créneaux (heure de Paris)", values: criteria.slots.map((slot) => TEAM_SLOT_LABELS[slot]) });
  if (criteria.platforms.length) rows.push({ label: "Plateformes", values: criteria.platforms });
  if (criteria.note) rows.push({ label: "Précisions", values: [criteria.note] });
  return rows;
}
