import { randomUUID } from "crypto";
import { after } from "next/server";
import { logger } from "@/lib/logger";

/**
 * Déclenchement de l'executor par événement (budget Neon Free) : au lieu
 * d'attendre le cron de 1 min, toute écriture d'une livraison demande un
 * passage de `runExecutorBatch` juste APRÈS la réponse de la requête en
 * cours (`after()`, Next.js). Le cron `/api/cron/notification-executor`
 * reste le filet de sécurité : il reprend les retries (backoff 1 à 30 min),
 * les éditions différées derrière un envoi non terminé et tout kick perdu.
 *
 * Meilleur effort : ne casse JAMAIS la mutation métier qui a enqueué. Un
 * échec est journalisé (jamais silencieux) ; la livraison reste PENDING et le
 * cron la reprend.
 *
 * - Hors `NOTIFICATION_EXECUTOR_ENABLED=true` (même garde que la route cron) :
 *   aucun effet, aucune requête.
 * - Une seule demande en attente par instance : un lot d'invitations ou une
 *   rafale d'enqueue ne planifie qu'un passage. L'indicateur est levé AU
 *   DÉBUT du passage, donc une livraison écrite pendant qu'il tourne en
 *   obtient un nouveau (l'executor est sûr en concurrence : bail,
 *   `FOR UPDATE SKIP LOCKED`).
 * - Appelé hors requête (script, test) : `after()` jette, on le journalise
 *   en info et le cron prend le relais.
 *
 * Imports dynamiques : `notification-dispatch` importe tous les résolveurs,
 * qui importent `notification-delivery`, qui importe ce module. En statique
 * ce serait un cycle.
 */
const PENDING_TTL_MS = 60_000;
let scheduledAt = 0;

export function kickNotificationExecutor(): void {
  if (process.env.NOTIFICATION_EXECUTOR_ENABLED !== "true") return;
  if (Date.now() - scheduledAt < PENDING_TTL_MS) return;
  scheduledAt = Date.now();
  try {
    after(runKickedBatch);
  } catch (error) {
    scheduledAt = 0;
    if (error instanceof Error && error.message.includes("outside a request scope")) {
      logger.info("executor-kick", "Hors requête : le cron prendra la livraison.");
    } else {
      logger.error("executor-kick", error, { effect: "cron_fallback" });
    }
  }
}

async function runKickedBatch(): Promise<void> {
  scheduledAt = 0;
  try {
    const [{ runExecutorBatch }, { DISPATCH_RESOLVER }] = await Promise.all([
      import("@/lib/notification-executor"),
      import("@/lib/notification-dispatch"),
    ]);
    const summary = await runExecutorBatch({ resolver: DISPATCH_RESOLVER, owner: `event:${randomUUID()}` });
    logger.info("executor-kick", "Batch terminé.", { ...summary });
  } catch (error) {
    logger.error("executor-kick", error, { effect: "cron_fallback" });
  }
}

/** Remise à zéro de l'état d'instance — tests uniquement. */
export function resetNotificationExecutorKickForTests(): void {
  scheduledAt = 0;
}
