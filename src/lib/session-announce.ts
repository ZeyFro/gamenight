import { randomUUID } from "crypto";
import type { Game, Proposal, Session, User, Vote } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { formatDateTimeFr } from "@/lib/wallclock";
import { resolveNotifiedUserIds } from "@/lib/notify-recipients";
import { filterUsersByNotificationPreference } from "@/lib/notification-preferences";
import { filterByActiveSessionInvite } from "@/lib/session-access";
import { createNotifications } from "@/lib/notifications";
import { getSessionAnnounceConfig } from "@/lib/discord-bot-config";
import {
  createNotificationEvent,
  enqueueDelivery,
  type ClaimedDelivery,
  type NotificationDb,
} from "@/lib/notification-delivery";
import type {
  DeliveryResolver,
  Resolution,
  ResolvedAction,
  ResolvedMessageContent,
  ResolveInput,
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
function threadSummarySlot(sessionId: string): string {
  return `${GUILD_SLOT_PREFIX}:SESSION:${sessionId}:thread-summary`;
}
function inviteSlot(sessionId: string, inviteId: string): string {
  return `${GUILD_SLOT_PREFIX}:SESSION:${sessionId}:invite:${inviteId}`;
}

const NO_MENTIONS_PARSE: { parse: [] } = { parse: [] };

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
export async function enqueueSessionCreationDeliveries(sessionId: string, db?: NotificationDb): Promise<void> {
  const event = await createNotificationEvent(
    {
      category: "SESSION",
      eventType: "SESSION_CREATED",
      sourceId: sessionId,
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
  // que la mutation de l'invitation).
  const invite = await prisma.sessionInvite.findUnique({
    where: { id: inviteId },
    select: { sessionId: true },
  });
  if (!invite) return;

  const event = await createNotificationEvent(
    {
      category: "SESSION",
      eventType: "SESSION_INVITE_SYNC",
      sourceId: invite.sessionId,
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
      targetSlot: inviteSlot(invite.sessionId, inviteId),
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

/* -------------------------------------------------------------------- */
/* Résolution — appelée par l'exécuteur (#97), jamais directement        */
/* -------------------------------------------------------------------- */

type SessionWithVotes = Session & {
  proposals: (Proposal & { game: Game; votes: (Vote & { user: User })[] })[];
};

async function loadSession(sessionId: string): Promise<SessionWithVotes | null> {
  return prisma.session.findUnique({
    where: { id: sessionId },
    include: {
      proposals: {
        include: { game: true, votes: { include: { user: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });
}

function absoluteSessionUrl(sessionId: string): string {
  const base = (process.env.AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return `${base}/sessions/${sessionId}`;
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
  session: Pick<Session, "id" | "createdById" | "notifiedUserIds" | "createdViaRoulette">,
  candidates: T[]
): Promise<T[]> {
  const notifiedUserIds = resolveNotifiedUserIds(session.notifiedUserIds);
  const restricted = notifiedUserIds ? candidates.filter((u) => notifiedUserIds.includes(u.id)) : candidates;
  const invited = await filterByActiveSessionInvite(session.id, session.createdById, restricted);
  const category = session.createdViaRoulette ? "ROULETTE" : "SESSION";
  return filterUsersByNotificationPreference(invited, category);
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
          { name: "Joueurs", value: String(winner.votes.length), inline: true },
          ...(tie ? [{ name: "Note", value: "Égalité de votes — choisi par ancienneté de proposition.", inline: false }] : []),
          { name: "Lien", value: absoluteSessionUrl(session.id) },
        ],
      },
      candidateMentions: winner.votes.map((v) => v.user),
    };
  }

  // VOTING — création ou modification de créneau.
  const voters = new Map<string, User & { silenceReminders: boolean }>();
  for (const proposal of session.proposals) {
    for (const vote of proposal.votes) voters.set(vote.user.id, vote.user);
  }
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
    candidateMentions: Array.from(voters.values()),
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
  discordBodyText = ""
): Promise<ResolvedMessageContent> {
  const eligible = candidateMentions ? await resolveEligibleMentions(session, candidateMentions) : [];
  const { text, userIds } = mentionContent(eligible);

  // Notification interne (#98, même philosophie que le chemin webhook) —
  // EXACTEMENT les mêmes destinataires que les mentions ci-dessus, jamais
  // un ensemble différent, et jamais si le webhook a déjà pu les créer
  // pour cette session (impossible ici : une session `announceViaBot`
  // n'appelle jamais les fonctions webhook, voir le commentaire de fichier).
  if (eligible.length > 0) {
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
    const config = getSessionAnnounceConfig();
    if (!config) return { eligible: false, reason: "not_configured" };

    const sessionId = event.sourceId;
    const session = await loadSession(sessionId);
    if (!session) return { eligible: false, reason: "expired" };

    const role = delivery.targetSlot.split(":").slice(3).join(":");

    if (role === "thread") {
      return resolveThreadCreation(sessionId, config.channelId);
    }
    if (role === "announce") {
      return resolveAnnounceDelivery(delivery, session);
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
      return resolveInviteSync(sessionId, inviteId);
    }

    logger.error("session-announce", `targetSlot de rôle inconnu : ${delivery.targetSlot}`, { sessionId });
    return { eligible: false, reason: "unresolvable" };
  },
};

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

  if (delivery.operation === "SEND") {
    const { notifType, notifTitle } = resolveSendNotificationMeta(session, rendering);
    const message = await buildMessageContent(
      session,
      rendering.candidateMentions,
      notifType,
      notifTitle,
      formatDateTimeFr(session.date)
    );
    const action: ResolvedAction = {
      kind: "send_thread_message",
      threadId: thread.discordThreadId,
      message: { ...message, embeds: [rendering.embed] },
    };
    return { eligible: true, action };
  }

  // EDIT — nécessite le messageId déjà posté par le SEND initial (posté
  // DANS le fil, donc `discordThreadId` sur cette même ligne SENT sert de
  // `channelId` pour l'édition — un fil est un salon côté API Discord,
  // voir le commentaire de fichier de discord-rest.ts).
  const sentAnnounce = await findSentDelivery(announceSlot(session.id));
  if (!sentAnnounce?.discordMessageId || !sentAnnounce.discordThreadId) {
    return { eligible: false, reason: "dependency_not_ready" };
  }

  const notifType = session.status === "SCHEDULED" || session.status === "DONE" ? "SESSION_RESULT" : "SESSION_CREATED";
  const notifTitle = session.status === "CANCELLED" ? "❌ Soirée annulée" : rendering.embed.title ?? "📣 Soirée";
  const message = await buildMessageContent(
    session,
    rendering.candidateMentions,
    notifType,
    notifTitle,
    formatDateTimeFr(session.date)
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
async function resolveInviteSync(sessionId: string, inviteId: string): Promise<Resolution> {
  const thread = await findSentDelivery(threadSlot(sessionId));
  if (!thread?.discordThreadId) return { eligible: false, reason: "dependency_not_ready" };

  const invite = await prisma.sessionInvite.findUnique({
    where: { id: inviteId },
    select: { status: true, user: { select: { discordId: true } } },
  });
  if (!invite) return { eligible: false, reason: "expired" };

  const action: ResolvedAction =
    invite.status === "ACTIVE"
      ? { kind: "add_thread_member", threadId: thread.discordThreadId, discordUserId: invite.user.discordId }
      : { kind: "remove_thread_member", threadId: thread.discordThreadId, discordUserId: invite.user.discordId };
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
    kind: "send_thread_message",
    threadId: thread.discordThreadId,
    message: { ...message, embeds: [rendering.embed] },
  };
  return { eligible: true, action };
}

async function resolveThreadReminder(sessionId: string, session: SessionWithVotes, minutes: number): Promise<Resolution> {
  const thread = await findSentDelivery(threadSlot(sessionId));
  if (!thread?.discordThreadId) return { eligible: false, reason: "dependency_not_ready" };

  if (session.status !== "SCHEDULED" && session.status !== "VOTING") {
    // Session annulée/déjà DONE entre l'enqueue du rappel et son
    // traitement — plus rien à rappeler, refus définitif (pas de sens à
    // retenter : l'état ne redeviendra jamais VOTING/SCHEDULED).
    return { eligible: false, reason: "expired" };
  }

  const voters = new Map<string, User & { silenceReminders: boolean }>();
  for (const proposal of session.proposals) {
    for (const vote of proposal.votes) voters.set(vote.user.id, vote.user);
  }

  const timingLabel = minutes >= 60 ? `${Math.round(minutes / 60)}h` : `${minutes}min`;
  const reminderTitle = `⏰ Rappel — dans ${timingLabel} !`;
  const message = await buildMessageContent(
    session,
    Array.from(voters.values()),
    "SESSION_CREATED",
    reminderTitle,
    session.decidedGameId ? "" : formatDateTimeFr(session.date),
    reminderTitle
  );
  const action: ResolvedAction = { kind: "send_thread_message", threadId: thread.discordThreadId, message };
  return { eligible: true, action };
}
