import { z } from "zod";
import { plural } from "@/lib/plural";

/**
 * Recherche de joueurs (cahier §12.2, §12.3) : critères déclarés par le joueur et compatibilité.
 * OFF par défaut : actif seulement si `PLAYER_MATCHING_ENABLED` vaut exactement `true`.
 */
export function isPlayerMatchingEnabled(): boolean {
  return process.env.PLAYER_MATCHING_ENABLED === "true";
}

export const PLAYER_LANGUAGES = [
  { key: "FR", label: "Français" },
  { key: "EN", label: "Anglais" },
  { key: "ES", label: "Espagnol" },
  { key: "DE", label: "Allemand" },
  { key: "IT", label: "Italien" },
  { key: "PT", label: "Portugais" },
  { key: "AR", label: "Arabe" },
  { key: "NL", label: "Néerlandais" },
] as const;

/** Habitudes de jeu : créneaux et rythme. */
export const PLAY_HABITS = [
  { key: "WEEKDAY_EVENING", label: "Soirs de semaine" },
  { key: "WEEKDAY_DAY", label: "Journée en semaine" },
  { key: "WEEKEND", label: "Week-end" },
  { key: "LATE_NIGHT", label: "Tard dans la nuit" },
  { key: "SHORT_SESSIONS", label: "Parties courtes (moins d’une heure)" },
  { key: "LONG_SESSIONS", label: "Longues soirées" },
] as const;

/** Préférences communautaires : ambiance recherchée. */
export const COMMUNITY_PREFERENCES = [
  { key: "VOICE_CHAT", label: "En vocal" },
  { key: "TEXT_ONLY", label: "Sans vocal, à l’écrit" },
  { key: "CHILL", label: "Ambiance détente" },
  { key: "COMPETITIVE", label: "Ambiance compétitive" },
  { key: "BEGINNER_FRIENDLY", label: "Accueil des débutants" },
  { key: "PLANNED", label: "Parties prévues à l’avance" },
  { key: "SPONTANEOUS", label: "Parties improvisées" },
] as const;

type Option = { readonly key: string; readonly label: string };
const keys = (options: readonly Option[]) => options.map(option => option.key) as [string, ...string[]];
const list = (options: readonly Option[]) => z.array(z.enum(keys(options))).max(options.length).transform(values => [...new Set(values)]);

export const playerMatchingSchema = z.object({
  languages: list(PLAYER_LANGUAGES),
  playHabits: list(PLAY_HABITS),
  communityPreferences: list(COMMUNITY_PREFERENCES),
});

export type PlayerMatchingData = { languages: string[]; playHabits: string[]; communityPreferences: string[] };

export function labelsFor(options: readonly Option[], values: readonly string[]): string[] {
  return options.filter(option => values.includes(option.key)).map(option => option.label);
}

/** Filtres de la liste Potes : une seule valeur par critère, inconnue = requête invalide (jamais élargie). */
export const playerMatchingFiltersSchema = z.object({
  language: z.enum(["", ...keys(PLAYER_LANGUAGES)]).optional(),
  habit: z.enum(["", ...keys(PLAY_HABITS)]).optional(),
  preference: z.enum(["", ...keys(COMMUNITY_PREFERENCES)]).optional(),
  tagId: z.string().trim().max(191).optional(),
});
export type PlayerMatchingFilters = z.infer<typeof playerMatchingFiltersSchema>;

export function parsePlayerMatchingFilters(params: Record<string, string | string[] | undefined>) {
  const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  return playerMatchingFiltersSchema.safeParse({
    language: one(params.language), habit: one(params.habit), preference: one(params.preference), tagId: one(params.tagId),
  });
}

/** Conditions Prisma sur `User`, ajoutées aux gardes communautaires et de visibilité, jamais utilisées seules. */
export function playerMatchingUserWhere(filters: PlayerMatchingFilters) {
  return {
    ...(filters.language ? { languages: { has: filters.language } } : {}),
    ...(filters.habit ? { playHabits: { has: filters.habit } } : {}),
    ...(filters.preference ? { communityPreferences: { has: filters.preference } } : {}),
    ...(filters.tagId ? { userTags: { some: { tagId: filters.tagId } } } : {}),
  };
}

export type MatchingProfile = PlayerMatchingData & { availablePlatforms: string[]; tagIds: string[] };
export type CompatibilityInput = MatchingProfile & { userId: string; commonGames: number };
export type Compatibility = { userId: string; score: number; reasons: string[] };

const shared = (a: readonly string[], b: readonly string[]) => a.filter(value => b.includes(value)).length;

/**
 * Score de compatibilité, transparent et sans IA : jeux possédés en commun (3 points chacun, 5 jeux au plus),
 * langue commune (4), plateforme commune (2 chacune), habitude commune (1 chacune), ambiance commune (1 chacune),
 * centre d'intérêt commun (1 chacun). Les ambiances opposées (vocal / sans vocal) ne comptent pas comme communes.
 */
export function compatibility(viewer: MatchingProfile, candidate: CompatibilityInput): Compatibility {
  const reasons: string[] = [];
  const games = Math.min(candidate.commonGames, 5);
  const languages = shared(viewer.languages, candidate.languages);
  const platforms = shared(viewer.availablePlatforms, candidate.availablePlatforms);
  const habits = shared(viewer.playHabits, candidate.playHabits);
  const preferences = shared(viewer.communityPreferences, candidate.communityPreferences);
  const tags = shared(viewer.tagIds, candidate.tagIds);
  if (candidate.commonGames) reasons.push(`${candidate.commonGames} ${plural(candidate.commonGames, "jeu", "jeux")} en commun`);
  if (languages) reasons.push(labelsFor(PLAYER_LANGUAGES, viewer.languages.filter(value => candidate.languages.includes(value))).join(", "));
  if (platforms) reasons.push(`${platforms} ${plural(platforms, "plateforme")} en commun`);
  if (habits) reasons.push(labelsFor(PLAY_HABITS, viewer.playHabits.filter(value => candidate.playHabits.includes(value))).join(", "));
  if (preferences) reasons.push(labelsFor(COMMUNITY_PREFERENCES, viewer.communityPreferences.filter(value => candidate.communityPreferences.includes(value))).join(", "));
  if (tags) reasons.push(`${tags} ${plural(tags, "centre")} d’intérêt en commun`);
  const score = games * 3 + (languages ? 4 : 0) + platforms * 2 + habits + preferences + tags;
  return { userId: candidate.userId, score, reasons };
}

export const COMPATIBLE_PARTNERS_LIMIT = 5;

/**
 * Partenaires proposés : au moins un jeu en commun ET un autre point commun, meilleurs scores d'abord.
 * Les candidats doivent déjà être filtrés par l'appelant (même communauté, profil visible).
 */
export function suggestCompatiblePartners(viewer: MatchingProfile, candidates: readonly CompatibilityInput[], limit = COMPATIBLE_PARTNERS_LIMIT): Compatibility[] {
  return candidates
    .filter(candidate => candidate.commonGames > 0)
    .map(candidate => compatibility(viewer, candidate))
    .filter(result => result.reasons.length >= 2)
    .sort((a, b) => b.score - a.score || a.userId.localeCompare(b.userId))
    .slice(0, limit);
}
