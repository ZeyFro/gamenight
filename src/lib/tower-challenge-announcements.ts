import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { towerTvPhotoReviewHint } from "@/lib/tower-challenge-proof-rules";
import { scopedPrisma } from "@/lib/community-scoped-client";
import { createNotificationEvent, enqueueDelivery } from "@/lib/notification-delivery";
import type { DeliveryResolver, Resolution } from "@/lib/notification-executor";
import type { DiscordActionRow } from "@/lib/discord-rest";
import { challengeVoteDeadline } from "@/lib/tower-challenge-voting";

type Kind = "proof" | "success" | "rejection";
const types = { proof: "TOWER_PROOF_SUBMITTED", success: "TOWER_CHALLENGE_APPROVED", rejection: "TOWER_CHALLENGE_REJECTED" } as const;
// Votes Discord (TOWER_DISCORD_VOTES_ENABLED) : mise à jour du message public et fil par preuve, deux événements dédiés.
export const TOWER_PROOF_VOTE_UPDATED = "TOWER_PROOF_VOTE_UPDATED";
export const TOWER_PROOF_THREAD = "TOWER_PROOF_THREAD";
export const TOWER_VOTE_EVENT_TYPES: readonly string[] = [...Object.values(types), TOWER_PROOF_VOTE_UPDATED, TOWER_PROOF_THREAD];
const votesEnabled = () => process.env.TOWER_DISCORD_VOTES_ENABLED === "true";
const numericId = (value: string | undefined): value is string => /^[0-9]{16,20}$/.test(value ?? "");
function config(kind: Kind) {
  if (process.env.TOWER_CHALLENGES_ENABLED !== "true" || process.env.TOWER_DISCORD_ANNOUNCE_ENABLED !== "true") return null;
  const guildId = process.env.TOWER_DISCORD_GUILD_ID;
  const proofChannelId = process.env.TOWER_DISCORD_CHANNEL_ID;
  const channelId = kind !== "success" ? proofChannelId : process.env.TOWER_DISCORD_GENERAL_CHANNEL_ID;
  return numericId(guildId) && numericId(proofChannelId) && numericId(channelId) ? { guildId, channelId, proofChannelId } : null;
}
// Une preuve resoumise après un rejet sans quorum est une nouvelle annonce : le créneau porte le rang de resoumission.
const slot = (guildId: string, attemptId: string, kind: Kind | "proof-thread", round = 0) =>
  guildId + ":TOWER:" + attemptId + ":" + kind + ((kind === "proof" || kind === "proof-thread") && round > 0 ? ":r" + round : "");
/** Rang de resoumission porté par un créneau de preuve (`:rN`), ou null si le créneau n'est pas celui attendu. */
function slotRound(targetSlot: string | null, guildId: string, attemptId: string, kind: "proof" | "proof-thread"): number | null {
  const base = slot(guildId, attemptId, kind);
  if (targetSlot === base) return 0;
  if (!targetSlot?.startsWith(base + ":r")) return null;
  const rest = targetSlot.slice(base.length + 2);
  return /^[1-9][0-9]{0,2}$/.test(rest) ? Number(rest) : null;
}

// Écriture dans la même transaction que le dépôt ou le gain ; aucun appel Discord ici.
export async function enqueueTowerChallengeEvent(scopedDb: Prisma.TransactionClient, communityId: string, attemptId: string, kind: Kind) {
  // Le règlement (validation ou rejet) retire les boutons du message public et y affiche l'issue.
  if (kind !== "proof") await refreshTowerProofMessage(scopedDb, communityId, attemptId);
  const destination = config(kind);
  if (!destination && kind !== "rejection") return;
  if (process.env.TOWER_CHALLENGES_ENABLED !== "true") return;
  const community = await scopedDb.community.findUnique({ where: { id: communityId }, select: { status: true, towerChallengesEnabled: true, discordGuildId: true } });
  if (community?.status !== "ACTIVE" || !community.towerChallengesEnabled) return;
  if (kind !== "rejection" && community.discordGuildId !== destination?.guildId) return;
  const event = await createNotificationEvent({ communityId, category: "ACHIEVEMENT", eventType: types[kind], sourceId: attemptId }, scopedDb);
  if (!destination || community.discordGuildId !== destination.guildId) return;
  const round = kind === "proof"
    ? (await scopedDb.towerChallengeAttempt.findFirst({ where: { id: attemptId, communityId }, select: { quorumResubmissions: true } }))?.quorumResubmissions ?? 0
    : 0;
  await enqueueDelivery({ eventId: event.id, channel: "DISCORD_CHANNEL", transport: "BOT", operation: "SEND",
    recipientKey: destination.channelId, targetSlot: slot(destination.guildId, attemptId, kind, round),
  }, scopedDb);
  if (kind === "proof" && votesEnabled()) {
    // Un fil par preuve, créé depuis le message d'annonce une fois celui-ci posté (dépendance gérée par le résolveur).
    const thread = await createNotificationEvent({ communityId, category: "ACHIEVEMENT", eventType: TOWER_PROOF_THREAD, sourceId: attemptId, occurrence: "r" + round }, scopedDb);
    await enqueueDelivery({ eventId: thread.id, channel: "DISCORD_CHANNEL", transport: "BOT", operation: "SEND",
      recipientKey: destination.channelId, targetSlot: slot(destination.guildId, attemptId, "proof-thread", round),
    }, scopedDb);
  }
  return true;
}

/**
 * Édite le message public de la preuve (compteur de votes, boutons retirés au règlement). Seulement si l'annonce
 * existe déjà dans la file ; le contenu est relu à l'envoi, une rafale de votes se réduit donc à la dernière édition.
 * `round` : rang de resoumission du message visé (défaut : celui de la tentative).
 */
export async function refreshTowerProofMessage(scopedDb: Prisma.TransactionClient, communityId: string, attemptId: string, round?: number) {
  if (!votesEnabled()) return false;
  const destination = config("proof");
  if (!destination) return false;
  const community = await scopedDb.community.findUnique({ where: { id: communityId }, select: { status: true, towerChallengesEnabled: true, discordGuildId: true } });
  if (community?.status !== "ACTIVE" || !community.towerChallengesEnabled || community.discordGuildId !== destination.guildId) return false;
  const targetRound = round ?? (await scopedDb.towerChallengeAttempt.findFirst({ where: { id: attemptId, communityId }, select: { quorumResubmissions: true } }))?.quorumResubmissions ?? 0;
  const targetSlot = slot(destination.guildId, attemptId, "proof", targetRound);
  const sent = await scopedDb.notificationDelivery.findFirst({
    where: { targetSlot, operation: "SEND", status: { in: ["PENDING", "RESERVED", "SENT"] } }, select: { id: true },
  });
  if (!sent) return false;
  const event = await createNotificationEvent({
    communityId, category: "ACHIEVEMENT", eventType: TOWER_PROOF_VOTE_UPDATED, sourceId: attemptId,
    occurrence: "r" + targetRound + ":" + Date.now() + ":" + randomUUID().slice(0, 8),
  }, scopedDb);
  await enqueueDelivery({ eventId: event.id, channel: "DISCORD_CHANNEL", transport: "BOT", operation: "EDIT",
    recipientKey: destination.channelId, targetSlot,
  }, scopedDb);
  return true;
}

/** Recover durable rejection intents after configuration returns; never resend an existing delivery. */
export async function requeueTowerRejectionNotices(scopedDb: Prisma.TransactionClient, communityId: string, deadline: Date) {
  if (!config("rejection")) return 0;
  const candidates = await scopedDb.$queryRaw<{ id: string }[]>`
    SELECT a.id FROM "TowerChallengeAttempt" a
    JOIN "Membership" m ON m."communityId" = a."communityId" AND m."userId" = a."userId" AND m.status = 'ACTIVE'
    WHERE a."communityId" = ${communityId} AND a.status = 'REJECTED' AND a."archivedAt" IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM "NotificationEvent" e JOIN "NotificationDelivery" d ON d."eventId" = e.id
        WHERE e."communityId" = a."communityId" AND e."sourceId" = a.id AND e."eventType" = 'TOWER_CHALLENGE_REJECTED'
      )
    ORDER BY a."rejectedAt", a.id LIMIT 25
  `;
  let queued = 0;
  for (const candidate of candidates) {
    if (Date.now() >= deadline.getTime()) break;
    if (await enqueueTowerChallengeEvent(scopedDb, communityId, candidate.id, "rejection")) queued++;
  }
  return queued;
}

const plain = (value: string, max: number) => value.slice(0, max).replace(/([\\\x60*_~|>\[\]()])/g, "\\$1");

type ResolveInput = Parameters<DeliveryResolver["resolve"]>[0];
type Refusal = "unresolvable" | "not_configured" | "expired" | "dependency_not_ready";
const refuse = (reason: Refusal): Resolution => ({ eligible: false, reason });
const proofUrl = (guildId: string, channelId: string | null, messageId: string | null) =>
  numericId(channelId ?? undefined) && numericId(messageId ?? undefined) ? "https://discord.com/channels/" + guildId + "/" + channelId + "/" + messageId : null;

/** Message public d'une preuve en vote : compteur de votants (sans le détail) et boutons tant que le vote est ouvert. */
async function resolveProofUpdate({ event, delivery, now }: ResolveInput): Promise<Resolution> {
  if (!votesEnabled() || event.category !== "ACHIEVEMENT" || !event.communityId
    || delivery.channel !== "DISCORD_CHANNEL" || delivery.transport !== "BOT" || delivery.operation !== "EDIT") return refuse("unresolvable");
  const destination = config("proof");
  if (!destination || process.env.NOTIFICATION_EXECUTOR_ENABLED !== "true") return refuse("not_configured");
  const round = slotRound(delivery.targetSlot, destination.guildId, event.sourceId, "proof");
  if (round === null || delivery.recipientKey !== destination.channelId) return refuse("unresolvable");
  if (!delivery.targetMessage) return refuse("dependency_not_ready");
  const scopedDb = scopedPrisma({ communityIds: [event.communityId], includesDefault: false });
  const community = await scopedDb.community.findUnique({ where: { id: event.communityId }, select: { status: true, towerChallengesEnabled: true, discordGuildId: true } });
  if (community?.status !== "ACTIVE" || !community.towerChallengesEnabled || community.discordGuildId !== destination.guildId) return refuse("expired");
  const attempt = await scopedDb.towerChallengeAttempt.findFirst({
    where: { id: event.sourceId, communityId: event.communityId },
    select: { id: true, userId: true, quorumResubmissions: true, voteExtendedAt: true, title: true, proofChannelId: true, proofMessageId: true,
      teamId: true, team: { select: { name: true } }, participants: { select: { userId: true } },
      submittedAt: true, status: true, user: { select: { discordName: true } } },
  });
  if (!attempt) return refuse("expired");
  const who = attempt.team ? "L’équipe **" + plain(attempt.team.name, 80) + "**" : plain(attempt.user.discordName, 80);
  let content: string;
  let components: DiscordActionRow[] = [];
  if (round < attempt.quorumResubmissions) {
    content = "⌛ **Vote clos sans quorum : " + plain(attempt.title, 120) + "**\n" + who + " : moins de trois votants, preuve rejetée sans pénalité. Une nouvelle preuve peut être déposée une seule fois.";
  } else if (attempt.status === "APPROVED" || attempt.status === "REJECTED") {
    const url = proofUrl(destination.guildId, attempt.proofChannelId, attempt.proofMessageId);
    content = (attempt.status === "APPROVED" ? "✅ **Preuve validée : " : "❌ **Preuve refusée : ") + plain(attempt.title, 120) + "**\n" + who
      + (attempt.status === "APPROVED" ? " : la communauté a validé cette réalisation." : " : la communauté n’a pas validé cette réalisation.")
      + (url ? "\n[Voir la preuve](" + url + ")" : "");
  } else if (attempt.status === "SUBMITTED" && attempt.submittedAt) {
    const url = proofUrl(destination.guildId, attempt.proofChannelId, attempt.proofMessageId);
    if (!url) return refuse("expired");
    const endsAt = challengeVoteDeadline(attempt.submittedAt, Boolean(attempt.voteExtendedAt)).getTime();
    const excluded = [attempt.userId, ...attempt.participants.map(p => p.userId)];
    const voters = await scopedDb.towerChallengeVote.count({ where: { communityId: event.communityId, attemptId: attempt.id, userId: { notIn: excluded } } });
    const open = now.getTime() < endsAt;
    content = "🧪 **Preuve à juger : " + plain(attempt.title, 120) + "**\n" + who + " propose sa réalisation au vote :\n"
      + "\n[Voir la preuve](" + url + ")\n"
      + (open
        ? "Vote jusqu’à <t:" + Math.floor(endsAt / 1000) + ":f> · 3 votants minimum, majorité favorable, aucun vote pour soi. Ton vote reste modifiable jusqu’à l’échéance.\n"
        : "Vote clos, le résultat est en cours de validation.\n")
      + "🗳️ **" + voters + "** votant(s) · le détail reste caché jusqu’au résultat. Discussion dans le fil de ce message.";
    if (open) components = voteButtons(attempt.id);
  } else return refuse("expired");
  return { eligible: true, action: { kind: "edit_channel_message", channelId: delivery.targetMessage.discordChannelId ?? destination.channelId,
    messageId: delivery.targetMessage.discordMessageId, message: { content, components, allowedMentions: { parse: [] } } } };
}

/** Fil de discussion de la preuve, créé depuis le message public une fois celui-ci posté. */
async function resolveProofThread({ event, delivery }: ResolveInput): Promise<Resolution> {
  if (!votesEnabled() || event.category !== "ACHIEVEMENT" || !event.communityId
    || delivery.channel !== "DISCORD_CHANNEL" || delivery.transport !== "BOT" || delivery.operation !== "SEND") return refuse("unresolvable");
  const destination = config("proof");
  if (!destination || process.env.NOTIFICATION_EXECUTOR_ENABLED !== "true") return refuse("not_configured");
  const round = slotRound(delivery.targetSlot, destination.guildId, event.sourceId, "proof-thread");
  if (round === null || delivery.recipientKey !== destination.channelId) return refuse("unresolvable");
  const scopedDb = scopedPrisma({ communityIds: [event.communityId], includesDefault: false });
  const community = await scopedDb.community.findUnique({ where: { id: event.communityId }, select: { status: true, towerChallengesEnabled: true, discordGuildId: true } });
  if (community?.status !== "ACTIVE" || !community.towerChallengesEnabled || community.discordGuildId !== destination.guildId) return refuse("expired");
  const attempt = await scopedDb.towerChallengeAttempt.findFirst({
    where: { id: event.sourceId, communityId: event.communityId }, select: { title: true, status: true, quorumResubmissions: true },
  });
  if (!attempt || attempt.quorumResubmissions !== round || attempt.status !== "SUBMITTED") return refuse("expired");
  // Le message public est posté par une autre livraison (créneau « proof ») : tant qu'il n'existe pas, on réessaie.
  const sent = await scopedDb.notificationDelivery.findFirst({
    where: { targetSlot: slot(destination.guildId, event.sourceId, "proof", round), operation: "SEND", status: "SENT" },
    select: { discordMessageId: true, discordChannelId: true },
  });
  if (!sent?.discordMessageId || !sent.discordChannelId) return refuse("dependency_not_ready");
  return { eligible: true, action: { kind: "create_thread", channelId: sent.discordChannelId, messageId: sent.discordMessageId,
    name: ("Preuve — " + attempt.title).slice(0, 100), autoArchiveDuration: 4320 } };
}

function voteButtons(attemptId: string): DiscordActionRow[] {
  return [{ type: 1, components: [
    { type: 2, style: 3, label: votesEnabled() ? "✅ Valider" : "Valider", custom_id: "gn:tower:vote:" + attemptId + ":yes" },
    { type: 2, style: 4, label: votesEnabled() ? "❌ Refuser" : "Refuser", custom_id: "gn:tower:vote:" + attemptId + ":no" },
  ] }];
}

export const towerChallengeAnnounceResolver: DeliveryResolver = {
  async resolve(input) {
    if (input.event.eventType === TOWER_PROOF_VOTE_UPDATED) return resolveProofUpdate(input);
    if (input.event.eventType === TOWER_PROOF_THREAD) return resolveProofThread(input);
    const { event, delivery, now } = input;
    const kind: Kind | null = event.eventType === types.proof ? "proof" : event.eventType === types.success ? "success" : event.eventType === types.rejection ? "rejection" : null;
    if (!kind || event.category !== "ACHIEVEMENT" || !event.communityId
      || delivery.channel !== "DISCORD_CHANNEL" || delivery.transport !== "BOT" || delivery.operation !== "SEND") return { eligible: false, reason: "unresolvable" };
    const destination = config(kind);
    if (!destination || process.env.NOTIFICATION_EXECUTOR_ENABLED !== "true") return { eligible: false, reason: kind === "rejection" ? "configuration_unavailable" : "not_configured" };
    if (delivery.recipientKey !== destination.channelId || !(delivery.targetSlot ?? "").startsWith(slot(destination.guildId, event.sourceId, kind))) return { eligible: false, reason: "unresolvable" };
    const scopedDb = scopedPrisma({ communityIds: [event.communityId], includesDefault: false });
    const community = await scopedDb.community.findUnique({ where: { id: event.communityId }, select: { status: true, towerChallengesEnabled: true, discordGuildId: true } });
    if (community?.status !== "ACTIVE" || !community.towerChallengesEnabled || community.discordGuildId !== destination.guildId) return { eligible: false, reason: "expired" };
    const attempt = await scopedDb.towerChallengeAttempt.findFirst({
      where: { id: event.sourceId, communityId: event.communityId },
      select: { id: true, userId: true, quorumResubmissions: true, voteExtendedAt: true, title: true, proofText: true, proofCode: true, proofChannelId: true, proofMessageId: true,
        teamId: true, team: { select: { name: true } },
        participants: { select: { rewardedAt: true } },
        publicationConsent: true, submittedAt: true, status: true, rewardedAt: true, rewardFloors: true,
        user: { select: { discordName: true } } },
    });
    if (attempt && delivery.targetSlot !== slot(destination.guildId, event.sourceId, kind, kind === "proof" ? attempt.quorumResubmissions : 0)) return { eligible: false, reason: "expired" };
    if (!attempt?.submittedAt || !attempt.proofText
      || attempt.proofChannelId !== destination.proofChannelId || !numericId(attempt.proofMessageId ?? undefined)
      || (kind === "success" && !attempt.publicationConsent)) return { eligible: false, reason: "expired" };
    const member = await scopedDb.membership.findUnique({ where: { communityId_userId: { communityId: event.communityId, userId: attempt.userId } }, select: { status: true } });
    if (member?.status !== "ACTIVE") return { eligible: false, reason: "expired" };
    const url = "https://discord.com/channels/" + destination.guildId + "/" + attempt.proofChannelId + "/" + attempt.proofMessageId;
    let content: string;
    let components: DiscordActionRow[] = [];
    if (kind === "proof") {
      const tvHint = attempt.proofCode ? towerTvPhotoReviewHint(attempt.proofText, attempt.proofCode) : null;
      const endsAt = challengeVoteDeadline(attempt.submittedAt, Boolean(attempt.voteExtendedAt)).getTime();
      if (attempt.status !== "SUBMITTED" || now.getTime() >= endsAt) return { eligible: false, reason: "expired" };
      content = "🧪 **Preuve à juger : " + plain(attempt.title, 120) + "**\n"
        + (attempt.team ? "L’équipe **" + plain(attempt.team.name, 80) + "** propose sa réalisation au vote :" : plain(attempt.user.discordName, 80) + " propose sa réalisation au vote :") + "\n"
        + (tvHint ? "\n" + tvHint : "")
        + "\n[Voir la preuve](" + url + ")\nVote jusqu’à <t:" + Math.floor(endsAt / 1000)
        + ":f> · 3 votants minimum, majorité favorable, aucun vote pour soi.";
      components = voteButtons(attempt.id);
    } else if (kind === "rejection") {
      if (attempt.status !== "REJECTED") return { eligible: false, reason: "expired" };
      content = "⚖️ **Vote terminé : preuve refusée**\n" + plain(attempt.user.discordName, 80)
        + " · **" + plain(attempt.title, 120) + "**. Le délai de contestation de 48 heures commence avec cette annonce. "
        + "Retrouve la contestation dans GameNight → The Tower.\n[Voir la preuve](" + url + ")";
    } else {
      if (attempt.status !== "APPROVED" || !attempt.rewardedAt) return { eligible: false, reason: "expired" };
      content = attempt.team
        ? "🏆 **La Tour valide… et prend des notes.**\nL’équipe **" + plain(attempt.team.name, 80)
          + "** a réussi **" + plain(attempt.title, 120) + "**. Chaque participant confirmé gagne +" + attempt.rewardFloors
          + " étage(s) sur son parcours personnel, dans la limite des deux réussites quotidiennes communes aux défis solo et équipe.\n"
          + plain(attempt.proofText, 700) + "\n[Admirer la réalisation](" + url + ")"
        : "🏆 **La Tour valide… et prend des notes.**\n" + plain(attempt.user.discordName, 80)
          + " a réussi **" + plain(attempt.title, 120) + "** : +" + attempt.rewardFloors
          + " étage(s) !\n" + plain(attempt.proofText, 700) + "\n[Admirer la réalisation](" + url + ")";
    }
    return { eligible: true, action: { kind: "send_channel_message_verified", guildId: destination.guildId,
      channelId: destination.channelId, message: { content, components, allowedMentions: { parse: [] } } } };
  },
};
