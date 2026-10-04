import { NextResponse } from "next/server";
import { verifyCronRequest } from "@/lib/cron-auth";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * Sonde de santé pour un monitoring externe (cron-job.org, UptimeRobot…) :
 * répond 200 si l'app tourne ET que la base répond à un `SELECT 1`, 503 sinon.
 *
 * Même authentification que les routes cron (`verifyCronRequest` : `CRON_SECRET`
 * absente → 503 route désactivée, en-tête absent/incorrect → 401) : une sonde
 * publique réveillerait Neon à chaque requête anonyme. Ne renvoie aucun secret,
 * aucune variable d'environnement, aucune donnée métier.
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
    await prisma.$queryRaw`SELECT 1`;
  } catch (error) {
    logger.error("health", error);
    return NextResponse.json({ ok: false, db: "error" }, { status: 503 });
  }

  return NextResponse.json({ ok: true, db: "ok" });
}
