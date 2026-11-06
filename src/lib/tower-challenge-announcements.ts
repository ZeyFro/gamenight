import type { Prisma } from "@prisma/client";
import { scopedPrisma } from "@/lib/community-scoped-client";
import { createNotificationEvent, enqueueDelivery } from "@/lib/notification-delivery";
import type { DeliveryResolver } from "@/lib/notification-executor";
import type { DiscordActionRow } from "@/lib/discord-rest";

type Kind = "proof" | "success";
const types = { proof: "TOWER_PROOF_SUBMITTED", success: "TOWER_CHALLENGE_APPROVED" } as const;
const numericId = (value: string | undefined): value is string => /^[0-9]{16,20}$/.test(value ?? "");
function config(kind: Kind) {
  if (process.env.TOWER_CHALLENGES_ENABLED !== "true" || process.env.TOWER_DISCORD_ANNOUNCE_ENABLED !== "true") return null;
  const guildId = process.env.TOWER_DISCORD_GUILD_ID;
  const proofChannelId = process.env.TOWER_DISCORD_CHANNEL_ID;
  const channelId = kind === "proof" ? proofChannelId : process.env.TOWER_DISCORD_GENERAL_CHANNEL_ID;
  return numericId(guildId) && numericId(proofChannelId) && numericId(channelId) ? { guildId, channelId, proofChannelId } : null;
}
const slot = (guildId: string, attemptId: string, kind: Kind) => guildId + ":TOWER:" + attemptId + ":" + kind;

// Écriture dans la même transaction que le dépôt ou le gain ; aucun appel Discord ici.
export async function enqueueTowerChallengeEvent(scopedDb: Prisma.TransactionClient, communityId: string, attemptId: string, kind: Kind) {
  const destination = config(kind);
  if (!destination) return;
  const community = await scopedDb.community.findUnique({ where: { id: communityId }, select: { status: true, towerChallengesEnabled: true, discordGuildId: true } });
  if (community?.status !== "ACTIVE" || !community.towerChallengesEnabled || community.discordGuildId !== destination.guildId) return;
  const event = await createNotificationEvent({ communityId, category: "ACHIEVEMENT", eventType: types[kind], sourceId: attemptId }, scopedDb);
  await enqueueDelivery({ eventId: event.id, channel: "DISCORD_CHANNEL", transport: "BOT", operation: "SEND",
    recipientKey: destination.channelId, targetSlot: slot(destination.guildId, attemptId, kind),
  }, scopedDb);
}

const plain = (value: string, max: number) => value.slice(0, max).replace(/([\\\x60*_~|>\[\]()])/g, "\\$1");

export const towerChallengeAnnounceResolver: DeliveryResolver = {
  async resolve({ event, delivery, now }) {
    const kind: Kind | null = event.eventType === types.proof ? "proof" : event.eventType === types.success ? "success" : null;
    if (!kind || event.category !== "ACHIEVEMENT" || !event.communityId
      || delivery.channel !== "DISCORD_CHANNEL" || delivery.transport !== "BOT" || delivery.operation !== "SEND") return { eligible: false, reason: "unresolvable" };
    const destination = config(kind);
    if (!destination || process.env.NOTIFICATION_EXECUTOR_ENABLED !== "true") return { eligible: false, reason: "not_configured" };
    if (delivery.recipientKey !== destination.channelId || delivery.targetSlot !== slot(destination.guildId, event.sourceId, kind)) return { eligible: false, reason: "unresolvable" };
    const scopedDb = scopedPrisma({ communityIds: [event.communityId], includesDefault: false });
    const community = await scopedDb.community.findUnique({ where: { id: event.communityId }, select: { status: true, towerChallengesEnabled: true, discordGuildId: true } });
    if (community?.status !== "ACTIVE" || !community.towerChallengesEnabled || community.discordGuildId !== destination.guildId) return { eligible: false, reason: "expired" };
    const attempt = await scopedDb.towerChallengeAttempt.findFirst({
      where: { id: event.sourceId, communityId: event.communityId },
      select: { id: true, userId: true, title: true, proofText: true, proofChannelId: true, proofMessageId: true,
        teamId: true, team: { select: { name: true } },
        participants: { select: { rewardedAt: true } },
        publicationConsent: true, submittedAt: true, status: true, rewardedAt: true, rewardFloors: true,
        user: { select: { discordName: true } } },
    });
    if (!attempt?.submittedAt || !attempt.proofText
      || attempt.proofChannelId !== destination.proofChannelId || !numericId(attempt.proofMessageId ?? undefined)
      || (kind === "success" && !attempt.publicationConsent)) return { eligible: false, reason: "expired" };
    const member = await scopedDb.membership.findUnique({ where: { communityId_userId: { communityId: event.communityId, userId: attempt.userId } }, select: { status: true } });
    if (member?.status !== "ACTIVE") return { eligible: false, reason: "expired" };
    const url = "https://discord.com/channels/" + destination.guildId + "/" + attempt.proofChannelId + "/" + attempt.proofMessageId;
    let content: string;
    let components: DiscordActionRow[] = [];
    if (kind === "proof") {
      const endsAt = attempt.submittedAt.getTime() + 24 * 3600000;
      if (attempt.status !== "SUBMITTED" || now.getTime() >= endsAt) return { eligible: false, reason: "expired" };
      content = "🧪 **Preuve à juger : " + plain(attempt.title, 120) + "**\n"
        + (attempt.team ? "L’équipe **" + plain(attempt.team.name, 80) + "** propose sa réalisation au vote :" : plain(attempt.user.discordName, 80) + " propose sa réalisation au vote :") + "\n"
        + "\n[Voir la preuve](" + url + ")\nVote jusqu’à <t:" + Math.floor(endsAt / 1000)
        + ":f> · 3 votants minimum, majorité favorable, aucun vote pour soi.";
      components = [{ type: 1, components: [
        { type: 2, style: 3, label: "Valider", custom_id: "gn:tower:vote:" + attempt.id + ":yes" },
        { type: 2, style: 4, label: "Refuser", custom_id: "gn:tower:vote:" + attempt.id + ":no" },
        ] }];
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
