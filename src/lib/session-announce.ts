import { randomUUID } from "crypto";
import type { Game, Proposal, Session, User, Vote } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { formatDateTimeFr } from "@/lib/wallclock";
import { resolveNotifiedUserIds } from "@/lib/notify-recipients";
import { filterUsersByNotificationPreference } from "@/lib/notification-preferences";
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
 * (TOURNAMENT explicitement différé, voir README). Relie enfin les
 * fondations de livraison (#95), le client REST (#96) et l'exécuteur
 * (#97) à un vrai événement métier, pour la toute première fois — jusqu'ici
 * `NOT_CONFIGURED_RESOLVER` refusait systématiquement. `discord-announce.ts`/
 * `discord-session-created.ts`/`discord-session-modified.ts` (webhook)
 * restent TOTALEMENT inchangés et actifs pour toute session dont
 * `announceViaBot` est resté `false` — voir le commentaire du champ dans
 * schema.prisma pour la règle de bascule.
 *
 * Organisation : une annonce principale ET un fil par soirée, sur le
 * SEUL salon configuré (`DISCORD_BOT_SESSION_CHANNEL_ID`, jamais une
 * destination choisie par un formulaire). Quatre rôles de `targetSlot`,
 * chacun une ligne `NotificationDelivery` distincte, qui progressent
 * indépendamment (voir `notification-delivery.ts`) :
 *   - `announce` — SEND une fois à la création, puis une EDIT à chaque
 *     changement d'état ultérieur (modification de créneau, clôture,
 *     annulation) — TOUJOURS rendue depuis l'état COURANT de la session
 *     en base au moment où l'EDIT est réellement traitée, jamais depuis
 *     un texte figé à l'enqueue : une EDIT plus ancienne ne peut donc
 *     jamais écraser un état plus récent (convergence déjà garantie par
 *     `claimNextDelivery`, jamais réimplémentée ici).
 *   - `thread` — SEND une fois, crée le fil à partir du message
 *     d'annonce ; dépend explicitement que `announce` soit `SENT`
 *     (résolu ici, PAS automatiquement par `claimNextDelivery`, qui ne
 *     résout que les dépendances SUR LE MÊME targetSlot).
 *   - `thread-reminder-<minutes>` — SEND, un par palier de rappel dû,
 *     posté DANS le fil ; dépend que `thread` soit `SENT` (même
 *     mécanisme de dépendance manuelle).
 *   - `thread-summary` — SEND, résumé posté DANS le fil à la clôture ;
 *     même dépendance sur `thread`.
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
 */
async function resolveEligibleMentions<T extends { id: string; discordId: string; silenceReminders: boolean }>(
  session: Pick<Session, "notifiedUserIds" | "createdViaRoulette">,
  candidates: T[]
): Promise<T[]> {
  const notifiedUserIds = resolveNotifiedUserIds(session.notifiedUserIds);
  const restricted = notifiedUserIds ? candidates.filter((u) => notifiedUserIds.includes(u.id)) : candidates;
  const category = session.createdViaRoulette ? "ROULETTE" : "SESSION";
  return filterUsersByNotificationPreference(restricted, category);
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
 * (`announce`/`thread`/`thread-reminder-<n>`/`thread-summary`). Chaque
 * dépendance inter-`targetSlot` (fil ⇐ annonce ; rappel/résumé ⇐ fil)
 * est vérifiée ICI, explicitement — `claimNextDelivery` ne la résout
 * jamais automatiquement pour des cibles DIFFÉRENTES (voir le
 * commentaire de fichier de `notification-executor.ts`).
 */
export const sessionAnnounceResolver: DeliveryResolver = {
  async resolve({ delivery, event }: ResolveInput): Promise<Resolution> {
    const config = getSessionAnnounceConfig();
    if (!config) return { eligible: false, reason: "not_configured" };

    const sessionId = event.sourceId;
    const session = await loadSession(sessionId);
    if (!session) return { eligible: false, reason: "expired" };

    const role = delivery.targetSlot.split(":").slice(3).join(":");

    if (role === "announce") {
      return resolveAnnounceDelivery(delivery, session, config.channelId);
    }
    if (role === "thread") {
      return resolveThreadCreation(sessionId, config.channelId);
    }
    if (role === "thread-summary") {
      return resolveThreadSummary(sessionId, session);
    }
    if (role.startsWith("thread-reminder-")) {
      const minutes = Number(role.slice("thread-reminder-".length));
      if (!Number.isFinite(minutes)) return { eligible: false, reason: "unresolvable" };
      return resolveThreadReminder(sessionId, session, minutes);
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

async function resolveAnnounceDelivery(
  delivery: ClaimedDelivery,
  session: SessionWithVotes,
  channelId: string
): Promise<Resolution> {
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
      kind: "send_channel_message",
      channelId,
      message: { ...message, embeds: [rendering.embed] },
    };
    return { eligible: true, action };
  }

  // EDIT — nécessite le messageId déjà posté par le SEND initial.
  const sent = await findSentDelivery(announceSlot(session.id));
  if (!sent?.discordMessageId) return { eligible: false, reason: "dependency_not_ready" };

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
    channelId,
    messageId: sent.discordMessageId,
    message: { ...message, embeds: [rendering.embed] },
  };
  return { eligible: true, action };
}

async function resolveThreadCreation(sessionId: string, channelId: string): Promise<Resolution> {
  const sent = await findSentDelivery(announceSlot(sessionId));
  if (!sent?.discordMessageId) return { eligible: false, reason: "dependency_not_ready" };

  const action: ResolvedAction = {
    kind: "create_thread",
    channelId,
    messageId: sent.discordMessageId,
    name: `Soirée — ${sessionId.slice(0, 8)}`,
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
