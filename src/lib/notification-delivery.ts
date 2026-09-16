import { Prisma } from "@prisma/client";
import type {
  DeliveryChannel,
  DeliveryOperation,
  DeliveryTransport,
  NotificationCategory,
  NotificationDelivery,
  NotificationEvent,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

/**
 * Même vérification que `isUniqueConstraintViolation` (`src/lib/xp-actions.ts`),
 * dupliquée volontairement plutôt qu'importée : ce module fondation ne doit
 * dépendre d'aucun module métier (XP, level-up...) pour une seule fonction
 * de 3 lignes — garde ce socle livraison isolable/testable indépendamment
 * du reste de l'app.
 */
function isUniqueConstraintViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/**
 * Refonte notifications Discord — fondations de livraison (PR 1/N).
 *
 * Ce module ne parle JAMAIS à Discord et n'est appelé par AUCUN code
 * existant : c'est uniquement le socle transactionnel sur lequel les PR
 * suivantes brancheront un vrai client (webhook puis bot), catégorie par
 * catégorie. Voir `prisma/schema.prisma` (modèles `NotificationEvent`/
 * `NotificationDelivery`) pour le détail des colonnes et le README pour la
 * procédure de validation.
 *
 * Cycle de vie d'une livraison, dans cet ordre, TOUJOURS porté par
 * l'appelant (un futur exécuteur, jamais ce module) :
 *   1. `enqueueDelivery` — écrit l'intention en base, dans la même
 *      transaction que la mutation métier si possible (best-effort côté
 *      Discord ne doit jamais dépendre de la réussite du webhook/bot).
 *   2. `claimNextDelivery` — réserve une livraison PENDING due, de façon
 *      atomique, exclusive par (targetSlot, operation). RETOURNE avant tout
 *      appel réseau : aucune transaction SQL n'est jamais tenue ouverte
 *      pendant l'appel Discord qui doit suivre côté appelant.
 *   3. L'appelant effectue l'appel HTTP Discord (hors de ce module, hors de
 *      toute transaction).
 *   4. `finalizeDeliverySuccess` / `finalizeDeliveryFailure` — clôture
 *      conditionnée au `reservedBy` : si la réservation a expiré entre
 *      temps (crash, lenteur), la finalisation échoue silencieusement
 *      (retourne `false`) plutôt que d'écraser l'état repris par un autre
 *      propriétaire.
 *
 * Récupération après interruption : `recoverExpiredReservations` doit être
 * appelée périodiquement (par un futur sweep, absent de cette PR) pour
 * repasser à PENDING les livraisons RESERVED dont le bail a expiré sans
 * finalisation — même mécanisme utilisé aussi bien par un envoi
 * synchrone (claim→send→finalize dans la même requête) que par un balayage
 * périodique (claim un lot→send chacun→finalize chacun).
 *
 * Limite assumée et non résolue ici (documentée, pas contournable sans
 * protocole transactionnel avec Discord, hors de portée) : pas de garantie
 * "exactement une fois" entre Postgres et Discord — si la réservation
 * expire ENTRE le moment où Discord a effectivement accepté le message et
 * celui où `finalizeDeliverySuccess` tente de le consigner, un autre
 * propriétaire peut reprendre la livraison et l'envoyer une seconde fois.
 * Risque résiduel accepté, borné par un bail court (`DEFAULT_LEASE_MS`).
 */

// Dérivé du plafond dur d'exécution du plan Vercel Hobby (60s, déjà utilisé
// tel quel par les routes cron existantes, ex. steam-library-full-sync) :
// un appel Discord (webhook ou bot REST, simple requête HTTP) ne devrait
// jamais s'approcher de cette limite. 30s laisse une marge d'au moins 2x
// avant le kill de la plateforme — pas une valeur devinée, même logique de
// dérivation que `CRON_LOCK_LEASE_MS` dans `src/lib/cron-lock.ts`.
export const DEFAULT_RESERVATION_LEASE_MS = 30_000;

export interface CreateEventInput {
  category: NotificationCategory;
  eventType: string;
  sourceId: string;
  /** Chaîne vide par défaut — voir le commentaire sur le modèle Prisma. */
  occurrence?: string;
}

/**
 * Idempotent : deux appels avec le même (category, eventType, sourceId,
 * occurrence) renvoient toujours le MÊME événement (celui déjà en base au
 * second appel), jamais un doublon — même idiome que `awardXp`
 * (`isUniqueConstraintViolation`, voir `src/lib/xp-actions.ts`) : on tente
 * la création, une violation de contrainte unique signifie juste que
 * l'événement existe déjà, auquel cas on le relit.
 */
export async function createNotificationEvent(
  input: CreateEventInput
): Promise<NotificationEvent> {
  const occurrence = input.occurrence ?? "";
  try {
    return await prisma.notificationEvent.create({
      data: {
        category: input.category,
        eventType: input.eventType,
        sourceId: input.sourceId,
        occurrence,
      },
    });
  } catch (error) {
    if (!isUniqueConstraintViolation(error)) throw error;
    const existing = await prisma.notificationEvent.findUnique({
      where: {
        category_eventType_sourceId_occurrence: {
          category: input.category,
          eventType: input.eventType,
          sourceId: input.sourceId,
          occurrence,
        },
      },
    });
    if (!existing) throw error;
    return existing;
  }
}

export interface EnqueueDeliveryInput {
  eventId: string;
  channel: DeliveryChannel;
  /** Choisi une fois pour toutes par l'appelant — jamais les deux transports
   * pour une même livraison, voir le commentaire sur le modèle Prisma. */
  transport: DeliveryTransport;
  operation?: DeliveryOperation;
  recipientKey: string;
  targetSlot: string;
}

/**
 * Idempotent sur `[eventId, channel, recipientKey, operation, targetSlot]` —
 * même philosophie que `createNotificationEvent` ci-dessus : ré-enqueue la
 * même intention ne crée jamais de doublon.
 */
export async function enqueueDelivery(
  input: EnqueueDeliveryInput
): Promise<NotificationDelivery> {
  const operation = input.operation ?? "SEND";
  try {
    return await prisma.notificationDelivery.create({
      data: {
        eventId: input.eventId,
        channel: input.channel,
        transport: input.transport,
        operation,
        recipientKey: input.recipientKey,
        targetSlot: input.targetSlot,
      },
    });
  } catch (error) {
    if (!isUniqueConstraintViolation(error)) throw error;
    const existing = await prisma.notificationDelivery.findUnique({
      where: {
        eventId_channel_recipientKey_operation_targetSlot: {
          eventId: input.eventId,
          channel: input.channel,
          recipientKey: input.recipientKey,
          operation,
          targetSlot: input.targetSlot,
        },
      },
    });
    if (!existing) throw error;
    return existing;
  }
}

/**
 * Abandonne (SKIPPED) toute livraison PENDING ou FAILED dès qu'une livraison
 * plus récente (sequence supérieure, même `targetSlot` + `operation`, pas
 * elle-même SKIPPED) existe — c'est le mécanisme d'"abandon des éditions
 * dépassées" : converger vers le dernier état connu plutôt que d'envoyer une
 * suite de messages intermédiaires périmés. `sequence` est un compteur
 * Postgres global (`SERIAL`), jamais recalculé côté app — ordre total,
 * atomique, sans les égalités possibles d'un `createdAt` à la milliseconde.
 *
 * Sûr à appeler à tout moment, y compris en concurrence avec un autre appel
 * ou avec `claimNextDelivery` : chaque ligne ne transitionne qu'une fois
 * (`WHERE status IN ('PENDING','FAILED')`), verrouillage ligne-par-ligne
 * standard de l'`UPDATE`, aucun besoin de `FOR UPDATE` explicite.
 *
 * Ne touche JAMAIS une ligne RESERVED : une livraison déjà en cours d'envoi
 * doit toujours pouvoir se finaliser normalement (succès ou échec) — la
 * supersession ne s'applique qu'à ce qui n'a pas encore été réservé.
 */
export async function supersedeStaleDeliveries(): Promise<number> {
  const skipped = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE "NotificationDelivery" AS d
    SET status = 'SKIPPED'
    WHERE d.status IN ('PENDING', 'FAILED')
      AND EXISTS (
        SELECT 1 FROM "NotificationDelivery" newer
        WHERE newer."targetSlot" = d."targetSlot"
          AND newer.operation = d.operation
          AND newer.sequence > d.sequence
          AND newer.status <> 'SKIPPED'
      )
    RETURNING d.id
  `;
  return skipped.length;
}

export interface ClaimOptions {
  leaseMs?: number;
  now?: Date;
}

// Nombre de candidats PENDING examinés par un appel de `claimNextDelivery`
// avant d'abandonner (retour `null`) si tous sont bloqués par le verrou
// advisory de leur cible — pas une limite de débit, juste un plafond de
// sécurité pour ne jamais boucler indéfiniment si un lot entier partage des
// cibles déjà réservées ailleurs.
const CLAIM_CANDIDATE_SCAN_LIMIT = 20;

interface ClaimCandidateRow {
  id: string;
  targetSlot: string;
  operation: string;
}

/**
 * Réserve, de façon atomique, AU PLUS UNE livraison PENDING due.
 *
 * Exclusivité par cible (correction demandée — une simple vérification
 * applicative "pas d'édition plus récente/déjà réservée" NE SUFFIT PAS :
 * deux transactions concurrentes peuvent toutes deux lire "aucune ligne
 * RESERVED" avant que l'une des deux n'ait committé la sienne, et réserver
 * chacune une livraison différente pour la MÊME cible — race vérifiée par
 * le test d'intégration correspondant avant ce correctif). La garantie
 * réelle vient d'un verrou advisory Postgres transactionnel,
 * `pg_try_advisory_xact_lock`, pris sur `hashtextextended(targetSlot ||
 * ':' || operation)` : contrairement à un `SELECT ... WHERE NOT EXISTS`,
 * c'est un verrou tenu par le moteur lui-même, visible immédiatement par
 * toute AUTRE transaction concurrente (pas seulement après COMMIT), non
 * bloquant (`_try_`, renvoie `false` sans attendre si déjà pris ailleurs),
 * et automatiquement relâché à la fin de la transaction — jamais besoin de
 * le libérer explicitement, y compris en cas d'erreur.
 *
 * Une seule courte transaction SQL (`prisma.$transaction`), UNIQUEMENT des
 * requêtes — aucun appel réseau Discord dedans : elle verrouille jusqu'à
 * `CLAIM_CANDIDATE_SCAN_LIMIT` candidats PENDING dus (`FOR UPDATE SKIP
 * LOCKED`, donc sans jamais bloquer sur des candidats déjà verrouillés par
 * un AUTRE claim en cours), puis parcourt ces candidats dans l'ordre et
 * réserve le premier dont le verrou advisory de cible est disponible —
 * s'arrête au premier succès. Si tous les candidats examinés sont bloqués
 * (verrou de cible déjà pris ailleurs), renvoie `null` : rien à réserver
 * MAINTENANT, pas une erreur.
 *
 * La réservation posée ici (`status`, `reservedBy`, `reservedUntil`) est un
 * état PERSISTÉ sur la ligne, committée à la fin de cette (courte)
 * transaction : elle survit donc à sa clôture, contrairement au verrou
 * advisory lui-même qui, lui, disparaît au commit — c'est voulu, il n'a
 * besoin d'exister que pendant l'arbitrage entre candidats concurrents.
 * L'appelant DOIT effectuer l'appel Discord APRÈS le retour de cette
 * fonction (jamais dans une transaction englobante), puis appeler
 * `finalizeDeliverySuccess`/`finalizeDeliveryFailure` avec le MÊME `owner`.
 */
export async function claimNextDelivery(
  owner: string,
  opts: ClaimOptions = {}
): Promise<NotificationDelivery | null> {
  const now = opts.now ?? new Date();
  const reservedUntil = new Date(now.getTime() + (opts.leaseMs ?? DEFAULT_RESERVATION_LEASE_MS));

  return prisma.$transaction(async (tx) => {
    // Un candidat à la fois (`LIMIT 1`), jamais un lot verrouillé d'un coup
    // (bug corrigé avant cette version : verrouiller tout un lot via
    // `FOR UPDATE SKIP LOCKED LIMIT N` fait qu'UN SEUL appel concurrent
    // rafle les N lignes, laissant les autres appels concurrents sans
    // aucun candidat à examiner — repéré par le test d'intégration "N
    // claims concurrents sur N cibles distinctes"). En reformulant en
    // scan ligne-par-ligne, chaque transaction concurrente ne verrouille
    // QUE la ligne qu'elle examine réellement, ce qui restaure le
    // comportement file-d'attente standard de `SKIP LOCKED` : N appels
    // concurrents sur N cibles indépendantes obtiennent chacun une ligne
    // différente dès leur premier essai. Les ids déjà examinés et rejetés
    // (verrou advisory de cible indisponible) sont exclus des essais
    // suivants, dans la même transaction.
    const excludedIds: string[] = [];
    for (let attempt = 0; attempt < CLAIM_CANDIDATE_SCAN_LIMIT; attempt++) {
      const [candidate] = await tx.$queryRaw<ClaimCandidateRow[]>`
        SELECT id, "targetSlot", operation
        FROM "NotificationDelivery"
        WHERE status = 'PENDING'
          AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= ${now})
          AND id <> ALL(${excludedIds}::text[])
        ORDER BY "createdAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      `;
      if (!candidate) return null;

      const lockKey = `${candidate.targetSlot}:${candidate.operation}`;
      const [{ locked }] = await tx.$queryRaw<{ locked: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(hashtextextended(${lockKey}, 0)) AS locked
      `;
      if (!locked) {
        excludedIds.push(candidate.id);
        continue;
      }

      return tx.notificationDelivery.update({
        where: { id: candidate.id },
        data: {
          status: "RESERVED",
          reservedBy: owner,
          reservedUntil,
          attempts: { increment: 1 },
        },
      });
    }

    return null;
  });
}

export interface FinalizeSuccessInput {
  discordMessageId?: string;
  discordChannelId?: string;
  discordThreadId?: string;
}

/**
 * Clôture une livraison en succès — UNIQUEMENT si `reservedBy` correspond
 * encore exactement à `owner` (même garde que `releaseCronLock`, voir
 * `src/lib/cron-lock.ts`) : si le bail a expiré et qu'une autre exécution a
 * déjà repris la ligne (ou pire, l'a déjà finalisée), cet appel ne touche
 * rien et renvoie `false` plutôt que d'écraser un état plus récent.
 *
 * `false` en retour n'est pas forcément une erreur applicative — ça signifie
 * que ce propriétaire a perdu sa réservation. L'appelant doit le logguer
 * pour rester visible, sans jamais retenter l'envoi Discord dans la foulée
 * (le message a déjà été accepté par Discord à ce stade de l'appel).
 */
export async function finalizeDeliverySuccess(
  id: string,
  owner: string,
  refs: FinalizeSuccessInput = {}
): Promise<boolean> {
  const result = await prisma.notificationDelivery.updateMany({
    where: { id, status: "RESERVED", reservedBy: owner },
    data: {
      status: "SENT",
      sentAt: new Date(),
      reservedBy: null,
      reservedUntil: null,
      discordMessageId: refs.discordMessageId,
      discordChannelId: refs.discordChannelId,
      discordThreadId: refs.discordThreadId,
    },
  });
  if (result.count === 0) {
    logger.warn("notification-delivery", "Finalisation succès orpheline (réservation déjà reprise ou expirée)", {
      id,
      owner,
    });
  }
  return result.count === 1;
}

export interface FinalizeFailureInput {
  /** `true` pour un échec transitoire (réseau, 5xx, 429) → retour à PENDING
   * avec backoff. `false` pour un échec non-retryable (token invalide,
   * permission refusée) ou des tentatives épuisées → FAILED terminal. */
  retryable: boolean;
  errorClass: string;
  lastError?: string;
  /** Requis quand `retryable` est `true` — ignoré sinon. */
  nextAttemptAt?: Date;
}

/**
 * Clôture une livraison en échec — même garde `reservedBy` que
 * `finalizeDeliverySuccess`. Un échec retryable repasse la ligne à PENDING
 * (jamais un statut FAILED intermédiaire) avec `nextAttemptAt` : c'est ce
 * qui la rend de nouveau sélectionnable par `claimNextDelivery`, sans état
 * transitoire supplémentaire à gérer.
 */
export async function finalizeDeliveryFailure(
  id: string,
  owner: string,
  input: FinalizeFailureInput
): Promise<boolean> {
  const result = await prisma.notificationDelivery.updateMany({
    where: { id, status: "RESERVED", reservedBy: owner },
    data: input.retryable
      ? {
          status: "PENDING",
          reservedBy: null,
          reservedUntil: null,
          errorClass: input.errorClass,
          lastError: input.lastError,
          nextAttemptAt: input.nextAttemptAt,
        }
      : {
          status: "FAILED",
          reservedBy: null,
          reservedUntil: null,
          errorClass: input.errorClass,
          lastError: input.lastError,
        },
  });
  if (result.count === 0) {
    logger.warn("notification-delivery", "Finalisation échec orpheline (réservation déjà reprise ou expirée)", {
      id,
      owner,
    });
  }
  return result.count === 1;
}

/**
 * Repasse à PENDING les livraisons RESERVED dont le bail a expiré sans
 * jamais avoir été finalisées (crash, timeout, exécution tuée par la
 * plateforme) — les rend de nouveau sélectionnables par
 * `claimNextDelivery`. Un simple `updateMany` conditionné suffit ici (pas
 * besoin de `FOR UPDATE SKIP LOCKED` : aucune décision n'est prise à partir
 * d'une lecture préalable, la condition du `WHERE` est directement celle de
 * l'écriture).
 */
export async function recoverExpiredReservations(now: Date = new Date()): Promise<number> {
  const result = await prisma.notificationDelivery.updateMany({
    where: { status: "RESERVED", reservedUntil: { lt: now } },
    data: { status: "PENDING", reservedBy: null, reservedUntil: null },
  });
  return result.count;
}
