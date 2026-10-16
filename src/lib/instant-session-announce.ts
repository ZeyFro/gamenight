import { scopedTransactionPrisma } from "@/lib/community-scoped-client";
import { scopedPrismaForCommunity } from "@/lib/community-scoped-client";
import { resolveSessionAnnounceConfig } from "@/lib/community-channels";
import { wallClockNow } from "@/lib/wallclock";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { isMemberOfCommunity } from "@/lib/community-isolation";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { resolveAbsoluteUrl } from "@/lib/app-url";
import { resolveNotifiedUserIds } from "@/lib/notify-recipients";
import { filterUsersByNotificationPreference } from "@/lib/notification-preferences";
import { isInstantSessionInviteViaBotEnabled } from "@/lib/discord-bot-config";
import { createNotificationEvent, enqueueDelivery, notificationEventMatchesSource } from "@/lib/notification-delivery";
import type { DeliveryResolver, Resolution, ResolvedAction, ResolveInput } from "@/lib/notification-executor";
import { ACCENT_COLOR } from "@/lib/discord";
import type { DiscordRestEmbed } from "@/lib/discord-rest";
import { instantSessionRsvpComponents } from "@/lib/instant-session-rsvp-components";

/**
 * V2 ("Jouer maintenant") — invitation rapide par MP Discord + notification
 * interne. "Les invitations rapides PRÉVIENNENT les personnes, elles ne
 * les inscrivent pas automatiquement" (voir `InstantSession.notifiedUserIds`,
 * schema.prisma) : ce module ne fait jamais que PRÉVENIR, jamais écrire
 * la moindre ligne `InstantSessionPresenceInterval`.
 *
 * Réutilise ENTIÈREMENT les fondations de livraison existantes (#95/#96/#97) —
 * même architecture SEND une fois / EDIT à chaque changement réel que
 * `session-announce.ts` (`announce`) : un `targetSlot` PAR DESTINATAIRE
 * (`invite:<userId>`, jamais partagé), SEND à occurrence FIXE (jamais un
 * second envoi pour le même destinataire, même retenté), EDIT à occurrence
 * ALÉATOIRE à chaque changement de jeu ET à la fin (jamais un nouvel
 * envoi — "ne pas envoyer une nouvelle invitation"). Le résolveur relit
 * TOUJOURS l'état courant de la session au moment du traitement, jamais un
 * texte figé à l'enqueue : si un changement de jeu survient alors que le
 * SEND initial est encore PENDING, ce SEND rendra directement l'état
 * DÉJÀ à jour quand il sera traité — "si l'envoi initial est encore en
 * attente, envoyer l'état courant" tombe donc de la même garantie
 * structurelle que `resolveAnnounceDelivery` (session-announce.ts),
 * jamais une logique séparée à maintenir ici.
 *
 * PREMIER usage réel de `DeliveryChannel.DISCORD_DM`/`send_direct_message`
 * dans ce dépôt (l'action existait déjà dans `notification-executor.ts`,
 * jamais branchée à un producteur métier avant ce chantier) — aucun salon
 * n'est nécessaire (voir `isInstantSessionInviteViaBotEnabled`,
 * discord-bot-config.ts), donc aucune configuration de destination à
 * figer à l'enqueue (contrairement à SESSION/TOURNAMENT) : enqueue
 * INCONDITIONNEL (même convention que TOURNAMENT, voir
 * `enqueueTournamentCreationDeliveries`), le flag n'est vérifié QUE dans
 * le résolveur, juste avant l'appel réel.
 *
 * Notification INTERNE (`Notification`, `type: INSTANT_SESSION_INVITE`) —
 * créée SYNCHRONEMENT, une seule fois, à l'invitation initiale (même
 * philosophie que `session-announce.ts` : "aucune notification interne en
 * doublon", écrite directement plutôt que passée par la file, cf. son
 * commentaire de fichier). **Limite assumée, documentée honnêtement** :
 * contrairement au MP Discord, cette notification n'est JAMAIS éditée en
 * place après coup (changement de jeu, fin de session) — `Notification`
 * n'a AUCUN mécanisme de mise à jour nulle part ailleurs dans cette app
 * (`prisma.notification.update` n'est appelé par aucun autre module,
 * vérifié avant d'écrire ce fichier) ; en construire un ici, pour ce seul
 * cas, aurait été une nouvelle capacité inventée hors du périmètre
 * minimal demandé. L'état à jour reste TOUJOURS consultable sur
 * `/jouer-maintenant/<id>`, dont le lien figure dans la notification
 * initiale — jamais une information fausse affirmée, seulement une
 * notification qui ne se rafraîchit pas toute seule, comme c'est déjà le
 * cas pour CHAQUE notification interne existante de cette app.
 */

const GUILD_SLOT_PREFIX = "default-guild";

function inviteSlot(instantSessionId: string, userId: string): string {
  return `${GUILD_SLOT_PREFIX}:INSTANT_SESSION:${instantSessionId}:invite:${userId}`;
}

const NO_MENTIONS_PARSE: { parse: [] } = { parse: [] };

const announceSlot = (id: string) => `${GUILD_SLOT_PREFIX}:INSTANT_SESSION:${id}:announce`;

/** La partie immédiate est ouverte aux membres du serveur. Une annonce
 * publique sans mention existe même si le créateur n'a choisi aucun MP. */
export async function enqueueInstantSessionAnnouncement(
  instantSessionId: string, db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<void> {
  if (process.env.DISCORD_BOT_SESSION_ANNOUNCE_ENABLED !== "true") return;
  const event = await createNotificationEvent({ category: "INSTANT_SESSION", eventType: "INSTANT_SESSION_ANNOUNCE", sourceId: instantSessionId }, db);
  await enqueueDelivery({ eventId: event.id, channel: "DISCORD_CHANNEL", transport: "BOT", operation: "SEND",
    recipientKey: "channel", targetSlot: announceSlot(instantSessionId) }, db);
}

async function enqueueAnnouncementUpdate(id: string, db: Prisma.TransactionClient | typeof prisma) {
  const initial = await db.notificationEvent.findUnique({ where: { category_eventType_sourceId_occurrence: {
    category: "INSTANT_SESSION", eventType: "INSTANT_SESSION_ANNOUNCE", sourceId: id, occurrence: "",
  } }, select: { communityId: true } });
  // Pas de publication tardive pour les parties historiques jamais annoncées.
  if (!initial) return;
  const event = await createNotificationEvent({ communityId: initial.communityId, category: "INSTANT_SESSION",
    eventType: "INSTANT_SESSION_ANNOUNCE_UPDATED", sourceId: id, occurrence: randomUUID() }, db);
  await enqueueDelivery({ eventId: event.id, channel: "DISCORD_CHANNEL", transport: "BOT", operation: "EDIT",
    recipientKey: "channel", targetSlot: announceSlot(id) }, db);
}

/* -------------------------------------------------------------------- */
/* Enqueue                                                               */
/* -------------------------------------------------------------------- */

/**
 * SEND une fois par destinataire (occurrence FIXE) + notification interne
 * synchrone pour les destinataires dont la préférence `INSTANT_SESSION`
 * est active. Appelée à la création ET par une éventuelle invitation
 * ultérieure ("inviter d'autres potes" après coup) — un même destinataire
 * réinvité plus tard obtient un NOUVEAU `targetSlot` (déjà l'un des
 * `userIds` passés), donc un SEND réellement distinct : cette fonction ne
 * déduplique QUE dans le temps pour un même (session, destinataire), pas
 * entre deux destinataires différents — comportement voulu, jamais un
 * appel groupé qui perdrait la granularité par personne.
 */
export async function enqueueInstantSessionInvites(
  instantSessionId: string,
  userIds: string[],
  db: Prisma.TransactionClient | typeof prisma = prisma
): Promise<void> {
  if (userIds.length === 0) return;

  // UN SEUL événement pour tous les destinataires (clé unique : category,
  // eventType, sourceId, occurrence) — le créer par destinataire levait P2002
  // dès le 2e invité, ce qui avorte la transaction de création (25P02) quand
  // `db` est un client de transaction. La granularité par personne est portée
  // par `recipientKey`/`targetSlot` de chaque livraison, pas par l'événement.
  const event = await createNotificationEvent(
    { category: "INSTANT_SESSION", eventType: "INSTANT_SESSION_INVITE", sourceId: instantSessionId },
    db
  );
  for (const userId of userIds) {
    await enqueueDelivery(
      {
        eventId: event.id,
        channel: "DISCORD_DM",
        transport: "BOT",
        operation: "SEND",
        recipientKey: `user:${userId}`,
        targetSlot: inviteSlot(instantSessionId, userId),
      },
      db
    );
  }

  // Lecture du parent non committé et notification dans la transaction de
  // création : lien et provenance viennent de cette session, pas de default.
  const recipients = await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, silenceReminders: true } });
  const allowed = await filterUsersByNotificationPreference(recipients, "INSTANT_SESSION", db);
  const session = await db.instantSession.findUniqueOrThrow({ where: { id: instantSessionId }, select: { communityId: true, game: { select: { name: true } } } });
  const scopedDb = scopedTransactionPrisma(db as Prisma.TransactionClient, null);
  await scopedDb.notification.createMany({ data: allowed.map((user) => ({
    userId: user.id, communityId: session.communityId, relatedSessionId: instantSessionId,
    type: "INSTANT_SESSION_INVITE" as const, title: "🎮 Jouer maintenant",
    message: `Une session instantanée démarre sur ${session.game.name} — rejoins-la si tu es dispo.`,
  })) });
}

/**
 * EDIT pour CHAQUE destinataire déjà invité — occurrence ALÉATOIRE (chaque
 * appel est une occurrence RÉELLEMENT distincte : jeu changé, ou session
 * terminée). Ne fait jamais qu'ENQUEUE : le résolveur relit l'état
 * courant au traitement (voir le commentaire de fichier). Aucune
 * notification interne créée ici (voir la limite assumée ci-dessus).
 */
export async function enqueueInstantSessionInviteUpdate(
  instantSessionId: string,
  db: Prisma.TransactionClient | typeof prisma = prisma
): Promise<void> {
  await enqueueAnnouncementUpdate(instantSessionId, db);
  const session = await db.instantSession.findUnique({
    where: { id: instantSessionId },
    select: { notifiedUserIds: true },
  });
  const userIds = resolveNotifiedUserIds(session?.notifiedUserIds) ?? [];
  if (userIds.length === 0) return;

  for (const userId of userIds) {
    const event = await createNotificationEvent(
      {
        category: "INSTANT_SESSION",
        eventType: "INSTANT_SESSION_UPDATED",
        sourceId: instantSessionId,
        occurrence: `${Date.now()}:${userId}:${Math.random().toString(36).slice(2)}`,
      },
      db
    );
    await enqueueDelivery(
      {
        eventId: event.id,
        channel: "DISCORD_DM",
        transport: "BOT",
        operation: "EDIT",
        recipientKey: `user:${userId}`,
        targetSlot: inviteSlot(instantSessionId, userId),
      },
      db
    );
  }
}

/* -------------------------------------------------------------------- */
/* Résolveur                                                             */
/* -------------------------------------------------------------------- */

async function findSentDelivery(targetSlot: string) {
  return prisma.notificationDelivery.findFirst({
    where: { targetSlot, operation: "SEND", status: "SENT" },
    select: { discordMessageId: true, discordChannelId: true },
  });
}

interface InstantSessionForMessage {
  id: string;
  status: "ACTIVE" | "ENDED";
  game: { name: string };
}

async function buildInviteMessage(session: InstantSessionForMessage) {
  const url = resolveAbsoluteUrl(`/jouer-maintenant/${session.id}`, {
    VERCEL_ENV: process.env.VERCEL_ENV,
    VERCEL_URL: process.env.VERCEL_URL,
    VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL,
  });
  const linkLine = url ? `\n${url}` : "";
  if (session.status === "ENDED") {
    const embed: DiscordRestEmbed = {
      title: "🎮 Session terminée",
      description: `La session sur **${session.game.name}** est terminée.${linkLine}`,
      color: ACCENT_COLOR,
    };
    return { embeds: [embed], allowedMentions: NO_MENTIONS_PARSE };
  }
  const embed: DiscordRestEmbed = {
    title: "🎮 Jouer maintenant",
    description: `Une session instantanée est en cours sur **${session.game.name}** — rejoins-la si tu es dispo.${linkLine}`,
    color: ACCENT_COLOR,
  };
  return { embeds: [embed], allowedMentions: NO_MENTIONS_PARSE };
}

export const instantSessionInviteResolver: DeliveryResolver = {
  async resolve({ delivery, event }: ResolveInput): Promise<Resolution> {
    if (delivery.targetSlot === announceSlot(event.sourceId)) return resolveAnnouncement({ delivery, event });
    if (!isInstantSessionInviteViaBotEnabled()) return { eligible: false, reason: "not_configured" };

    const instantSessionId = event.sourceId;
    const role = delivery.targetSlot.split(":").slice(3).join(":");
    if (!role.startsWith("invite:")) {
      logger.error("instant-session-announce", `targetSlot de rôle inconnu : ${delivery.targetSlot}`, {
        instantSessionId,
      });
      return { eligible: false, reason: "unresolvable" };
    }
    const userId = role.slice("invite:".length);

    const session = await prisma.instantSession.findUnique({
      where: { id: instantSessionId },
      select: { id: true, communityId: true, status: true, game: { select: { name: true } } },
    });
    if (!session) return { eligible: false, reason: "expired" };
    if (!(await isMemberOfCommunity(userId, session.communityId))) return { eligible: false, reason: "preference_declined" };

    const recipient = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, discordId: true, silenceReminders: true },
    });
    if (!recipient) return { eligible: false, reason: "unresolvable" };

    if (delivery.operation === "SEND") {
      // Jamais un envoi pour une session déjà terminée avant même son
      // premier envoi — "empêcher les invitations périmées encore en
      // attente de partir".
      if (session.status !== "ACTIVE") return { eligible: false, reason: "expired" };

      // Préférence relue JUSTE À TEMPS (jamais depuis un instantané pris à
      // l'enqueue, même garantie que partout ailleurs dans ce chantier) —
      // une désactivation survenue APRÈS l'enqueue mais AVANT le SEND réel
      // empêche donc bien l'envoi. Ne bloque JAMAIS l'EDIT ci-dessous : un
      // MP déjà envoyé reste mis à jour même si la préférence change
      // ensuite — seule une NOUVELLE invitation est concernée.
      const [allowed] = await filterUsersByNotificationPreference([recipient], "INSTANT_SESSION");
      if (!allowed) return { eligible: false, reason: "preference_declined" };

      const message = await buildInviteMessage(session);
      const action: ResolvedAction = {
        kind: "send_direct_message",
        userId: recipient.discordId,
        message,
      };
      return { eligible: true, action };
    }

    // EDIT — nécessite le SEND initial déjà traité (dépendance résolue ICI,
    // jamais automatiquement par `claimNextDelivery` pour un AUTRE
    // targetSlot — même limite documentée que session-announce.ts, mais ici
    // il n'y a qu'un seul targetSlot par destinataire, donc jamais une
    // dépendance croisée entre deux cibles).
    const sent = await findSentDelivery(delivery.targetSlot);
    if (!sent?.discordChannelId || !sent.discordMessageId) {
      return { eligible: false, reason: "dependency_not_ready" };
    }
    const message = await buildInviteMessage(session);
    const action: ResolvedAction = {
      kind: "edit_channel_message",
      channelId: sent.discordChannelId,
      messageId: sent.discordMessageId,
      isDirectMessage: true,
      message,
    };
    return { eligible: true, action };
  },
};

/** Destination du parent, pas de la communauté actuellement sélectionnée.
 * Le salon est vérifié côté Discord par l'action SEND de l'executor. */
async function resolveAnnouncement({ event, delivery }: Pick<ResolveInput, "event" | "delivery">): Promise<Resolution> {
  if (event.category !== "INSTANT_SESSION" || !["INSTANT_SESSION_ANNOUNCE", "INSTANT_SESSION_ANNOUNCE_UPDATED"].includes(event.eventType) ||
    delivery.channel !== "DISCORD_CHANNEL" || delivery.transport !== "BOT" || delivery.recipientKey !== "channel") return { eligible: false, reason: "unresolvable" };
  if (process.env.DISCORD_BOT_SESSION_ANNOUNCE_ENABLED !== "true") return { eligible: false, reason: "configuration_unavailable" };
  const scopedDb = scopedPrismaForCommunity(event.communityId);
  const session = await scopedDb.instantSession.findUnique({ where: { id: event.sourceId }, select: {
    id: true, communityId: true, status: true, expiresAt: true, game: { select: { name: true } },
    createdById: true, createdBy: { select: { discordName: true } },
  } });
  if (!session || !(await notificationEventMatchesSource(event.communityId, session.communityId))) return { eligible: false, reason: "expired" };
  // Ce nouveau message public exige un serveur et un créateur encore actifs,
  // même si les flags d'isolation sont momentanément OFF.
  const community = await prisma.community.findUnique({ where: session.communityId ? { id: session.communityId } : { slug: "default" }, select: { id: true, status: true } });
  if (community?.status !== "ACTIVE") return { eligible: false, reason: "expired" };
  const member = await prisma.membership.findUnique({ where: { communityId_userId: { communityId: community.id, userId: session.createdById } }, select: { status: true } });
  if (member?.status !== "ACTIVE") return { eligible: false, reason: "expired" };
  const active = session.status === "ACTIVE" && session.expiresAt > wallClockNow();
  if (delivery.operation === "SEND" && !active) return { eligible: false, reason: "expired" };
  const config = await resolveSessionAnnounceConfig(session.communityId);
  const link = resolveAbsoluteUrl(`/jouer-maintenant/${session.id}`, {
    VERCEL_ENV: process.env.VERCEL_ENV, VERCEL_URL: process.env.VERCEL_URL, VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL,
  });
  if (!config || !link) return { eligible: false, reason: "configuration_unavailable" };
  const message = { allowedMentions: NO_MENTIONS_PARSE, components: active ? instantSessionRsvpComponents(session.id) : [], embeds: [{
    title: active ? "🎮 On joue maintenant !" : "🎮 Partie terminée",
    description: active ? `**${session.createdBy.discordName}** lance une partie de **${session.game.name}**.\nLes membres de ce serveur peuvent participer.\n\n👉 [Rejoindre la partie](${link})`
      : `La partie sur **${session.game.name}** est terminée.`, color: ACCENT_COLOR,
  }] };
  if (delivery.operation === "SEND") return { eligible: true, action: { kind: "send_channel_message_verified", ...config, message } };
  const sent = await findSentDelivery(delivery.targetSlot);
  if (!sent?.discordChannelId || !sent.discordMessageId) {
    const initial = await prisma.notificationDelivery.findFirst({ where: { targetSlot: delivery.targetSlot, operation: "SEND" }, select: { status: true } });
    return { eligible: false, reason: initial?.status === "FAILED" || initial?.status === "SKIPPED" ? "expired" : "dependency_not_ready" };
  }
  if (sent.discordChannelId !== config.channelId) return { eligible: false, reason: "configuration_unavailable" };
  return { eligible: true, action: { kind: "edit_channel_message", channelId: sent.discordChannelId, messageId: sent.discordMessageId, message } };
}
