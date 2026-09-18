import { randomUUID } from "crypto";
import type { Tournament, TournamentMatch, TournamentParticipant, User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { bracketSizeFor, totalRoundsFor } from "@/lib/tournaments";
import { getTournamentAnnounceConfig } from "@/lib/discord-bot-config";
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
 * Chantier annonces Discord tournois (#🏆-tournois, fil dédié par
 * tournoi) — étend le chantier annonces bot de #99 (`session-announce.ts`)
 * à la catégorie TOURNAMENT, sans en dupliquer aucun mécanisme : mêmes
 * fondations de livraison (#95), même client REST (#96), même exécuteur
 * (#97), même principe "transport figé par entité à la création" (#99).
 * `src/lib/discord.ts` (webhook, appelé par `createTournamentAction` et
 * `announceTournamentFinalization`) reste TOTALEMENT inchangé et actif
 * pour tout tournoi dont `announceViaBot` est resté `false`.
 *
 * Organisation : une annonce principale ET un fil par tournoi, sur le SEUL
 * salon configuré (`DISCORD_BOT_TOURNAMENT_CHANNEL_ID`, jamais une
 * destination choisie par un formulaire). Trois rôles de `targetSlot`,
 * chacun une ligne `NotificationDelivery` distincte (voir
 * `notification-delivery.ts`) :
 *   - `announce` — SEND une fois à la création (inscriptions ouvertes),
 *     puis une EDIT à chaque changement d'état ultérieur pertinent
 *     (lancement du bracket, clôture) — TOUJOURS rendue depuis l'état
 *     COURANT du tournoi en base au moment où l'EDIT est réellement
 *     traitée, jamais depuis un texte figé à l'enqueue (même garantie que
 *     `session-announce.ts`, voir son commentaire de fichier).
 *   - `thread` — SEND une fois, crée le fil à partir du message d'annonce ;
 *     dépend explicitement que `announce` soit `SENT` (résolu ici, PAS
 *     automatiquement par `claimNextDelivery`, qui ne résout que les
 *     dépendances SUR LE MÊME `targetSlot`).
 *   - `thread-summary` — SEND, résumé (champion/finaliste/demi-finalistes)
 *     posté DANS le fil à la clôture ; dépend que `thread` soit `SENT`.
 *
 * Pas de rappels (contrairement aux soirées, F7) — aucune notion de
 * rappel n'existe pour les tournois dans le produit actuel, hors périmètre
 * de cette PR (aucune règle de tournoi inventée). Pas de mentions
 * personnelles non plus (spec §5) : ce module ne mentionne JAMAIS
 * personne, `allowedMentions` explicitement vide (`parse: []`, aucun
 * `users`/`roles`) sur TOUS les messages envoyés/édités ici — les noms de
 * participants apparaissent en texte brut uniquement (jamais `<@id>`).
 * Aucune notification interne (`createNotifications`) : le chemin webhook
 * actuel n'en écrit aucune pour les tournois (vérifié, `tournaments.ts`/
 * `src/app/tournois/actions.ts` n'importent pas `createNotifications`),
 * donc ce module n'en invente pas non plus — jamais une sollicitation
 * personnelle nouvelle (spec §5, interdiction explicite de simuler une
 * préférence TOURNAMENT en réutilisant SESSION/ROULETTE).
 */

const GUILD_SLOT_PREFIX = "default-guild";

function announceSlot(tournamentId: string): string {
  return `${GUILD_SLOT_PREFIX}:TOURNAMENT:${tournamentId}:announce`;
}
function threadSlot(tournamentId: string): string {
  return `${GUILD_SLOT_PREFIX}:TOURNAMENT:${tournamentId}:thread`;
}
function threadSummarySlot(tournamentId: string): string {
  return `${GUILD_SLOT_PREFIX}:TOURNAMENT:${tournamentId}:thread-summary`;
}

/** Jamais de mention sur ce chantier — aucun `users`/`roles`, voir le
 * commentaire de fichier. Une seule constante partagée : aucun risque
 * qu'un futur ajout oublie de la vider sur un des deux call sites
 * (SEND/EDIT). */
const NO_MENTIONS: ResolvedMessageContent["allowedMentions"] = { parse: [] };

/* -------------------------------------------------------------------- */
/* Enqueue — appelé depuis les points d'entrée métier existants          */
/* -------------------------------------------------------------------- */

/**
 * SEND une fois pour toutes (annonce + fil) — occurrence FIXE (vide),
 * même raisonnement que `enqueueSessionCreationDeliveries` (idempotence
 * d'un retry applicatif, voir son commentaire).
 *
 * `db` optionnel (défaut : client global) — passer le `tx` d'un
 * `prisma.$transaction` englobant compose cet enqueue avec la création du
 * tournoi DANS LA MÊME transaction (voir `createTournamentAction`) :
 * jamais un tournoi bot orphelin qui n'annoncerait jamais rien parce que
 * le process a crashé entre les deux écritures. Aucun appel Discord ici
 * (uniquement des écritures) — voir le commentaire de fichier de
 * `notification-delivery.ts` sur l'interdiction d'appel Discord dans une
 * transaction SQL.
 */
export async function enqueueTournamentCreationDeliveries(
  tournamentId: string,
  db?: NotificationDb
): Promise<void> {
  const event = await createNotificationEvent(
    { category: "TOURNAMENT", eventType: "TOURNAMENT_CREATED", sourceId: tournamentId },
    db
  );
  await enqueueDelivery(
    {
      eventId: event.id,
      channel: "DISCORD_CHANNEL",
      transport: "BOT",
      operation: "SEND",
      recipientKey: "channel",
      targetSlot: announceSlot(tournamentId),
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
      targetSlot: threadSlot(tournamentId),
    },
    db
  );
}

/**
 * EDIT — appelée à CHAQUE changement d'état pertinent de l'annonce
 * (lancement du bracket, clôture). Occurrence ALÉATOIRE à dessein, même
 * raisonnement que `enqueueSessionAnnounceUpdate` : chaque appel
 * représente une occurrence métier RÉELLEMENT DISTINCTE, alimente la
 * convergence "seule la plus récente survit" déjà garantie par
 * `claimNextDelivery`. Ne rend jamais elle-même le contenu : le résolveur
 * relit l'état actuel du tournoi au moment du traitement (voir
 * `resolveTournamentAnnounceRendering`).
 *
 * `db` optionnel — même contrat que ci-dessus (voir `buildBracketInTransaction`/
 * `advanceWinner`, src/lib/tournaments.ts, pour les deux appelants réels).
 */
export async function enqueueTournamentAnnounceUpdate(
  tournamentId: string,
  db?: NotificationDb
): Promise<void> {
  const event = await createNotificationEvent(
    {
      category: "TOURNAMENT",
      eventType: "TOURNAMENT_MODIFIED",
      sourceId: tournamentId,
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
      targetSlot: announceSlot(tournamentId),
    },
    db
  );
}

/**
 * SEND une fois (occurrence fixe) — résumé posté dans le fil à la clôture
 * (champion/finaliste/demi-finalistes), EN PLUS de l'EDIT de l'annonce
 * (`enqueueTournamentAnnounceUpdate`, à appeler séparément par
 * l'appelant, même découpage que `enqueueSessionResultThreadSummary`).
 *
 * `db` optionnel — même contrat que ci-dessus.
 */
export async function enqueueTournamentResultThreadSummary(
  tournamentId: string,
  db?: NotificationDb
): Promise<void> {
  const event = await createNotificationEvent(
    { category: "TOURNAMENT", eventType: "TOURNAMENT_RESULT", sourceId: tournamentId },
    db
  );
  await enqueueDelivery(
    {
      eventId: event.id,
      channel: "DISCORD_CHANNEL",
      transport: "BOT",
      operation: "SEND",
      recipientKey: "channel",
      targetSlot: threadSummarySlot(tournamentId),
    },
    db
  );
}

/* -------------------------------------------------------------------- */
/* Résolution — appelée par l'exécuteur (#97), jamais directement        */
/* -------------------------------------------------------------------- */

type TournamentWithMatches = Tournament & {
  matches: TournamentMatch[];
  participants: TournamentParticipant[];
  game: { name: string };
  champion: User | null;
};

async function loadTournament(tournamentId: string): Promise<TournamentWithMatches | null> {
  return prisma.tournament.findUnique({
    where: { id: tournamentId },
    include: { matches: true, participants: true, game: { select: { name: true } }, champion: true },
  });
}

function absoluteTournamentUrl(tournamentId: string): string {
  const base = (process.env.AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return `${base}/tournois/${tournamentId}`;
}

interface AnnounceRendering {
  embed: DiscordRestEmbed;
}

/**
 * Rend l'annonce depuis l'état ACTUEL du tournoi, pour le SEND initial ET
 * pour toute EDIT ultérieure — jamais depuis un texte figé au moment de
 * l'enqueue (même garantie que `resolveAnnounceRendering`,
 * session-announce.ts). Couvre les 3 états observables du modèle
 * (`TournamentStatus` n'a pas d'état `CANCELLED` — aucune annulation de
 * tournoi n'existe dans le produit actuel, voir le commentaire de fichier
 * : REGISTRATION (inscriptions ouvertes), IN_PROGRESS (bracket lancé),
 * DONE (champion connu).
 */
function resolveTournamentAnnounceRendering(tournament: TournamentWithMatches): AnnounceRendering {
  const url = absoluteTournamentUrl(tournament.id);

  if (tournament.status === "DONE") {
    return {
      embed: {
        title: `🏆 Tournoi ${tournament.name} — terminé`,
        description: `Sur ${tournament.game.name}`,
        color: 0xf59e0b,
        fields: [
          { name: "Champion", value: tournament.champion?.discordName ?? "—" },
          { name: "Lien", value: url },
        ],
      },
    };
  }

  if (tournament.status === "IN_PROGRESS") {
    const totalRounds = totalRoundsFor(bracketSizeFor(tournament.maxPlayers));
    return {
      embed: {
        title: `🏆 Tournoi ${tournament.name} — en cours`,
        description: `Sur ${tournament.game.name}`,
        color: 0x8b5cf6,
        fields: [
          { name: "Participants", value: String(tournament.participants.length), inline: true },
          { name: "Rounds", value: String(totalRounds), inline: true },
          { name: "Lien", value: url },
        ],
      },
    };
  }

  // REGISTRATION — création, ou inscriptions toujours ouvertes.
  return {
    embed: {
      title: `🏆 Tournoi ${tournament.name} — inscriptions ouvertes`,
      description: `Sur ${tournament.game.name}`,
      color: 0x8b5cf6,
      fields: [
        {
          name: "Places",
          value: `${tournament.participants.length} / ${tournament.maxPlayers}`,
          inline: true,
        },
        { name: "Lien", value: url },
      ],
    },
  };
}

/** Contenu commun aux 3 rôles — jamais de mention, jamais de texte visible
 * hors embed (chaque rôle porte toute son information dans l'embed,
 * contrairement au rappel de soirée qui n'a pas d'équivalent ici). */
function buildMessageContent(embed: DiscordRestEmbed): ResolvedMessageContent {
  return { embeds: [embed], allowedMentions: NO_MENTIONS };
}

async function findSentDelivery(targetSlot: string) {
  return prisma.notificationDelivery.findFirst({
    where: { targetSlot, operation: "SEND", status: "SENT" },
    select: { discordMessageId: true, discordChannelId: true, discordThreadId: true },
  });
}

/**
 * Résolveur TOURNAMENT — dispatché par le rôle terminal du `targetSlot`
 * (`announce`/`thread`/`thread-summary`), même structure que
 * `sessionAnnounceResolver` (chaque dépendance inter-`targetSlot` est
 * vérifiée ICI explicitement, `claimNextDelivery` ne la résout jamais
 * automatiquement pour des cibles DIFFÉRENTES).
 */
export const tournamentAnnounceResolver: DeliveryResolver = {
  async resolve({ delivery, event }: ResolveInput): Promise<Resolution> {
    const config = getTournamentAnnounceConfig();
    if (!config) return { eligible: false, reason: "not_configured" };

    const tournamentId = event.sourceId;
    const tournament = await loadTournament(tournamentId);
    if (!tournament) return { eligible: false, reason: "expired" };

    const role = delivery.targetSlot.split(":").slice(3).join(":");

    if (role === "announce") {
      return resolveAnnounceDelivery(delivery, tournament, config.channelId);
    }
    if (role === "thread") {
      return resolveThreadCreation(tournamentId, config.channelId);
    }
    if (role === "thread-summary") {
      return resolveThreadSummary(tournamentId, tournament);
    }

    logger.error("tournament-announce", `targetSlot de rôle inconnu : ${delivery.targetSlot}`, {
      tournamentId,
    });
    return { eligible: false, reason: "unresolvable" };
  },
};

async function resolveAnnounceDelivery(
  delivery: ClaimedDelivery,
  tournament: TournamentWithMatches,
  channelId: string
): Promise<Resolution> {
  const rendering = resolveTournamentAnnounceRendering(tournament);

  if (delivery.operation === "SEND") {
    const action: ResolvedAction = {
      kind: "send_channel_message",
      channelId,
      message: buildMessageContent(rendering.embed),
    };
    return { eligible: true, action };
  }

  // EDIT — nécessite le messageId déjà posté par le SEND initial.
  const sent = await findSentDelivery(announceSlot(tournament.id));
  if (!sent?.discordMessageId) return { eligible: false, reason: "dependency_not_ready" };

  const action: ResolvedAction = {
    kind: "edit_channel_message",
    channelId,
    messageId: sent.discordMessageId,
    message: buildMessageContent(rendering.embed),
  };
  return { eligible: true, action };
}

async function resolveThreadCreation(tournamentId: string, channelId: string): Promise<Resolution> {
  const sent = await findSentDelivery(announceSlot(tournamentId));
  if (!sent?.discordMessageId) return { eligible: false, reason: "dependency_not_ready" };

  const action: ResolvedAction = {
    kind: "create_thread",
    channelId,
    messageId: sent.discordMessageId,
    name: `Tournoi — ${tournamentId.slice(0, 8)}`,
  };
  return { eligible: true, action };
}

async function resolveThreadSummary(
  tournamentId: string,
  tournament: TournamentWithMatches
): Promise<Resolution> {
  const thread = await findSentDelivery(threadSlot(tournamentId));
  if (!thread?.discordThreadId) return { eligible: false, reason: "dependency_not_ready" };

  if (tournament.status !== "DONE" || !tournament.championId) {
    // Résumé enqueue avant que la finalisation n'ait (encore) committé la
    // lecture qu'il voit, ou tournoi redevenu incohérent entre-temps —
    // jamais de sens à publier un résumé sans résultat, différé, retenté
    // au prochain claim (`dependency_not_ready`, jamais un refus terminal :
    // la même transaction qui a enqueue ce résumé a DÉJÀ committé
    // `status: DONE` avant que l'événement ne devienne réclamable côté
    // exécuteur, donc cet état ne devrait durer qu'une fenêtre de lecture
    // read-committed transitoire, jamais indéfiniment).
    return { eligible: false, reason: "dependency_not_ready" };
  }

  const totalRounds = totalRoundsFor(bracketSizeFor(tournament.maxPlayers));
  const finalMatch = tournament.matches.find((m) => m.round === totalRounds);
  const runnerUpId =
    finalMatch && finalMatch.winnerId
      ? finalMatch.player1Id === finalMatch.winnerId
        ? finalMatch.player2Id
        : finalMatch.player1Id
      : null;
  const runnerUp = runnerUpId
    ? await prisma.user.findUnique({ where: { id: runnerUpId }, select: { discordName: true } })
    : null;

  const semifinalRound = totalRounds - 1;
  const semifinalLoserIds = tournament.matches
    .filter((m) => m.round === semifinalRound && m.winnerId)
    .map((m) => (m.player1Id === m.winnerId ? m.player2Id : m.player1Id))
    .filter((id): id is string => id !== null && id !== runnerUpId);
  const semifinalists =
    semifinalLoserIds.length > 0
      ? await prisma.user.findMany({ where: { id: { in: semifinalLoserIds } }, select: { discordName: true } })
      : [];

  const embed: DiscordRestEmbed = {
    title: `🎮 Résumé — ${tournament.name}`,
    description: `Sur ${tournament.game.name} — GG à tous les participants !`,
    color: 0xf59e0b,
    fields: [
      { name: "🏆 Champion", value: tournament.champion?.discordName ?? "—" },
      ...(runnerUp ? [{ name: "🥈 Finaliste", value: runnerUp.discordName }] : []),
      ...(semifinalists.length > 0
        ? [{ name: "🥉 Demi-finalistes", value: semifinalists.map((u) => u.discordName).join(", ") }]
        : []),
    ],
  };

  const action: ResolvedAction = {
    kind: "send_thread_message",
    threadId: thread.discordThreadId,
    message: buildMessageContent(embed),
  };
  return { eligible: true, action };
}
