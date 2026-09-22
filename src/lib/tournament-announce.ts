import { randomUUID } from "crypto";
import type { Tournament, TournamentMatch, TournamentParticipant, User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { bracketSizeFor, totalRoundsFor } from "@/lib/tournaments";
import { getTournamentAnnounceConfig } from "@/lib/discord-bot-config";
import { resolveNotifiedUserIds } from "@/lib/notify-recipients";
import { filterUsersByNotificationPreference } from "@/lib/notification-preferences";
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
 * destination choisie par un formulaire).
 *
 * Revue ciblée avant merge #100 — contrôle de destination : la
 * configuration live (`getTournamentAnnounceConfig()`) n'est plus JAMAIS
 * utilisée comme destination d'un envoi — seulement comme porte
 * d'activation globale de la catégorie (`not_configured` si absente).
 * La destination RÉELLE d'un tournoi donné vient de
 * `Tournament.discordGuildId`/`discordChannelId`, figée UNE SEULE FOIS à
 * sa création (voir le commentaire du champ, schema.prisma) — un
 * changement de `DISCORD_BOT_TOURNAMENT_CHANNEL_ID` après coup, même
 * AVANT le tout premier SEND d'un tournoi déjà créé, n'a donc plus aucun
 * effet sur lui. Avant le tout premier SEND (et seulement lui — jamais
 * pour une EDIT ni un fil, voir plus bas), cette destination persistée
 * est vérifiée via un VRAI appel Discord (`sendChannelMessageVerified`,
 * discord-rest.ts) : le salon doit appartenir au `guildId` persisté ET
 * son type doit supporter le parcours annonce+fil — sinon AUCUN envoi
 * n'est tenté. Les éditions et le fil qui suivent ne redemandent JAMAIS
 * la config (live ou persistée) : ils utilisent la référence du message
 * RÉELLEMENT créé (`discordChannelId`/`discordMessageId` persistés sur la
 * livraison SEND finalisée, lus via `findSentDelivery`) — un changement
 * de salon survenu APRÈS le premier SEND ne peut donc jamais recombiner
 * une ancienne annonce avec un nouveau salon : le message édité/le fil
 * créé cible toujours exactement le salon où l'annonce existe réellement.
 *
 * Quatre rôles de `targetSlot`,
 * chacun une ligne `NotificationDelivery` distincte (voir
 * `notification-delivery.ts`) :
 *   - `announce` — SEND une fois à la création (inscriptions ouvertes),
 *     puis une EDIT à chaque changement d'état ultérieur pertinent
 *     (lancement du bracket, clôture, annulation, suppression) — TOUJOURS
 *     rendue depuis l'état COURANT du tournoi en base au moment où la
 *     livraison est réellement traitée, jamais depuis un texte figé à
 *     l'enqueue (même garantie que `session-announce.ts`, voir son
 *     commentaire de fichier).
 *   - `thread` — SEND une fois, crée le fil à partir du message d'annonce ;
 *     dépend explicitement que `announce` soit `SENT` (résolu ici, PAS
 *     automatiquement par `claimNextDelivery`, qui ne résout que les
 *     dépendances SUR LE MÊME `targetSlot`).
 *   - `thread-summary` — SEND, résumé (champion/finaliste/demi-finalistes)
 *     posté DANS le fil à la clôture ; dépend que `thread` soit `SENT`.
 *   - `thread-close` — SEND (occurrence fixe, V2 annulation/suppression),
 *     archive le fil sur annulation/suppression — voir `resolveThreadClose`
 *     ci-dessous pour pourquoi ce rôle ne dépend JAMAIS de l'état du
 *     tournoi lui-même (contrairement aux trois autres), seulement de la
 *     référence du fil déjà persistée.
 *
 * Pas de rappels (contrairement aux soirées, F7) — aucune notion de
 * rappel n'existe pour les tournois dans le produit actuel, hors périmètre
 * de ce chantier (aucune règle de tournoi inventée au-delà de ce qui est
 * demandé).
 *
 * **Mentions (V2, notifications maîtrisées)** — LE SEUL message qui
 * mentionne jamais quelqu'un est le SEND initial de `announce` (ouverture
 * des inscriptions), et UNIQUEMENT les destinataires explicitement
 * sélectionnés par le créateur au formulaire (`Tournament.notifiedUserIds`,
 * même contrat que `Session.notifiedUserIds`) ET encore éligibles à ce
 * moment-là (préférence `TOURNAMENT` relue au traitement RÉEL, jamais à
 * l'enqueue — voir `resolveEligibleTournamentMentions`). TOUTES les autres
 * livraisons (EDIT de l'annonce — lancement/clôture/annulation/suppression
 * —, résumé de fil, fermeture de fil) restent `allowedMentions: {parse:
 * []}` STRICT, sans exception : ne jamais re-solliciter personne pour une
 * mise à jour, une inscription, une désinscription ou un compteur — les
 * noms de participants continuent d'apparaître en texte brut uniquement
 * dans ces messages-là (jamais `<@id>`). Aucune notification interne
 * (`createNotifications`) n'est écrite par ce module, avant comme
 * maintenant : seule la mention Discord elle-même est ajoutée par ce
 * chantier, jamais une notification bell interne (hors périmètre explicite
 * de la demande).
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
function threadCloseSlot(tournamentId: string): string {
  return `${GUILD_SLOT_PREFIX}:TOURNAMENT:${tournamentId}:thread-close`;
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

/**
 * SEND une fois (occurrence fixe, V2 annulation/suppression) — ferme
 * (archive) le fil du tournoi. Appelée par `cancelTournament`/
 * `deleteTournament` (src/lib/tournaments.ts), TOUJOURS accompagnée d'un
 * `enqueueTournamentAnnounceUpdate` dans la même transaction (l'annonce et
 * le fil sont deux messages distincts, deux livraisons indépendantes,
 * même découpage que partout ailleurs dans ce module) — jamais appelée
 * seule.
 *
 * Occurrence FIXE (jamais aléatoire) : un tournoi n'est annulé/supprimé
 * qu'UNE SEULE FOIS (transition d'état à sens unique, réclamée par
 * `updateMany`/verrou `FOR UPDATE`, voir `tournaments.ts`) — un appel
 * répété par retry applicatif doit retomber sur la MÊME livraison, jamais
 * en créer une seconde.
 *
 * `db` optionnel — même contrat que ci-dessus.
 */
export async function enqueueTournamentThreadClose(
  tournamentId: string,
  db?: NotificationDb
): Promise<void> {
  const event = await createNotificationEvent(
    { category: "TOURNAMENT", eventType: "TOURNAMENT_REMOVED", sourceId: tournamentId },
    db
  );
  await enqueueDelivery(
    {
      eventId: event.id,
      channel: "DISCORD_CHANNEL",
      transport: "BOT",
      operation: "SEND",
      recipientKey: "channel",
      targetSlot: threadCloseSlot(tournamentId),
    },
    db
  );
}

/**
 * Utilisé par `deleteTournament` (tournaments.ts) pour décider, AVANT de
 * supprimer la ligne `Tournament`, si son annonce a RÉELLEMENT déjà été
 * postée — seul ce cas nécessite d'éditer le message existant ("supprimé")
 * et de fermer le fil avant de perdre toute trace du tournoi ; si rien n'a
 * encore été envoyé, la suppression seule suffit (voir le commentaire de
 * `resolveAnnounceDelivery` : un SEND encore PENDING se refuse lui-même,
 * `expired`, dès qu'il constate que le tournoi a disparu).
 */
export async function isTournamentAnnounceSent(tournamentId: string, db: NotificationDb = prisma): Promise<boolean> {
  const sent = await db.notificationDelivery.findFirst({
    where: { targetSlot: announceSlot(tournamentId), operation: "SEND", status: "SENT" },
    select: { id: true },
  });
  return sent !== null;
}

/**
 * État d'envoi de l'annonce/du fil d'un tournoi — pour l'affichage créateur
 * (`/tournois/[id]`), jamais présenté comme instantané : lit l'état RÉEL
 * de la dernière livraison SEND connue sur chaque rôle (`pending` par
 * défaut — aucune livraison connue, ou encore PENDING/RESERVED/RETRYING —
 * jamais `"sent"` par optimisme, et jamais `"failed"` pour un simple envoi
 * différé qui n'a pas encore eu lieu).
 */
export interface TournamentAnnounceStatus {
  announce: "pending" | "sent" | "failed";
  thread: "pending" | "sent" | "failed";
}

export async function getTournamentAnnounceStatus(tournamentId: string): Promise<TournamentAnnounceStatus> {
  const slots = [announceSlot(tournamentId), threadSlot(tournamentId)];
  const rows = await prisma.notificationDelivery.findMany({
    where: { targetSlot: { in: slots }, operation: "SEND" },
    orderBy: { sequence: "desc" },
    select: { targetSlot: true, status: true },
  });
  function statusFor(slot: string): "pending" | "sent" | "failed" {
    const row = rows.find((r) => r.targetSlot === slot);
    if (!row) return "pending";
    if (row.status === "SENT") return "sent";
    if (row.status === "FAILED") return "failed";
    return "pending";
  }
  return { announce: statusFor(slots[0]), thread: statusFor(slots[1]) };
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
  /** Potes à mentionner dans le CONTENU du message (hors embed) — non
   * `null` UNIQUEMENT pour le tout premier SEND (ouverture des
   * inscriptions), toujours `null` pour toute EDIT (relancement, clôture,
   * annulation, suppression) ou pour le rendu "générique" d'un tournoi
   * supprimé — voir `resolveAnnounceDelivery`. */
  candidateMentionIds: string[] | null;
}

/**
 * Rend l'annonce depuis l'état ACTUEL du tournoi, pour le SEND initial ET
 * pour toute EDIT ultérieure — jamais depuis un texte figé au moment de
 * l'enqueue (même garantie que `resolveAnnounceRendering`,
 * session-announce.ts). Couvre les 4 états observables du modèle
 * (REGISTRATION, IN_PROGRESS, DONE, CANCELLED — V2), PLUS le cas où le
 * tournoi a été SUPPRIMÉ (ligne disparue, `tournament === null`) : ce
 * dernier cas est le SEUL de tout ce module qui rend un contenu générique,
 * indépendant de toute donnée du tournoi (par nécessité — la ligne n'existe
 * plus au moment où cette EDIT est réellement traitée, voir le commentaire
 * de `resolveAnnounceDelivery` et de `deleteTournament`, tournaments.ts).
 */
function resolveTournamentAnnounceRendering(tournament: TournamentWithMatches | null): AnnounceRendering {
  if (!tournament) {
    return {
      embed: {
        title: "🏆 Tournoi supprimé",
        description: "Ce tournoi a été supprimé par son créateur.",
        color: 0xef4444,
      },
      candidateMentionIds: null,
    };
  }

  const url = absoluteTournamentUrl(tournament.id);

  if (tournament.status === "CANCELLED") {
    return {
      embed: {
        title: `🏆 Tournoi ${tournament.name} — annulé`,
        description: `Sur ${tournament.game.name} — annulé par son créateur. Les matchs déjà joués restent visibles.`,
        color: 0xef4444,
        fields: [{ name: "Détails", value: url }],
      },
      candidateMentionIds: null,
    };
  }

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
      candidateMentionIds: null,
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
      candidateMentionIds: null,
    };
  }

  // REGISTRATION — création, ou inscriptions toujours ouvertes. Seul état
  // qui mentionne jamais quelqu'un (SEND initial uniquement — voir
  // `resolveAnnounceDelivery`, une EDIT ultérieure repasse ici tant que le
  // tournoi reste en REGISTRATION, ex. correction rare, mais ne mentionne
  // jamais elle non plus : c'est `resolveAnnounceDelivery`, pas cette
  // fonction, qui décide QUAND ce champ est effectivement utilisé).
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
    candidateMentionIds: resolveNotifiedUserIds(tournament.notifiedUserIds),
  };
}

/**
 * Potes réellement mentionnés au SEND initial — croise la sélection du
 * créateur (`candidateMentionIds`, déjà une liste d'ids VALIDÉS contre de
 * vrais users par `createTournamentAction`, jamais relus ici) avec la
 * préférence `TOURNAMENT` relue au traitement RÉEL (jamais à l'enqueue,
 * même garantie que #98/#99) : un opt-out posé APRÈS l'enqueue mais AVANT
 * le SEND retire quand même la mention. `null` (aucune restriction —
 * tournoi créé avant cette colonne) traité comme "personne à mentionner",
 * jamais "tout le monde" : contrairement aux soirées, il n'existe aucune
 * notion de "liste de potes du groupe" à consulter par défaut ici, seule
 * la sélection explicite du créateur compte.
 */
async function resolveEligibleTournamentMentions(
  candidateMentionIds: string[]
): Promise<{ id: string; discordId: string; silenceReminders: boolean }[]> {
  if (candidateMentionIds.length === 0) return [];
  const candidates = await prisma.user.findMany({
    where: { id: { in: candidateMentionIds } },
    select: { id: true, discordId: true, silenceReminders: true },
  });
  return filterUsersByNotificationPreference(candidates, "TOURNAMENT");
}

function mentionContent(users: { discordId: string }[]): { text: string; userIds: string[] } {
  return { text: users.map((u) => `<@${u.discordId}>`).join(" "), userIds: users.map((u) => u.discordId) };
}

/** Contenu commun à la plupart des rôles — jamais de mention (embed
 * uniquement) SAUF pour le SEND initial de `announce`, seul appelant à
 * fournir `mentionedUsers` non vide (voir `resolveAnnounceDelivery`). */
function buildMessageContent(embed: DiscordRestEmbed, mentionedUsers: { discordId: string }[] = []): ResolvedMessageContent {
  if (mentionedUsers.length === 0) {
    return { embeds: [embed], allowedMentions: NO_MENTIONS };
  }
  const { text, userIds } = mentionContent(mentionedUsers);
  return {
    content: text,
    embeds: [embed],
    // Liste EXPLICITE d'ids (`users`), jamais `parse: ["users"]` — exclut
    // structurellement tout autre `<@id>` qui apparaîtrait par accident
    // dans le texte (ex. un nom de tournoi ressemblant à une mention) :
    // seuls CES ids précis peuvent notifier, jamais `@everyone`/`@here`/un
    // rôle (`NO_MENTIONS`/`parse: []` de base, jamais élargi).
    allowedMentions: { ...NO_MENTIONS, users: userIds },
  };
}

async function findSentDelivery(targetSlot: string) {
  return prisma.notificationDelivery.findFirst({
    where: { targetSlot, operation: "SEND", status: "SENT" },
    select: { discordMessageId: true, discordChannelId: true, discordThreadId: true },
  });
}

/**
 * Résolveur TOURNAMENT — dispatché par le rôle terminal du `targetSlot`
 * (`announce`/`thread`/`thread-summary`/`thread-close`), même structure
 * que `sessionAnnounceResolver` (chaque dépendance inter-`targetSlot` est
 * vérifiée ICI explicitement, `claimNextDelivery` ne la résout jamais
 * automatiquement pour des cibles DIFFÉRENTES).
 *
 * `thread-close` est traité AVANT le chargement du tournoi, et l'EDIT de
 * `announce` tolère explicitement un tournoi introuvable (ligne
 * supprimée) — les DEUX seuls cas de ce résolveur qui n'exigent PAS que
 * le tournoi existe encore, voir `resolveThreadClose`/
 * `resolveAnnounceDelivery` pour le raisonnement complet (V2, annulation/
 * suppression).
 */
export const tournamentAnnounceResolver: DeliveryResolver = {
  async resolve({ delivery, event }: ResolveInput): Promise<Resolution> {
    // Porte d'activation GLOBALE de la catégorie uniquement — jamais la
    // source de la destination d'un envoi précis (voir le commentaire de
    // fichier). Si retirée pendant qu'un tournoi bot a des livraisons en
    // attente, celles-ci échouent en `not_configured` (même limite
    // assumée/documentée que pour les soirées, #99).
    if (!getTournamentAnnounceConfig()) return { eligible: false, reason: "not_configured" };

    const tournamentId = event.sourceId;
    const role = delivery.targetSlot.split(":").slice(3).join(":");

    if (role === "thread-close") {
      return resolveThreadClose(tournamentId);
    }

    const tournament = await loadTournament(tournamentId);

    if (role === "announce") {
      if (!tournament) {
        // Tournoi supprimé entre l'enqueue et le traitement — un SEND n'a
        // plus rien à annoncer (`expired`, jamais une invitation tardive à
        // rejoindre un tournoi qui n'existe plus). Une EDIT, en revanche,
        // doit encore pouvoir dire "supprimé" sur le message déjà publié
        // (voir `deleteTournament`, tournaments.ts, et le rendu générique
        // de `resolveTournamentAnnounceRendering`) — c'est le SEUL rôle de
        // ce module qui continue d'être traité après la disparition du
        // tournoi.
        if (delivery.operation !== "EDIT") return { eligible: false, reason: "expired" };
        return resolveAnnounceDelivery(delivery, tournamentId, null);
      }
      return resolveAnnounceDelivery(delivery, tournamentId, tournament);
    }

    if (!tournament) return { eligible: false, reason: "expired" };

    if (role === "thread") {
      return resolveThreadCreation(tournamentId, tournament);
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
  tournamentId: string,
  tournament: TournamentWithMatches | null
): Promise<Resolution> {
  const rendering = resolveTournamentAnnounceRendering(tournament);

  if (delivery.operation === "SEND") {
    // Structurellement non-null ici : le dispatcher refuse déjà tout SEND
    // sans tournoi (`expired`) avant d'appeler cette fonction — garde
    // défensive uniquement.
    if (!tournament) return { eligible: false, reason: "expired" };

    if (tournament.status === "CANCELLED") {
      // Annulé avant même le tout premier envoi (course créateur —
      // possible seulement pour un tournoi passé directement de
      // REGISTRATION à... non, `cancelTournament` exige IN_PROGRESS ; ce
      // cas ne devrait donc jamais survenir en pratique pour un SEND
      // encore PENDING, gardé en défense structurelle si l'invariant
      // changeait un jour) : jamais une invitation tardive à rejoindre un
      // tournoi qui n'accepte plus d'inscriptions.
      return { eligible: false, reason: "expired" };
    }

    // Destination PERSISTÉE (figée à la création, voir le commentaire de
    // fichier), jamais la config live — et jamais null pour un tournoi
    // `announceViaBot: true` (les deux colonnes sont posées ENSEMBLE avec
    // le booléen, voir `createTournamentAction`). Défensif : un état
    // incohérent (ne devrait jamais se produire) refuse plutôt que
    // d'envoyer vers une destination vide.
    if (!tournament.discordGuildId || !tournament.discordChannelId) {
      logger.error(
        "tournament-announce",
        "Tournoi announceViaBot sans destination persistée — incohérence défensive.",
        { tournamentId: tournament.id }
      );
      return { eligible: false, reason: "not_configured" };
    }

    // Mentions (V2) — UNIQUEMENT sur ce tout premier SEND, jamais sur une
    // EDIT. Relit la préférence TOURNAMENT MAINTENANT (traitement réel),
    // jamais un instantané figé à l'enqueue.
    const mentioned = rendering.candidateMentionIds
      ? await resolveEligibleTournamentMentions(rendering.candidateMentionIds)
      : [];

    const action: ResolvedAction = {
      kind: "send_channel_message_verified",
      channelId: tournament.discordChannelId,
      guildId: tournament.discordGuildId,
      message: buildMessageContent(rendering.embed, mentioned),
    };
    return { eligible: true, action };
  }

  // EDIT — nécessite la référence (messageId ET channelId) du message
  // RÉELLEMENT posté par le SEND initial, jamais la destination persistée
  // sur le tournoi ni la config live : c'est cette référence, et elle
  // seule, qui garantit qu'une EDIT ne peut jamais recombiner l'ancienne
  // annonce avec un salon différent (voir le commentaire de fichier).
  // Fonctionne À L'IDENTIQUE que le tournoi existe encore ou non
  // (`tournamentId` passé explicitement, jamais dérivé de `tournament`,
  // qui peut être `null` ici — voir le dispatcher) : `announceSlot` ne
  // dépend que de l'id, jamais d'une lecture de la ligne `Tournament`.
  const sent = await findSentDelivery(announceSlot(tournamentId));
  if (!sent?.discordMessageId || !sent.discordChannelId) {
    return { eligible: false, reason: "dependency_not_ready" };
  }

  const action: ResolvedAction = {
    kind: "edit_channel_message",
    channelId: sent.discordChannelId,
    messageId: sent.discordMessageId,
    message: buildMessageContent(rendering.embed),
  };
  return { eligible: true, action };
}

async function resolveThreadCreation(tournamentId: string, tournament: TournamentWithMatches): Promise<Resolution> {
  if (tournament.status === "CANCELLED") {
    // Même raisonnement que le SEND de l'annonce ci-dessus (garde
    // structurelle, ne devrait pas survenir en pratique pour un `thread`
    // encore PENDING vu que `cancelTournament` exige IN_PROGRESS, donc
    // `announce` déjà SENT depuis longtemps) : jamais de fil créé pour un
    // tournoi qui n'existe plus vraiment.
    return { eligible: false, reason: "expired" };
  }

  // Même garantie que l'EDIT ci-dessus : le fil est créé DANS le salon où
  // l'annonce a RÉELLEMENT été postée (référence persistée sur la
  // livraison SEND finalisée), jamais depuis une config relue.
  const sent = await findSentDelivery(announceSlot(tournamentId));
  if (!sent?.discordMessageId || !sent.discordChannelId) {
    return { eligible: false, reason: "dependency_not_ready" };
  }

  const action: ResolvedAction = {
    kind: "create_thread",
    channelId: sent.discordChannelId,
    messageId: sent.discordMessageId,
    name: `Tournoi — ${tournamentId.slice(0, 8)}`,
  };
  return { eligible: true, action };
}

/**
 * Ferme (archive) le fil — V2 annulation/suppression. Ne dépend QUE de la
 * référence du fil déjà persistée (`thread` SENT), JAMAIS de l'état actuel
 * du tournoi : contrairement à `announce`/`thread`/`thread-summary`, cette
 * livraison doit continuer à fonctionner même après la SUPPRESSION du
 * tournoi (ligne disparue) — sa seule mission est de fermer un fil
 * Discord qui existe peut-être encore, indépendamment de ce qu'il reste
 * en base de l'entité qui l'a créé.
 *
 * Relit l'état ACTUEL (jamais figé) de la livraison "thread" elle-même
 * pour décider : SENT → archive le fil réel ; encore PENDING/RESERVED →
 * pas encore tranché, attend (`dependency_not_ready`, le fil pourrait
 * encore se créer OU se refuser juste après, selon l'état du tournoi
 * relu PAR CETTE livraison-là au moment où elle sera traitée) ; FAILED/
 * SKIPPED/jamais enqueue → le fil ne sera jamais créé, rien à fermer
 * (`expired`, définitif).
 */
async function resolveThreadClose(tournamentId: string): Promise<Resolution> {
  const thread = await findSentDelivery(threadSlot(tournamentId));
  if (thread?.discordThreadId) {
    const action: ResolvedAction = { kind: "archive_thread", threadId: thread.discordThreadId, locked: false };
    return { eligible: true, action };
  }

  const threadSend = await prisma.notificationDelivery.findFirst({
    where: { targetSlot: threadSlot(tournamentId), operation: "SEND" },
    orderBy: { sequence: "desc" },
    select: { status: true },
  });
  if (threadSend && (threadSend.status === "PENDING" || threadSend.status === "RESERVED")) {
    return { eligible: false, reason: "dependency_not_ready" };
  }
  return { eligible: false, reason: "expired" };
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
