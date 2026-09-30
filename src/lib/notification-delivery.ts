import { randomUUID } from "crypto";
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
 *      atomique, exclusive par `targetSlot` (SEND/EDIT/ARCHIVE confondus).
 *      Abandonne au passage (SKIPPED) toute édition dépassée et diffère
 *      toute EDIT/ARCHIVE dont le SEND cible n'est pas encore SENT — les
 *      DEUX intégrées au chemin normal, jamais un appel séparé à espérer
 *      qu'un futur exécuteur n'oublie pas. RETOURNE avant tout appel
 *      réseau : aucune transaction SQL n'est jamais tenue ouverte pendant
 *      l'appel Discord qui doit suivre côté appelant.
 *   3. L'appelant effectue l'appel HTTP Discord (hors de ce module, hors de
 *      toute transaction) — voir `hasSufficientLeaseRemaining` plus bas
 *      pour le contrat de timeout attendu du futur client.
 *   4. `finalizeDeliverySuccess` / `finalizeDeliveryFailure` — clôture
 *      conditionnée au `reservationToken` obtenu à l'étape 2 (PAS à
 *      `reservedBy`, voir le commentaire du champ dans le schéma) : si la
 *      réservation a expiré et a été reprise entre-temps (crash, lenteur),
 *      la finalisation échoue silencieusement (retourne `false`) plutôt
 *      que d'écraser l'état repris par un autre propriétaire — même si ce
 *      nouveau propriétaire réutilise le même `owner`/`reservedBy`.
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
 * Risque résiduel accepté, borné par un bail court (`DEFAULT_RESERVATION_LEASE_MS`)
 * et réduit (jamais éliminé, voir `hasSufficientLeaseRemaining`) par la
 * discipline de timeout attendue du futur appelant.
 */

// Dérivé du plafond dur d'exécution du plan Vercel Hobby (60s, déjà utilisé
// tel quel par les routes cron existantes, ex. steam-library-full-sync) :
// un appel Discord (webhook ou bot REST, simple requête HTTP) ne devrait
// jamais s'approcher de cette limite. 30s laisse une marge d'au moins 2x
// avant le kill de la plateforme — pas une valeur devinée, même logique de
// dérivation que `CRON_LOCK_LEASE_MS` dans `src/lib/cron-lock.ts`.
export const DEFAULT_RESERVATION_LEASE_MS = 30_000;

/**
 * Contrat pour le futur client Discord (PR suivante, PAS implémentée ici) :
 * avant d'effectuer l'appel réseau vers Discord, l'appelant DOIT vérifier
 * le temps restant sur le bail de sa réservation (`reservedUntil - now`) et
 * n'engager l'appel que s'il en reste plus que `marginMs` — cette marge
 * couvre le round-trip de finalisation lui-même (`finalizeDeliverySuccess`/
 * `finalizeDeliveryFailure`), pas seulement l'appel Discord. Le timeout HTTP
 * du client (`AbortSignal.timeout`) doit lui-même être borné au temps
 * restant moins cette marge, jamais au-delà — même logique que les 6s de
 * timeout Steam sous un budget de 45s (`src/lib/steam.ts`).
 *
 * Si le temps restant est insuffisant, l'appelant ne doit PAS tenter
 * l'appel : traiter comme un échec retryable immédiat
 * (`finalizeDeliveryFailure` avec `retryable: true`) plutôt que de risquer
 * un appel qui dépasse le bail en cours de route.
 *
 * Cette fonction RÉDUIT la fenêtre du risque documenté plus haut, elle ne
 * L'ÉLIMINE PAS : un appel engagé à temps peut quand même dépasser le bail
 * si Discord répond lentement (réseau, rate limit) — la limite
 * "pas d'exactement une fois" reste entière dans ce cas.
 */
export const MIN_CALL_MARGIN_MS = 5_000;

export function hasSufficientLeaseRemaining(
  reservedUntil: Date,
  now: Date = new Date(),
  marginMs: number = MIN_CALL_MARGIN_MS
): boolean {
  return reservedUntil.getTime() - now.getTime() > marginMs;
}

/**
 * Client accepté par `createNotificationEvent`/`enqueueDelivery` — soit le
 * client global `prisma` (comportement historique, inchangé si l'appelant
 * ne passe rien), soit un client de transaction (`tx`, voir
 * `prisma.$transaction`), pour que l'appelant puisse enfin enregistrer
 * l'intention de notification DANS LA MÊME transaction SQL que sa
 * mutation métier — documenté comme l'intention depuis #95 (voir le
 * commentaire de fichier plus haut, "dans la même transaction que la
 * mutation métier si possible") mais jamais rendu possible jusqu'ici : les
 * deux fonctions utilisaient inconditionnellement le client global, quel
 * que soit l'appelant, empêchant structurellement cette composition.
 * Volontairement un `Pick` structurel (pas `PrismaClient` ni
 * `Prisma.TransactionClient` explicitement) : les deux types exposent la
 * même forme pour `notificationEvent`/`notificationDelivery`, donc les
 * deux sont assignables ici sans dépendre d'un type interne Prisma fragile
 * d'une version à l'autre.
 */
export type NotificationDb = Pick<typeof prisma, "notificationEvent" | "notificationDelivery">;

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
 *
 * `db` optionnel (défaut : client global) — voir `NotificationDb`. Passer
 * un `tx` compose cette écriture avec la mutation métier de l'appelant
 * dans la MÊME transaction ; la logique de retry idempotent ci-dessous
 * reste valide à l'identique dans les deux cas (une violation de
 * contrainte unique DANS une transaction se comporte comme hors
 * transaction pour ce genre de retry en lecture seule).
 */
export async function createNotificationEvent(
  input: CreateEventInput,
  db: NotificationDb = prisma
): Promise<NotificationEvent> {
  const occurrence = input.occurrence ?? "";
  try {
    return await db.notificationEvent.create({
      data: {
        category: input.category,
        eventType: input.eventType,
        sourceId: input.sourceId,
        occurrence,
      },
    });
  } catch (error) {
    if (!isUniqueConstraintViolation(error)) throw error;
    const existing = await db.notificationEvent.findUnique({
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
  /** Voir le commentaire du champ dans `prisma/schema.prisma` pour le
   * format attendu (`<guildId>:<category>:<sourceId>:<rôle>`) — une valeur
   * = un message Discord physique précis, jamais partagée entre deux
   * messages distincts (ex. deux rappels différents de la même soirée
   * doivent avoir des `targetSlot` différents, pas le même). */
  targetSlot: string;
}

/**
 * Idempotent sur `[eventId, channel, recipientKey, operation, targetSlot]` —
 * même philosophie que `createNotificationEvent` ci-dessus : ré-enqueue la
 * même intention ne crée jamais de doublon.
 *
 * `db` optionnel (défaut : client global) — voir `NotificationDb`, même
 * contrat que `createNotificationEvent`.
 */
export async function enqueueDelivery(
  input: EnqueueDeliveryInput,
  db: NotificationDb = prisma
): Promise<NotificationDelivery> {
  const operation = input.operation ?? "SEND";
  try {
    return await db.notificationDelivery.create({
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
    const existing = await db.notificationDelivery.findUnique({
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
 * elle-même SKIPPED) existe. Comparaison scopée PAR OPÉRATION (contrairement
 * à l'exclusivité de réservation, scopée par `targetSlot` seul, voir
 * `claimNextDelivery`) : seules deux lignes de la MÊME opération sont des
 * "versions successives du même contenu" comparables — un SEND n'est
 * jamais périmé par une EDIT, ni l'inverse. Deux `targetSlot` différents
 * (ex. deux rappels distincts de la même soirée) ne sont jamais comparés
 * entre eux non plus, par construction (`newer."targetSlot" = d."targetSlot"`).
 *
 * `sequence` est un compteur Postgres global (`SERIAL`), jamais recalculé
 * côté app — ordre total, atomique, sans les égalités possibles d'un
 * `createdAt` à la milliseconde.
 *
 * DEVENU UN UTILITAIRE DE MAINTENANCE, PAS UNE CONDITION DE CORRECTION :
 * `claimNextDelivery` applique désormais cette même règle lui-même, à
 * chaque candidat examiné, avant de réserver — la correction ne dépend
 * plus d'un appel séparé à cette fonction. L'appeler périodiquement reste
 * utile pour nettoyer en lot les lignes périmées qui ne seraient sinon
 * jamais examinées par un claim (au-delà de `CLAIM_CANDIDATE_SCAN_LIMIT`).
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
// avant d'abandonner (retour `null`) si tous sont bloqués (verrou de cible
// pris ailleurs, réservation active concurrente, dépendance SEND non
// remplie...) — pas une limite de débit, juste un plafond de sécurité pour
// ne jamais boucler indéfiniment.
const CLAIM_CANDIDATE_SCAN_LIMIT = 20;

interface ClaimCandidateRow {
  id: string;
  targetSlot: string;
  operation: string;
  sequence: number;
}

interface TargetMessageRow {
  discordMessageId: string | null;
  discordChannelId: string | null;
  discordThreadId: string | null;
}

export interface TargetMessageRef {
  discordMessageId: string;
  discordChannelId: string | null;
  discordThreadId: string | null;
}

export interface ClaimedDelivery extends NotificationDelivery {
  /** Résolu au moment du claim pour EDIT/ARCHIVE — référence du message
   * Discord déjà envoyé (SEND au statut SENT pour le même `targetSlot`)
   * que cette opération doit cibler. Toujours `null` pour un SEND. Jamais
   * persisté sur la ligne elle-même : dérivé à chaque claim pour éviter
   * une donnée dupliquée/potentiellement périmée en base. */
  targetMessage: TargetMessageRef | null;
}

/**
 * Réserve, de façon atomique, AU PLUS UNE livraison PENDING due.
 *
 * Exclusivité par cible — CORRIGÉE (audit avant merge #95) : la version
 * précédente n'utilisait qu'un verrou advisory Postgres transactionnel
 * (`pg_try_advisory_xact_lock`), relâché au COMMIT. Ça arbitrait
 * correctement deux réservations STRICTEMENT SIMULTANÉES (deux
 * transactions concurrentes ne peuvent jamais réserver la même cible en
 * même temps), mais ne protégeait PAS deux réservations SÉQUENTIELLES :
 * une fois la première transaction committée, le verrou est libre, et une
 * transaction ultérieure pouvait réserver une AUTRE ligne PENDING pour la
 * MÊME cible sans qu'aucune vérification ne l'en empêche — reproduit à la
 * main via `psql` avant ce correctif (deux lignes `RESERVED`
 * simultanément pour le même `targetSlot`, voir le README pour la trace
 * complète). Corrigé en ajoutant, SOUS le verrou advisory, une vérification
 * explicite qu'aucune réservation active n'existe déjà pour la cible — le
 * verrou advisory sert maintenant UNIQUEMENT à sérialiser cette
 * vérification entre transactions concurrentes (empêcher que deux
 * transactions la fassent en même temps et concluent toutes deux "libre"),
 * la garantie d'exclusivité elle-même vient de la vérification, pas du
 * verrou. Résultat : exclusivité valable entre réservations SIMULTANÉES
 * ET SÉQUENTIELLES.
 *
 * Portée de l'exclusivité — SEND, EDIT et ARCHIVE visant le MÊME
 * `targetSlot` s'excluent désormais mutuellement (clé du verrou advisory =
 * `targetSlot` seul, plus `targetSlot:operation` comme avant) : ce sont
 * trois opérations sur le même message physique. Deux `targetSlot`
 * différents (ex. annonce et fil d'une même soirée) restent entièrement
 * indépendants.
 *
 * Édition dépassée — intégrée au chemin de réservation lui-même (pas un
 * appel séparé à `supersedeStaleDeliveries`, voir son commentaire) :
 * chaque candidat est d'abord vérifié contre une livraison plus récente de
 * la MÊME opération sur la MÊME cible ; si une existe, ce candidat est
 * marqué SKIPPED immédiatement et le scan continue sans jamais le réserver.
 *
 * Dépendance EDIT/ARCHIVE → SEND — une EDIT ou une ARCHIVE ne devient
 * réclamable qu'une fois le SEND correspondant (même `targetSlot`) au
 * statut SENT ; sinon le candidat est différé (laissé PENDING, retenté à
 * un futur claim), jamais marqué en erreur. Si la dépendance est remplie,
 * la référence du message ciblé (`discordMessageId`/`discordChannelId`/
 * `discordThreadId` du SEND) est résolue et renvoyée dans
 * `targetMessage`, pour que l'appelant n'ait pas à refaire cette requête.
 *
 * Une seule courte transaction SQL (`prisma.$transaction`), UNIQUEMENT des
 * requêtes — aucun appel réseau Discord dedans : elle examine jusqu'à
 * `CLAIM_CANDIDATE_SCAN_LIMIT` candidats PENDING dus (`FOR UPDATE SKIP
 * LOCKED`, donc sans jamais bloquer sur des candidats déjà verrouillés par
 * un AUTRE claim en cours), s'arrête au premier réservé avec succès.
 *
 * La réservation posée ici (`status`, `reservedBy`, `reservationToken`,
 * `reservedUntil`) est un état PERSISTÉ sur la ligne, committé à la fin de
 * cette (courte) transaction. L'appelant DOIT effectuer l'appel Discord
 * APRÈS le retour de cette fonction (jamais dans une transaction
 * englobante — voir `hasSufficientLeaseRemaining` pour le contrat de
 * timeout attendu), puis appeler `finalizeDeliverySuccess`/
 * `finalizeDeliveryFailure` avec le `reservationToken` retourné ICI (PAS
 * `owner`, voir le commentaire du champ dans le schéma).
 */
export async function claimNextDelivery(
  owner: string,
  opts: ClaimOptions = {}
): Promise<ClaimedDelivery | null> {
  const now = opts.now ?? new Date();
  const reservedUntil = new Date(now.getTime() + (opts.leaseMs ?? DEFAULT_RESERVATION_LEASE_MS));

  return prisma.$transaction(async (tx) => {
    const excludedIds: string[] = [];
    for (let attempt = 0; attempt < CLAIM_CANDIDATE_SCAN_LIMIT; attempt++) {
      // Un candidat à la fois (`LIMIT 1`), jamais un lot verrouillé d'un
      // coup (bug corrigé avant la version précédente : verrouiller tout
      // un lot via `FOR UPDATE SKIP LOCKED LIMIT N` fait qu'un seul appel
      // concurrent rafle les N lignes). Le scan ligne-par-ligne restaure
      // le comportement file-d'attente standard de `SKIP LOCKED`.
      const [candidate] = await tx.$queryRaw<ClaimCandidateRow[]>`
        SELECT id, "targetSlot", operation, sequence
        FROM "NotificationDelivery"
        WHERE status = 'PENDING'
          AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= ${now})
          AND id <> ALL(${excludedIds}::text[])
        ORDER BY sequence ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      `;
      if (!candidate) return null;

      // 1) Édition dépassée — converge vers le dernier état plutôt que
      // d'envoyer une étape intermédiaire périmée.
      const [staled] = await tx.$queryRaw<{ id: string }[]>`
        UPDATE "NotificationDelivery"
        SET status = 'SKIPPED'
        WHERE id = ${candidate.id}
          AND EXISTS (
            SELECT 1 FROM "NotificationDelivery" newer
            WHERE newer."targetSlot" = ${candidate.targetSlot}
              AND newer.operation = ${candidate.operation}::"DeliveryOperation"
              AND newer.sequence > ${candidate.sequence}
              AND newer.status <> 'SKIPPED'
          )
        RETURNING id
      `;
      if (staled) {
        excludedIds.push(candidate.id);
        continue;
      }

      // 2) Exclusivité par cible. Le verrou advisory arbitre d'abord les
      // réservations SIMULTANÉES (une seule transaction concurrente peut
      // le détenir à la fois pour cette cible) ; la vérification explicite
      // qui suit, faite SOUS ce verrou, couvre le cas SÉQUENTIEL (voir
      // commentaire de la fonction).
      const [{ locked }] = await tx.$queryRaw<{ locked: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(hashtextextended(${candidate.targetSlot}, 0)) AS locked
      `;
      if (!locked) {
        excludedIds.push(candidate.id);
        continue;
      }

      const [{ conflict }] = await tx.$queryRaw<{ conflict: boolean }[]>`
        SELECT EXISTS (
          SELECT 1 FROM "NotificationDelivery"
          WHERE "targetSlot" = ${candidate.targetSlot}
            AND status = 'RESERVED'
        ) AS conflict
      `;
      if (conflict) {
        excludedIds.push(candidate.id);
        continue;
      }

      // 3) EDIT/ARCHIVE dépendent d'un SEND déjà SENT pour la même cible.
      let targetMessage: TargetMessageRef | null = null;
      if (candidate.operation !== "SEND") {
        const [sent] = await tx.$queryRaw<TargetMessageRow[]>`
          SELECT "discordMessageId", "discordChannelId", "discordThreadId"
          FROM "NotificationDelivery"
          WHERE "targetSlot" = ${candidate.targetSlot}
            AND operation = 'SEND'
            AND status = 'SENT'
          ORDER BY "sentAt" DESC
          LIMIT 1
        `;
        if (!sent || !sent.discordMessageId) {
          // Dépendance non remplie — PAS une erreur : différé, laissé
          // PENDING, retenté au prochain claim une fois le SEND terminé.
          excludedIds.push(candidate.id);
          continue;
        }
        targetMessage = {
          discordMessageId: sent.discordMessageId,
          discordChannelId: sent.discordChannelId,
          discordThreadId: sent.discordThreadId,
        };
      }

      const reservationToken = randomUUID();
      const updated = await tx.notificationDelivery.update({
        where: { id: candidate.id },
        data: {
          status: "RESERVED",
          reservedBy: owner,
          reservationToken,
          reservedUntil,
          attempts: { increment: 1 },
        },
      });
      return { ...updated, targetMessage };
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
 * Clôture une livraison en succès — UNIQUEMENT si `reservationToken`
 * correspond encore exactement à celui posé par `claimNextDelivery` (PAS
 * une comparaison sur `reservedBy` — voir le commentaire du champ dans le
 * schéma : deux réservations successives de la même ligne peuvent
 * partager le même `reservedBy` si le worker réutilise un identifiant
 * statique, mais ont TOUJOURS des `reservationToken` différents, générés
 * aléatoirement à chaque réservation). Si le bail a expiré et qu'une autre
 * exécution a déjà repris la ligne (ou pire, l'a déjà finalisée) entre
 * temps, cet appel ne touche rien et renvoie `false` plutôt que d'écraser
 * un état plus récent — même si son `reservedBy` est identique à celui du
 * nouveau propriétaire.
 *
 * `false` en retour n'est pas forcément une erreur applicative — ça signifie
 * que ce propriétaire a perdu sa réservation. L'appelant doit le logguer
 * pour rester visible, sans jamais retenter l'envoi Discord dans la foulée
 * (le message a déjà été accepté par Discord à ce stade de l'appel).
 */
export async function finalizeDeliverySuccess(
  id: string,
  reservationToken: string,
  refs: FinalizeSuccessInput = {}
): Promise<boolean> {
  const result = await prisma.notificationDelivery.updateMany({
    where: { id, status: "RESERVED", reservationToken },
    data: {
      status: "SENT",
      sentAt: new Date(),
      reservedBy: null,
      reservationToken: null,
      reservedUntil: null,
      discordMessageId: refs.discordMessageId,
      discordChannelId: refs.discordChannelId,
      discordThreadId: refs.discordThreadId,
    },
  });
  if (result.count === 0) {
    logger.warn(
      "notification-delivery",
      "Finalisation succès orpheline (réservation déjà reprise ou expirée)",
      { id }
    );
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
 * Clôture une livraison en échec — même garde `reservationToken` que
 * `finalizeDeliverySuccess`. Un échec retryable repasse la ligne à PENDING
 * (jamais un statut FAILED intermédiaire) avec `nextAttemptAt` : c'est ce
 * qui la rend de nouveau sélectionnable par `claimNextDelivery`, sans état
 * transitoire supplémentaire à gérer.
 */
export async function finalizeDeliveryFailure(
  id: string,
  reservationToken: string,
  input: FinalizeFailureInput
): Promise<boolean> {
  const result = await prisma.notificationDelivery.updateMany({
    where: { id, status: "RESERVED", reservationToken },
    data: input.retryable
      ? {
          status: "PENDING",
          reservedBy: null,
          reservationToken: null,
          reservedUntil: null,
          errorClass: input.errorClass,
          lastError: input.lastError,
          nextAttemptAt: input.nextAttemptAt,
        }
      : {
          status: "FAILED",
          reservedBy: null,
          reservationToken: null,
          reservedUntil: null,
          errorClass: input.errorClass,
          lastError: input.lastError,
        },
  });
  if (result.count === 0) {
    logger.warn(
      "notification-delivery",
      "Finalisation échec orpheline (réservation déjà reprise ou expirée)",
      { id }
    );
  }
  return result.count === 1;
}

/**
 * Repasse à PENDING les livraisons RESERVED dont le bail a expiré sans
 * jamais avoir été finalisées (crash, timeout, exécution tuée par la
 * plateforme) — les rend de nouveau sélectionnables par
 * `claimNextDelivery`. `reservationToken` est effacé avec le reste de
 * l'état de réservation : la prochaine réservation en générera un nouveau,
 * distinct, ce qui est précisément ce qui empêche l'ancien propriétaire de
 * finaliser à tort la nouvelle réservation (voir `finalizeDeliverySuccess`).
 * Un simple `updateMany` conditionné suffit ici (pas besoin de `FOR UPDATE
 * SKIP LOCKED` : aucune décision n'est prise à partir d'une lecture
 * préalable, la condition du `WHERE` est directement celle de l'écriture).
 */
export async function recoverExpiredReservations(now: Date = new Date()): Promise<number> {
  const result = await prisma.notificationDelivery.updateMany({
    where: { status: "RESERVED", reservedUntil: { lt: now } },
    data: { status: "PENDING", reservedBy: null, reservationToken: null, reservedUntil: null },
  });
  return result.count;
}

/**
 * Nettoyage automatique des fils (V2) — vrai si une livraison d'un même
 * événement métier (même préfixe de `targetSlot`, ex.
 * `default-guild:SESSION:<id>:`) est encore PENDING/RESERVED, hors des
 * emplacements `excludeSlots` (typiquement les livraisons de nettoyage
 * elles-mêmes). Sert à ne jamais verrouiller un fil pendant qu'un résumé,
 * un rappel ou une synchronisation de membre attend encore d'y être posé.
 */
export async function hasUnsettledDeliveriesWithPrefix(
  prefix: string,
  excludeSlots: string[]
): Promise<boolean> {
  const unsettled = await prisma.notificationDelivery.findFirst({
    where: {
      targetSlot: { startsWith: prefix, notIn: excludeSlots },
      status: { in: ["PENDING", "RESERVED"] },
    },
    select: { id: true },
  });
  return unsettled !== null;
}
