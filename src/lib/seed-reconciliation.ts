import { logger } from "@/lib/logger";
import { seedDefaultMessages } from "@/lib/seed-messages";
import { fixInvalidMessageTemplates } from "@/lib/fix-invalid-templates";
import { backfillXp } from "@/lib/backfill-xp";
import { backfillUserColors } from "@/lib/backfill-user-colors";
import { seedGameStats } from "@/lib/seed-game-stats";
import { seedSuperlatives } from "@/lib/seed-superlatives";
import { seedBadges } from "@/lib/seed-badges";
import { backfillBadges } from "@/lib/backfill-badges";
import { seedTags } from "@/lib/seed-tags";
import { seedGroupAchievements } from "@/lib/seed-group-achievements";
import { seedInitialSeason } from "@/lib/seed-season";
import { ensureDefaultCommunity } from "@/lib/default-community";

/**
 * PR "build ne fait plus que compiler" — regroupe les 11 anciens scripts
 * `npm run build` (`prisma/*.mjs`) désormais sortis du build, appelée
 * depuis `POST /api/backfill/seed-reconcile` (cron quotidien externe +
 * curl manuel).
 *
 * Chaque tâche dans son propre try/catch : un échec de l'une n'empêche
 * JAMAIS les 10 autres de s'exécuter (contraste volontaire avec le
 * comportement précédent, où une exception dans n'importe lequel de ces
 * scripts bloquait `next build`, donc le déploiement entier). Ordre
 * IDENTIQUE à l'ancien `npm run build` — une seule dépendance réelle entre
 * deux tâches (`backfillBadges` a besoin des `Badge` déjà créés par
 * `seedBadges`), préservée en gardant les deux dans CETTE fonction plutôt
 * que dans deux routes séparées qui pourraient être appelées dans le
 * désordre.
 *
 * Toutes les tâches sont idempotentes (vérifié à la conversion, cf. PR) —
 * aucun marqueur "déjà fait" nécessaire, le coût d'un passage à vide
 * (aucune tâche n'a quoi que ce soit à faire) est négligeable.
 */

/** "skipped" : budget de temps épuisé avant cette tâche (reprise au prochain passage, tout est idempotent). */
type TaskResult = "ok" | "error" | "skipped";

/**
 * Budget interne (maxDuration = 300 s sur la route, Hobby + Fluid compute) :
 * vérifié ENTRE les tâches seulement — une tâche n'est jamais interrompue.
 */
export const SEED_RECONCILE_TIME_BUDGET_MS = 240_000;

export interface SeedReconciliationSummary {
  stopReason: "completed" | "time_budget" | "error";
  durationMs: number;
  results: Record<SeedTaskName, TaskResult>;
}

const TASKS = [
  ["seedDefaultMessages", seedDefaultMessages],
  ["fixInvalidMessageTemplates", fixInvalidMessageTemplates],
  ["backfillXp", backfillXp],
  ["backfillUserColors", backfillUserColors],
  ["seedGameStats", seedGameStats],
  ["seedSuperlatives", seedSuperlatives],
  // Ordre figé : seedBadges AVANT backfillBadges (ce dernier a besoin des
  // Badge déjà créés — voir le commentaire en tête de fichier).
  ["seedBadges", seedBadges],
  ["backfillBadges", backfillBadges],
  ["seedTags", seedTags],
  ["seedGroupAchievements", seedGroupAchievements],
  ["seedInitialSeason", seedInitialSeason],
  // Multi-communautés (PR A) : communauté par défaut + Memberships des
  // utilisateurs qui n’en ont pas encore (idempotent, voir default-community.ts).
  ["ensureDefaultCommunity", ensureDefaultCommunity],
] as const;

export type SeedTaskName = (typeof TASKS)[number][0];

export async function runSeedReconciliation(
  opts: { budgetMs?: number } = {}
): Promise<SeedReconciliationSummary> {
  const budgetMs = opts.budgetMs ?? SEED_RECONCILE_TIME_BUDGET_MS;
  const startedAt = Date.now();
  const results = {} as Record<SeedTaskName, TaskResult>;
  const skipped: string[] = [];
  let anyError = false;
  logger.info("seed-reconcile", `début (${TASKS.length} tâches, budget ${budgetMs} ms)`);

  for (const [name, task] of TASKS) {
    if (Date.now() - startedAt > budgetMs) {
      results[name] = "skipped";
      skipped.push(name);
      continue;
    }
    // Un "début" sans "fin" correspondant dans les logs = exécution coupée par la plateforme.
    logger.info("seed-reconcile", `tâche ${name} début`);
    const taskStart = Date.now();
    try {
      await task();
      results[name] = "ok";
    } catch (error) {
      results[name] = "error";
      anyError = true;
      logger.error("seed-reconcile", error, { task: name });
    }
    logger.info("seed-reconcile", `tâche ${name} fin ${Date.now() - taskStart} ms ${results[name]}`);
  }

  const stopReason = skipped.length > 0 ? "time_budget" : anyError ? "error" : "completed";
  const durationMs = Date.now() - startedAt;
  const message = `fin stopReason=${stopReason} durée=${durationMs} ms sautées=[${skipped.join(",")}]`;
  if (stopReason === "time_budget") logger.warn("seed-reconcile", message);
  else logger.info("seed-reconcile", message);

  return { stopReason, durationMs, results };
}
