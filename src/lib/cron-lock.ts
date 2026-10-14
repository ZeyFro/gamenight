import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

/**
 * Verrou global inter-exécutions du cron `reminders` (fix bug remonté F7,
 * rappels Discord en double si deux exécutions du cron externe se
 * chevauchent — cron-job.org peut redéclencher avant la fin d'un run
 * précédent, notamment sur un retry après un timeout apparent côté
 * appelant alors que la route continue de tourner côté Vercel). Une seule
 * ligne singleton `CronLock` (name = "reminders"), créée par la migration
 * `20260914120000_add_cron_lock` — PAS par le seed quotidien/décorrélé
 * (`runSeedReconciliation`), qui ne tourne qu'après coup et jamais
 * automatiquement au déploiement (voir cette migration pour le détail du
 * raisonnement). La route (`src/app/api/cron/reminders/route.ts`) échoue
 * explicitement ("fail closed") si l'acquisition échoue pour toute raison
 * autre qu'un verrou légitimement détenu par une autre exécution en
 * cours — jamais d'envoi de rappels sans protection.
 *
 * Bail (TTL) = 90s, dérivé du `maxDuration` EXPLICITE de 60s déclaré sur
 * les routes qui prennent ce verrou (`reminders`, et comme elles les routes
 * de backfill IGDB/Steam/actus) + 30s de marge pour la latence réseau Neon
 * et un éventuel écart d'horloge : PAS une valeur devinée. Ce 60s est un
 * choix de route, pas le plafond du plan (défaut et maximum Vercel : 300s
 * sur Hobby avec Fluid compute). Une exécution qui dépasserait 60s est
 * tuée par la plateforme, donc un verrou plus vieux que ce bail ne peut
 * correspondre qu'à une exécution déjà morte.
 *
 * Limite assumée et documentée (pas de solution — impossible avec un
 * simple verrou à bail sans mécanisme de renouvellement/heartbeat, hors
 * scope de ce fix) : si une exécution dépasse elle-même le bail (dans les
 * faits jamais plus de 60s, le `maxDuration` de la route), une exécution suivante
 * peut reprendre la main AVANT que la première ne se termine — un
 * doublon Discord reste alors possible pour les rappels encore en cours
 * d'envoi à ce moment précis. Le `token` garantit seulement qu'une
 * exécution ne peut jamais libérer LE VERROU D'UNE AUTRE — jamais qu'il
 * n'y ait qu'une seule exécution active à la fois en toutes
 * circonstances. Autre limite assumée : un rappel peut rester manqué si,
 * après un crash, la prochaine exécution qui réussit à acquérir le
 * verrou arrive après que `date` de la session soit déjà passée — le
 * filtre `date: { gt: now }` de la route l'exclut alors définitivement
 * (comportement inchangé par cette PR, déjà présent avant elle).
 */
export const CRON_LOCK_NAME = "reminders";
export const CRON_LOCK_LEASE_MS = 90_000;

/**
 * Pure — reflète exactement la condition utilisée par `acquireCronLock`
 * (`lockedAt` jamais posé, ou plus vieux que le bail). Extraite pour
 * rester testable sans mock Prisma, même limite/convention que
 * `src/lib/reminders.ts`.
 */
export function isLockAvailable(
  lockedAt: Date | null,
  now: Date,
  leaseMs: number = CRON_LOCK_LEASE_MS
): boolean {
  if (lockedAt === null) return true;
  return now.getTime() - lockedAt.getTime() > leaseMs;
}

export type CronLockAcquireResult =
  | { acquired: true; token: string }
  | { acquired: false; reason: "locked" }
  | { acquired: false; reason: "missing_row" };

/**
 * Tente d'acquérir le verrou de façon atomique — un seul `updateMany`
 * conditionné fait foi (même pattern que `claimSessionClose`/
 * `finalizeSeasonIfDue` : le `count` du résultat décide, jamais un
 * read-then-write séparé qui laisserait une fenêtre de course). En cas
 * d'échec, un `findUnique` sert UNIQUEMENT à choisir le bon diagnostic
 * (verrou légitimement détenu vs ligne absente) pour le log/la réponse —
 * la décision d'acquisition elle-même reste entièrement portée par
 * l'`updateMany` atomique ci-dessus.
 */
export async function acquireCronLock(
  name: string = CRON_LOCK_NAME,
  leaseMs: number = CRON_LOCK_LEASE_MS
): Promise<CronLockAcquireResult> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - leaseMs);
  const token = randomUUID();

  const claim = await prisma.cronLock.updateMany({
    where: {
      name,
      OR: [{ lockedAt: null }, { lockedAt: { lt: cutoff } }],
    },
    data: { lockedAt: now, token },
  });

  if (claim.count === 1) {
    return { acquired: true, token };
  }

  const row = await prisma.cronLock.findUnique({ where: { name } });
  if (!row) {
    logger.error(
      "cron-lock",
      `Ligne CronLock "${name}" absente — la migration qui la crée n'a probablement pas été appliquée.`
    );
    return { acquired: false, reason: "missing_row" };
  }

  return { acquired: false, reason: "locked" };
}

/**
 * Libère le verrou — SEULEMENT si `token` correspond encore au détenteur
 * actuel en base (comparaison serveur, jamais en mémoire) : une exécution
 * dont le bail a expiré et dont le verrou a déjà été repris par une
 * exécution plus récente ne doit jamais écraser ce nouveau verrou. Un
 * `count === 0` ici n'est pas une erreur en soi — ça signifie que ce run
 * a dépassé son propre bail et qu'une autre exécution tourne déjà ;
 * loggé en info pour rester visible, sans lever d'alerte.
 */
export async function releaseCronLock(
  token: string,
  name: string = CRON_LOCK_NAME
): Promise<void> {
  const released = await prisma.cronLock.updateMany({
    where: { name, token },
    data: { lockedAt: null, token: null },
  });
  if (released.count === 0) {
    logger.info(
      "cron-lock",
      `Verrou "${name}" déjà repris par une autre exécution (bail dépassé) — rien à libérer.`
    );
  }
}
