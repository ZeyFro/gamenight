import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { scopedPrisma } from "@/lib/community-scoped-client";
import { createNotificationEvent, enqueueDelivery } from "@/lib/notification-delivery";
import type { DeliveryResolver, Resolution } from "@/lib/notification-executor";
import { measureSummary, TOWER_MEASURE_DOUBT_WINDOW_MS, isTowerSteamAutovalidateEnabled } from "@/lib/tower-steam-measure-rules";

// Validation automatique Steam : trois événements passant par la file (jamais d'appel Discord direct).
//  - TOWER_AUTO_VALIDATION          : message public « validation en attente » avec le bouton « Signaler un doute » (SEND)
//  - TOWER_AUTO_VALIDATION_UPDATED  : même message, édité à la validation ou au doute (EDIT, boutons retirés)
//  - TOWER_AUTO_VALIDATED           : MP au joueur à la validation
export const TOWER_AUTO_VALIDATION = "TOWER_AUTO_VALIDATION";
export const TOWER_AUTO_VALIDATION_UPDATED = "TOWER_AUTO_VALIDATION_UPDATED";
export const TOWER_AUTO_VALIDATED = "TOWER_AUTO_VALIDATED";
export const TOWER_STEAM_EVENT_TYPES: readonly string[] = [TOWER_AUTO_VALIDATION, TOWER_AUTO_VALIDATION_UPDATED, TOWER_AUTO_VALIDATED];

const numericId = (value: string | undefined): value is string => /^[0-9]{16,20}$/.test(value ?? "");
/** Configuration commune : annonces Tower actives, serveur et salon des preuves valides. Sinon la validation automatique ne démarre pas. */
export function towerSteamConfig(env: Record<string, string | undefined> = process.env) {
  if (env.TOWER_CHALLENGES_ENABLED !== "true" || !isTowerSteamAutovalidateEnabled(env) || env.TOWER_DISCORD_ANNOUNCE_ENABLED !== "true") return null;
  const guildId = env.TOWER_DISCORD_GUILD_ID;
  const channelId = env.TOWER_DISCORD_CHANNEL_ID;
  return numericId(guildId) && numericId(channelId) ? { guildId, channelId } : null;
}
export const towerAutoSlot = (guildId: string, attemptId: string) => guildId + ":TOWER:" + attemptId + ":auto";
const dmSlot = (guildId: string, attemptId: string) => guildId + ":TOWER:" + attemptId + ":auto-dm";
const plain = (value: string, max: number) => value.slice(0, max).replace(/([\\\x60*_~|>\[\]()])/g, "\\$1");

export type TowerAutoValidationKind = "pending" | "validated" | "doubt";

/** À appeler dans la transaction qui change l'état de la tentative. */
export async function enqueueTowerAutoValidationEvent(scopedDb: Prisma.TransactionClient, communityId: string, attemptId: string, kind: TowerAutoValidationKind) {
  const config = towerSteamConfig();
  if (!config) return false;
  const community = await scopedDb.community.findUnique({ where: { id: communityId }, select: { status: true, towerChallengesEnabled: true, discordGuildId: true } });
  if (community?.status !== "ACTIVE" || !community.towerChallengesEnabled || community.discordGuildId !== config.guildId) return false;
  const slot = towerAutoSlot(config.guildId, attemptId);
  if (kind === "pending") {
    const event = await createNotificationEvent({ communityId, category: "ACHIEVEMENT", eventType: TOWER_AUTO_VALIDATION, sourceId: attemptId }, scopedDb);
    await enqueueDelivery({ eventId: event.id, channel: "DISCORD_CHANNEL", transport: "BOT", operation: "SEND", recipientKey: config.channelId, targetSlot: slot }, scopedDb);
    return true;
  }
  // Édition seulement si le message public existe déjà dans la file ; sinon rien à mettre à jour.
  const sent = await scopedDb.notificationDelivery.findFirst({
    where: { targetSlot: slot, operation: "SEND", status: { in: ["PENDING", "RESERVED", "SENT"] } }, select: { id: true },
  });
  if (sent) {
    const edit = await createNotificationEvent({
      communityId, category: "ACHIEVEMENT", eventType: TOWER_AUTO_VALIDATION_UPDATED, sourceId: attemptId,
      occurrence: kind + ":" + Date.now() + ":" + randomUUID().slice(0, 8),
    }, scopedDb);
    await enqueueDelivery({ eventId: edit.id, channel: "DISCORD_CHANNEL", transport: "BOT", operation: "EDIT", recipientKey: config.channelId, targetSlot: slot }, scopedDb);
  }
  if (kind === "validated") {
    const attempt = await scopedDb.towerChallengeAttempt.findFirst({ where: { id: attemptId, communityId }, select: { userId: true } });
    if (!attempt) return false;
    const dm = await createNotificationEvent({ communityId, category: "ACHIEVEMENT", eventType: TOWER_AUTO_VALIDATED, sourceId: attemptId }, scopedDb);
    await enqueueDelivery({ eventId: dm.id, channel: "DISCORD_DM", transport: "BOT", operation: "SEND",
      recipientKey: "user:" + attempt.userId, targetSlot: dmSlot(config.guildId, attemptId) }, scopedDb);
  }
  return true;
}

const refuse = (reason: "unresolvable" | "not_configured" | "expired" | "dependency_not_ready"): Resolution => ({ eligible: false, reason });

export const towerSteamAnnounceResolver: DeliveryResolver = {
  async resolve({ event, delivery, now }) {
    if (event.category !== "ACHIEVEMENT" || !event.communityId || !TOWER_STEAM_EVENT_TYPES.includes(event.eventType)
      || delivery.transport !== "BOT") return refuse("unresolvable");
    const config = towerSteamConfig();
    if (!config || process.env.NOTIFICATION_EXECUTOR_ENABLED !== "true") return refuse("not_configured");
    const isDm = event.eventType === TOWER_AUTO_VALIDATED;
    const wanted = isDm
      ? { channel: "DISCORD_DM", operation: "SEND" }
      : { channel: "DISCORD_CHANNEL", operation: event.eventType === TOWER_AUTO_VALIDATION ? "SEND" : "EDIT" };
    if (delivery.channel !== wanted.channel || delivery.operation !== wanted.operation) return refuse("unresolvable");
    const expectedSlot = isDm ? dmSlot(config.guildId, event.sourceId) : towerAutoSlot(config.guildId, event.sourceId);
    if (delivery.targetSlot !== expectedSlot || (!isDm && delivery.recipientKey !== config.channelId)) return refuse("unresolvable");

    const scopedDb = scopedPrisma({ communityIds: [event.communityId], includesDefault: false });
    const community = await scopedDb.community.findUnique({ where: { id: event.communityId }, select: { status: true, towerChallengesEnabled: true, discordGuildId: true } });
    if (community?.status !== "ACTIVE" || !community.towerChallengesEnabled || community.discordGuildId !== config.guildId) return refuse("expired");
    const attempt = await scopedDb.towerChallengeAttempt.findFirst({
      where: { id: event.sourceId, communityId: event.communityId },
      select: { id: true, userId: true, title: true, rewardFloors: true, status: true, rewardedAt: true, autoValidatedAt: true, doubtReportedAt: true,
        measureKind: true, measureTarget: true, measureAchievement: true, measureValue: true,
        user: { select: { discordId: true, discordName: true } } },
    });
    if (!attempt?.autoValidatedAt || !attempt.measureKind || attempt.measureTarget === null) return refuse("expired");
    if (isDm && delivery.recipientKey !== "user:" + attempt.userId) return refuse("unresolvable");
    const member = await scopedDb.membership.findUnique({ where: { communityId_userId: { communityId: event.communityId, userId: attempt.userId } }, select: { status: true } });
    if (member?.status !== "ACTIVE") return refuse("expired");
    const summary = measureSummary({ kind: attempt.measureKind, value: attempt.measureValue ?? 0, target: attempt.measureTarget, achievement: attempt.measureAchievement });
    const title = plain(attempt.title, 120);
    const player = plain(attempt.user.discordName, 80);

    if (isDm) {
      if (attempt.status !== "APPROVED" || !attempt.rewardedAt) return refuse("expired");
      return { eligible: true, action: { kind: "send_direct_message", userId: attempt.user.discordId, message: {
        content: "🏆 **Défi validé automatiquement : " + title + "**\n+" + attempt.rewardFloors + " étage(s) ! " + summary,
        allowedMentions: { parse: [] },
      } } };
    }
    if (event.eventType === TOWER_AUTO_VALIDATION) {
      const endsAt = attempt.autoValidatedAt.getTime() + TOWER_MEASURE_DOUBT_WINDOW_MS;
      if (attempt.status !== "ASSIGNED" || attempt.doubtReportedAt || now.getTime() >= endsAt) return refuse("expired");
      return { eligible: true, action: { kind: "send_channel_message_verified", guildId: config.guildId, channelId: config.channelId, message: {
        content: "🤖 **Validation automatique en attente : " + title + "**\n" + player + " a atteint l’objectif mesuré sur Steam. " + summary + "\n"
          + "Validation définitive <t:" + Math.floor(endsAt / 1000) + ":R>, sauf doute : un membre actif depuis 3 jours peut le signaler, le défi passe alors au vote communautaire.",
        components: [{ type: 1, components: [{ type: 2, style: 4, label: "Signaler un doute", custom_id: "gn:tower:doubt:" + attempt.id }] }],
        allowedMentions: { parse: [] },
      } } };
    }
    if (!delivery.targetMessage) return refuse("dependency_not_ready");
    let content: string;
    if (attempt.doubtReportedAt) {
      content = "⚖️ **Doute signalé : " + title + "**\n" + player + " : la validation automatique est suspendue, la preuve passe au vote communautaire.";
    } else if (attempt.status === "APPROVED" && attempt.rewardedAt) {
      content = "✅ **Validé automatiquement : " + title + "**\n" + player + " : +" + attempt.rewardFloors + " étage(s). " + summary;
    } else return refuse("expired");
    return { eligible: true, action: { kind: "edit_channel_message", channelId: delivery.targetMessage.discordChannelId ?? config.channelId,
      messageId: delivery.targetMessage.discordMessageId, message: { content, components: [], allowedMentions: { parse: [] } } } };
  },
};
