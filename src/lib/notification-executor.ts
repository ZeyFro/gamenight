import type { NotificationEvent } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import {
  claimNextDelivery,
  finalizeDeliveryFailure,
  finalizeDeliverySuccess,
  hasSufficientLeaseRemaining,
  MIN_CALL_MARGIN_MS,
  recoverExpiredReservations,
  type ClaimedDelivery,
  type FinalizeFailureInput,
  type FinalizeSuccessInput,
  type NotificationDb,
} from "@/lib/notification-delivery";
import {
  addThreadMember,
  addThreadMemberVerified,
  archiveThread,
  deleteChannelMessage,
  deleteThreadPermanently,
  editChannelMessage,
  removeThreadMemberVerified,
  sendChannelMessage,
  sendChannelMessageVerified,
  sendDirectMessage,
  sendThreadMessage,
  sendThreadMessageVerified,
  startPrivateThread,
  startThreadFromMessage,
  type AllowedMentions,
  type DiscordRestEmbed,
  type DiscordRestFailure,
  type DiscordRestResult,
} from "@/lib/discord-rest";

/**
 * Exécuteur de notifications (PR 3/N) — relie les fondations de livraison
 * persistées (`notification-delivery.ts`, #95) au client Discord REST
 * (`discord-rest.ts`, #96). AUCUNE notification métier n'est branchée ici
 * (aucun producteur réel, aucun résolveur réel) — voir `NOT_CONFIGURED_RESOLVER`
 * plus bas, utilisé tel quel par la route cron tant qu'aucune PR future ne
 * fournit de résolveur réel. `src/lib/discord.ts` (webhook) reste
 * l'unique chemin actif pour toutes les notifications actuelles.
 *
 * Ce module ne fait QUE composer les garanties déjà posées par les deux PR
 * précédentes — il n'en réimplémente aucune :
 *   - réservation persistée exclusive par cible, dépendances SEND→EDIT/
 *     ARCHIVE, convergence vers l'édition la plus récente, jeton de
 *     réservation anti-écrasement : entièrement délégué à
 *     `claimNextDelivery`/`finalizeDeliverySuccess`/`finalizeDeliveryFailure`
 *     (notification-delivery.ts), jamais réimplémenté ici en vérification
 *     applicative parallèle.
 *   - budget réseau couvrant requête ET lecture de réponse, MP à deadline
 *     partagé : entièrement délégué à `discord-rest.ts`
 *     (`discordRequest`/`sendDirectMessage`).
 *
 * Cycle par livraison (`processNextDelivery`) : claim atomique (hors de
 * toute portée réseau) → résolution du contenu/destination "juste à temps"
 * (jamais mise en cache depuis l'enqueue) → vérification du budget de bail
 * restant → UN appel Discord, hors transaction SQL → finalisation
 * conditionnée au `reservationToken` obtenu au claim. Aucune boucle de
 * retry synchrone : un échec retryable repasse simplement la livraison à
 * PENDING avec `nextAttemptAt`, reprise par une future exécution du cron
 * (jamais une attente/un retry à l'intérieur de cette même requête).
 */

// Borne de tentatives — pas dérivée d'une contrainte plateforme précise
// (contrairement aux timeouts/lease dérivés du plafond Vercel Hobby
// ailleurs dans ce chantier) : choisie pour qu'une notification ne reste
// jamais bloquée en re-tentative silencieuse indéfiniment, tout en
// laissant plusieurs heures de marge aux pannes transitoires (rate limit,
// 5xx Discord, dépendance métier pas encore prête). Une fois atteinte, un
// échec par ailleurs retryable devient terminal (FAILED).
export const MAX_DELIVERY_ATTEMPTS = 8;

// Backoff exponentiel pour les échecs retryable SANS indication de délai
// explicite de Discord (network_uncertain, server_error, insufficient_lease
// avant appel) — 1 min de base, doublé par tentative, plafonné à 30 min.
// Quand Discord fournit un délai explicite (429 → retry_after/Retry-After),
// celui-ci est TOUJOURS préféré à ce calcul (voir `classifyDiscordFailure`).
const RETRY_BASE_MS = 60_000;
const RETRY_MAX_MS = 30 * 60_000;

// Backoff court dédié à une dépendance métier pas encore prête (ex. le
// SEND de l'annonce dont un SEND de création de fil a besoin, sur un AUTRE
// targetSlot — voir le commentaire de `ResolvedAction`/`Resolution` plus
// bas) : la dépendance se résout typiquement au prochain passage du cron,
// pas la peine d'attendre aussi longtemps qu'un vrai échec réseau.
const DEPENDENCY_RETRY_BACKOFF_MS = 2 * 60_000;

// Plafond de livraisons traitées par exécution du batch — chaque livraison
// est réservée puis traitée une par une (jamais un gros lot réservé
// d'avance, voir `runExecutorBatch`), donc cette borne protège seulement
// contre un backlog anormalement long qui ferait dépasser la durée
// d'exécution de la route, pas contre une expiration de bail par lot.
export const DEFAULT_MAX_DELIVERIES_PER_RUN = 25;

// Budget de temps mur pour un batch complet — sous le plafond dur de 60s
// du plan Vercel Hobby (`maxDuration`, même convention que les autres
// routes cron de ce dépôt), avec une marge pour la réponse HTTP elle-même
// et un éventuel dernier appel Discord déjà engagé au moment où le budget
// est atteint.
export const DEFAULT_BATCH_BUDGET_MS = 50_000;

/** Contenu textuel commun aux actions qui envoient/éditent un message —
 * `allowedMentions` REQUIS (pas de valeur implicite), même contrat que
 * `discord-rest.ts`. */
export interface ResolvedMessageContent {
  content?: string;
  embeds?: DiscordRestEmbed[];
  allowedMentions: AllowedMentions;
}

/**
 * Action Discord concrète qu'une résolution éligible demande d'exécuter —
 * correspond 1:1 aux fonctions exportées de `discord-rest.ts`, jamais une
 * abstraction supplémentaire. Les cinq capacités demandées pour cette PR :
 * envoi/édition de message (salon ou MP), ouverture de MP + envoi à
 * deadline partagé (`send_direct_message` → `sendDirectMessage`), création
 * de fil, envoi dans un fil, archivage.
 *
 * Aucune opération inconnue n'est représentable : ce type FERME la liste
 * des actions que cet exécuteur sait exécuter. Un résolveur qui aurait
 * besoin d'autre chose ne peut pas l'inventer via ce contrat — c'est
 * intentionnel, voir le commentaire de fichier.
 */
export type ResolvedAction =
  | { kind: "send_channel_message"; channelId: string; message: ResolvedMessageContent }
  | {
      /** Vérifie via un GET réel que `channelId` appartient à `guildId`
       * ET que son type supporte le parcours annonce+fil AVANT le POST
       * (`sendChannelMessageVerified`, discord-rest.ts) — jamais de
       * message envoyé si la vérification échoue. Réservée au tout
       * premier SEND d'une annonce (chantier tournois) ; les éditions et
       * messages de fil qui suivent ciblent directement la référence du
       * message réellement créé, jamais revérifiée (voir le commentaire
       * de `sendChannelMessageVerified`). */
      kind: "send_channel_message_verified";
      channelId: string;
      guildId: string;
      message: ResolvedMessageContent;
    }
  | {
      kind: "edit_channel_message";
      channelId: string;
      messageId: string;
      isDirectMessage?: boolean;
      message: ResolvedMessageContent;
    }
  | { kind: "send_direct_message"; userId: string; message: ResolvedMessageContent }
  | {
      kind: "create_thread";
      channelId: string;
      messageId: string;
      name: string;
      autoArchiveDuration?: 60 | 1440 | 4320 | 10080;
    }
  | { kind: "send_thread_message"; threadId: string; message: ResolvedMessageContent }
  | { kind: "archive_thread"; threadId: string; locked?: boolean }
  | {
      /** Chantier confidentialité des soirées — fil PRIVÉ (`type: 12`),
       * jamais rattaché à un message (`startPrivateThread`,
       * discord-rest.ts) : aucune information de soirée ne transite par
       * le salon public parent. */
      kind: "create_private_thread";
      channelId: string;
      name: string;
      autoArchiveDuration?: 60 | 1440 | 4320 | 10080;
    }
  | {
      /** Comme `send_thread_message`, mais revérifie via un `GET` réel
       * (`verifyThreadIsPrivate`, discord-rest.ts) que le fil référencé
       * est bien PRIVÉ avant tout envoi — un `threadId` lu en base peut,
       * pour une soirée créée avant ce chantier, pointer vers l'ANCIEN
       * fil PUBLIC (jamais recréé, l'enqueue de `thread` est à occurrence
       * fixe). Réservée à toute publication dans un fil dont la
       * référence vient d'une lecture en base, jamais nécessaire pour un
       * fil qu'on vient de créer dans le même appel. */
      kind: "send_thread_message_verified";
      threadId: string;
      message: ResolvedMessageContent;
    }
  | { kind: "add_thread_member_verified"; threadId: string; discordUserId: string }
  | { kind: "remove_thread_member_verified"; threadId: string; discordUserId: string }
  | {
      /** Chantier nettoyage réel du stockage (V2) — adhésion automatique
       * aux fils de TOURNOIS, jamais un fil PRIVÉ (voir le commentaire de
       * `addThreadMember`, discord-rest.ts) : pas de revérification de
       * type avant l'ajout, contrairement à `add_thread_member_verified`. */
      kind: "add_thread_member";
      threadId: string;
      discordUserId: string;
    }
  | {
      /** Suppression PERMANENTE d'un fil (soirée ou tournoi) — distincte
       * d'`archive_thread` (réversible, toujours utilisée par l'annulation,
       * jamais transformée en suppression définitive). `threadId` provient
       * EXCLUSIVEMENT d'une référence déjà persistée par un SEND antérieur
       * sur ce même targetSlot (jamais construit/deviné). */
      kind: "delete_thread_permanent";
      threadId: string;
    }
  | {
      /** Suppression du message d'annonce d'un tournoi dans le salon
       * PARENT (jamais le salon lui-même, jamais un message sans lien
       * certain) — évite un lien d'inscription cassé après suppression du
       * tournoi. `channelId`/`messageId` proviennent EXCLUSIVEMENT de la
       * référence du SEND initial déjà persisté. */
      kind: "delete_channel_message";
      channelId: string;
      messageId: string;
    };

/** Raisons de non-éligibilité — voir `classifyResolutionFailure` pour leur
 * traitement (retryable ou terminal). `dependency_not_ready` est la SEULE
 * retryable : les autres sont des refus définitifs pour cette livraison
 * telle qu'elle existe (pas de sens à retenter sans qu'un humain ou un
 * futur événement ne change la donnée source). */
export type ResolutionReason =
  | "preference_declined"
  | "expired"
  | "not_configured"
  | "dependency_not_ready"
  | "unresolvable";

export type Resolution =
  | {
      eligible: true;
      action: ResolvedAction;
      /** Optionnel, non exploité par cet exécuteur — réservé pour un futur
       * contrôle de concurrence optimiste côté résolveur métier (ex.
       * détecter qu'un événement source a changé entre l'enqueue et la
       * résolution). Typé ici pour ne pas re-migrer le contrat plus tard,
       * volontairement pas de logique dessus dans cette PR (voir le
       * commentaire de fichier — aucune fonctionnalité métier inventée). */
      stateVersion?: string;
    }
  | { eligible: false; reason: ResolutionReason };

/** Contexte fourni à un résolveur pour une livraison réservée donnée.
 * `event` est chargé par l'exécuteur (pas par le résolveur) pour éviter à
 * chaque résolveur de refaire la même requête. `delivery.targetMessage`
 * (déjà résolu par `claimNextDelivery` pour EDIT/ARCHIVE) donne la
 * référence du message ciblé sur le MÊME `targetSlot` — un résolveur qui a
 * besoin d'une référence sur un AUTRE `targetSlot` (ex. le fil dépend du
 * message de l'annonce) doit la chercher lui-même : ce n'est pas une
 * garantie que ce module fournit, volontairement, voir le commentaire de
 * fichier. */
export interface ResolveInput {
  delivery: ClaimedDelivery;
  event: NotificationEvent;
  now: Date;
}

/**
 * Contrat qu'un futur producteur métier doit implémenter pour brancher de
 * vraies notifications. AUCUNE implémentation réelle dans cette PR — voir
 * `NOT_CONFIGURED_RESOLVER` pour le résolveur par défaut utilisé en
 * production tant qu'aucun résolveur réel n'est branché, et les tests pour
 * des résolveurs synthétiques d'exemple.
 *
 * Appelé APRÈS le claim, juste avant l'appel Discord — jamais mis en
 * cache : `resolve` doit relire l'état métier courant à chaque appel
 * (c'est ce qui permet de vérifier préférence/validité "juste à temps"
 * plutôt que sur un instantané périmé pris à l'enqueue).
 */
export interface DeliveryResolver {
  resolve(input: ResolveInput): Promise<Resolution>;
  /**
   * V2 (MP soirées) — optionnel. Appelé quand l'APPEL DISCORD d'une
   * livraison échoue définitivement (jamais pour un refus du résolveur,
   * jamais pour un échec encore retentable), DANS LA MÊME transaction que
   * son passage à FAILED : une compensation enqueue-ée ici (ex. mention de
   * secours quand un MP est fermé) existe si et seulement si l'échec est
   * acté. Uniquement des écritures via `db`, jamais d'appel Discord.
   */
  onTerminalDiscordFailure?(input: TerminalDiscordFailureInput): Promise<void>;
}

export interface TerminalDiscordFailureInput {
  delivery: ClaimedDelivery;
  event: NotificationEvent;
  errorClass: string;
  db: NotificationDb;
}

/**
 * Résolveur par défaut, sûr, utilisé par la route cron tant qu'aucun
 * producteur métier réel n'est branché (hors de portée de cette PR) —
 * refuse systématiquement d'envoyer, jamais de repli implicite vers une
 * autre notification. Matérialise directement l'exigence "en l'absence de
 * résolution ou de configuration sûre, ne pas envoyer".
 */
export const NOT_CONFIGURED_RESOLVER: DeliveryResolver = {
  async resolve() {
    return { eligible: false, reason: "not_configured" };
  },
};

function computeRetryBackoffMs(attempts: number): number {
  const exponent = Math.max(0, attempts - 1);
  return Math.min(RETRY_BASE_MS * 2 ** exponent, RETRY_MAX_MS);
}

/**
 * Traduit un échec Discord classifié (`discord-rest.ts`) en instruction de
 * finalisation — propage TEL QUEL le `retryable` de `discord-rest.ts`
 * (déjà correctement posé par kind, rien à redécider ici), sauf si la
 * borne de tentatives est atteinte, auquel cas un échec par ailleurs
 * retryable devient terminal.
 *
 * `rate_limited` respecte explicitement le délai indiqué par Discord
 * (`retryAfterMs`, dérivé du corps `retry_after` OU de l'en-tête
 * `Retry-After` par `discord-rest.ts`) plutôt que le backoff générique.
 *
 * Résultat réseau incertain (`network_uncertain`) — traité comme
 * retryable comme documenté par `discord-rest.ts`/`notification-delivery.ts`,
 * mais avec un risque résiduel DIFFÉRENT selon l'opération, documenté ici
 * plutôt que résolu (aucune solution d'idempotence Discord n'existe) :
 *   - SEND : Discord a peut-être déjà créé le message avant que la
 *     réponse ne se perde — retenter peut produire un second message
 *     distinct. Risque accepté, déjà documenté comme limite structurelle
 *     dans `notification-delivery.ts` (pas d'exactly-once).
 *   - EDIT/ARCHIVE : retenter est sûr par nature — ré-appliquer le même
 *     contenu ou le même état d'archivage ne produit jamais de doublon,
 *     au pire un appel réseau redondant.
 */
export function classifyDiscordFailure(
  result: DiscordRestFailure,
  attempts: number,
  now: Date
): FinalizeFailureInput {
  const attemptsExhausted = attempts >= MAX_DELIVERY_ATTEMPTS;
  const retryable = result.retryable && !attemptsExhausted;
  const errorClass =
    attemptsExhausted && result.retryable ? `discord:${result.kind}:max_attempts_exceeded` : `discord:${result.kind}`;

  if (!retryable) {
    return { retryable: false, errorClass, lastError: result.message };
  }

  const backoffMs =
    result.kind === "rate_limited" && result.retryAfterMs !== undefined
      ? result.retryAfterMs
      : computeRetryBackoffMs(attempts);

  return {
    retryable: true,
    errorClass,
    lastError: result.message,
    nextAttemptAt: new Date(now.getTime() + backoffMs),
  };
}

/** Traduit une résolution non éligible en instruction de finalisation —
 * voir le commentaire de `ResolutionReason` pour la distinction retryable/
 * terminal. */
function classifyResolutionFailure(reason: ResolutionReason, attempts: number, now: Date): FinalizeFailureInput {
  if (reason === "dependency_not_ready" && attempts < MAX_DELIVERY_ATTEMPTS) {
    return {
      retryable: true,
      errorClass: "resolver:dependency_not_ready",
      lastError: "Dépendance métier pas encore prête (ex. message source d'un autre targetSlot) — reporté.",
      nextAttemptAt: new Date(now.getTime() + DEPENDENCY_RETRY_BACKOFF_MS),
    };
  }
  return {
    retryable: false,
    errorClass: `resolver:${reason}`,
    lastError: `Livraison non éligible (${reason}).`,
  };
}

/** Résultat normalisé d'une action Discord, quel que soit son type —
 * directement compatible avec `FinalizeSuccessInput`. */
type DiscordActionSuccess = FinalizeSuccessInput;

function mapDiscordResult<T>(
  result: DiscordRestResult<T>,
  transform: (data: T) => DiscordActionSuccess
): DiscordRestResult<DiscordActionSuccess> {
  if (!result.ok) return result;
  return { ok: true, data: transform(result.data) };
}

/**
 * Exécute UNE action Discord (un seul appel réseau, hors de toute
 * transaction SQL — déjà garanti par l'appelant, `processNextDelivery`).
 * Dispatch direct vers `discord-rest.ts`, aucune logique de retry/attente
 * ici : ce module se contente de traduire l'action résolue en appel
 * concret et d'en normaliser le résultat.
 */
export async function performDiscordAction(
  action: ResolvedAction,
  deadline: Date,
  now: Date
): Promise<DiscordRestResult<DiscordActionSuccess>> {
  switch (action.kind) {
    case "send_channel_message": {
      const result = await sendChannelMessage({
        channelId: action.channelId,
        content: action.message.content,
        embeds: action.message.embeds,
        allowedMentions: action.message.allowedMentions,
        deadline,
        now,
      });
      return mapDiscordResult(result, (data) => ({
        discordMessageId: data.messageId,
        discordChannelId: data.channelId,
      }));
    }
    case "send_channel_message_verified": {
      const result = await sendChannelMessageVerified({
        channelId: action.channelId,
        guildId: action.guildId,
        content: action.message.content,
        embeds: action.message.embeds,
        allowedMentions: action.message.allowedMentions,
        deadline,
        now,
      });
      return mapDiscordResult(result, (data) => ({
        discordMessageId: data.messageId,
        discordChannelId: data.channelId,
      }));
    }
    case "edit_channel_message": {
      const result = await editChannelMessage({
        channelId: action.channelId,
        messageId: action.messageId,
        content: action.message.content,
        embeds: action.message.embeds,
        allowedMentions: action.message.allowedMentions,
        isDirectMessage: action.isDirectMessage,
        deadline,
        now,
      });
      return mapDiscordResult(result, (data) => ({
        discordMessageId: data.messageId,
        discordChannelId: data.channelId,
      }));
    }
    case "send_direct_message": {
      // Ouverture du canal MP + envoi à DEADLINE PARTAGÉ, jamais
      // réinitialisé entre les deux appels — entièrement délégué à
      // `sendDirectMessage` (discord-rest.ts), qui porte cette garantie
      // structurellement (voir sa doc).
      const result = await sendDirectMessage({
        userId: action.userId,
        content: action.message.content,
        embeds: action.message.embeds,
        allowedMentions: action.message.allowedMentions,
        deadline,
        now,
      });
      return mapDiscordResult(result, (data) => ({
        discordMessageId: data.messageId,
        discordChannelId: data.channelId,
      }));
    }
    case "create_thread": {
      const result = await startThreadFromMessage({
        channelId: action.channelId,
        messageId: action.messageId,
        name: action.name,
        autoArchiveDuration: action.autoArchiveDuration,
        deadline,
        now,
      });
      return mapDiscordResult(result, (data) => ({
        discordThreadId: data.threadId,
        discordChannelId: data.parentId ?? undefined,
      }));
    }
    case "send_thread_message": {
      // Un fil est un salon côté API Discord (voir discord-rest.ts) : le
      // `channelId` renvoyé par ce SEND correspond au `threadId` lui-même.
      const result = await sendThreadMessage({
        threadId: action.threadId,
        content: action.message.content,
        embeds: action.message.embeds,
        allowedMentions: action.message.allowedMentions,
        deadline,
        now,
      });
      return mapDiscordResult(result, (data) => ({
        discordMessageId: data.messageId,
        discordThreadId: data.channelId,
      }));
    }
    case "archive_thread": {
      const result = await archiveThread({
        threadId: action.threadId,
        locked: action.locked,
        deadline,
        now,
      });
      // Nettoyage automatique des fils (V2) — un fil déjà absent (supprimé
      // à la main par un modérateur) n'a plus besoin d'être fermé : même
      // équivalence 404 → succès que `delete_thread_permanent` ci-dessous.
      // Un 403 (permission `MANAGE_THREADS` manquante pour `locked`) reste
      // un échec, jamais reclassé.
      if (!result.ok && result.kind === "not_found") {
        return { ok: true, data: { discordThreadId: action.threadId } };
      }
      return mapDiscordResult(result, (data) => ({
        discordThreadId: data.threadId,
        discordChannelId: data.parentId ?? undefined,
      }));
    }
    case "create_private_thread": {
      const result = await startPrivateThread({
        channelId: action.channelId,
        name: action.name,
        autoArchiveDuration: action.autoArchiveDuration,
        deadline,
        now,
      });
      return mapDiscordResult(result, (data) => ({
        discordThreadId: data.threadId,
        discordChannelId: data.parentId ?? undefined,
      }));
    }
    case "send_thread_message_verified": {
      // Un fil est un salon côté API Discord (voir discord-rest.ts) : le
      // `channelId` renvoyé par ce SEND correspond au `threadId` lui-même.
      const result = await sendThreadMessageVerified({
        threadId: action.threadId,
        content: action.message.content,
        embeds: action.message.embeds,
        allowedMentions: action.message.allowedMentions,
        deadline,
        now,
      });
      return mapDiscordResult(result, (data) => ({
        discordMessageId: data.messageId,
        discordThreadId: data.channelId,
      }));
    }
    case "add_thread_member_verified": {
      const result = await addThreadMemberVerified({
        threadId: action.threadId,
        discordUserId: action.discordUserId,
        deadline,
        now,
      });
      return mapDiscordResult(result, () => ({ discordThreadId: action.threadId }));
    }
    case "remove_thread_member_verified": {
      const result = await removeThreadMemberVerified({
        threadId: action.threadId,
        discordUserId: action.discordUserId,
        deadline,
        now,
      });
      // Un `404` ("déjà absent du fil", OU le fil référencé n'existe plus
      // du tout — la vérification elle-même 404) atteint exactement
      // l'état cible d'un retrait — traité comme un succès ICI (jamais
      // dans discord-rest.ts, qui reste honnête sur la réponse HTTP
      // brute, voir son commentaire) : sans cette équivalence, une
      // invitation révoquée pour quelqu'un jamais réellement ajouté
      // (échec transitoire du premier ajout, ou double révocation)
      // resterait éternellement en échec `FAILED`/retenue en `retrying`,
      // alors que le but — cette personne absente du fil — est déjà
      // atteint.
      if (!result.ok && result.kind === "not_found") {
        return { ok: true, data: { discordThreadId: action.threadId } };
      }
      return mapDiscordResult(result, () => ({ discordThreadId: action.threadId }));
    }
    case "add_thread_member": {
      const result = await addThreadMember({
        threadId: action.threadId,
        discordUserId: action.discordUserId,
        deadline,
        now,
      });
      return mapDiscordResult(result, () => ({ discordThreadId: action.threadId }));
    }
    case "delete_thread_permanent": {
      const result = await deleteThreadPermanently({ threadId: action.threadId, deadline, now });
      // Chantier nettoyage réel du stockage (V2) — un `404` ("fil déjà
      // absent", déjà supprimé par un appel précédent qui a réussi côté
      // Discord mais dont la réponse s'est perdue, ou retiré manuellement
      // par un modérateur) atteint exactement l'état cible d'une
      // suppression : le fil n'existe plus. Traité comme un succès ICI
      // (jamais dans discord-rest.ts, qui reste honnête sur la réponse
      // HTTP brute) — même raisonnement/même équivalence que
      // `remove_thread_member_verified` ci-dessus. Un refus de permission
      // (403) ou une erreur réseau restent des échecs, JAMAIS reclassés.
      if (!result.ok && result.kind === "not_found") {
        return { ok: true, data: { discordThreadId: action.threadId } };
      }
      return mapDiscordResult(result, () => ({ discordThreadId: action.threadId }));
    }
    case "delete_channel_message": {
      const result = await deleteChannelMessage({
        channelId: action.channelId,
        messageId: action.messageId,
        deadline,
        now,
      });
      // Même équivalence 404 → succès que `delete_thread_permanent`
      // ci-dessus : un message déjà absent atteint déjà l'état cible.
      if (!result.ok && result.kind === "not_found") {
        return { ok: true, data: { discordMessageId: action.messageId, discordChannelId: action.channelId } };
      }
      return mapDiscordResult(result, () => ({
        discordMessageId: action.messageId,
        discordChannelId: action.channelId,
      }));
    }
  }
}

export type ProcessedDeliveryOutcome =
  | { deliveryId: string; outcome: "sent" }
  | { deliveryId: string; outcome: "retrying"; errorClass: string }
  | { deliveryId: string; outcome: "failed"; errorClass: string }
  /** L'appel Discord a réussi, mais la finalisation a trouvé la réservation
   * déjà reprise (bail expiré, un autre propriétaire a pris la main) —
   * l'état en base N'A PAS été écrasé (voir `finalizeDeliverySuccess`).
   * PAS de retry Discord dans ce cas : le message a déjà été accepté par
   * Discord à ce stade, retenter risquerait un doublon pour rien. */
  | { deliveryId: string; outcome: "lost_reservation_after_success" };

export interface ProcessDeliveryOptions {
  resolver: DeliveryResolver;
  owner: string;
  now?: Date;
  leaseMs?: number;
  /** Budget global restant de l'exécuteur (fin de la fenêtre d'exécution
   * du batch, ex. `DEFAULT_BATCH_BUDGET_MS` — voir `runExecutorBatch`).
   * Optionnel : un appel direct à `processNextDelivery` (hors batch, ex.
   * un exécuteur synchrone) n'est contraint que par le bail de la
   * réservation. Quand fourni, la deadline transmise au client Discord
   * respecte la PLUS PROCHE des deux échéances — jamais seulement le
   * bail — pour qu'un appel réseau ne puisse jamais, à lui seul, pousser
   * l'exécution du batch au-delà de son budget global. */
  batchDeadline?: Date;
}

/**
 * Traite UNE livraison de bout en bout : claim → vérification transport →
 * chargement de l'événement → résolution → vérification du budget de bail
 * restant → appel Discord (hors transaction) → finalisation. Renvoie
 * `null` s'il n'y a rien à réclamer.
 *
 * Une erreur sur cette livraison (résolveur non configuré, dépendance pas
 * prête, échec Discord quelconque) ne lève jamais d'exception vers
 * l'appelant — toujours finalisée proprement (succès ou échec) puis
 * renvoyée, pour que `runExecutorBatch` puisse toujours passer à la
 * livraison suivante sans qu'un échec n'empêche les autres cibles
 * éligibles de progresser.
 */
export async function processNextDelivery(opts: ProcessDeliveryOptions): Promise<ProcessedDeliveryOutcome | null> {
  const now = opts.now ?? new Date();
  const claimed = await claimNextDelivery(opts.owner, { now, leaseMs: opts.leaseMs });
  if (!claimed) return null;

  // Invariant post-claim : une ligne RESERVED a toujours un
  // reservationToken ET un reservedUntil, posés ENSEMBLE par le même
  // `update` dans `claimNextDelivery` — jamais l'un sans l'autre avec le
  // code actuel. Défensif uniquement, ne devrait jamais se produire ; si
  // ça arrivait quand même, ne jamais planter tout le batch pour une
  // seule ligne incohérente. Pas de finalisation possible ici sans jeton
  // valide (le contrat `finalizeDeliveryFailure` l'exige) : la ligne
  // reste RESERVED, récupérée par `recoverExpiredReservations` au
  // prochain balayage SI `reservedUntil` est bien posé (le cas réel,
  // couvert par l'invariant ci-dessus) — un `reservedUntil` réellement
  // absent échapperait à ce balayage, situation qui ne peut survenir
  // qu'en cas de corruption externe des données, hors de portée de ce
  // module.
  if (!claimed.reservationToken || !claimed.reservedUntil) {
    logger.error(
      "notification-executor",
      "Invariant violé : livraison RESERVED sans reservationToken/reservedUntil — ignorée pour ce passage.",
      { id: claimed.id }
    );
    return { deliveryId: claimed.id, outcome: "failed", errorClass: "internal:invariant_violation" };
  }
  const reservationToken = claimed.reservationToken;
  const reservedUntil = claimed.reservedUntil;

  // Une opération inconnue ou non prise en charge ne doit jamais être
  // considérée comme envoyée. `WEBHOOK` n'est aujourd'hui jamais produit
  // par `enqueueDelivery` (rien ne le branche), mais reste représentable
  // par le schéma — garde défensive explicite plutôt qu'un dispatch
  // silencieusement incorrect si un futur appelant s'y trompait.
  if (claimed.transport !== "BOT") {
    await finalizeDeliveryFailure(claimed.id, reservationToken, {
      retryable: false,
      errorClass: "unsupported_transport",
      lastError: `Transport "${claimed.transport}" non pris en charge par cet exécuteur (bot uniquement).`,
    });
    return { deliveryId: claimed.id, outcome: "failed", errorClass: "unsupported_transport" };
  }

  const event = await prisma.notificationEvent.findUnique({ where: { id: claimed.eventId } });
  if (!event) {
    await finalizeDeliveryFailure(claimed.id, reservationToken, {
      retryable: false,
      errorClass: "event_missing",
      lastError: "NotificationEvent introuvable pour cette livraison.",
    });
    return { deliveryId: claimed.id, outcome: "failed", errorClass: "event_missing" };
  }

  let resolution: Resolution;
  try {
    resolution = await opts.resolver.resolve({ delivery: claimed, event, now });
  } catch (error) {
    const failure: FinalizeFailureInput =
      claimed.attempts >= MAX_DELIVERY_ATTEMPTS
        ? { retryable: false, errorClass: "resolver:error:max_attempts_exceeded", lastError: String(error) }
        : {
            retryable: true,
            errorClass: "resolver:error",
            lastError: String(error),
            nextAttemptAt: new Date(now.getTime() + computeRetryBackoffMs(claimed.attempts)),
          };
    await finalizeDeliveryFailure(claimed.id, reservationToken, failure);
    return {
      deliveryId: claimed.id,
      outcome: failure.retryable ? "retrying" : "failed",
      errorClass: failure.errorClass,
    };
  }

  if (!resolution.eligible) {
    const failure = classifyResolutionFailure(resolution.reason, claimed.attempts, now);
    await finalizeDeliveryFailure(claimed.id, reservationToken, failure);
    return {
      deliveryId: claimed.id,
      outcome: failure.retryable ? "retrying" : "failed",
      errorClass: failure.errorClass,
    };
  }

  // Budget vérifié AVANT tout appel réseau, contre la PLUS PROCHE des deux
  // échéances : fin de bail de la réservation, ET fin du budget global de
  // l'exécuteur (`batchDeadline`, si fourni par `runExecutorBatch`) — un
  // bail encore largement valide ne doit jamais autoriser un appel réseau
  // que le budget du batch ne peut plus se permettre. Même fonction de
  // marge (`hasSufficientLeaseRemaining`/`MIN_CALL_MARGIN_MS`) réutilisée
  // pour les deux, jamais une vérification parallèle réinventée.
  const deadlineSource =
    opts.batchDeadline && opts.batchDeadline.getTime() < reservedUntil.getTime() ? opts.batchDeadline : reservedUntil;
  const insufficientBudgetKind = deadlineSource === opts.batchDeadline ? "insufficient_batch_budget" : "insufficient_lease";

  if (!hasSufficientLeaseRemaining(deadlineSource, now)) {
    const failure: FinalizeFailureInput =
      claimed.attempts >= MAX_DELIVERY_ATTEMPTS
        ? {
            retryable: false,
            errorClass: `${insufficientBudgetKind}:max_attempts_exceeded`,
            lastError: "Budget insuffisant avant appel Discord (bail ou budget global de l'exécuteur).",
          }
        : {
            retryable: true,
            errorClass: insufficientBudgetKind,
            lastError: "Budget insuffisant avant appel Discord (bail ou budget global de l'exécuteur).",
            nextAttemptAt: new Date(now.getTime() + computeRetryBackoffMs(claimed.attempts)),
          };
    await finalizeDeliveryFailure(claimed.id, reservationToken, failure);
    return {
      deliveryId: claimed.id,
      outcome: failure.retryable ? "retrying" : "failed",
      errorClass: failure.errorClass,
    };
  }

  // Deadline transmise au client Discord = échéance retenue ci-dessus
  // MOINS la marge de finalisation — jamais l'échéance brute (voir le
  // contrat documenté sur `MIN_CALL_MARGIN_MS`, notification-delivery.ts).
  const deadline = new Date(deadlineSource.getTime() - MIN_CALL_MARGIN_MS);

  const discordResult = await performDiscordAction(resolution.action, deadline, now);

  if (discordResult.ok) {
    const finalized = await finalizeDeliverySuccess(claimed.id, reservationToken, discordResult.data);
    if (!finalized) {
      // Réservation reprise entre-temps (bail expiré) — le message a déjà
      // été accepté par Discord, jamais de nouvel envoi ici. Déjà loggué
      // par `finalizeDeliverySuccess` lui-même.
      return { deliveryId: claimed.id, outcome: "lost_reservation_after_success" };
    }
    // Instrumentation ciblée (V2, revue du délai constaté en production sur
    // un premier SEND de tournoi ~2 minutes après sa création) — mesure le
    // délai RÉEL enqueue→envoi pour CHAQUE livraison qui aboutit, sans
    // supposer où il vient (cadence du cron externe, dépendance entre
    // cibles, budget de batch...). `claimed.createdAt` est posé à l'écriture
    // de la ligne (juste après la mutation métier qui l'a enqueue-ée,
    // souvent DANS la même transaction), donc `now - createdAt` couvre tout
    // le chemin réel création → claim → envoi, pas seulement le dernier
    // appel réseau. Seuls des identifiants déjà loggués ailleurs dans ce
    // module (`targetSlot`) et des nombres — jamais un contenu de message
    // ni une donnée personnelle.
    logger.info("notification-executor", "Livraison envoyée.", {
      targetSlot: claimed.targetSlot,
      operation: claimed.operation,
      attempts: claimed.attempts,
      delayMs: now.getTime() - claimed.createdAt.getTime(),
    });
    return { deliveryId: claimed.id, outcome: "sent" };
  }

  const failure = classifyDiscordFailure(discordResult, claimed.attempts, now);
  const onTerminalFailure = opts.resolver.onTerminalDiscordFailure?.bind(opts.resolver);
  if (!failure.retryable && onTerminalFailure) {
    // Échec définitif ET compensation dans la même transaction (voir
    // `DeliveryResolver.onTerminalDiscordFailure`) — la finalisation reste
    // gardée par le jeton : une réservation déjà reprise ne déclenche rien.
    await prisma.$transaction(async (tx) => {
      const finalized = await finalizeDeliveryFailure(claimed.id, reservationToken, failure, tx);
      if (finalized) {
        await onTerminalFailure({ delivery: claimed, event, errorClass: failure.errorClass, db: tx });
      }
    });
  } else {
    await finalizeDeliveryFailure(claimed.id, reservationToken, failure);
  }
  return {
    deliveryId: claimed.id,
    outcome: failure.retryable ? "retrying" : "failed",
    errorClass: failure.errorClass,
  };
}

export interface RunExecutorBatchOptions {
  resolver: DeliveryResolver;
  owner: string;
  now?: Date;
  leaseMs?: number;
  maxDeliveries?: number;
  batchBudgetMs?: number;
}

export interface ExecutorBatchSummary {
  recovered: number;
  processed: number;
  sent: number;
  retrying: number;
  failed: number;
  lostReservation: number;
  stoppedReason: "no_more_deliveries" | "max_deliveries_reached" | "budget_exhausted";
}

/**
 * Traite les livraisons dues UNE À LA FOIS (`processNextDelivery` en
 * boucle) jusqu'à épuisement, jusqu'à `maxDeliveries`, ou jusqu'à
 * épuisement du budget de temps mur — jamais un gros lot réservé d'avance
 * (chaque itération ne réserve qu'UNE ligne, dont le bail ne commence à
 * courir qu'au moment de sa propre réservation, jamais avant : aucun bail
 * ne peut donc expirer "en attendant son tour" dans un lot).
 *
 * Appelle `recoverExpiredReservations` une fois en tout début de batch —
 * c'est le balayage périodique documenté comme "absent" dans
 * `notification-delivery.ts` (PR #95) : cette PR le branche enfin, porté
 * par chaque exécution de ce batch plutôt qu'un processus séparé.
 *
 * Transmet sa propre échéance (`batchDeadline`) à CHAQUE appel de
 * `processNextDelivery` — pas seulement la vérification "budget épuisé,
 * n'en réclame pas d'autre" ci-dessous : une fois une livraison réclamée,
 * `processNextDelivery` borne lui-même la deadline transmise au client
 * Discord par le plus proche du bail de la réservation ET de cette
 * échéance de batch, pour qu'un seul appel réseau ne puisse jamais, à lui
 * seul, pousser l'exécution au-delà du budget global (voir son
 * commentaire).
 */
export async function runExecutorBatch(opts: RunExecutorBatchOptions): Promise<ExecutorBatchSummary> {
  const startedAt = opts.now ?? new Date();
  const maxDeliveries = opts.maxDeliveries ?? DEFAULT_MAX_DELIVERIES_PER_RUN;
  const budgetMs = opts.batchBudgetMs ?? DEFAULT_BATCH_BUDGET_MS;
  const batchDeadlineMs = startedAt.getTime() + budgetMs;
  const batchDeadline = new Date(batchDeadlineMs);

  const recovered = await recoverExpiredReservations(startedAt);

  const summary: ExecutorBatchSummary = {
    recovered,
    processed: 0,
    sent: 0,
    retrying: 0,
    failed: 0,
    lostReservation: 0,
    stoppedReason: "no_more_deliveries",
  };

  for (;;) {
    if (summary.processed >= maxDeliveries) {
      summary.stoppedReason = "max_deliveries_reached";
      break;
    }
    if (Date.now() >= batchDeadlineMs) {
      summary.stoppedReason = "budget_exhausted";
      break;
    }

    const outcome = await processNextDelivery({
      resolver: opts.resolver,
      owner: opts.owner,
      leaseMs: opts.leaseMs,
      batchDeadline,
    });
    if (!outcome) {
      summary.stoppedReason = "no_more_deliveries";
      break;
    }

    summary.processed++;
    switch (outcome.outcome) {
      case "sent":
        summary.sent++;
        break;
      case "retrying":
        summary.retrying++;
        break;
      case "failed":
        summary.failed++;
        break;
      case "lost_reservation_after_success":
        summary.lostReservation++;
        break;
    }
  }

  return summary;
}
