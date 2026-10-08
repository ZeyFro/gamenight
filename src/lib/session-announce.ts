import { sessionMessage } from "@/lib/session-message";
import { communityMemberUserWhere, isCommunityIsolationEnabled, isMemberOfCommunity } from "@/lib/community-isolation";
import { notificationEventMatchesSource } from "@/lib/notification-delivery";
import { randomUUID } from "crypto";
import type { Game, Proposal, Session, SessionInvite, SessionSeat, User, Vote } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isSeatReminderRecipient } from "@/lib/session-seat-plan";
import { logger } from "@/lib/logger";
import { formatDateTimeFr, wallClockNow } from "@/lib/wallclock";
import { formatReminderTimingShort } from "@/lib/reminder-timings";
import { resolveNotifiedUserIds } from "@/lib/notify-recipients";
import { filterUsersByNotificationPreference } from "@/lib/notification-preferences";
import { filterByActiveSessionInvite } from "@/lib/session-access";
import { createNotifications } from "@/lib/notifications";
import { isSessionDirectMessageEnabled, isRouletteDirectMessageEnabled } from "@/lib/discord-bot-config";
import { resolveSessionAnnounceConfig } from "@/lib/community-channels";
import {
  createNotificationEvent,
  enqueueDelivery,
  hasUnsettledDeliveriesWithPrefix,
  isNotificationEventCommunityActive,
  type ClaimedDelivery,
  type NotificationDb,
} from "@/lib/notification-delivery";
import type {
  DeliveryResolver,
  Resolution,
  ResolvedAction,
  ResolvedMessageContent,
  ResolveInput,
  TerminalDiscordFailureInput,
} from "@/lib/notification-executor";
import type { DiscordRestEmbed } from "@/lib/discord-rest";

/**
 * Chantier annonces Discord bot — SESSION uniquement dans cette PR
 * (TOURNAMENT explicitement différé, voir README). Relie les fondations
 * de livraison (#95), le client REST (#96) et l'exécuteur (#97) à un vrai
 * événement métier. `discord-announce.ts`/`discord-session-created.ts`/
 * `discord-session-modified.ts` (webhook legacy) restent inchangés en
 * CODE, mais voir le chantier confidentialité ci-dessous pour leur
 * comportement RÉEL désormais.
 *
 * CHANTIER CONFIDENTIALITÉ DES SOIRÉES — remplace l'ancien choix
 * d'annonces collectives : une soirée n'appartient plus qu'à son créateur
 * et ses invités actifs (`SessionInvite`, voir src/lib/session-access.ts),
 * sur le site ET sur Discord. Deux conséquences structurelles sur ce
 * module :
 *   - `thread` n'est plus un fil PUBLIC créé à partir d'un message posté
 *     dans le salon #🎮-soirées — c'est désormais un fil PRIVÉ
 *     (`GUILD_PRIVATE_THREAD`, `startPrivateThread`, discord-rest.ts),
 *     créé SANS message source, donc SANS jamais rien poster dans le
 *     salon public. `announce` (le contenu) est donc maintenant posté
 *     DANS ce fil, jamais dans le salon — la dépendance s'est INVERSÉE
 *     par rapport à l'organisation d'origine (`announce` dépend
 *     maintenant de `thread`, plus l'inverse).
 *   - Un cinquième rôle, `invite:<inviteId>` (un par ligne `SessionInvite`),
 *     synchronise l'appartenance au fil privé avec l'invitation
 *     applicative — ajoute ou retire le membre Discord correspondant
 *     selon le statut ACTUEL de l'invitation au moment du TRAITEMENT
 *     (jamais depuis un instantané pris à l'enqueue), voir
 *     `resolveInviteSync`.
 *   - **Correction (revue ciblée, bug remonté en test réel) — sixième
 *     rôle, `creator-member`** : le CRÉATEUR d'une soirée n'a jamais de
 *     ligne `SessionInvite` (`inviteToSession` l'exclut lui-même de sa
 *     propre sélection — il a accès via `createdById`, jamais via une
 *     invitation) et n'était donc JAMAIS ajouté comme membre du fil
 *     PRIVÉ : seul `resolveInviteSync` (ci-dessus) ajoutait des membres,
 *     exclusivement à partir de `SessionInvite`. Le créateur pouvait voir
 *     le fil listé (ex. "Plus de fils actifs", si son compte Discord
 *     détient par ailleurs `MANAGE_THREADS` sur le serveur — un simple
 *     effet de bord de permissions de modération, jamais une garantie
 *     applicative) sans jamais y être RÉELLEMENT membre. `creator-member`
 *     (SEND, occurrence fixe à la création — voir
 *     `enqueueSessionCreatorThreadMembership`) ajoute explicitement le
 *     créateur, une seule fois, dès que `thread` est `SENT` — jamais
 *     retiré ensuite (contrairement à un invité, l'accès du créateur
 *     n'est jamais révocable).
 *
 * `isSessionAnnounceViaBotEnabled()` continue de gouverner UNIQUEMENT le
 * TRANSPORT à la création (bot vs webhook, figé sur `announceViaBot`,
 * jamais relu ensuite — voir schema.prisma). Le chemin webhook
 * (`announceViaBot: false`) n'a en revanche plus AUCUN moyen privé
 * d'annoncer une soirée : voir `discord-announce.ts`/
 * `discord-session-created.ts`/`discord-session-modified.ts`, dont les
 * appels réels sont désormais des no-op documentés côté appelants
 * (`sessions.ts`/`session-lifecycle.ts`/`roulette.ts`) plutôt que de
 * publier la moindre donnée de soirée dans un salon public. Voir le
 * README ("Transition et retour arrière") pour le détail de cette
 * bascule et ses limites assumées.
 *
 * Organisation : un SEUL fil privé par soirée, sur le salon PARENT
 * configuré (`DISCORD_BOT_SESSION_CHANNEL_ID`, jamais une destination
 * choisie par un formulaire — le salon lui-même reste public, seul le fil
 * qui y est créé est privé). Cinq rôles de `targetSlot`, chacun une ligne
 * `NotificationDelivery` distincte, qui progressent indépendamment (voir
 * `notification-delivery.ts`) :
 *   - `thread` — SEND une fois, crée le fil privé (aucune dépendance).
 *   - `announce` — SEND une fois le fil créé, puis une EDIT à chaque
 *     changement d'état ultérieur (modification de créneau, clôture,
 *     annulation), POSTÉ DANS LE FIL — TOUJOURS rendu depuis l'état
 *     COURANT de la session en base au moment où l'EDIT est réellement
 *     traitée, jamais depuis un texte figé à l'enqueue : une EDIT plus
 *     ancienne ne peut donc jamais écraser un état plus récent
 *     (convergence déjà garantie par `claimNextDelivery`, jamais
 *     réimplémentée ici). Dépend que `thread` soit `SENT` (résolu ici,
 *     PAS automatiquement par `claimNextDelivery`, qui ne résout que les
 *     dépendances SUR LE MÊME targetSlot).
 *   - `thread-reminder-<minutes>` — SEND, un par palier de rappel dû,
 *     posté DANS le fil ; dépend que `thread` soit `SENT`.
 *   - `thread-summary` — SEND, résumé posté DANS le fil à la clôture ;
 *     même dépendance sur `thread`.
 *   - `thread-validated` — SEND une fois, « Soirée validée : {jeu} » avec
 *     mention des joueurs du jeu retenu, posté DANS le fil, + MP
 *     (`dm:validated:<userId>`) aux joueurs et au créateur.
 *   - `thread-date-<changeId>` — SEND (occurrence aléatoire, une par
 *     changement de date) : message avec mention dans le fil + nouveau MP
 *     « Date modifiée » (`dm:date:<changeId>:<userId>`).
 *   - `dm:announce:<userId>` — le MP d'invitation : SEND à la création, puis
 *     EDIT (même targetSlot, jamais un nouveau MP) à chaque modification ou
 *     fin de soirée.
 *   - `invite:<inviteId>` — SEND (occurrence aléatoire, une par
 *     changement de statut de l'invitation), ajoute/retire le membre
 *     Discord correspondant ; dépend aussi que `thread` soit `SENT`.
 *
 * Aucune notification interne (`createNotifications`) en doublon de
 * celles déjà écrites par le chemin webhook : une session `announceViaBot`
 * n'appelle JAMAIS les fonctions `discord-session-created.ts`/etc, donc
 * leurs propres `createNotifications` ne s'exécutent jamais pour elle —
 * SEUL ce module écrit les notifications in-app d'une session bot,
 * juste avant l'appel Discord correspondant, avec EXACTEMENT les mêmes
 * destinataires que les mentions (jamais un ensemble différent).
 */

const GUILD_SLOT_PREFIX = "default-guild";

function announceSlot(sessionId: string): string {
  return `${GUILD_SLOT_PREFIX}:SESSION:${sessionId}:announce`;
}
function threadSlot(sessionId: string): string {
  return `${GUILD_SLOT_PREFIX}:SESSION:${sessionId}:thread`;
}
function threadReminderSlot(sessionId: string, minutes: number): string {
  return `${GUILD_SLOT_PREFIX}:SESSION:${sessionId}:thread-reminder-${minutes}`;
}
function threadValidatedSlot(sessionId: string): string {
  return `${GUILD_SLOT_PREFIX}:SESSION:${sessionId}:thread-validated`;
}
function threadDateSlot(sessionId: string, changeId: string): string {
  return `${GUILD_SLOT_PREFIX}:SESSION:${sessionId}:thread-date-${changeId}`;
}
function threadSummarySlot(sessionId: string): string {
  return `${GUILD_SLOT_PREFIX}:SESSION:${sessionId}:thread-summary`;
}
function inviteSlot(sessionId: string, inviteId: string): string {
  return `${GUILD_SLOT_PREFIX}:SESSION:${sessionId}:invite:${inviteId}`;
}
function creatorMemberSlot(sessionId: string): string {
  return `${GUILD_SLOT_PREFIX}:SESSION:${sessionId}:creator-member`;
}
function threadDeleteSlot(sessionId: string): string {
  return `${GUILD_SLOT_PREFIX}:SESSION:${sessionId}:thread-delete`;
}
function threadArchiveSlot(sessionId: string): string {
  return `${GUILD_SLOT_PREFIX}:SESSION:${sessionId}:thread-archive`;
}

/**
 * Nettoyage automatique des fils (V2) — emplacements lus par le
 * planificateur `discord-thread-cleanup.ts`, jamais reconstruits là-bas
 * à la main : une seule définition des `targetSlot` d'une soirée.
 */
export function sessionThreadCleanupSlots(sessionId: string) {
  return {
    prefix: `${GUILD_SLOT_PREFIX}:SESSION:${sessionId}:`,
    thread: threadSlot(sessionId),
    archive: threadArchiveSlot(sessionId),
    delete: threadDeleteSlot(sessionId),
  };
}

const NO_MENTIONS_PARSE: { parse: [] } = { parse: [] };

/* -------------------------------------------------------------------- */
/* MP des soirées (V2) — un MP par pote concerné, mention de secours     */
/* -------------------------------------------------------------------- */

/**
 * Rôles d'un `targetSlot` de MP : `dm:<kind>:<userId>` où `<kind>` vaut
 * `announce` (invitation, ÉDITÉE ensuite à chaque changement/fin de soirée),
 * `date:<eventId>` (nouveau MP « Date modifiée »), `validated` (soirée
 * validée) ou `reminder:<minutes>` (rappel) — ces trois derniers en plus du
 * message du fil, créateur inclus (MP oui, mention non). Mention de secours
 * dans le fil (MP fermé, créateur seulement) : `dm-fallback:<kind>:<userId>`,
 * même `<kind>` que le MP d'origine. Un `userId` (cuid) ne contient jamais `:`.
 *
 * L'ancien kind `update:<eventId>` n'est plus jamais mis en file (l'invitation
 * est éditée) ; ses lignes déjà en file sont abandonnées (`expired`).
 */
type DmKind = "announce" | "validated" | `date:${string}` | `reminder:${string}`;

function dmSlot(sessionId: string, kind: DmKind, userId: string): string {
  return `${GUILD_SLOT_PREFIX}:SESSION:${sessionId}:dm:${kind}:${userId}`;
}
function dmFallbackSlot(sessionId: string, kind: string, userId: string): string {
  return `${GUILD_SLOT_PREFIX}:SESSION:${sessionId}:dm-fallback:${kind}:${userId}`;
}

const DM_UNAVAILABLE_ERROR_CLASS = "discord:dm_unavailable";

/**
 * Met en file un MP par destinataire (idempotent : un seul MP par
 * `[soirée, kind, pote]`, un retry du résolveur retombe sur la même ligne)
 * et renvoie les potes DÉSORMAIS couverts par un MP (leur mention dans le fil
 * est conservée : double ping, voir `buildMessageContent`). Jamais couverts :
 *   - un pote dont un MP de cette soirée a déjà échoué en `dm_unavailable`
 *     (MP fermé : aucune nouvelle tentative ; le créateur est alors mentionné
 *     en secours dans le fil, les invités le sont de toute façon) ;
 *   - pour `date`, un pote qui n'a jamais reçu le MP d'invitation (pas de
 *     MP surprise pour une soirée annoncée sans MP).
 * Uniquement des écritures — jamais d'appel Discord (voir le commentaire de
 * fichier de `notification-delivery.ts`).
 */
async function enqueueSessionDirectMessages<T extends { id: string }>(
  sessionId: string,
  kind: DmKind,
  users: T[]
): Promise<{ covered: T[]; blocked: T[] }> {
  if (users.length === 0) return { covered: [], blocked: [] };
  const prefix = `${GUILD_SLOT_PREFIX}:SESSION:${sessionId}:dm:`;
  const known = await prisma.notificationDelivery.findMany({
    where: { targetSlot: { startsWith: prefix }, recipientKey: { in: users.map((u) => `user:${u.id}`) } },
    select: { targetSlot: true, recipientKey: true, errorClass: true },
  });
  const blocked = new Set(known.filter((d) => d.errorClass === DM_UNAVAILABLE_ERROR_CLASS).map((d) => d.recipientKey));
  const announced = new Set(known.filter((d) => d.targetSlot.includes(":dm:announce:")).map((d) => d.recipientKey));

  const blockedUsers = users.filter((u) => blocked.has(`user:${u.id}`));
  const covered = users.filter((u) => {
    const key = `user:${u.id}`;
    if (blocked.has(key)) return false;
    return kind.startsWith("date:") ? announced.has(key) : true;
  });
  if (covered.length === 0) return { covered: [], blocked: blockedUsers };

  const event = await createNotificationEvent({
    category: "SESSION",
    eventType: "SESSION_DM",
    sourceId: sessionId,
    occurrence: kind,
  });
  for (const user of covered) {
    await enqueueDelivery({
      eventId: event.id,
      channel: "DISCORD_DM",
      transport: "BOT",
      operation: "SEND",
      recipientKey: `user:${user.id}`,
      targetSlot: dmSlot(sessionId, kind, user.id),
    });
  }
  return { covered, blocked: blockedUsers };
}

/**
 * Le CRÉATEUR reçoit aussi les MP de sa soirée (invitation, date modifiée,
 * validation, rappels), comme les invités — il n'est jamais dans la sélection
 * `notifiedUserIds` ni dans les invitations (accès non révocable, voir
 * `session-access.ts`), donc hors de `resolveEligibleMentions`. Seule sa
 * préférence personnelle (`SESSION`, ou `ROULETTE` pour une soirée issue
 * d'une roulette) reste appliquée, comme pour tout le monde.
 */
async function resolveCreatorDmRecipient(session: Pick<Session, "createdById" | "createdViaRoulette" | "communityId">) {
  if (!(await isMemberOfCommunity(session.createdById, session.communityId))) return null;
  const creator = await prisma.user.findUnique({ where: { id: session.createdById } });
  if (!creator) return null;
  const category = session.createdViaRoulette ? "ROULETTE" : "SESSION";
  const [allowed] = await filterUsersByNotificationPreference([creator], category);
  return allowed ?? null;
}

/** Éligibilité d'un destinataire de MP relue à l'envoi : le créateur
 * n'est soumis qu'à sa préférence, tout autre pote à la règle complète
 * des mentions (sélection, invitation active, préférence). */
async function isDmRecipientEligible(
  session: Pick<Session, "id" | "createdById" | "notifiedUserIds" | "createdViaRoulette" | "communityId">,
  recipient: User
): Promise<boolean> {
  if (recipient.id === session.createdById) return (await resolveCreatorDmRecipient(session)) !== null;
  return (await resolveEligibleMentions(session, [recipient])).length > 0;
}

/**
 * MP fermé (`discord:dm_unavailable`, jamais une autre erreur) : trace
 * l'échec (déjà écrite par l'exécuteur) ET, pour le CRÉATEUR seulement, met
 * en file une mention de secours dans le fil de la soirée — dans la MÊME transaction que le
 * passage à FAILED. Jamais de nouvelle tentative de MP. Idempotent
 * (occurrence = `targetSlot` du MP d'origine).
 */
async function enqueueDirectMessageFallback(input: TerminalDiscordFailureInput): Promise<void> {
  const { delivery, event, errorClass, db } = input;
  if (event.category !== "SESSION" || delivery.channel !== "DISCORD_DM" || delivery.operation !== "SEND") return;
  if (errorClass !== DM_UNAVAILABLE_ERROR_CLASS) return;
  const role = delivery.targetSlot.split(":").slice(3).join(":");
  if (!role.startsWith("dm:")) return;
  const rest = role.slice("dm:".length);
  const userId = rest.slice(rest.lastIndexOf(":") + 1);
  const kind = rest.slice(0, rest.lastIndexOf(":"));
  // Les invités sont TOUJOURS mentionnés dans le fil (double ping) : un
  // message de secours serait un second ping inutile. Seul le créateur, qui
  // n'est jamais mentionné, a besoin du secours.
  const session = await prisma.session.findUnique({ where: { id: event.sourceId }, select: { createdById: true } });
  if (session?.createdById !== userId) return;

  const fallbackEvent = await createNotificationEvent(
    { category: "SESSION", eventType: "SESSION_DM_FALLBACK", sourceId: event.sourceId, occurrence: delivery.targetSlot },
    db
  );
  await enqueueDelivery(
    {
      eventId: fallbackEvent.id,
      channel: "DISCORD_CHANNEL",
      transport: "BOT",
      operation: "SEND",
      recipientKey: `user:${userId}`,
      targetSlot: dmFallbackSlot(event.sourceId, kind, userId),
    },
    db
  );
}

/* -------------------------------------------------------------------- */
/* Enqueue — appelé depuis les points d'entrée métier existants          */
/* -------------------------------------------------------------------- */

/**
 * SEND une fois pour toutes (annonce + fil) — occurrence FIXE (vide),
 * jamais un identifiant aléatoire : un appel répété (retry applicatif)
 * doit retomber sur le MÊME `NotificationEvent`, donc sur les MÊMES
 * lignes `NotificationDelivery` via l'idempotence déjà garantie par
 * `createNotificationEvent`/`enqueueDelivery` — jamais un second SEND
 * pour la même cible (contrat documenté dans notification-delivery.ts).
 *
 * `db` optionnel (défaut : client global) — passer le `tx` d'un
 * `prisma.$transaction` englobant compose cet enqueue avec la mutation
 * métier de l'appelant DANS LA MÊME transaction (voir `createSession`,
 * `session-lifecycle.ts`) : si la transaction échoue/rollback pour
 * n'importe quelle raison après la création de la session, l'intention de
 * notification n'existe jamais non plus — jamais une session bot orpheline
 * qui n'annoncerait jamais rien parce que le process a crashé pile entre
 * les deux écritures (l'un des deux angles morts identifiés lors de la
 * revue ciblée de cette PR). Toujours un simple appel Discord HORS de
 * cette transaction ensuite (aucun appel réseau n'est fait ici, seulement
 * des écritures — voir le commentaire de fichier de notification-delivery.ts
 * sur l'interdiction d'appel Discord dans une transaction SQL).
 */
export async function enqueueSessionCreationDeliveries(sessionId: string, db?: NotificationDb, sourceRouletteId?: string): Promise<void> {
  const event = await createNotificationEvent(
    {
      category: "SESSION",
      eventType: "SESSION_CREATED",
      sourceId: sessionId,
      ...(sourceRouletteId ? { payload: { sourceRouletteId } } : {}),
    },
    db
  );
  // `thread` enqueue AVANT `announce` — reflète la dépendance réelle
  // (`announce` dépend de `thread`, voir le commentaire de fichier) : la
  // livraison la plus ancienne éligible est réclamée en premier
  // (`claimNextDelivery`), donc le passage naturel du cron traite `thread`
  // avant `announce` sans détour par `dependency_not_ready` — jamais un
  // ORDRE garanti par ce module (l'exécuteur ne suppose jamais un ordre
  // d'enqueue, voir notification-executor.ts), juste l'ordre le plus
  // efficace pour le cas courant.
  await enqueueDelivery(
    {
      eventId: event.id,
      channel: "DISCORD_CHANNEL",
      transport: "BOT",
      operation: "SEND",
      recipientKey: "channel",
      targetSlot: threadSlot(sessionId),
    },
    db
  );
  await enqueueDelivery(
    {
      eventId: event.id,
      channel: "DISCORD_CHANNEL",
      transport: "BOT",
      operation: "SEND",
      recipientKey: "channel",
      targetSlot: announceSlot(sessionId),
    },
    db
  );
  // Correction (revue ciblée) — le créateur n'a jamais de `SessionInvite`,
  // donc jamais ajouté au fil par `resolveInviteSync` seul (voir le
  // commentaire de fichier). Enqueue-é DANS LA MÊME TRANSACTION que le
  // reste (même garantie d'atomicité) pour TOUTE nouvelle soirée bot,
  // classique ou roulette (un seul appelant, `enqueueSessionCreationDeliveries`,
  // commun aux deux chemins).
  await enqueueSessionCreatorThreadMembership(sessionId, db);
}

/**
 * Ajoute le CRÉATEUR comme membre du fil privé — jamais retiré ensuite
 * (contrairement à un invité via `SessionInvite`/`resolveInviteSync`) :
 * l'accès du créateur n'est jamais révocable, voir `session-access.ts`.
 *
 * Occurrence ALÉATOIRE (comme `enqueueSessionInviteSync`, jamais fixe
 * comme `enqueueSessionCreationDeliveries`) : appelée automatiquement une
 * fois à la création (bundlée ci-dessus), mais aussi rappelable
 * MANUELLEMENT (réessai créateur depuis `/sessions/[id]/invites`, voir
 * `retrySessionCreatorThreadSyncAction`) pour deux cas que l'occurrence
 * fixe ne couvrirait pas : une soirée créée AVANT ce correctif (jamais
 * enqueue-ée la première fois, aucune ligne `NotificationDelivery` à
 * retenter) et une synchronisation `FAILED` (terminale, jamais retentée
 * automatiquement par le cron — voir notification-executor.ts). Un
 * appel répété crée une NOUVELLE ligne à chaque fois ; seule la plus
 * récente survit (convergence `[targetSlot, operation]`,
 * `claimNextDelivery`, #95) — jamais un doublon d'ajout traité en double.
 *
 * `db` optionnel — même contrat que les autres enqueue de ce module.
 */
export async function enqueueSessionCreatorThreadMembership(sessionId: string, db?: NotificationDb): Promise<void> {
  const event = await createNotificationEvent(
    {
      category: "SESSION",
      eventType: "SESSION_CREATOR_MEMBER",
      sourceId: sessionId,
      occurrence: randomUUID(),
    },
    db
  );
  await enqueueDelivery(
    {
      eventId: event.id,
      channel: "DISCORD_CHANNEL",
      transport: "BOT",
      operation: "SEND",
      recipientKey: "creator",
      targetSlot: creatorMemberSlot(sessionId),
    },
    db
  );
}

/**
 * EDIT — appelée à CHAQUE changement d'état pertinent (modification de
 * créneau, clôture avec résultat, annulation). Occurrence ALÉATOIRE à
 * dessein, contrairement au SEND ci-dessus : chaque appel représente une
 * occurrence métier RÉELLEMENT DISTINCTE (l'état a changé), donc doit
 * produire une NOUVELLE ligne `NotificationDelivery` — c'est cette
 * multiplicité qui alimente la convergence "seule la plus récente
 * survit" déjà garantie par `claimNextDelivery` (voir #95). Ne rend
 * jamais elle-même le contenu : le résolveur relit l'état actuel de la
 * session au moment du traitement (voir `resolveAnnounceRendering`).
 *
 * `db` optionnel (défaut : client global) — même contrat que
 * `enqueueSessionCreationDeliveries` : passer le `tx` d'un
 * `prisma.$transaction` englobant compose cette EDIT avec la mutation
 * métier de l'appelant (édition, annulation, clôture) DANS LA MÊME
 * transaction (voir `editSessionAction`/`cancelSession`/`closeSession`).
 * Idempotence NON compromise par un retry applicatif malgré l'occurrence
 * aléatoire : si la transaction rollback, cet appel n'a jamais commité
 * non plus — un nouvel essai de l'appelant tire une nouvelle occurrence
 * pour une mutation qui, elle aussi, n'a jamais eu lieu ; aucune livraison
 * fantôme ne peut donc apparaître pour une mutation qui n'a pas eu lieu.
 */
export async function enqueueSessionAnnounceUpdate(sessionId: string, db?: NotificationDb): Promise<void> {
  const event = await createNotificationEvent(
    {
      category: "SESSION",
      eventType: "SESSION_MODIFIED",
      sourceId: sessionId,
      occurrence: randomUUID(),
    },
    db
  );
  await enqueueDelivery(
    {
      eventId: event.id,
      channel: "DISCORD_CHANNEL",
      transport: "BOT",
      operation: "EDIT",
      recipientKey: "channel",
      targetSlot: announceSlot(sessionId),
    },
    db
  );
  await enqueueSessionDirectMessageEdits(sessionId, db);
}

/**
 * Édite les MP d'invitation DÉJÀ envoyés (jamais un nouveau MP) : un EDIT sur
 * le même `targetSlot` que le SEND d'origine, pour chaque pote dont le MP
 * `announce` est `SENT`. Un MP jamais envoyé, fermé ou encore en attente est
 * ignoré (le SEND en attente rend de toute façon l'état courant). Lecture via
 * le client global (lignes déjà committées), écritures via `db`.
 */
async function enqueueSessionDirectMessageEdits(sessionId: string, db?: NotificationDb): Promise<void> {
  if (!isSessionDirectMessageEnabled()) return;
  const sent = await prisma.notificationDelivery.findMany({
    where: {
      targetSlot: { startsWith: `${GUILD_SLOT_PREFIX}:SESSION:${sessionId}:dm:announce:` },
      operation: "SEND",
      status: "SENT",
    },
    select: { targetSlot: true, recipientKey: true },
  });
  if (sent.length === 0) return;
  const event = await createNotificationEvent(
    { category: "SESSION", eventType: "SESSION_DM_EDIT", sourceId: sessionId, occurrence: randomUUID() },
    db
  );
  for (const delivery of sent) {
    await enqueueDelivery(
      {
        eventId: event.id,
        channel: "DISCORD_DM",
        transport: "BOT",
        operation: "EDIT",
        recipientKey: delivery.recipientKey,
        targetSlot: delivery.targetSlot,
      },
      db
    );
  }
}

/**
 * Soirée validée (vote clos avec un jeu retenu, ou tirage) : message distinct
 * « Soirée validée : {jeu} » dans le fil, avec mention des joueurs — une
 * édition de l'annonce ne notifie personne. MP en plus (voir
 * `resolveThreadValidated`). Occurrence FIXE (un seul
 * message par soirée). Jamais appelé pour une soirée de roulette, créée
 * directement validée (son message de création le dit déjà).
 */
export async function enqueueSessionValidated(sessionId: string, db?: NotificationDb): Promise<void> {
  const event = await createNotificationEvent(
    { category: "SESSION", eventType: "SESSION_VALIDATED", sourceId: sessionId },
    db
  );
  await enqueueDelivery(
    {
      eventId: event.id,
      channel: "DISCORD_CHANNEL",
      transport: "BOT",
      operation: "SEND",
      recipientKey: "channel",
      targetSlot: threadValidatedSlot(sessionId),
    },
    db
  );
}

/**
 * Changement de date : message avec mention dans le fil + nouveau MP « Date
 * modifiée » (mis en file à l'envoi du message). Occurrence ALÉATOIRE : une
 * ligne par changement. L'annonce et le MP d'invitation sont édités à part
 * (`enqueueSessionAnnounceUpdate`, à appeler aussi).
 */
export async function enqueueSessionDateChange(sessionId: string, db?: NotificationDb, previousDate?: Date): Promise<void> {
  const changeId = randomUUID();
  const event = await createNotificationEvent(
    { category: "SESSION", eventType: "SESSION_DATE_CHANGED", sourceId: sessionId, occurrence: changeId, ...(previousDate ? { payload: { previousDate: previousDate.toISOString() } } : {}) },
    db
  );
  await enqueueDelivery(
    {
      eventId: event.id,
      channel: "DISCORD_CHANNEL",
      transport: "BOT",
      operation: "SEND",
      recipientKey: "channel",
      targetSlot: threadDateSlot(sessionId, changeId),
    },
    db
  );
}

/**
 * SEND une fois (occurrence fixe, même raisonnement que la création) —
 * résumé posté dans le fil à la clôture, EN PLUS de l'EDIT de l'annonce
 * (`enqueueSessionAnnounceUpdate`, à appeler séparément par l'appelant).
 *
 * `db` optionnel — même contrat que ci-dessus.
 */
export async function enqueueSessionResultThreadSummary(sessionId: string, db?: NotificationDb): Promise<void> {
  const event = await createNotificationEvent(
    {
      category: "SESSION",
      eventType: "SESSION_RESULT",
      sourceId: sessionId,
    },
    db
  );
  await enqueueDelivery(
    {
      eventId: event.id,
      channel: "DISCORD_CHANNEL",
      transport: "BOT",
      operation: "SEND",
      recipientKey: "channel",
      targetSlot: threadSummarySlot(sessionId),
    },
    db
  );
}

/** SEND une fois par palier de rappel (occurrence = le palier lui-même,
 * fixe par nature) — un appel répété pour le MÊME palier déjà dû est
 * sans effet (idempotent), sûr à rappeler depuis le cron à chaque
 * passage tant que le palier reste dû. Pas de paramètre `db` : appelée
 * depuis le cron rappels, jamais couplée à une mutation métier atomique
 * (aucune mutation métier n'accompagne un rappel — voir le README). */
export async function enqueueSessionReminderDelivery(sessionId: string, minutes: number): Promise<void> {
  const event = await createNotificationEvent({
    category: "SESSION",
    eventType: "SESSION_REMINDER",
    sourceId: sessionId,
    occurrence: String(minutes),
  });
  await enqueueDelivery({
    eventId: event.id,
    channel: "DISCORD_CHANNEL",
    transport: "BOT",
    operation: "SEND",
    recipientKey: "channel",
    targetSlot: threadReminderSlot(sessionId, minutes),
  });
}

/**
 * Chantier confidentialité des soirées — synchronise l'appartenance au
 * fil privé pour UNE invitation (`src/app/sessions/actions/invites.ts`,
 * appelée à chaque invitation/révocation). Occurrence ALÉATOIRE, même
 * targetSlot à chaque appel (dérivé de `inviteId`, stable pour toute la
 * vie de cette ligne `SessionInvite`) — même raisonnement que
 * `enqueueSessionAnnounceUpdate` : un appel répété (double clic, ou
 * invite→revoke→invite rapprochés) crée une NOUVELLE ligne
 * `NotificationDelivery`, dont seule la plus récente survit
 * (`claimNextDelivery`, convergence "seule la plus récente survit" par
 * `[targetSlot, operation]`) — jamais une ancienne intention périmée
 * traitée après une plus récente. `operation: "SEND"` (jamais "EDIT")
 * pour CHAQUE appel : l'action réelle (ajout ou retrait) n'est décidée
 * qu'au TRAITEMENT, en relisant le statut actuel de l'invitation
 * (`resolveInviteSync`), jamais depuis l'occurrence de l'enqueue
 * elle-même — c'est ce qui garantit qu'une révocation survenue APRÈS
 * l'enqueue d'un ajout (mais avant son traitement) résout quand même vers
 * un retrait.
 *
 * `db` optionnel — même contrat que les enqueue ci-dessus (composable
 * avec la transaction de `inviteToSession`/`revokeSessionInvite` par
 * l'appelant si besoin, quoique non utilisé ainsi actuellement : les
 * actions serveur appellent cette fonction APRÈS la mutation, jamais dans
 * la même transaction — un échec d'enqueue ici ne doit jamais annuler une
 * invitation/révocation déjà actée côté accès applicatif, qui est la
 * garantie prioritaire ; la synchronisation Discord reste rattrapable au
 * prochain appel, l'accès applicatif ne l'est pas).
 */
export async function enqueueSessionInviteSync(inviteId: string, db?: NotificationDb): Promise<void> {
  // Lecture toujours via le client global, jamais `db` (typé `NotificationDb`,
  // volontairement restreint à `notificationEvent`/`notificationDelivery` —
  // voir son commentaire dans notification-delivery.ts) : cette lecture
  // n'a de toute façon pas besoin de cohérence transactionnelle avec
  // l'écriture appelante (voir le commentaire de fonction ci-dessus, sur
  // pourquoi cette fonction n'est jamais appelée DANS la même transaction
  // que la mutation de l'invitation) — SAUF `enqueueSessionInviteSyncForNewInvite`
  // ci-dessous, qui contourne délibérément cette lecture pour le cas où elle
  // serait invalide (voir son commentaire).
  const invite = await prisma.sessionInvite.findUnique({
    where: { id: inviteId },
    select: { sessionId: true },
  });
  if (!invite) return;

  await enqueueInviteSyncDelivery(invite.sessionId, inviteId, db);
}

/**
 * Bug remonté (test réel, complément au diagnostic `creator-member`
 * ci-dessus) — les invités sélectionnés SUR LE FORMULAIRE DE CRÉATION
 * (`notifiedUserIds`, classique ET roulette : `createSession` dans
 * session-lifecycle.ts, `createRouletteResultSession` dans sessions.ts)
 * obtenaient bien une ligne `SessionInvite` (accès applicatif correct dès
 * la création), mais AUCUNE synchronisation Discord n'était jamais
 * enqueue-ée pour eux : seul `addSessionInviteAction` (bouton "inviter" de
 * la page `/sessions/[id]/invites`, ajout APRÈS création) appelait
 * `enqueueSessionInviteSync`. Un invité sélectionné à la création n'était
 * donc JAMAIS ajouté comme membre du fil privé par ce chemin — exactement
 * le même symptôme que le bug `creator-member`, mais pour les invités,
 * pas seulement le créateur, et sur LES DEUX parcours de création (la
 * roulette n'est pas épargnée : `createRouletteResultSession` a la même
 * lacune). Seul un réinvite manuel ultérieur via la page invités (qui,
 * lui, appelle bien `enqueueSessionInviteSync`) déclenchait la
 * synchronisation — expliquant qu'un fil de test ayant reçu ce geste
 * manuel affiche des membres alors qu'un autre, jamais retouché après
 * création, n'affiche que le bot.
 *
 * Appelée par `createSession`/`createRouletteResultSession` DANS LA MÊME
 * transaction que `inviteToSession` (même garantie d'atomicité que
 * `enqueueSessionCreationDeliveries` : un crash entre les deux ne doit
 * jamais laisser un invité avec accès applicatif mais sans la moindre
 * intention de synchronisation Discord enqueue-ée). Contourne DÉLIBÉRÉMENT
 * la lecture par le client global de `enqueueSessionInviteSync` ci-dessus
 * (qui ne verrait pas encore la ligne `SessionInvite` non committée créée
 * dans la même transaction) : l'appelant a déjà l'id de session ET l'id
 * d'invite en main (retournés par `inviteToSession(tx)`), aucune relecture
 * n'est nécessaire ni possible ici.
 */
export async function enqueueSessionInviteSyncForNewInvite(
  sessionId: string,
  inviteId: string,
  db?: NotificationDb
): Promise<void> {
  await enqueueInviteSyncDelivery(sessionId, inviteId, db);
}

async function enqueueInviteSyncDelivery(sessionId: string, inviteId: string, db?: NotificationDb): Promise<void> {
  const event = await createNotificationEvent(
    {
      category: "SESSION",
      eventType: "SESSION_INVITE_SYNC",
      sourceId: sessionId,
      occurrence: randomUUID(),
    },
    db
  );
  await enqueueDelivery(
    {
      eventId: event.id,
      channel: "DISCORD_CHANNEL",
      transport: "BOT",
      operation: "SEND",
      recipientKey: `user:${inviteId}`,
      targetSlot: inviteSlot(sessionId, inviteId),
    },
    db
  );
}

/**
 * État de synchronisation Discord de chaque invitation — pour
 * l'interface de gestion (`/sessions/[id]/invites`), jamais présentée
 * comme instantanée : lit la DERNIÈRE livraison connue (par `sequence`,
 * en ignorant `SKIPPED` — une intention périmée par une plus récente,
 * jamais l'état réel visé) sur le `targetSlot` de chaque invitation.
 * `"pending"` par défaut (aucune livraison connue, ou encore PENDING/
 * RESERVED/RETRYING) — jamais `"synced"` par optimisme.
 */
export async function getSessionInviteSyncStatuses(
  sessionId: string,
  inviteIds: string[]
): Promise<Map<string, "synced" | "pending" | "failed">> {
  const result = new Map<string, "synced" | "pending" | "failed">();
  if (inviteIds.length === 0) return result;

  const targetSlots = inviteIds.map((id) => inviteSlot(sessionId, id));
  const deliveries = await prisma.notificationDelivery.findMany({
    where: { targetSlot: { in: targetSlots }, operation: "SEND" },
    orderBy: { sequence: "desc" },
    select: { targetSlot: true, status: true },
  });

  const latestBySlot = new Map<string, "synced" | "pending" | "failed">();
  for (const delivery of deliveries) {
    if (latestBySlot.has(delivery.targetSlot) || delivery.status === "SKIPPED") continue;
    latestBySlot.set(
      delivery.targetSlot,
      delivery.status === "SENT" ? "synced" : delivery.status === "FAILED" ? "failed" : "pending"
    );
  }

  for (const inviteId of inviteIds) {
    result.set(inviteId, latestBySlot.get(inviteSlot(sessionId, inviteId)) ?? "pending");
  }
  return result;
}

/** État de la DERNIÈRE livraison connue d'un `targetSlot` donné — même
 * logique que `getSessionInviteSyncStatuses` (ignore `SKIPPED`, une
 * intention périmée par une plus récente jamais l'état réel visé),
 * factorisée ici pour être réutilisée par plusieurs `targetSlot`
 * distincts (`thread`, `creator-member`) sans dupliquer la requête. */
async function latestDeliveryStatus(
  targetSlot: string,
  operation: "SEND" | "EDIT" = "SEND"
): Promise<"pending" | "synced" | "failed"> {
  const deliveries = await prisma.notificationDelivery.findMany({
    where: { targetSlot, operation },
    orderBy: { sequence: "desc" },
    select: { status: true },
  });
  const latest = deliveries.find((d) => d.status !== "SKIPPED");
  if (!latest) return "pending";
  if (latest.status === "SENT") return "synced";
  if (latest.status === "FAILED") return "failed";
  return "pending";
}

export type SessionThreadReadiness = "preparing" | "syncing" | "ready" | "failed";

/**
 * État honnête du fil privé POUR LE CRÉATEUR — bug remonté en test réel :
 * jamais "ready" tant que son propre ajout au fil n'est pas confirmé (le
 * créateur pouvait voir le fil listé côté Discord — permissions de
 * modération sur le serveur, sans rapport avec ce module — sans jamais y
 * être RÉELLEMENT membre). Distingue quatre états, jamais un simple
 * booléen "prêt/pas prêt" :
 *   - `"preparing"` — le fil lui-même n'existe pas encore (SEND `thread`
 *     pas encore traité, ou encore en attente après un échec retryable).
 *   - `"syncing"` — le fil existe, mais l'ajout du créateur comme membre
 *     n'est pas encore confirmé.
 *   - `"ready"` — le créateur est confirmé membre du fil.
 *   - `"failed"` — le fil OU l'ajout du créateur a échoué de façon
 *     terminale (jamais retenté automatiquement par le cron — voir
 *     `retrySessionCreatorThreadSyncAction` pour le réessai manuel).
 */
export async function getSessionThreadReadiness(sessionId: string): Promise<SessionThreadReadiness> {
  const threadStatus = await latestDeliveryStatus(threadSlot(sessionId));
  if (threadStatus === "failed") return "failed";
  if (threadStatus === "pending") return "preparing";

  const creatorStatus = await latestDeliveryStatus(creatorMemberSlot(sessionId));
  if (creatorStatus === "failed") return "failed";
  if (creatorStatus === "synced") return "ready";
  return "syncing";
}

/**
 * Bug remonté en revue (complément au diagnostic `creator-member`/
 * `enqueueSessionInviteSyncForNewInvite` ci-dessus) — pour une soirée
 * créée AVANT ces deux correctifs, ni le créateur ni les invités choisis
 * au formulaire n'ont la moindre ligne `NotificationDelivery` : jamais
 * enqueue-ée la première fois, donc rien à retenter automatiquement, et
 * le statut affiché (`getSessionThreadReadiness`/`getSessionInviteSyncStatuses`)
 * reste indéfiniment `"syncing"`/`"pending"` — un état qui laisse croire
 * qu'un passage cron suffira, alors qu'AUCUNE livraison n'existe pour
 * qu'un cron ait quoi que ce soit à traiter. Le réessai par invitation
 * (`retrySessionInviteSyncAction`) et par créateur
 * (`retrySessionCreatorThreadSyncAction`) n'apparaissent QUE sur un
 * statut `"failed"` — jamais atteint ici, donc jamais visibles pour ce
 * cas précis.
 *
 * Resynchronisation manuelle GROUPÉE, réservée au créateur
 * (`resyncSessionThreadMembersAction`, invites.ts, vérifie déjà
 * `assertOwnsSession`) : re-enqueue l'ajout du créateur ET la
 * synchronisation de CHAQUE invitation ACTIVE relue À CET INSTANT — ne
 * touche JAMAIS une invitation révoquée (aucun risque de rétablir un
 * accès coupé), ne recrée JAMAIS le fil (dépend toujours de `thread`
 * SENT, comme toute opération de ce module) et ne renvoie AUCUNE
 * annonce. Aucun contrôle de confidentialité court-circuité : chaque
 * livraison enqueue-ée ici relit le statut RÉEL de l'invitation/l'accès
 * au traitement effectif, exactement comme un enqueue individuel
 * (`resolveInviteSync`/`resolveCreatorThreadMembership`) — une
 * invitation révoquée entre cet appel et le traitement réel résout quand
 * même vers un retrait, jamais un ajout périmé. Sans effet sur les
 * personnes déjà membres (le PUT `add_thread_member` est idempotent par
 * construction Discord, déjà documenté ailleurs dans ce module) : un
 * appel répété ne fait jamais de mal, seulement du travail redondant.
 */
export async function resyncSessionThreadMembers(sessionId: string): Promise<void> {
  await enqueueSessionCreatorThreadMembership(sessionId);

  const activeInvites = await prisma.sessionInvite.findMany({
    where: { sessionId, status: "ACTIVE" },
    select: { id: true },
  });
  for (const invite of activeInvites) {
    await enqueueSessionInviteSync(invite.id);
  }
}

/**
 * Chantier nettoyage réel du stockage (V2) — suppression manuelle
 * définitive d'une soirée (`deleteSessionAction`, session-lifecycle.ts) :
 * ferme définitivement (jamais un simple archivage) le fil privé, AVEC ses
 * messages. Occurrence ALÉATOIRE (jamais fixe) — délibérément appelable
 * PLUSIEURS FOIS depuis la même fonction : le premier appel vient
 * automatiquement de `deleteSessionAction` (au moment de la suppression),
 * les suivants viennent d'un réessai manuel (nettoyage échoué de façon
 * terminale — permission refusée, etc.) exposé séparément (voir le README
 * pour la procédure de retry, hors périmètre d'une UI dédiée dans cette
 * PR). Chaque appel crée une NOUVELLE ligne `NotificationDelivery` ; seule
 * la plus récente survit (convergence `[targetSlot, operation]`,
 * `claimNextDelivery`, #95) — jamais deux suppressions traitées en
 * double, un second appel du client Discord sur un fil déjà absent
 * atteint de toute façon l'état cible (voir `performDiscordAction`,
 * équivalence 404 → succès pour `delete_thread_permanent`).
 *
 * `db` optionnel — composable avec la transaction qui supprime la ligne
 * `Session` elle-même (voir `deleteSessionAction`) : un crash entre les
 * deux ne doit jamais laisser une soirée supprimée en base sans que son
 * fil ne soit jamais nettoyé.
 *
 * Ne dépend JAMAIS de l'existence de la ligne `Session` (voir
 * `resolveSessionThreadDelete`, spécifiquement dispatché AVANT le
 * chargement de la session dans le résolveur ci-dessous) : par
 * construction, au moment où cette livraison est réellement traitée, la
 * session a déjà disparu (supprimée dans la même transaction que
 * l'enqueue) — cette fonction n'a donc structurellement de sens QUE pour
 * un nettoyage après coup, jamais pour un fil encore "vivant".
 */
export async function enqueueSessionThreadDelete(sessionId: string, db?: NotificationDb): Promise<void> {
  const event = await createNotificationEvent(
    {
      category: "SESSION",
      eventType: "SESSION_REMOVED",
      sourceId: sessionId,
      occurrence: randomUUID(),
    },
    db
  );
  await enqueueDelivery(
    {
      eventId: event.id,
      channel: "DISCORD_CHANNEL",
      transport: "BOT",
      operation: "SEND",
      recipientKey: "channel",
      targetSlot: threadDeleteSlot(sessionId),
    },
    db
  );
}

/**
 * Nettoyage automatique des fils (V2) — archive ET verrouille le fil d'une
 * soirée terminée/annulée (voir `discord-thread-cleanup.ts`, seul
 * appelant). Occurrence FIXE : un fil ne s'archive qu'une fois, un
 * passage cron répété (ou concurrent) retombe sur la MÊME livraison.
 */
export async function enqueueSessionThreadArchive(sessionId: string, db?: NotificationDb): Promise<void> {
  const event = await createNotificationEvent(
    { category: "SESSION", eventType: "SESSION_THREAD_ARCHIVE", sourceId: sessionId },
    db
  );
  await enqueueDelivery(
    {
      eventId: event.id,
      channel: "DISCORD_CHANNEL",
      transport: "BOT",
      operation: "SEND",
      recipientKey: "channel",
      targetSlot: threadArchiveSlot(sessionId),
    },
    db
  );
}

/**
 * Nettoyage automatique des fils (V2) — suppression définitive programmée
 * par le cron une fois le délai écoulé après l'archivage. Même `targetSlot`
 * que `enqueueSessionThreadDelete` (donc même résolveur, même garde, et
 * même lecture par `getSessionThreadDeleteStatus`), mais occurrence FIXE :
 * contrairement au réessai manuel, un passage cron répété ne doit jamais
 * créer une seconde intention.
 */
export async function enqueueSessionThreadAutoDelete(sessionId: string, db?: NotificationDb): Promise<void> {
  const event = await createNotificationEvent(
    { category: "SESSION", eventType: "SESSION_THREAD_AUTO_DELETE", sourceId: sessionId },
    db
  );
  await enqueueDelivery(
    {
      eventId: event.id,
      channel: "DISCORD_CHANNEL",
      transport: "BOT",
      operation: "SEND",
      recipientKey: "channel",
      targetSlot: threadDeleteSlot(sessionId),
    },
    db
  );
}

/**
 * État de la dernière tentative de nettoyage Discord connue pour une
 * soirée SUPPRIMÉE (la ligne `Session` n'existe plus — lu par son id brut,
 * jamais via une relation Prisma qui échouerait silencieusement). Réservé
 * à un usage d'audit/retry manuel (voir le README, "Nettoyage échoué —
 * état honnête et réessai") : `"never_enqueued"` distingue une soirée
 * jamais passée par le chemin bot (rien à nettoyer) d'un nettoyage
 * réellement en attente/échoué.
 */
export async function getSessionThreadDeleteStatus(
  sessionId: string
): Promise<"never_enqueued" | "pending" | "done" | "failed"> {
  const status = await latestDeliveryStatus(threadDeleteSlot(sessionId));
  if (status === "synced") return "done";
  if (status === "failed") return "failed";
  // `latestDeliveryStatus` renvoie "pending" aussi bien pour "jamais
  // enqueue-é" que pour "en attente réelle" — cette fonction distingue les
  // deux en vérifiant l'existence d'au moins une ligne, contrairement à
  // `latestDeliveryStatus` (facteur commun avec `getSessionThreadDeleteStatus`
  // côté tournoi, même garde).
  const any = await prisma.notificationDelivery.findFirst({
    where: { targetSlot: threadDeleteSlot(sessionId) },
    select: { id: true },
  });
  return any ? "pending" : "never_enqueued";
}

/* -------------------------------------------------------------------- */
/* Résolution — appelée par l'exécuteur (#97), jamais directement        */
/* -------------------------------------------------------------------- */

type SessionWithVotes = Session & {
  deferredRoulette?: boolean;
  createdBy: User;
  proposals: (Proposal & { game: Game; votes: (Vote & { user: User })[] })[];
  invites: (SessionInvite & { user: User })[];
  seats?: (SessionSeat & { user: User })[];
};

async function loadSession(sessionId: string): Promise<SessionWithVotes | null> {
  return prisma.session.findUnique({
    where: { id: sessionId },
    include: {
      createdBy: true,
      proposals: {
        include: { game: true, votes: { include: { user: true } } },
        orderBy: { createdAt: "asc" },
      },
      invites: { include: { user: true } },
      seats: { where: { status: "CONFIRMED" }, include: { user: true } },
    },
  });
}

function absoluteSessionUrl(sessionId: string): string {
  const base = (process.env.AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return `${base}/sessions/${sessionId}`;
}

/**
 * Bug remonté (test réel Discord, 26/09) — les candidats aux mentions
 * d'une soirée encore VOTING (annonce initiale ET rappels) étaient
 * jusqu'ici les VOTANTS des propositions (`Vote`), jamais les invités : à
 * la création, personne n'a encore voté → aucune mention sur le SEND
 * initial, et l'EDIT qui suit (changement de créneau, clôture) ne peut
 * jamais rattraper ça, Discord ne notifiant jamais les mentions ajoutées
 * par édition (voir `resolveAnnounceDelivery`). Corrigé en amont : les
 * candidats sont désormais les invités `ACTIVE` de la soirée, jamais les
 * votants, pour VOTING (branche SCHEDULED/DONE inchangée — le résultat
 * décidé continue de mentionner les votants du jeu gagnant, comportement
 * voulu).
 *
 * Fonction PURE — ne lit rien en base, reçoit `session.invites` déjà
 * chargé par `loadSession` et filtre elle-même le statut plutôt que de
 * dépendre d'un `where` Prisma : testable sans `TEST_DATABASE_URL` (voir
 * `session-announce.pure.test.ts`), contrairement au reste de ce module.
 *
 * JAMAIS le créateur, même pour une roulette où il figure dans
 * `notifiedUserIds` (et serait donc autrement inclus par
 * `resolveEligibleMentions`) : un créateur ne doit jamais se pinger
 * lui-même pour sa propre soirée.
 */
export function resolveInvitedCandidates<U extends { id: string }>(
  invites: { status: "ACTIVE" | "REVOKED"; user: U }[],
  excludeUserId: string
): U[] {
  const seen = new Map<string, U>();
  for (const invite of invites) {
    if (invite.status !== "ACTIVE") continue;
    if (invite.user.id === excludeUserId) continue;
    if (!seen.has(invite.user.id)) seen.set(invite.user.id, invite.user);
  }
  return Array.from(seen.values());
}

/**
 * Restreint une liste de candidats à la sélection `notifiedUserIds` du
 * créateur PUIS à leur préférence personnelle (#98) — dans cet ordre, mais
 * l'ordre n'a pas d'incidence : les deux filtres ne font que RETIRER des
 * destinataires (intersection), jamais en ajouter. Un refus de
 * préférence n'est donc jamais contournable en sélectionnant malgré tout
 * ce destinataire à la création — l'intersection l'exclut de toute façon.
 *
 * Bug remonté en revue (production, sessions Roulette) — catégorie de
 * préférence figée en dur sur `"SESSION"`, alors qu'une session
 * `createdViaRoulette` (`createRouletteResultSession`, src/lib/sessions.ts)
 * doit honorer la préférence `"ROULETTE"`, exactement comme le fait déjà
 * le chemin webhook équivalent (`announceRouletteResult`,
 * discord-roulette.ts). Session relue depuis l'état COURANT à CHAQUE appel
 * (`loadSession`, jamais mise en cache) : cette sélection de catégorie est
 * donc elle aussi correctement réévaluée à l'envoi réel, y compris pour un
 * SEND/EDIT différé traité bien après l'enqueue — même garantie que le
 * reste de ce résolveur (voir le commentaire de fichier).
 *
 * Chantier confidentialité des soirées — troisième filtre RESTRICTIF
 * ajouté : `filterByActiveSessionInvite` (src/lib/session-access.ts)
 * retire quiconque n'a plus d'invitation `ACTIVE` sur cette soirée. Un
 * retrait d'invité doit couper toute NOUVELLE mention/notification, même
 * pour une livraison déjà enqueue avant le retrait — relu ici depuis la
 * base à CHAQUE appel, jamais mis en cache, exactement comme les deux
 * autres filtres.
 */
async function resolveEligibleMentions<
  T extends { id: string; discordId: string; silenceReminders: boolean },
>(
  session: Pick<Session, "id" | "createdById" | "notifiedUserIds" | "createdViaRoulette" | "communityId">,
  candidates: T[]
): Promise<T[]> {
  const notifiedUserIds = resolveNotifiedUserIds(session.notifiedUserIds);
  const restricted = notifiedUserIds ? candidates.filter((u) => notifiedUserIds.includes(u.id)) : candidates;
  const invited = await filterByActiveSessionInvite(session.id, session.createdById, restricted);
  const members = isCommunityIsolationEnabled() && invited.length ? await prisma.user.findMany({
    where: { id: { in: invited.map((u) => u.id) }, ...(await communityMemberUserWhere(session.communityId)) }, select: { id: true },
  }) : invited;
  const current = new Set(members.map((u) => u.id));
  const category = session.createdViaRoulette ? "ROULETTE" : "SESSION";
  return filterUsersByNotificationPreference(invited.filter((u) => current.has(u.id)), category);
}

function mentionContent(users: { discordId: string }[]): { text: string; userIds: string[] } {
  return { text: users.map((u) => `<@${u.discordId}>`).join(" "), userIds: users.map((u) => u.discordId) };
}

interface AnnounceRendering {
  embed: DiscordRestEmbed;
  /** `null` pour un état qui ne mentionne jamais personne (annulation) —
   * distinct d'une liste vide (tout le monde a refusé/a été décoché). */
  candidateMentions: (User & { silenceReminders: boolean })[] | null;
}

/**
 * Rend l'annonce depuis l'état ACTUEL de la session, pour le SEND initial
 * ET pour toute EDIT ultérieure — jamais depuis un texte figé au moment
 * de l'enqueue (voir le commentaire de fichier). Couvre les 4 états
 * observables : VOTING (création/modification), SCHEDULED/DONE avec
 * gagnant (résultat), CANCELLED (annulée).
 */
function resolveAnnounceRendering(session: SessionWithVotes): AnnounceRendering {
  if (session.status === "CANCELLED") {
    return {
      embed: {
        title: "❌ Soirée annulée",
        description: formatDateTimeFr(session.date),
        color: 0xef4444,
      },
      candidateMentions: null,
    };
  }

  if (session.status === "SCHEDULED" || session.status === "DONE") {
    const winner = session.proposals.find((p) => p.gameId === session.decidedGameId);
    if (!winner) {
      // État incohérent (gagnant introuvable) — ne devrait jamais se
      // produire (décidé par `closeSession`, jamais changé ensuite) ;
      // rend un état neutre plutôt que de planter le résolveur.
      return {
        embed: { title: "🎮 Soirée validée", description: formatDateTimeFr(session.date), color: 0x8b5cf6 },
        candidateMentions: null,
      };
    }
    const maxVotes = Math.max(...session.proposals.map((p) => p.votes.length));
    const tie = winner.votes.length === maxVotes && session.proposals.filter((p) => p.votes.length === maxVotes).length > 1;
    return {
      embed: {
        title: `🎮 Soirée validée : ${winner.game.name}`,
        description: formatDateTimeFr(session.date),
        color: 0x8b5cf6,
        fields: [
          { name: "Joueurs", value: session.attendanceCapacity != null ? `${session.seats?.length ?? 0}/${session.attendanceCapacity}` : String(winner.votes.length), inline: true },
          ...(tie ? [{ name: "Note", value: "Égalité de votes — choisi par ancienneté de proposition.", inline: false }] : []),
          { name: "Lien", value: absoluteSessionUrl(session.id) },
        ],
      },
      candidateMentions: session.attendanceCapacity != null ? (session.seats ?? []).map(seat => seat.user) : winner.votes.map((v) => v.user),
    };
  }

  // VOTING — création ou modification de créneau. Candidats = les invités
  // ACTIVE, jamais les votants (voir le commentaire de `resolveInvitedCandidates`).
  return {
    embed: {
      title: "📣 Soirée",
      description: formatDateTimeFr(session.date),
      color: 0x8b5cf6,
      fields: [
        {
          name: "Deadline de vote",
          value: formatDateTimeFr(session.votingDeadline ?? session.date),
          inline: true,
        },
        { name: "Lien", value: absoluteSessionUrl(session.id) },
      ],
    },
    candidateMentions: resolveInvitedCandidates(session.invites, session.createdById),
  };
}

async function buildMessageContent(
  session: SessionWithVotes,
  candidateMentions: (User & { silenceReminders: boolean })[] | null,
  notificationType: "SESSION_CREATED" | "SESSION_RESULT",
  notificationTitle: string,
  notificationMessage: string,
  // Texte visible dans le message Discord lui-même, DISTINCT du texte de
  // la notification interne ci-dessus (souvent identique en substance,
  // mais deux canaux différents) — vide pour announce/thread-summary
  // (l'embed porte déjà toute l'information), non vide pour un rappel
  // (aucun embed, sans quoi le message ne contiendrait QUE des mentions,
  // ou rien du tout si personne n'est éligible à être mentionné).
  discordBodyText = "",
  // MP des soirées (V2) — si fourni ET `DISCORD_DM_SESSION_ENABLED`, chaque
  // pote éligible reçoit un MP (mis en file ici) EN PLUS de sa mention dans
  // le fil (double ping voulu). Secours (mention du créateur) si son MP échoue.
  dmKind?: DmKind,
  // Notification in-app : `false` pour les messages qui complètent une
  // édition d'annonce (déjà notifiée in-app) — jamais deux fois la même.
  inApp = true
): Promise<ResolvedMessageContent> {
  const eligible = candidateMentions ? await resolveEligibleMentions(session, candidateMentions) : [];
  // Le créateur est destinataire de MP en plus des invités (jamais mentionné
  // dans le fil, sauf en secours si son MP est fermé) — pas pour un état sans
  // mention (annulation : `candidateMentions === null`).
  const dmActive = Boolean(dmKind) && !session.deferredRoulette &&
    (session.createdViaRoulette ? isRouletteDirectMessageEnabled() : isSessionDirectMessageEnabled());
  const creatorRecipient =
    dmActive && candidateMentions !== null && !eligible.some((u) => u.id === session.createdById)
      ? await resolveCreatorDmRecipient(session)
      : null;
  const dmTargets = creatorRecipient ? [...eligible, creatorRecipient] : eligible;
  const dm = dmActive && dmKind ? await enqueueSessionDirectMessages(session.id, dmKind, dmTargets) : null;
  // Double ping : TOUS les invités éligibles restent mentionnés, MP ou non.
  const mentioned = session.createdViaRoulette ? [] : [...eligible];
  // MP fermé du créateur : mentionné dans le fil comme n'importe quel pote.
  if (!session.createdViaRoulette && creatorRecipient && dm?.blocked.some((u) => u.id === creatorRecipient.id)) mentioned.push(creatorRecipient);
  const { text, userIds } = mentionContent(mentioned);

  // Notification interne (#98, même philosophie que le chemin webhook) —
  // EXACTEMENT les mêmes destinataires que les mentions ci-dessus, jamais
  // un ensemble différent, et jamais si le webhook a déjà pu les créer
  // pour cette session (impossible ici : une session `announceViaBot`
  // n'appelle jamais les fonctions webhook, voir le commentaire de fichier).
  if (inApp && eligible.length > 0) {
    await createNotifications(
      eligible.map((u) => ({
        userId: u.id,
        type: notificationType,
        title: notificationTitle,
        message: notificationMessage,
        relatedSessionId: session.id,
      }))
    );
  }

  const content = [discordBodyText, text].filter((part) => part.length > 0).join(" ");
  return {
    content: content || undefined,
    allowedMentions: { ...NO_MENTIONS_PARSE, users: userIds.length > 0 ? userIds : undefined },
  };
}

async function findSentDelivery(targetSlot: string) {
  return prisma.notificationDelivery.findFirst({
    where: { targetSlot, operation: "SEND", status: "SENT" },
    select: { discordMessageId: true, discordChannelId: true, discordThreadId: true },
  });
}

/**
 * Communauté d'une soirée (multi-communautés, PR3) : `null` = communauté par
 * défaut, y compris pour une soirée déjà supprimée (rôles `thread-delete` /
 * `thread-archive`, qui n'utilisent la configuration que comme porte). La
 * lecture est évitée tant que `COMMUNITY_CHANNELS_ENABLED` est éteint.
 */
/**
 * Résolveur SESSION — dispatché par le rôle terminal du `targetSlot`
 * (`thread`/`announce`/`thread-reminder-<n>`/`thread-summary`/
 * `invite:<inviteId>`). Chaque dépendance inter-`targetSlot` (tout
 * dépend de `thread`, voir le commentaire de fichier) est vérifiée ICI,
 * explicitement — `claimNextDelivery` ne la résout jamais automatiquement
 * pour des cibles DIFFÉRENTES (voir le commentaire de fichier de
 * `notification-executor.ts`).
 */
export const sessionAnnounceResolver: DeliveryResolver = {
  async resolve({ delivery, event }: ResolveInput): Promise<Resolution> {
    if (!(await isNotificationEventCommunityActive(event))) return { eligible: false, reason: "expired" };
    const config = await resolveSessionAnnounceConfig(event.communityId);
    if (!config) return { eligible: false, reason: "not_configured" };

    const sessionId = event.sourceId;
    const role = delivery.targetSlot.split(":").slice(3).join(":");

    // Chantier nettoyage réel du stockage (V2) — SEUL rôle de ce module
    // qui NE dépend PAS de l'existence de la ligne `Session` (voir le
    // commentaire de `enqueueSessionThreadDelete`) : dispatché AVANT le
    // chargement de la session, exactement comme `thread-close` pour les
    // tournois (tournament-announce.ts).
    if (role === "thread-delete") {
      return resolveSessionThreadDelete(sessionId);
    }
    if (role === "thread-archive") {
      return resolveSessionThreadArchive(sessionId);
    }

    const session = await loadSession(sessionId);
    if (!session) return { eligible: false, reason: "expired" };
    if (!(await notificationEventMatchesSource(event.communityId, session.communityId))) return { eligible: false, reason: "expired" };
    if (session.createdViaRoulette) {
      const initial = await prisma.notificationEvent.findUnique({
        where: { category_eventType_sourceId_occurrence: { category: "SESSION", eventType: "SESSION_CREATED", sourceId: sessionId, occurrence: "" } },
        select: { payload: true },
      });
      session.deferredRoulette = Boolean((initial?.payload as { sourceRouletteId?: string } | null)?.sourceRouletteId);
    }

    if (role === "thread") {
      return resolveThreadCreation(sessionId, config.channelId);
    }
    if (role === "announce") {
      return resolveAnnounceDelivery(delivery, session);
    }
    if (role === "thread-validated") {
      return resolveThreadValidated(sessionId, session);
    }
    if (role.startsWith("thread-date-")) {
      return resolveThreadDateChange(sessionId, session, role.slice("thread-date-".length));
    }
    if (role === "thread-summary") {
      return resolveThreadSummary(sessionId, session);
    }
    if (role.startsWith("thread-reminder-")) {
      const minutes = Number(role.slice("thread-reminder-".length));
      if (!Number.isFinite(minutes)) return { eligible: false, reason: "unresolvable" };
      return resolveThreadReminder(sessionId, session, minutes);
    }
    if (role.startsWith("invite:")) {
      const inviteId = role.slice("invite:".length);
      return resolveInviteSync(sessionId, inviteId, session.communityId);
    }
    if (role === "creator-member") {
      return resolveCreatorThreadMembership(sessionId, session);
    }
    if (role.startsWith("dm:")) {
      return resolveSessionDirectMessage(role, session, delivery);
    }
    if (role.startsWith("dm-fallback:")) {
      return resolveSessionDirectMessageFallback(role, session);
    }

    logger.error("session-announce", `targetSlot de rôle inconnu : ${delivery.targetSlot}`, { sessionId });
    return { eligible: false, reason: "unresolvable" };
  },
  onTerminalDiscordFailure: enqueueDirectMessageFallback,
};

interface ParsedDmRole {
  /** `announce`, `validated`, `date:<changeId>`, `reminder:<min>` (ou, hérité, `update:<id>`). */
  kind: string;
  base: "announce" | "date" | "validated" | "update" | "reminder";
  userId: string;
}

function parseDmRole(role: string, prefix: "dm:" | "dm-fallback:"): ParsedDmRole | null {
  const rest = role.slice(prefix.length);
  const cut = rest.lastIndexOf(":");
  if (cut < 0) return null;
  const kind = rest.slice(0, cut);
  const base = kind.split(":")[0];
  if (base !== "announce" && base !== "date" && base !== "validated" && base !== "update" && base !== "reminder") {
    return null;
  }
  return { kind, base, userId: rest.slice(cut + 1) };
}

/**
 * Texte d'accroche d'un MP/d'une mention de secours, selon le kind (et, pour
 * l'édition du MP d'invitation, le statut courant de la soirée). `null` pour
 * un kind hérité (`update`, plus jamais envoyé).
 */
function dmSubject(session: SessionWithVotes, parsed: ParsedDmRole, operation: "SEND" | "EDIT"): string | null {
  if (parsed.base === "date") return "📅 Date modifiée";
  if (parsed.base === "reminder") {
    const minutesRemaining = (session.date.getTime() - wallClockNow().getTime()) / 60_000;
    if (minutesRemaining <= 0) return null;
    return `⏰ Rappel — dans ${formatReminderTimingShort(Math.round(minutesRemaining))} !`;
  }
  if (parsed.base === "validated") {
    const winner = session.proposals.find((p) => p.gameId === session.decidedGameId);
    return winner ? `🎮 Soirée validée : ${winner.game.name}` : null;
  }
  if (parsed.base !== "announce") return null;
  if (operation === "SEND") return "📣 Nouvelle soirée";
  switch (session.status) {
    case "CANCELLED":
      return "❌ Soirée annulée";
    case "DONE":
      return "✅ Soirée terminée";
    case "SCHEDULED":
      return "🎮 Soirée validée";
    default:
      return "📣 Soirée mise à jour";
  }
}

/**
 * MP d'une soirée — état relu JUSTE À TEMPS, jamais depuis l'enqueue, et le
 * pote doit toujours être éligible (sélection du créateur, invitation ACTIVE,
 * préférence `SESSION`/`ROULETTE`) — une désactivation postérieure à
 * l'enqueue empêche l'envoi.
 *   - SEND (`announce`, `date`) : la soirée doit être VOTING/SCHEDULED
 *     (jamais un MP pour une soirée annulée/terminée).
 *   - EDIT (`announce` uniquement) : édite le MP d'invitation déjà envoyé, quel
 *     que soit l'état de la soirée (terminée/annulée incluses) ; jamais un
 *     nouveau MP si l'original n'existe pas.
 * Un MP fermé (`dm_unavailable`) n'est JAMAIS retenté (échec définitif, voir
 * `discord-rest.ts`) : `onTerminalDiscordFailure` met alors, pour le créateur
 * seulement, la mention de secours en file.
 */
async function resolveSessionDirectMessage(
  role: string,
  session: SessionWithVotes,
  delivery: ClaimedDelivery
): Promise<Resolution> {
  const parsed = parseDmRole(role, "dm:");
  if (!parsed) return { eligible: false, reason: "unresolvable" };
  if (parsed.base === "reminder" && !isSeatReminderRecipient(session.attendanceCapacity, session.createdById, parsed.userId, (session.seats ?? []).map(seat => seat.userId))) return { eligible: false, reason: "preference_declined" };
  const operation = delivery.operation === "EDIT" ? "EDIT" : "SEND";
  if (session.deferredRoulette && operation === "SEND") return { eligible: false, reason: "expired" };
  if (operation === "EDIT" && parsed.base !== "announce") return { eligible: false, reason: "unresolvable" };
  if (operation === "SEND" && session.status !== "VOTING" && session.status !== "SCHEDULED") {
    return { eligible: false, reason: "expired" };
  }
  const subject = dmSubject(session, parsed, operation);
  if (!subject) return { eligible: false, reason: "expired" };

  const recipient = await prisma.user.findUnique({ where: { id: parsed.userId } });
  if (!recipient) return { eligible: false, reason: "unresolvable" };
  if (!(await isDmRecipientEligible(session, recipient))) return { eligible: false, reason: "preference_declined" };

  const rendering = resolveAnnounceRendering(session);
  let body = subject;
  if (operation === "SEND" && (parsed.base === "reminder" || parsed.base === "date" || (parsed.base === "announce" && session.status === "VOTING"))) {
    const previousDate = parsed.base === "date" ? await previousDateForChange(session.id, parsed.kind.slice("date:".length)) : undefined;
    body = `${subject} — ${await sessionMessage(session, parsed.base === "announce" ? "created" : parsed.base, { creatorName: session.createdBy.discordName, recipientName: recipient.discordName, previousDate, gameName: session.proposals.find((p) => p.gameId === session.decidedGameId)?.game.name })}`;
  }
  const message = { content: body, embeds: [rendering.embed], allowedMentions: NO_MENTIONS_PARSE };

  if (operation === "EDIT") {
    const sent = await findSentDelivery(delivery.targetSlot);
    if (!sent?.discordMessageId || !sent.discordChannelId) return { eligible: false, reason: "unresolvable" };
    const action: ResolvedAction = {
      kind: "edit_channel_message",
      channelId: sent.discordChannelId,
      messageId: sent.discordMessageId,
      isDirectMessage: true,
      message,
    };
    return { eligible: true, action };
  }

  const action: ResolvedAction = { kind: "send_direct_message", userId: recipient.discordId, message };
  return { eligible: true, action };
}

/**
 * Mention de secours dans le fil quand le MP d'un pote est fermé — même
 * garde d'état/d'éligibilité que le MP, postée DANS le fil privé (jamais
 * le salon public). Ne mentionne que ce pote.
 */
async function resolveSessionDirectMessageFallback(role: string, session: SessionWithVotes): Promise<Resolution> {
  if (session.createdViaRoulette) return { eligible: false, reason: "expired" };
  const parsed = parseDmRole(role, "dm-fallback:");
  if (!parsed) return { eligible: false, reason: "unresolvable" };
  const thread = await findSentDelivery(threadSlot(session.id));
  if (!thread?.discordThreadId) return { eligible: false, reason: "dependency_not_ready" };
  if (session.status !== "VOTING" && session.status !== "SCHEDULED") return { eligible: false, reason: "expired" };
  // Secours réservé au créateur (les invités sont déjà mentionnés dans le fil).
  if (parsed.userId !== session.createdById) return { eligible: false, reason: "unresolvable" };
  const subject = dmSubject(session, parsed, "SEND");
  if (!subject) return { eligible: false, reason: "expired" };

  const recipient = await prisma.user.findUnique({ where: { id: parsed.userId } });
  if (!recipient) return { eligible: false, reason: "unresolvable" };
  if (!(await isDmRecipientEligible(session, recipient))) return { eligible: false, reason: "preference_declined" };

  const action: ResolvedAction = {
    kind: "send_thread_message_verified",
    threadId: thread.discordThreadId,
    message: {
      content: `<@${recipient.discordId}> ${subject} (MP impossible) — ${absoluteSessionUrl(session.id)}`,
      allowedMentions: { ...NO_MENTIONS_PARSE, users: [recipient.discordId] },
    },
  };
  return { eligible: true, action };
}

/**
 * Bug remonté (production, sessions Roulette) — le SEND initial supposait
 * jusqu'ici TOUJOURS une session encore `VOTING` (seule invariante vraie
 * pour `createSession`, seul appelant connu à l'écriture de #99) : type et
 * titre de notification interne figés en dur ("SESSION_CREATED"/"📣
 * Nouvelle soirée"), alors que l'EMBED Discord, lui, était déjà
 * correctement dérivé de l'état courant (`resolveAnnounceRendering`).
 * Une session Roulette (`createRouletteResultSession`, src/lib/sessions.ts)
 * est créée DIRECTEMENT `SCHEDULED` avec un jeu déjà décidé — son tout
 * premier SEND affichait donc un embed Discord correct ("🎮 Soirée
 * validée : [Jeu]") accompagné d'une notification interne incohérente
 * ("📣 Nouvelle soirée" / type `SESSION_CREATED`). Corrigé : dérivé de
 * l'état courant, comme l'EDIT le fait déjà plus bas — sans changer le
 * texte pour le cas `VOTING` (seul cas rencontré par `createSession`,
 * comportement historique préservé à l'identique).
 */
function resolveSendNotificationMeta(
  session: SessionWithVotes,
  rendering: AnnounceRendering
): { notifType: "SESSION_CREATED" | "SESSION_RESULT"; notifTitle: string } {
  if (session.status === "SCHEDULED" || session.status === "DONE") {
    return { notifType: "SESSION_RESULT", notifTitle: rendering.embed.title ?? "🎮 Soirée validée" };
  }
  // VOTING — seul cas atteint par `createSession` (comportement historique
  // inchangé). `CANCELLED` n'est jamais atteignable ici : aucune session
  // n'est jamais créée déjà annulée.
  return { notifType: "SESSION_CREATED", notifTitle: "📣 Nouvelle soirée" };
}

/**
 * Contenu de la soirée — POSTÉ DANS LE FIL PRIVÉ, jamais dans le salon
 * parent (chantier confidentialité). Dépend désormais de `thread` (SEND
 * ET EDIT), dépendance INVERSÉE par rapport à l'organisation d'origine
 * (où `thread` dépendait de `announce`) — voir le commentaire de fichier.
 */
async function resolveAnnounceDelivery(
  delivery: ClaimedDelivery,
  session: SessionWithVotes
): Promise<Resolution> {
  const thread = await findSentDelivery(threadSlot(session.id));
  if (!thread?.discordThreadId) return { eligible: false, reason: "dependency_not_ready" };

  const rendering = resolveAnnounceRendering(session);
  if (session.status === "VOTING" && delivery.operation === "SEND") rendering.embed.description = await sessionMessage(session, "created", { creatorName: session.createdBy.discordName });

  if (delivery.operation === "SEND") {
    const { notifType, notifTitle } = resolveSendNotificationMeta(session, rendering);
    const message = await buildMessageContent(
      session,
      rendering.candidateMentions,
      notifType,
      notifTitle,
      formatDateTimeFr(session.date),
      "",
      "announce"
    );
    const action: ResolvedAction = {
      kind: "send_thread_message_verified",
      threadId: thread.discordThreadId,
      message: { ...message, embeds: [rendering.embed] },
    };
    return { eligible: true, action };
  }

  // EDIT — nécessite le messageId déjà posté par le SEND initial (posté
  // DANS le fil, donc `discordThreadId` sur cette même ligne SENT sert de
  // `channelId` pour l'édition — un fil est un salon côté API Discord,
  // voir le commentaire de fichier de discord-rest.ts). Jamais revérifié
  // ICI (pas de `edit_channel_message_verified`) — MAIS PAS pour la
  // raison qu'une version antérieure de ce commentaire affirmait à tort
  // (« le SEND initial est nécessairement passé par
  // send_thread_message_verified ») : c'est faux pour une soirée créée
  // AVANT #102, dont l'annonce a été envoyée via `send_channel_message`
  // (salon PUBLIC direct, jamais un fil). La vraie garantie est
  // STRUCTURELLE, pas temporelle : `discordThreadId` sur la ligne
  // `announce` ne peut être posé QUE par un envoi DANS un fil
  // (`send_thread_message`/`send_thread_message_verified`) — jamais par
  // le chemin legacy `send_channel_message`, qui ne pose que
  // `discordChannelId`. Une soirée pré-#102 (ancienne architecture, où
  // `thread` était créé DEPUIS le message d'annonce, dépendance inversée
  // par rapport à aujourd'hui) a donc TOUJOURS sa ligne `announce` sans
  // `discordThreadId`, quel que soit le code déployé au moment du
  // traitement — ce champ n'est écrit qu'au moment du SEND réel, jamais
  // rétroactivement. Un ancien fil PUBLIC ne peut donc jamais être ciblé
  // par cette EDIT ; voir le test dédié "protection contre un ancien fil
  // PUBLIC référencé en base — EDIT sur une annonce/un fil legacy".
  const sentAnnounce = await findSentDelivery(announceSlot(session.id));
  if (!sentAnnounce?.discordMessageId) {
    // SEND pas encore traité — dépendance réellement susceptible de se
    // résoudre plus tard (le cron n'est pas encore passé dessus),
    // retenté normalement.
    return { eligible: false, reason: "dependency_not_ready" };
  }
  if (!sentAnnounce.discordThreadId) {
    // Ligne "announce" legacy (envoyée AVANT #102, salon PUBLIC direct,
    // jamais un fil) — fait STRUCTUREL et PERMANENT, jamais une question
    // de timing : ce champ ne sera jamais rempli rétroactivement. Refus
    // IMMÉDIAT et définitif (`unresolvable`, jamais `dependency_not_ready`)
    // — jamais un salon public édité avec du contenu de soirée, jamais de
    // tentatives inutiles avant un échec terminal qui finirait par
    // arriver de toute façon.
    return { eligible: false, reason: "unresolvable" };
  }

  const notifType = session.status === "SCHEDULED" || session.status === "DONE" ? "SESSION_RESULT" : "SESSION_CREATED";
  const notifTitle = session.status === "CANCELLED" ? "❌ Soirée annulée" : rendering.embed.title ?? "📣 Soirée";
  const message = await buildMessageContent(
    session,
    rendering.candidateMentions,
    notifType,
    notifTitle,
    formatDateTimeFr(session.date),
    ""
    // Aucun `dmKind` : une édition ne met en file AUCUN nouveau MP (les MP
    // d'invitation sont édités à part, `enqueueSessionDirectMessageEdits`).
  );
  const action: ResolvedAction = {
    kind: "edit_channel_message",
    channelId: sentAnnounce.discordThreadId,
    messageId: sentAnnounce.discordMessageId,
    message: { ...message, embeds: [rendering.embed] },
  };
  return { eligible: true, action };
}

/**
 * Crée le fil PRIVÉ lui-même — AUCUNE dépendance (c'est désormais le tout
 * premier appel Discord de la soirée, voir le commentaire de fichier).
 * Nom du fil délibérément non descriptif (juste les 8 premiers
 * caractères de l'id) — même choix que l'ancien fil public, mais ici
 * particulièrement important : un titre de fil reste visible dans les
 * outils de modération/l'API même pour un fil privé, jamais d'y faire
 * apparaître une date ou un nom de jeu.
 */
async function resolveThreadCreation(sessionId: string, channelId: string): Promise<Resolution> {
  const action: ResolvedAction = {
    kind: "create_private_thread",
    channelId,
    name: `Soirée — ${sessionId.slice(0, 8)}`,
  };
  return { eligible: true, action };
}

/**
 * Synchronisation d'appartenance au fil privé pour UNE invitation —
 * relit son statut ACTUEL à CHAQUE traitement (jamais depuis un
 * instantané pris à l'enqueue) : une invitation révoquée APRÈS l'enqueue
 * de cette synchronisation mais AVANT son traitement résout quand même
 * vers un retrait, jamais un ajout périmé qui rétablirait un accès déjà
 * coupé côté application. Dépend de `thread` (a besoin du fil créé).
 * `expired` (définitif, jamais retenté) si l'invitation elle-même a
 * disparu (session supprimée entre-temps, cascade sur `SessionInvite`).
 */
async function resolveInviteSync(sessionId: string, inviteId: string, communityId: string | null): Promise<Resolution> {
  const thread = await findSentDelivery(threadSlot(sessionId));
  if (!thread?.discordThreadId) return { eligible: false, reason: "dependency_not_ready" };

  const invite = await prisma.sessionInvite.findUnique({
    where: { id: inviteId },
    select: { status: true, user: { select: { id: true, discordId: true } } },
  });
  if (!invite) return { eligible: false, reason: "expired" };

  const action: ResolvedAction =
    invite.status === "ACTIVE" && await isMemberOfCommunity(invite.user.id, communityId)
      ? { kind: "add_thread_member_verified", threadId: thread.discordThreadId, discordUserId: invite.user.discordId }
      : { kind: "remove_thread_member_verified", threadId: thread.discordThreadId, discordUserId: invite.user.discordId };
  return { eligible: true, action };
}

/**
 * Ajoute le CRÉATEUR comme membre du fil privé — jamais un retrait
 * (contrairement à `resolveInviteSync`, symétrique ajout/retrait selon le
 * statut d'une invitation) : l'accès du créateur n'est jamais révocable.
 * Dépend de `thread` (a besoin du fil créé), comme toute opération sur le
 * fil dans ce module.
 */
async function resolveCreatorThreadMembership(sessionId: string, session: SessionWithVotes): Promise<Resolution> {
  if (!(await isMemberOfCommunity(session.createdById, session.communityId))) return { eligible: false, reason: "expired" };
  const thread = await findSentDelivery(threadSlot(sessionId));
  if (!thread?.discordThreadId) return { eligible: false, reason: "dependency_not_ready" };

  const creator = await prisma.user.findUnique({
    where: { id: session.createdById },
    select: { discordId: true },
  });
  // Défensif — ne devrait jamais se produire (FK `Session.createdById`
  // vers `User`, jamais de suppression de compte implémentée dans cette
  // app), mais refuse plutôt que de planter si c'était le cas un jour.
  if (!creator) return { eligible: false, reason: "expired" };

  const action: ResolvedAction = {
    kind: "add_thread_member_verified",
    threadId: thread.discordThreadId,
    discordUserId: creator.discordId,
  };
  return { eligible: true, action };
}

async function resolveThreadSummary(sessionId: string, session: SessionWithVotes): Promise<Resolution> {
  const thread = await findSentDelivery(threadSlot(sessionId));
  if (!thread?.discordThreadId) return { eligible: false, reason: "dependency_not_ready" };

  const rendering = resolveAnnounceRendering(session);
  const message = await buildMessageContent(
    session,
    null, // le résumé dans le fil ne re-mentionne personne — la mention a déjà eu lieu sur l'annonce éditée.
    "SESSION_RESULT",
    "🎮 Résumé de la soirée",
    formatDateTimeFr(session.date)
  );
  const action: ResolvedAction = {
    kind: "send_thread_message_verified",
    threadId: thread.discordThreadId,
    message: { ...message, embeds: [rendering.embed] },
  };
  return { eligible: true, action };
}

/**
 * « Soirée validée : {jeu} » dans le fil, avec mention des joueurs du jeu
 * retenu (même ensemble que l'annonce validée, préférences relues), ET en MP à
 * chaque joueur éligible et au créateur (MP oui, mention non). N'a de sens que pour une soirée validée (SCHEDULED/DONE) avec un gagnant.
 */
async function resolveThreadValidated(sessionId: string, session: SessionWithVotes): Promise<Resolution> {
  const thread = await findSentDelivery(threadSlot(sessionId));
  if (!thread?.discordThreadId) return { eligible: false, reason: "dependency_not_ready" };
  if (session.status !== "SCHEDULED" && session.status !== "DONE") return { eligible: false, reason: "expired" };
  const winner = session.proposals.find((p) => p.gameId === session.decidedGameId);
  if (!winner) return { eligible: false, reason: "expired" };

  const rendering = resolveAnnounceRendering(session);
  const title = `🎮 Soirée validée : ${winner.game.name}`;
  const message = await buildMessageContent(
    session,
    rendering.candidateMentions,
    "SESSION_RESULT",
    title,
    title,
    `${title} — ${absoluteSessionUrl(session.id)}`,
    "validated",
    false
  );
  const action: ResolvedAction = { kind: "send_thread_message_verified", threadId: thread.discordThreadId, message };
  return { eligible: true, action };
}

/**
 * Changement de date : message avec mention dans le fil (une édition ne notifie
 * personne) ET nouveau MP « Date modifiée » à chaque pote ayant reçu
 * l'invitation (double ping). Créneau relu au traitement, jamais figé.
 */
async function previousDateForChange(sessionId: string, changeId: string): Promise<Date | undefined> {
  const event = await prisma.notificationEvent.findUnique({
    where: { category_eventType_sourceId_occurrence: { category: "SESSION", sourceId: sessionId, eventType: "SESSION_DATE_CHANGED", occurrence: changeId } }, select: { payload: true },
  });
  const payload = event?.payload as { previousDate?: string } | null;
  const date = payload?.previousDate ? new Date(payload.previousDate) : undefined;
  return date && !Number.isNaN(date.getTime()) ? date : undefined;
}

async function resolveThreadDateChange(
  sessionId: string,
  session: SessionWithVotes,
  changeId: string
): Promise<Resolution> {
  const thread = await findSentDelivery(threadSlot(sessionId));
  if (!thread?.discordThreadId) return { eligible: false, reason: "dependency_not_ready" };
  if (session.status !== "VOTING" && session.status !== "SCHEDULED") return { eligible: false, reason: "expired" };

  const rendering = resolveAnnounceRendering(session);
  const previousDate = await previousDateForChange(sessionId, changeId);
  const body = `📅 Date modifiée — ${await sessionMessage(session, "date", { creatorName: session.createdBy.discordName, previousDate })} — ${absoluteSessionUrl(session.id)}`;
  const message = await buildMessageContent(
    session,
    rendering.candidateMentions,
    "SESSION_CREATED",
    "📅 Date modifiée",
    formatDateTimeFr(session.date),
    body,
    `date:${changeId}`,
    false
  );
  const action: ResolvedAction = { kind: "send_thread_message_verified", threadId: thread.discordThreadId, message };
  return { eligible: true, action };
}

/**
 * Suppression PERMANENTE du fil — V2, suppression manuelle d'une soirée.
 * Ne dépend QUE de la référence du fil déjà persistée (`thread` SENT),
 * JAMAIS de l'existence de la session (voir le commentaire de
 * `enqueueSessionThreadDelete`) — même structure exacte que
 * `resolveThreadClose` (tournament-announce.ts), qui traite le même
 * problème pour l'archivage sur annulation/suppression de tournoi :
 *   - `thread` SENT → supprime le fil réel.
 *   - `thread` encore PENDING/RESERVED → pas encore tranché, le fil
 *     pourrait encore se créer (course "suppression pendant la création du
 *     fil", cf. demande explicite) — `dependency_not_ready`, retenté
 *     jusqu'à ce que `thread` se règle dans un sens ou dans l'autre. Si le
 *     SEND finit par réussir malgré la suppression déjà actée (fil créé
 *     "en vol"), cette livraison-ci finira par le voir SENT et le
 *     supprimera — compensation durable, sans jamais dépendre d'un
 *     rattrapage manuel pour ce cas précis.
 *   - FAILED/SKIPPED/jamais enqueue-é → le fil ne sera jamais créé, rien à
 *     supprimer (`expired`, définitif).
 */
async function resolveSessionThreadDelete(sessionId: string): Promise<Resolution> {
  // Nettoyage automatique des fils (V2) — garde relue AU TRAITEMENT : une
  // soirée supprimée (ligne absente, cas historique ci-dessus) ou terminée
  // passe ; une soirée encore active ne voit JAMAIS son fil supprimé,
  // quelle que soit la façon dont la livraison a été enqueue-ée.
  const live = await prisma.session.findUnique({ where: { id: sessionId }, select: { status: true } });
  if (live && !isTerminalSessionStatus(live.status)) {
    logger.warn("session-announce", "Suppression de fil refusée : soirée encore active.", {
      sessionId,
      status: live.status,
    });
    return { eligible: false, reason: "expired" };
  }

  const thread = await findSentDelivery(threadSlot(sessionId));
  if (thread?.discordThreadId) {
    const action: ResolvedAction = { kind: "delete_thread_permanent", threadId: thread.discordThreadId };
    return { eligible: true, action };
  }

  const threadSend = await prisma.notificationDelivery.findFirst({
    where: { targetSlot: threadSlot(sessionId), operation: "SEND" },
    orderBy: { sequence: "desc" },
    select: { status: true },
  });
  if (threadSend && (threadSend.status === "PENDING" || threadSend.status === "RESERVED")) {
    return { eligible: false, reason: "dependency_not_ready" };
  }
  return { eligible: false, reason: "expired" };
}

export function isTerminalSessionStatus(status: string): boolean {
  return status === "DONE" || status === "CANCELLED";
}

/**
 * Nettoyage automatique des fils (V2) — archive ET verrouille le fil d'une
 * soirée terminée/annulée. Relit l'état AU TRAITEMENT : soirée supprimée
 * (le fil est déjà pris en charge par `thread-delete`) ou encore active →
 * `expired`, jamais un verrouillage d'un fil encore utile. Attend
 * (`dependency_not_ready`) tant qu'une autre livraison de la soirée
 * (résumé, rappel, synchronisation de membre…) doit encore passer par le
 * fil — un fil verrouillé refuserait ces écritures.
 */
async function resolveSessionThreadArchive(sessionId: string): Promise<Resolution> {
  const live = await prisma.session.findUnique({ where: { id: sessionId }, select: { status: true } });
  if (!live || !isTerminalSessionStatus(live.status)) return { eligible: false, reason: "expired" };

  const slots = sessionThreadCleanupSlots(sessionId);
  if (await hasUnsettledDeliveriesWithPrefix(slots.prefix, [slots.archive, slots.delete])) {
    return { eligible: false, reason: "dependency_not_ready" };
  }

  const thread = await findSentDelivery(slots.thread);
  if (!thread?.discordThreadId) return { eligible: false, reason: "expired" };
  const action: ResolvedAction = { kind: "archive_thread", threadId: thread.discordThreadId, locked: true };
  return { eligible: true, action };
}

/**
 * Fix bug remonté (rappels de rattrapage au contenu mensonger, ex. "dans
 * 12h !" affiché alors que la soirée commence dans 20 minutes) : le
 * libellé n'est PLUS dérivé du seuil configuré (`minutes`, encodé dans le
 * `targetSlot` uniquement pour l'idempotence de l'enqueue, voir
 * `enqueueSessionReminderDelivery`) — le temps RÉELLEMENT restant est
 * recalculé ICI, au moment du traitement effectif (`wallClockNow()`,
 * jamais mis en cache depuis l'enqueue), qui peut avoir lieu plus tard
 * que prévu si l'exécuteur avait lui-même du retard sur sa propre file.
 * Si la soirée a depuis COMMENCÉ (temps restant ≤ 0), plus aucun compte
 * à rebours n'a de sens : refus définitif (`expired`), jamais un message
 * annonçant une soirée à venir qui a déjà débuté — cette garde couvre
 * aussi bien une livraison enqueue-ée avant ce fix (encore en file) que
 * la seule qui puisse désormais être enqueue-ée par passage (voir
 * `computeTimingsDue`, reminders.ts) mais traitée en retard par
 * l'exécuteur.
 */
async function resolveThreadReminder(
  sessionId: string,
  session: SessionWithVotes,
  minutes: number
): Promise<Resolution> {
  const thread = await findSentDelivery(threadSlot(sessionId));
  if (!thread?.discordThreadId) return { eligible: false, reason: "dependency_not_ready" };

  if (session.status !== "SCHEDULED" && session.status !== "VOTING") {
    // Session annulée/déjà DONE entre l'enqueue du rappel et son
    // traitement — plus rien à rappeler, refus définitif (pas de sens à
    // retenter : l'état ne redeviendra jamais VOTING/SCHEDULED).
    return { eligible: false, reason: "expired" };
  }

  const minutesRemaining = (session.date.getTime() - wallClockNow().getTime()) / 60_000;
  if (minutesRemaining <= 0) {
    return { eligible: false, reason: "expired" };
  }

  // Même bug que l'annonce initiale (voir `resolveInvitedCandidates`) —
  // un rappel VOTING envoyé avant tout vote ne mentionnait jamais
  // personne. `SCHEDULED` (jeu déjà décidé) garde son comportement
  // d'origine, inchangé : les votants de TOUTES les propositions (pas
  // seulement du jeu gagnant), pas la portée de ce correctif.
  let candidates: (User & { silenceReminders: boolean })[];
  if (session.status === "VOTING") {
    candidates = resolveInvitedCandidates(session.invites, session.createdById);
  } else if (session.attendanceCapacity != null) {
    candidates = (session.seats ?? []).map(seat => seat.user);
  } else {
    const voters = new Map<string, User & { silenceReminders: boolean }>();
    for (const proposal of session.proposals) {
      for (const vote of proposal.votes) voters.set(vote.user.id, vote.user);
    }
    candidates = Array.from(voters.values());
  }

  const reminderTitle = `⏰ Rappel — dans ${formatReminderTimingShort(Math.round(minutesRemaining))} !`;
  const reminderBody = await sessionMessage(session, "reminder", { creatorName: session.createdBy.discordName, gameName: session.proposals.find((p) => p.gameId === session.decidedGameId)?.game.name });
  const message = await buildMessageContent(
    session,
    candidates,
    "SESSION_CREATED",
    reminderTitle,
    session.decidedGameId ? "" : formatDateTimeFr(session.date),
    `${reminderTitle} ${reminderBody}`,
    `reminder:${minutes}`
    // Rappel : mention dans le fil ET MP à chaque invité, créateur inclus (MP, pas de mention).
  );
  const action: ResolvedAction = { kind: "send_thread_message_verified", threadId: thread.discordThreadId, message };
  return { eligible: true, action };
}
