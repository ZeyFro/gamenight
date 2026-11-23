import { z } from "zod";
import type { SteamAchievement } from "@/lib/steam";

// Validation automatique des défis « mesurables Steam » : règles pures, sans Steam ni base.

/** Fenêtre pendant laquelle un membre éligible peut signaler un doute avant le crédit des étages. */
export const TOWER_MEASURE_DOUBT_WINDOW_MS = 6 * 60 * 60 * 1000;
/** Une tentative n'est pas relue plus souvent (quota de l'API Steam). */
export const TOWER_MEASURE_CHECK_INTERVAL_MS = 10 * 60 * 1000;
/** Nombre maximal de tentatives mesurées par passage du cron, donc d'appels Steam. */
export const TOWER_MEASURE_BATCH_SIZE = 25;
/** Même ancienneté minimale que les votants (≥ 3 jours de Membership). */
export const TOWER_MEASURE_DOUBT_MIN_TENURE_MS = 3 * 24 * 60 * 60 * 1000;

export type MeasureKind = "STEAM_PLAYTIME" | "STEAM_ACHIEVEMENT";

export interface MeasuredAttempt {
  measureKind: MeasureKind;
  measureTarget: number;
  measureAchievement: string | null;
  measureBaseline: number | null;
  assignedAt: Date;
}

export type MeasureEvaluation =
  | { state: "NEEDS_BASELINE" }
  | { state: "WATCHING"; value: number }
  | { state: "ACHIEVED"; value: number };

/** Minutes jouées depuis l'attribution ; jamais négatif (Steam peut corriger un cumul à la baisse). */
export function playtimeDelta(baseline: number, current: number): number {
  if (!Number.isFinite(baseline) || !Number.isFinite(current)) throw new RangeError("Temps de jeu invalide");
  return Math.max(0, Math.trunc(current) - Math.trunc(baseline));
}

export function evaluatePlaytime(input: { baseline: number | null; current: number; target: number }): MeasureEvaluation {
  if (input.baseline === null) return { state: "NEEDS_BASELINE" };
  const value = playtimeDelta(input.baseline, input.current);
  return value >= input.target ? { state: "ACHIEVED", value } : { state: "WATCHING", value };
}

/**
 * Succès débloqués depuis l'attribution : seul un déblocage dont `unlocktime` est postérieur à l'attribution compte.
 * Avec `apiName`, ce succès précis doit être débloqué (valeur 1) ; sinon `target` succès au total.
 */
export function evaluateAchievements(input: {
  achievements: readonly SteamAchievement[];
  assignedAt: Date;
  target: number;
  apiName: string | null;
}): MeasureEvaluation {
  const since = Math.floor(input.assignedAt.getTime() / 1000);
  const unlocked = input.achievements.filter((achievement) => achievement.achieved && achievement.unlocktime >= since);
  if (input.apiName) {
    const done = unlocked.some((achievement) => achievement.apiname === input.apiName) ? 1 : 0;
    return done ? { state: "ACHIEVED", value: 1 } : { state: "WATCHING", value: 0 };
  }
  return unlocked.length >= input.target ? { state: "ACHIEVED", value: unlocked.length } : { state: "WATCHING", value: unlocked.length };
}

export function measureSummary(input: { kind: MeasureKind; value: number; target: number; achievement: string | null }): string {
  if (input.kind === "STEAM_PLAYTIME") {
    return "Mesure Steam automatique : " + input.value + " min de jeu depuis l'attribution (objectif : " + input.target + " min).";
  }
  return input.achievement
    ? "Mesure Steam automatique : le succès « " + input.achievement + " » a été débloqué depuis l'attribution."
    : "Mesure Steam automatique : " + input.value + " succès débloqué(s) depuis l'attribution (objectif : " + input.target + ").";
}

export type DoubtRefusal = "SELF_DOUBT" | "DOUBT_NOT_ACTIVE" | "DOUBT_TOO_RECENT" | "CLOSED";

/** Qui peut signaler un doute, et quand : membre actif depuis 3 jours, jamais l'auteur, fenêtre ouverte, un seul doute. */
export function canReportDoubt(input: {
  authorId: string;
  reporterId: string;
  reporterStatus: string | null | undefined;
  reporterJoinedAt: Date | null | undefined;
  autoValidatedAt: Date | null;
  doubtReportedAt: Date | null;
  now: Date;
}): { ok: true } | { ok: false; reason: DoubtRefusal } {
  if (input.authorId === input.reporterId) return { ok: false, reason: "SELF_DOUBT" };
  if (input.reporterStatus !== "ACTIVE" || !input.reporterJoinedAt) return { ok: false, reason: "DOUBT_NOT_ACTIVE" };
  if (input.now.getTime() - input.reporterJoinedAt.getTime() < TOWER_MEASURE_DOUBT_MIN_TENURE_MS) return { ok: false, reason: "DOUBT_TOO_RECENT" };
  if (!input.autoValidatedAt || input.doubtReportedAt) return { ok: false, reason: "CLOSED" };
  if (input.now.getTime() >= input.autoValidatedAt.getTime() + TOWER_MEASURE_DOUBT_WINDOW_MS) return { ok: false, reason: "CLOSED" };
  return { ok: true };
}

/** Crédit des étages : seulement une fois la fenêtre de doute écoulée sans signalement. */
export function isDoubtWindowOver(autoValidatedAt: Date, now: Date): boolean {
  return now.getTime() >= autoValidatedAt.getTime() + TOWER_MEASURE_DOUBT_WINDOW_MS;
}

export const isTowerSteamAutovalidateEnabled = (env: Record<string, string | undefined> = process.env) =>
  env.TOWER_STEAM_AUTOVALIDATE_ENABLED === "true";

/** Champs de mesure facultatifs d'une définition solo ; la cohérence d'ensemble est vérifiée par `isCoherentMeasure`. */
export const towerChallengeMeasureSchema = z.object({
  measureKind: z.enum(["STEAM_PLAYTIME", "STEAM_ACHIEVEMENT"]).optional(),
  measureAppId: z.number().int().min(1).max(2_000_000_000).optional(),
  measureTarget: z.number().int().min(1).max(100_000).optional(),
  measureAchievement: z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9_.-]+$/).optional(),
});

/** Tout ou rien, cohérent avec la contrainte SQL de la migration : le succès nommé n'existe que pour STEAM_ACHIEVEMENT. */
export function isCoherentMeasure(measure: z.infer<typeof towerChallengeMeasureSchema>): boolean {
  if (!measure.measureKind) {
    return measure.measureAppId === undefined && measure.measureTarget === undefined && measure.measureAchievement === undefined;
  }
  return measure.measureAppId !== undefined && measure.measureTarget !== undefined
    && (measure.measureKind === "STEAM_ACHIEVEMENT" || measure.measureAchievement === undefined);
}
