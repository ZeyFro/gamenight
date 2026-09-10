import { NextResponse } from "next/server";
import { finalizeSeasonIfDue } from "@/lib/seasons";
import { generateMonthlyRecapIfDue } from "@/lib/monthly-recap";
import { logger } from "@/lib/logger";
import { verifyCronRequest } from "@/lib/cron-auth";

/**
 * Sprint 4 (Recap mensuel Wrapped + Saisons mensuelles) — un seul cron
 * quotidien pour les deux tâches "mensuelles" du sprint, plutôt que deux
 * routes séparées : les deux ne font quelque chose qu'à une date précise
 * du mois (`finalizeSeasonIfDue` vérifie `endDate`, `generateMonthlyRecapIfDue`
 * vérifie "on est le 1er") et sont chacune un no-op silencieux le reste du
 * temps — inutile de payer deux appels externes cron-job.org par jour pour
 * ça. Même protection `CRON_SECRET` que les autres crons du projet.
 */
export async function GET(request: Request) {
  const auth = verifyCronRequest(request);
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.status === 503 ? "not_configured" : "unauthorized" },
      { status: auth.status }
    );
  }

  try {
    await finalizeSeasonIfDue();
  } catch (error) {
    logger.error("cron:monthly-tasks", error, { task: "finalizeSeasonIfDue" });
  }

  try {
    await generateMonthlyRecapIfDue();
  } catch (error) {
    logger.error("cron:monthly-tasks", error, { task: "generateMonthlyRecapIfDue" });
  }

  return NextResponse.json({ ok: true });
}
