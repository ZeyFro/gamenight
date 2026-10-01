import { randomUUID } from "crypto";
import type { Tournament, TournamentMatch, TournamentParticipant, User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { bracketSizeFor, totalRoundsFor } from "@/lib/tournaments";
import { getTournamentAnnounceConfig, isTournamentDirectMessageEnabled } from "@/lib/discord-bot-config";
import {
  enqueueDirectMessageEdits,
  enqueueDirectMessageFallback,
  enqueueDirectMessages,
  parseDmRole,
} from "@/lib/discord-dm";
import { resolveNotifiedUserIds } from "@/lib/notify-recipients";
import { filterUsersByNotificationPreference } from "@/lib/notification-preferences";
import {
  createNotificationEvent,
  enqueueDelivery,
  hasUnsettledDeliveriesWithPrefix,
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
 * **Règles de ping (PR D)** — création = annonce (jamais de mention) + fil,
 * mention des joueurs dans le fil (`thread-invite`, un message distinct) ET MP
 * d'invitation à chaque joueur (double ping voulu ; créateur : MP, pas de
 * mention). Modification/fin (lancement, clôture, annulation) = annonce ET MP
 * d'invitation ÉDITÉS, jamais un nouveau MP. Secours (mention dans le fil) si le
 * MP du créateur est fermé. Arrivée/départ d'un joueur : aucun ping.
 *
 * **Mentions (V2, notifications maîtrisées)** — LE SEUL message qui
 * mentionne jamais quelqu'un est `thread-invite` (ouverture des
 * inscriptions, DANS le fil), et UNIQUEMENT les destinataires explicitement
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
function threadInviteSlot(tournamentId: string): string {
  return `${GUILD_SLOT_PREFIX}:TOURNAMENT:${tournamentId}:thread-invite`;
}
function threadSummarySlot(tournamentId: string): string {
  return `${GUILD_SLOT_PREFIX}:TOURNAMENT:${tournamentId}:thread-summary`;
}
function threadCloseSlot(tournamentId: string): string {
  return `${GUILD_SLOT_PREFIX}:TOURNAMENT:${tournamentId}:thread-close`;
}
function threadDeleteSlot(tournamentId: string): string {
  return `${GUILD_SLOT_PREFIX}:TOURNAMENT:${tournamentId}:thread-delete`;
}
function announceDeleteSlot(tournamentId: string): string {
  return `${GUILD_SLOT_PREFIX}:TOURNAMENT:${tournamentId}:announce-delete`;
}
function memberSlot(tournamentId: string, userId: string): string {
  return `${GUILD_SLOT_PREFIX}:TOURNAMENT:${tournamentId}:member:${userId}`;
}

/**
 * Nettoyage automatique des fils (V2) — emplacements lus par le
 * planificateur `discord-thread-cleanup.ts`. `archive` est le `thread-close`
 * historique (archivage à l'annulation), réutilisé tel quel.
 */
export function tournamentThreadCleanupSlots(tournamentId: string) {
  return {
    prefix: `${GUILD_SLOT_PREFIX}:TOURNAMENT:${tournamentId}:`,
    thread: threadSlot(tournamentId),
    archive: threadCloseSlot(tournamentId),
    delete: threadDeleteSlot(tournamentId),
  };
}

export function isTerminalTournamentStatus(status: string): boolean {
  return status === "DONE" || status === "CANCELLED";
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
  // Les MP d'invitation déjà envoyés sont ÉDITÉS aussi (statut courant), jamais
  // un nouveau MP.
  if (isTournamentDirectMessageEnabled()) {
    await enqueueDirectMessageEdits(
      { category: "TOURNAMENT", sourceId: tournamentId, eventType: "TOURNAMENT_DM_EDIT", kind: "announce" },
      db
    );
  }
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
 * Chantier nettoyage réel du stockage (V2) — suppression manuelle
 * définitive d'un tournoi (`deleteTournament`, tournaments.ts) : supprime
 * DÉFINITIVEMENT (jamais une simple édition/archivage, réservés à
 * l'annulation — voir `cancelTournament`, comportement inchangé et
 * distinct) le message d'annonce dans le salon PARENT et le fil dédié,
 * AVEC ses messages. Toujours appelées ENSEMBLE par `deleteTournament`
 * (deux livraisons indépendantes, comme partout ailleurs dans ce module).
 *
 * Occurrence ALÉATOIRE (jamais fixe) — même raisonnement que
 * `enqueueSessionThreadDelete` (session-announce.ts) : appelable
 * plusieurs fois (l'appel automatique à la suppression, PUIS un éventuel
 * réessai manuel d'un nettoyage resté en échec terminal), la convergence
 * `[targetSlot, operation]` garantit qu'une seule intention survit à la
 * fois sans jamais dupliquer l'effet (idempotence Discord elle-même déjà
 * assurée côté `performDiscordAction`, équivalence 404 → succès).
 *
 * `db` optionnel — composable avec la transaction qui supprime la ligne
 * `Tournament` (voir `deleteTournament`) : un crash entre les deux ne doit
 * jamais laisser un tournoi supprimé en base sans que son annonce/son fil
 * ne soient jamais nettoyés.
 */
export async function enqueueTournamentAnnounceDelete(tournamentId: string, db?: NotificationDb): Promise<void> {
  const event = await createNotificationEvent(
    { category: "TOURNAMENT", eventType: "TOURNAMENT_REMOVED", sourceId: tournamentId, occurrence: randomUUID() },
    db
  );
  await enqueueDelivery(
    {
      eventId: event.id,
      channel: "DISCORD_CHANNEL",
      transport: "BOT",
      operation: "SEND",
      recipientKey: "channel",
      targetSlot: announceDeleteSlot(tournamentId),
    },
    db
  );
}

/**
 * Nettoyage automatique des fils (V2) — même `targetSlot` que
 * `enqueueTournamentThreadDelete`, occurrence FIXE (un passage cron répété
 * ne crée jamais une seconde intention). Voir `enqueueSessionThreadAutoDelete`.
 */
export async function enqueueTournamentThreadAutoDelete(tournamentId: string, db?: NotificationDb): Promise<void> {
  const event = await createNotificationEvent(
    { category: "TOURNAMENT", eventType: "TOURNAMENT_THREAD_AUTO_DELETE", sourceId: tournamentId },
    db
  );
  await enqueueDelivery(
    {
      eventId: event.id,
      channel: "DISCORD_CHANNEL",
      transport: "BOT",
      operation: "SEND",
      recipientKey: "channel",
      targetSlot: threadDeleteSlot(tournamentId),
    },
    db
  );
}

export async function enqueueTournamentThreadDelete(tournamentId: string, db?: NotificationDb): Promise<void> {
  const event = await createNotificationEvent(
    { category: "TOURNAMENT", eventType: "TOURNAMENT_REMOVED", sourceId: tournamentId, occurrence: randomUUID() },
    db
  );
  await enqueueDelivery(
    {
      eventId: event.id,
      channel: "DISCORD_CHANNEL",
      transport: "BOT",
      operation: "SEND",
      recipientKey: "channel",
      targetSlot: threadDeleteSlot(tournamentId),
    },
    db
  );
}

/**
 * État de la dernière tentative de nettoyage Discord connue pour un
 * tournoi SUPPRIMÉ — même usage d'audit/retry manuel que
 * `getSessionThreadDeleteStatus` (session-announce.ts, voir son
 * commentaire pour le raisonnement complet).
 */
export async function getTournamentCleanupStatus(
  tournamentId: string
): Promise<{
  announce: "never_enqueued" | "pending" | "done" | "failed";
  thread: "never_enqueued" | "pending" | "done" | "failed";
}> {
  async function statusFor(targetSlot: string): Promise<"never_enqueued" | "pending" | "done" | "failed"> {
    const rows = await prisma.notificationDelivery.findMany({
      where: { targetSlot, operation: "SEND" },
      orderBy: { sequence: "desc" },
      select: { status: true },
    });
    const latest = rows.find((r) => r.status !== "SKIPPED");
    if (!latest) return rows.length > 0 ? "pending" : "never_enqueued";
    if (latest.status === "SENT") return "done";
    if (latest.status === "FAILED") return "failed";
    return "pending";
  }
  return {
    announce: await statusFor(announceDeleteSlot(tournamentId)),
    thread: await statusFor(threadDeleteSlot(tournamentId)),
  };
}

/**
 * Chantier auto-adhésion aux fils de tournois (V2) — ajoute UNE personne
 * comme membre du fil du tournoi (créateur, destinataire sélectionné à la
 * création, OU joueur qui s'inscrit ensuite — même rôle `member:<userId>`
 * pour les trois cas, voir le commentaire de fichier). Ajouter au fil
 * n'inscrit JAMAIS au tournoi (aucune écriture `TournamentParticipant`
 * ici) et ne notifie jamais séparément (aucun message envoyé, seulement
 * une adhésion API — voir `resolveThreadMembership`).
 *
 * Occurrence ALÉATOIRE (comme `enqueueSessionInviteSync`) — un appel
 * répété pour la MÊME personne (ex. notifiée à la création PUIS inscrite
 * ensuite) crée une nouvelle ligne sur le MÊME `targetSlot`
 * (`memberSlot(tournamentId, userId)`, dérivé de l'id, jamais dupliqué par
 * personne) ; seule la plus récente est traitée (convergence), et le
 * `PUT` Discord sous-jacent est de toute façon idempotent — déduplication
 * garantie à deux niveaux, jamais un double ajout traité comme deux
 * opérations distinctes.
 *
 * `db` optionnel — composable avec la transaction de création du tournoi
 * ou d'inscription (voir `createTournamentAction`/`registerForTournamentAction`).
 */
export async function enqueueTournamentThreadMember(
  tournamentId: string,
  userId: string,
  db?: NotificationDb
): Promise<void> {
  const event = await createNotificationEvent(
    { category: "TOURNAMENT", eventType: "TOURNAMENT_THREAD_MEMBER", sourceId: tournamentId, occurrence: randomUUID() },
    db
  );
  await enqueueDelivery(
    {
      eventId: event.id,
      channel: "DISCORD_CHANNEL",
      transport: "BOT",
      operation: "SEND",
      recipientKey: `user:${userId}`,
      targetSlot: memberSlot(tournamentId, userId),
    },
    db
  );
}

/**
 * Resynchronisation GROUPÉE du fil — réservée au créateur
 * (`resyncTournamentThreadMembersAction`, tournois/actions.ts, vérifie
 * `createdById === actorUserId`), pour un tournoi créé AVANT ce
 * correctif (jamais enqueue-é la première fois). Ne recrée JAMAIS le fil
 * ni ne renvoie l'annonce/reping personne (aucun message envoyé,
 * uniquement des ajouts silencieux d'adhésion) — même garantie que
 * `resyncSessionThreadMembers` (session-announce.ts). Relit l'état
 * COURANT (destinataires persistés + inscrits ACTUELS) à CET INSTANT,
 * jamais un instantané périmé.
 */
export async function resyncTournamentThreadMembers(tournamentId: string): Promise<void> {
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: { createdById: true, notifiedUserIds: true },
  });
  if (!tournament) return;

  const userIds = new Set<string>([tournament.createdById]);
  for (const id of resolveNotifiedUserIds(tournament.notifiedUserIds) ?? []) userIds.add(id);

  const participants = await prisma.tournamentParticipant.findMany({
    where: { tournamentId },
    select: { userId: true },
  });
  for (const p of participants) userIds.add(p.userId);

  for (const userId of userIds) {
    await enqueueTournamentThreadMember(tournamentId, userId);
  }
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

/**
 * Le CRÉATEUR du tournoi reçoit aussi le MP d'annonce, même s'il n'est pas
 * dans sa propre sélection `notifiedUserIds` — seule sa préférence
 * `TOURNAMENT` s'applique (relue à chaque appel), comme pour tout le monde.
 */
async function resolveTournamentCreatorDmRecipient(
  creatorId: string
): Promise<{ id: string; discordId: string; silenceReminders: boolean } | null> {
  const creator = await prisma.user.findUnique({
    where: { id: creatorId },
    select: { id: true, discordId: true, silenceReminders: true },
  });
  if (!creator) return null;
  const [allowed] = await filterUsersByNotificationPreference([creator], "TOURNAMENT");
  return allowed ?? null;
}

/** Éligibilité d'un destinataire de MP relue À L'ENVOI : le créateur n'est
 * soumis qu'à sa préférence ; tout autre pote doit toujours figurer dans la
 * sélection du créateur ET avoir la préférence `TOURNAMENT` active. */
async function isTournamentDmRecipientEligible(
  tournament: Pick<Tournament, "createdById" | "notifiedUserIds">,
  userId: string
): Promise<boolean> {
  if (userId === tournament.createdById) return (await resolveTournamentCreatorDmRecipient(userId)) !== null;
  const selected = resolveNotifiedUserIds(tournament.notifiedUserIds) ?? [];
  if (!selected.includes(userId)) return false;
  return (await resolveEligibleTournamentMentions([userId])).length > 0;
}

/**
 * MP d'ouverture d'un tournoi — état relu JUSTE À TEMPS : le tournoi doit
 * toujours exister et accepter les inscriptions (jamais un MP pour un
 * tournoi lancé/annulé/supprimé entre-temps), et le destinataire rester
 * éligible. Un MP fermé n'est JAMAIS retenté (`dm_unavailable`, échec
 * définitif) : c'est `onTerminalDiscordFailure` qui met la mention de
 * secours en file.
 */
async function resolveTournamentDirectMessage(
  role: string,
  tournament: TournamentWithMatches,
  delivery: ClaimedDelivery
): Promise<Resolution> {
  const parsed = parseDmRole(role, "dm:");
  if (!parsed || parsed.kind !== "announce") return { eligible: false, reason: "unresolvable" };
  const isEdit = delivery.operation === "EDIT";
  // SEND : seulement tant que les inscriptions sont ouvertes. EDIT : le MP
  // d'invitation déjà envoyé est mis à jour quel que soit l'état (lancé,
  // terminé, annulé).
  if (!isEdit && tournament.status !== "REGISTRATION") return { eligible: false, reason: "expired" };

  const recipient = await prisma.user.findUnique({ where: { id: parsed.userId } });
  if (!recipient) return { eligible: false, reason: "unresolvable" };
  if (!(await isTournamentDmRecipientEligible(tournament, recipient.id))) {
    return { eligible: false, reason: "preference_declined" };
  }

  const rendering = resolveTournamentAnnounceRendering(tournament);
  const message: ResolvedMessageContent = {
    content: isEdit ? rendering.embed.title : `🏆 Tournoi ${tournament.name} — inscriptions ouvertes`,
    embeds: [rendering.embed],
    allowedMentions: NO_MENTIONS,
  };
  if (isEdit) {
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
 * Mention de secours dans le FIL du tournoi quand le MP d'un pote est
 * fermé — même garde d'état/d'éligibilité que le MP. Attend que le fil
 * existe (`dependency_not_ready`). Ne mentionne que ce pote.
 */
async function resolveTournamentDirectMessageFallback(
  role: string,
  tournament: TournamentWithMatches
): Promise<Resolution> {
  const parsed = parseDmRole(role, "dm-fallback:");
  if (!parsed || parsed.kind !== "announce") return { eligible: false, reason: "unresolvable" };
  // Secours réservé au créateur (les joueurs sont déjà mentionnés dans le fil).
  if (parsed.userId !== tournament.createdById) return { eligible: false, reason: "unresolvable" };
  const thread = await findSentDelivery(threadSlot(tournament.id));
  if (!thread?.discordThreadId) return { eligible: false, reason: "dependency_not_ready" };
  if (tournament.status !== "REGISTRATION") return { eligible: false, reason: "expired" };

  const recipient = await prisma.user.findUnique({ where: { id: parsed.userId } });
  if (!recipient) return { eligible: false, reason: "unresolvable" };
  if (!(await isTournamentDmRecipientEligible(tournament, recipient.id))) {
    return { eligible: false, reason: "preference_declined" };
  }

  const action: ResolvedAction = {
    kind: "send_thread_message",
    threadId: thread.discordThreadId,
    message: {
      content: `<@${recipient.discordId}> 🏆 Tournoi ${tournament.name} — inscriptions ouvertes (MP impossible) — ${absoluteTournamentUrl(tournament.id)}`,
      allowedMentions: { ...NO_MENTIONS, users: [recipient.discordId] },
    },
  };
  return { eligible: true, action };
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

/** Ligne absente (tournoi supprimé) = plus active ; sinon, statut relu. */
async function isTournamentStillActive(tournamentId: string): Promise<boolean> {
  const live = await prisma.tournament.findUnique({ where: { id: tournamentId }, select: { status: true } });
  return live !== null && !isTerminalTournamentStatus(live.status);
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
    // Chantier nettoyage réel du stockage (V2) — suppression manuelle
    // définitive : ces deux rôles ne dépendent JAMAIS de l'existence de la
    // ligne `Tournament` (voir le commentaire d'`enqueueTournamentAnnounceDelete`/
    // `enqueueTournamentThreadDelete`), exactement comme `thread-close`
    // ci-dessus.
    if (role === "thread-delete") {
      return resolveThreadDelete(tournamentId);
    }
    if (role === "announce-delete") {
      return resolveAnnounceDelete(tournamentId);
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

    if (role.startsWith("dm:")) {
      return resolveTournamentDirectMessage(role, tournament, delivery);
    }
    if (role.startsWith("dm-fallback:")) {
      return resolveTournamentDirectMessageFallback(role, tournament);
    }

    if (role === "thread") {
      return resolveThreadCreation(tournamentId, tournament);
    }
    if (role === "thread-invite") {
      return resolveThreadInvite(tournamentId, tournament);
    }
    if (role === "thread-summary") {
      return resolveThreadSummary(tournamentId, tournament);
    }
    if (role.startsWith("member:")) {
      const userId = role.slice("member:".length);
      return resolveThreadMembership(tournamentId, userId);
    }

    logger.error("tournament-announce", `targetSlot de rôle inconnu : ${delivery.targetSlot}`, {
      tournamentId,
    });
    return { eligible: false, reason: "unresolvable" };
  },
  // MP des tournois (V2) — mention de secours dans le fil si un MP est fermé.
  onTerminalDiscordFailure: enqueueCreatorDirectMessageFallback,
};

/**
 * Secours MP fermé : réservé au CRÉATEUR (les joueurs sont déjà mentionnés dans
 * le fil par `thread-invite` — un message de secours serait un second ping).
 */
async function enqueueCreatorDirectMessageFallback(input: TerminalDiscordFailureInput): Promise<void> {
  const { delivery, event } = input;
  if (event.category !== "TOURNAMENT" || delivery.channel !== "DISCORD_DM") return;
  const parsed = parseDmRole(delivery.targetSlot.split(":").slice(3).join(":"), "dm:");
  if (!parsed) return;
  const tournament = await prisma.tournament.findUnique({ where: { id: event.sourceId }, select: { createdById: true } });
  if (tournament?.createdById !== parsed.userId) return;
  await enqueueDirectMessageFallback(input, "TOURNAMENT");
}

/**
 * Message de bienvenue DANS le fil avec mention des joueurs sélectionnés
 * (préférence `TOURNAMENT` relue maintenant ; créateur jamais mentionné). Une
 * édition de l'annonce ne notifie personne : c'est CE message qui ping. Seulement
 * tant que les inscriptions sont ouvertes.
 */
async function resolveThreadInvite(tournamentId: string, tournament: TournamentWithMatches): Promise<Resolution> {
  const thread = await findSentDelivery(threadSlot(tournamentId));
  if (!thread?.discordThreadId) return { eligible: false, reason: "dependency_not_ready" };
  if (tournament.status !== "REGISTRATION") return { eligible: false, reason: "expired" };

  const rendering = resolveTournamentAnnounceRendering(tournament);
  const eligible = rendering.candidateMentionIds
    ? (await resolveEligibleTournamentMentions(rendering.candidateMentionIds)).filter(
        (u) => u.id !== tournament.createdById
      )
    : [];
  const mentions = buildMessageContent(rendering.embed, eligible);
  const action: ResolvedAction = {
    kind: "send_thread_message",
    threadId: thread.discordThreadId,
    message: {
      ...mentions,
      content: [`🏆 Tournoi ${tournament.name} — inscriptions ouvertes`, mentionContent(eligible).text]
        .filter((part) => part.length > 0)
        .join(" "),
    },
  };
  return { eligible: true, action };
}

/**
 * Adhésion automatique au fil — V2. Dépend de `thread` SENT (a besoin du
 * fil créé, même dépendance que toute autre opération sur le fil dans ce
 * module). Le tournoi doit encore exister (vérifié par le dispatcher
 * ci-dessus AVANT d'appeler cette fonction, `tournament` chargé pour tous
 * les rôles hors `thread-close`/`thread-delete`/`announce-delete`) — une
 * synchronisation périmée ne peut donc jamais rouvrir un fil déjà fermé/
 * supprimé (le rôle `thread-delete`, dispatché en premier et indépendant
 * de l'état du tournoi, l'emporte structurellement une fois le tournoi
 * supprimé : `member:<userId>` retombe alors sur `expired` via le
 * dispatcher, avant même d'atteindre cette fonction).
 */
async function resolveThreadMembership(tournamentId: string, userId: string): Promise<Resolution> {
  const thread = await findSentDelivery(threadSlot(tournamentId));
  if (!thread?.discordThreadId) return { eligible: false, reason: "dependency_not_ready" };

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { discordId: true } });
  // Défensif — ne devrait jamais se produire (aucune suppression de compte
  // implémentée dans cette app), refuse plutôt que de planter.
  if (!user) return { eligible: false, reason: "expired" };

  const action: ResolvedAction = {
    kind: "add_thread_member",
    threadId: thread.discordThreadId,
    discordUserId: user.discordId,
  };
  return { eligible: true, action };
}

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

    // Double ping (PR D) : l'annonce du salon ne mentionne JAMAIS personne
    // (les joueurs sont mentionnés dans le fil, `thread-invite`) ; chaque
    // pote éligible ET le créateur reçoivent en plus l'invitation en MP.
    // Préférence TOURNAMENT relue MAINTENANT (traitement réel), jamais un
    // instantané figé à l'enqueue. Secours (créateur seulement) si son MP est fermé.
    const eligible = rendering.candidateMentionIds
      ? await resolveEligibleTournamentMentions(rendering.candidateMentionIds)
      : [];
    if (isTournamentDirectMessageEnabled()) {
      const creator = eligible.some((u) => u.id === tournament.createdById)
        ? null
        : await resolveTournamentCreatorDmRecipient(tournament.createdById);
      await enqueueDirectMessages({
        category: "TOURNAMENT",
        sourceId: tournament.id,
        eventType: "TOURNAMENT_DM",
        kind: "announce",
        users: creator ? [...eligible, creator] : eligible,
      });
    }

    // Message de bienvenue DANS le fil, avec mention des joueurs : mis en file ici
    // (comme les MP, occurrence fixe → idempotent sur un retry), traité quand le
    // fil existe (`dependency_not_ready` sinon). Seulement s'il y a quelqu'un à
    // mentionner (le créateur n'est jamais mentionné).
    if (eligible.some((u) => u.id !== tournament.createdById)) {
      const inviteEvent = await createNotificationEvent({
        category: "TOURNAMENT",
        eventType: "TOURNAMENT_THREAD_INVITE",
        sourceId: tournament.id,
        occurrence: "thread-invite",
      });
      await enqueueDelivery({
        eventId: inviteEvent.id,
        channel: "DISCORD_CHANNEL",
        transport: "BOT",
        operation: "SEND",
        recipientKey: "channel",
        targetSlot: threadInviteSlot(tournament.id),
      });
    }

    const action: ResolvedAction = {
      kind: "send_channel_message_verified",
      channelId: tournament.discordChannelId,
      guildId: tournament.discordGuildId,
      message: buildMessageContent(rendering.embed),
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
 * Ferme (archive ET verrouille) le fil — V2 annulation, et depuis le
 * nettoyage automatique des fils, aussi la fin normale (DONE). Ne dépend
 * que de la référence du fil déjà persistée (`thread` SENT) et continue de
 * fonctionner après la SUPPRESSION du tournoi (ligne disparue) ; seule
 * exception : un tournoi encore présent ET actif n'est jamais fermé.
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
  // Nettoyage automatique des fils (V2) — un tournoi encore actif ne voit
  // jamais son fil fermé ; tournoi absent (supprimé) ou terminé : passe.
  if (await isTournamentStillActive(tournamentId)) return { eligible: false, reason: "expired" };
  // Jamais verrouiller pendant qu'un résumé/ajout de membre doit encore
  // passer par le fil (un fil verrouillé refuserait ces écritures).
  const slots = tournamentThreadCleanupSlots(tournamentId);
  const cleanupSlots = [slots.archive, slots.delete, announceDeleteSlot(tournamentId)];
  if (await hasUnsettledDeliveriesWithPrefix(slots.prefix, cleanupSlots)) {
    return { eligible: false, reason: "dependency_not_ready" };
  }

  const thread = await findSentDelivery(threadSlot(tournamentId));
  if (thread?.discordThreadId) {
    // Verrouillé (V2, décision produit) : plus personne n'écrit dans le fil
    // d'un tournoi terminé/annulé avant sa suppression définitive.
    const action: ResolvedAction = { kind: "archive_thread", threadId: thread.discordThreadId, locked: true };
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

/**
 * Suppression PERMANENTE du fil — V2, suppression manuelle définitive
 * d'un tournoi. Même structure EXACTE que `resolveThreadClose` ci-dessus
 * (dépend uniquement de la référence déjà persistée du SEND `thread`,
 * jamais de l'état du tournoi lui-même) — seule l'action Discord change
 * (`delete_thread_permanent` au lieu d'`archive_thread`).
 */
async function resolveThreadDelete(tournamentId: string): Promise<Resolution> {
  if (await isTournamentStillActive(tournamentId)) {
    logger.warn("tournament-announce", "Suppression de fil refusée : tournoi encore actif.", { tournamentId });
    return { eligible: false, reason: "expired" };
  }
  const thread = await findSentDelivery(threadSlot(tournamentId));
  if (thread?.discordThreadId) {
    const action: ResolvedAction = { kind: "delete_thread_permanent", threadId: thread.discordThreadId };
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

/**
 * Suppression du message d'annonce dans le salon PARENT — V2, suppression
 * manuelle définitive d'un tournoi. Même structure que `resolveThreadDelete`
 * ci-dessus, appliquée au SEND `announce` (jamais le salon lui-même,
 * jamais un message reconstruit/deviné — uniquement la référence
 * PERSISTÉE du message réellement envoyé).
 */
async function resolveAnnounceDelete(tournamentId: string): Promise<Resolution> {
  const sent = await findSentDelivery(announceSlot(tournamentId));
  if (sent?.discordMessageId && sent.discordChannelId) {
    const action: ResolvedAction = {
      kind: "delete_channel_message",
      channelId: sent.discordChannelId,
      messageId: sent.discordMessageId,
    };
    return { eligible: true, action };
  }

  const announceSend = await prisma.notificationDelivery.findFirst({
    where: { targetSlot: announceSlot(tournamentId), operation: "SEND" },
    orderBy: { sequence: "desc" },
    select: { status: true },
  });
  if (announceSend && (announceSend.status === "PENDING" || announceSend.status === "RESERVED")) {
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
