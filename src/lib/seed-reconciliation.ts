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

type TaskResult = "ok" | "error";

export interface SeedReconciliationSummary {
  seedDefaultMessages: TaskResult;
  fixInvalidMessageTemplates: TaskResult;
  backfillXp: TaskResult;
  backfillUserColors: TaskResult;
  seedGameStats: TaskResult;
  seedSuperlatives: TaskResult;
  seedBadges: TaskResult;
  backfillBadges: TaskResult;
  seedTags: TaskResult;
  seedGroupAchievements: TaskResult;
  seedInitialSeason: TaskResult;
}

async function runTask(name: string, task: () => Promise<void>): Promise<TaskResult> {
  try {
    await task();
    return "ok";
  } catch (error) {
    logger.error("seed-reconcile", error, { task: name });
    return "error";
  }
}

export async function runSeedReconciliation(): Promise<SeedReconciliationSummary> {
  return {
    seedDefaultMessages: await runTask("seedDefaultMessages", seedDefaultMessages),
    fixInvalidMessageTemplates: await runTask(
      "fixInvalidMessageTemplates",
      fixInvalidMessageTemplates
    ),
    backfillXp: await runTask("backfillXp", backfillXp),
    backfillUserColors: await runTask("backfillUserColors", backfillUserColors),
    seedGameStats: await runTask("seedGameStats", seedGameStats),
    seedSuperlatives: await runTask("seedSuperlatives", seedSuperlatives),
    // Ordre figé : seedBadges AVANT backfillBadges (ce dernier a besoin
    // des Badge déjà créés — voir le commentaire en tête de fichier).
    seedBadges: await runTask("seedBadges", seedBadges),
    backfillBadges: await runTask("backfillBadges", backfillBadges),
    seedTags: await runTask("seedTags", seedTags),
    seedGroupAchievements: await runTask("seedGroupAchievements", seedGroupAchievements),
    seedInitialSeason: await runTask("seedInitialSeason", seedInitialSeason),
  };
}
