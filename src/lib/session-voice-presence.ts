import type { VoiceInterval } from "./discord-voice-presence";
import { prisma } from "@/lib/prisma";
import { getSessionAccessRole } from "@/lib/session-access";
import { communityMemberUserWhere } from "@/lib/community-isolation";
import { toWallClock } from "@/lib/wallclock";

export type SessionVoiceConfig = { guildId: string; channelIds: readonly string[]; sessionId: string };

export function sessionVoiceConfig(env: Record<string, string | undefined>): SessionVoiceConfig | null {
  if (env.VOICE_PRESENCE_ENABLED !== "true") return null;
  const guildId = env.VOICE_PRESENCE_GUILD_ID?.trim() ?? "";
  const sessionId = env.VOICE_PRESENCE_SESSION_ID?.trim() ?? "";
  const channelIds = env.VOICE_PRESENCE_CHANNEL_IDS?.split(",").map(id => id.trim()).filter(Boolean) ?? [];
  if (!/^\d{17,20}$/.test(guildId) || !sessionId || !channelIds.length || channelIds.some(id => !/^\d{17,20}$/.test(id))) {
    throw new Error("Voice presence session configuration incomplete");
  }
  return { guildId, channelIds, sessionId };
}

export async function storeSessionVoiceInterval(
  config: SessionVoiceConfig | null,
  interval: VoiceInterval,
) {
  if (!config || !config.channelIds.includes(interval.channelId)) return false;
  if (!/^\d{17,20}$/.test(interval.memberKey) || !Number.isFinite(interval.startedAt) || !Number.isFinite(interval.endedAt) || interval.endedAt <= interval.startedAt) return false;
  const durationSeconds = Math.floor((interval.endedAt - interval.startedAt) / 1_000);
  if (durationSeconds < 1) return false;

  const user = await prisma.user.findUnique({ where: { discordId: interval.memberKey }, select: { id: true } });
  if (!user) return false;
  const session = await prisma.session.findFirst({
    where: {
      id: config.sessionId,
      status: "SCHEDULED",
      date: { lte: toWallClock(new Date(interval.startedAt)) },
      community: { is: {
        discordGuildId: config.guildId,
        status: "ACTIVE",
        channelConfigs: { some: { category: "VOICE", discordChannelId: interval.channelId, enabled: true } },
      } },
      OR: [
        { createdById: user.id },
        { invites: { some: { userId: user.id, status: "ACTIVE" } } },
      ],
    },
    select: { id: true, communityId: true },
  });
  if (!session) return false;
  const member = await prisma.user.findFirst({
    where: { id: user.id, ...await communityMemberUserWhere(session.communityId) },
    select: { id: true },
  });
  if (!member) return false;

  const startedAt = new Date(interval.startedAt);
  await prisma.sessionVoicePresenceInterval.upsert({
    where: { sessionId_userId_channelId_startedAt: { sessionId: session.id, userId: user.id, channelId: interval.channelId, startedAt } },
    create: {
      sessionId: session.id,
      userId: user.id,
      channelId: interval.channelId,
      startedAt,
      durationSeconds,
      partial: interval.partial === true,
    },
    update: {
      durationSeconds,
      partial: interval.partial === true,
    },
  });
  return true;
}

export async function readSessionVoicePresence(sessionId: string, viewerId: string) {
  if (process.env.VOICE_PRESENCE_ENABLED !== "true" || await getSessionAccessRole(viewerId, sessionId) !== "creator") return null;
  const totals = await prisma.sessionVoicePresenceInterval.groupBy({
    by: ["userId"],
    where: { sessionId },
    _sum: { durationSeconds: true },
    _max: { partial: true },
  });
  if (!totals.length) return [];
  const users = await prisma.user.findMany({
    where: { id: { in: totals.map(row => row.userId) } },
    select: { id: true, discordName: true },
  });
  const names = new Map(users.map(user => [user.id, user.discordName]));
  return totals
    .map(row => ({ userId: row.userId, name: names.get(row.userId) ?? "Membre", durationSeconds: row._sum.durationSeconds ?? 0, partial: row._max.partial ?? false }))
    .sort((a, b) => b.durationSeconds - a.durationSeconds);
}
