import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { isCspReportEnabled } from "@/lib/csp-policy";
import { summarizeCspReport } from "@/lib/csp-report";
import { logger } from "@/lib/logger";

/**
 * Collecte des violations CSP (`report-uri` de `src/lib/csp-policy.ts`).
 * Étape 1 du plan de `docs/rapport-csp-bloquant.md` : observer avant de bloquer.
 *
 * Point d'entrée PUBLIC (les navigateurs l'appellent sans session), donc borné :
 * - inerte (404) sans `CSP_REPORT_ENABLED=true` ;
 * - corps limité à 16 Ko, rejeté en 413 au-delà ;
 * - débit global limité (60 rapports / minute / instance), 429 au-delà ;
 * - rien n'est stocké en base : seule une ligne de log par rapport, réduite à
 *   quelques champs connus, tronqués, sans paramètres d'URL (`?…`, `#…`).
 */

const MAX_BODY_BYTES = 16 * 1024;
const RATE_LIMIT = { limit: 60, windowMs: 60_000 };

export async function POST(request: Request) {
  if (!isCspReportEnabled()) {
    return new NextResponse(null, { status: 404 });
  }

  if (!checkRateLimit("global", "csp-report", RATE_LIMIT)) {
    return new NextResponse(null, { status: 429 });
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return new NextResponse(null, { status: 413 });
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return new NextResponse(null, { status: 413 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new NextResponse(null, { status: 400 });
  }

  const summary = summarizeCspReport(payload);
  if (summary) {
    logger.warn("csp-report", "Violation CSP signalée par un navigateur.", summary);
  }
  return new NextResponse(null, { status: 204 });
}
