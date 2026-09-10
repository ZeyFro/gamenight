/**
 * Vérification d'accès partagée des routes cron/backfill (PR "Accès &
 * secrets") — remplace le bloc dupliqué dans 8 routes qui était fail-open :
 * `CRON_SECRET` absente de l'env laissait la route s'exécuter sans aucune
 * authentification (seul `/api/admin/force-relogin` faisait déjà le bon
 * choix, 503 route désactivée). Comportement cible, identique pour les 8 :
 * secret absent → 503 (route désactivée) ; en-tête absent/incorrect → 401
 * (déjà le cas avant) ; secret correct → exécution.
 */

export type CronAuthResult = { ok: true } | { ok: false; status: 401 | 503 };

/**
 * Logique pure — isolée de `Request`/`process.env` pour rester testable
 * sans mock (même limite/discipline que les PR précédentes : ce projet ne
 * mocke pas Prisma, ni `Request`).
 */
export function checkCronAuth(
  cronSecret: string | undefined,
  authHeader: string | null
): CronAuthResult {
  if (!cronSecret) return { ok: false, status: 503 };
  if (authHeader !== `Bearer ${cronSecret}`) return { ok: false, status: 401 };
  return { ok: true };
}

/** Wrapper pratique pour les routes — lit `process.env`/l'en-tête lui-même. */
export function verifyCronRequest(request: Request): CronAuthResult {
  return checkCronAuth(process.env.CRON_SECRET, request.headers.get("authorization"));
}
