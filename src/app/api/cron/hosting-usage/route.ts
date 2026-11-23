import { NextResponse } from "next/server";
import { verifyCronRequest } from "@/lib/cron-auth";
import { logger } from "@/lib/logger";
import { evaluateHostingUsage, isHostingAlertEnabled, readDatabaseSizeBytes } from "@/lib/hosting-usage";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Alerte avant saturation de l'hébergement gratuit (docs/HEBERGEMENT.md). Appelée une fois par jour par le service de
 * tâches externe (aucun cron créé automatiquement). Lecture seule : aucune écriture en base ni vers Discord.
 *
 * - 200 : la base est sous 70 % de sa limite de stockage (ou la mesure est inconnue) ;
 * - 503 `{status:"alert"}` : au-delà de 70 % (« warn ») ou 90 % (« critical ») : le moniteur externe (cron-job.org) traite
 *   tout code hors 2xx comme un échec et PRÉVIENT par e-mail, sans passer par Discord ;
 * - 503 `not_configured` / 401 : mêmes règles que les autres routes cron (`CRON_SECRET`). Éteint (`HOSTING_ALERT_ENABLED`
 *   absent) : `{enabled:false}` en 200 sans rien lire.
 * Le temps de calcul Neon n'est pas mesuré (voir `hosting-usage.ts`) : la réponse le rappelle dans `manual`.
 */
export async function GET(request: Request) {
  const auth = verifyCronRequest(request);
  if (!auth.ok) {
    if (auth.status === 503) return NextResponse.json({ error: "not_configured" }, { status: 503, headers: NO_STORE });
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }
  if (!isHostingAlertEnabled()) return NextResponse.json({ enabled: false }, { headers: NO_STORE });

  let storageBytes: number | null = null;
  const readErrors: string[] = [];
  try {
    storageBytes = await readDatabaseSizeBytes();
  } catch (error) {
    logger.error("cron:hosting-usage", error);
    readErrors.push("storage");
  }

  const report = evaluateHostingUsage({ storageBytes });
  const alert = report.level === "warn" || report.level === "critical";
  const summary = report.metrics.map((metric) => `${metric.key}=${metric.percent}%`);
  if (alert) logger.error("cron:hosting-usage", "Hébergement gratuit proche de la saturation.", { level: report.level, metrics: summary });
  else logger.info("cron:hosting-usage", "Hébergement sous les seuils.", { level: report.level, metrics: summary });
  return NextResponse.json({ status: alert ? "alert" : "ok", ...report, readErrors }, { status: alert ? 503 : 200, headers: NO_STORE });
}
