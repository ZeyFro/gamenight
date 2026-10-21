import type { VoiceInterval } from "./discord-voice-presence";
import { prisma } from "@/lib/prisma";
import { getSessionAccessRole } from "@/lib/session-access";
import { isCommunityIsolationEnabled } from "@/lib/community-isolation";
import { toWallClock } from "@/lib/wallclock";

export type SessionVoiceConfig = { guildId: string; defaultGuildId?: string; channelIds: readonly string[]; sessionId: string };

export function sessionVoiceConfig(env: Record<string, string | undefined>): SessionVoiceConfig | null {
  if (env.VOICE_PRESENCE_ENABLED !== "true") return null;
  const guildId = env.VOICE_PRESENCE_GUILD_ID?.trim() ?? "";
  const sessionId = env.VOICE_PRESENCE_SESSION_ID?.trim() ?? "";
  const channelIds = env.VOICE_PRESENCE_CHANNEL_IDS?.split(",").map(id => id.trim()).filter(Boolean) ?? [];
  if (!/^\d{17,20}$/.test(guildId) || !sessionId || !channelIds.length || channelIds.some(id => !/^\d{17,20}$/.test(id))) {
    throw new Error("Voice presence session configuration incomplete");
  }
  return { guildId, defaultGuildId: env.DISCORD_BOT_GUILD_ID?.trim() ?? "", channelIds, sessionId };
}

export async function storeSessionVoiceInterval(
  config: SessionVoiceConfig | null,
  interval: VoiceInterval,
) {
  if (!config || !config.channelIds.includes(interval.channelId)) return false;
  if (!/^\d{17,20}$/.test(interval.memberKey) || !Number.isFinite(interval.startedAt) || !Number.isFinite(interval.endedAt) || interval.endedAt <= interval.startedAt) return false;
  const durationSeconds = Math.floor((interval.endedAt - interval.startedAt) / 1_000);
  if (durationSeconds < 1) return false;
  const usesDefaultGuildFallback = config.defaultGuildId === config.guildId;
  const communityGuildFilter = usesDefaultGuildFallback
    ? { OR: [{ discordGuildId: config.guildId }, { slug: "default", discordGuildId: null }] }
    : { discordGuildId: config.guildId };

  const user = await prisma.user.findUnique({ where: { discordId: interval.memberKey }, select: { id: true } });
  if (!user) return false;
  const session = await prisma.session.findFirst({
    where: {
      id: config.sessionId,
      status: "SCHEDULED",
      date: { lte: toWallClock(new Date(interval.startedAt)) },
      community: { is: {
        ...communityGuildFilter,
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

  const startedAt = new Date(interval.startedAt);
  const upsert = {
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
  };
  const isolationEnabled = isCommunityIsolationEnabled();
  return prisma.$transaction(async tx => {
    // Keep the lock order aligned with OAuth (User before Membership) and
    // serialize every acceptance predicate until the interval is committed.
    const users = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "User"
      WHERE id = ${user.id} AND "discordId" = ${interval.memberKey}
      FOR SHARE
    `;
    if (!users.length) return false;

    const sessions = await tx.$queryRaw<{
      id: string;
      createdById: string;
      communityId: string | null;
    }[]>`
      SELECT id, "createdById", "communityId"
      FROM "Session"
      WHERE id = ${config.sessionId}
        AND status = 'SCHEDULED'
        AND date <= ${toWallClock(new Date(interval.startedAt))}
      FOR SHARE
    `;
    const currentSession = sessions[0];
    if (!currentSession?.communityId) return false;

    const communities = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Community"
      WHERE id = ${currentSession.communityId}
        AND status = 'ACTIVE'
        AND (
          "discordGuildId" = ${config.guildId}
          OR ("slug" = 'default' AND "discordGuildId" IS NULL AND ${usesDefaultGuildFallback})
        )
      FOR SHARE
    `;
    if (!communities.length) return false;

    const voiceConfigs = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "CommunityChannelConfig"
      WHERE "communityId" = ${currentSession.communityId}
        AND category = 'VOICE'
        AND "discordChannelId" = ${interval.channelId}
        AND enabled = true
      FOR SHARE
    `;
    if (!voiceConfigs.length) return false;

    if (currentSession.createdById !== user.id) {
      const invites = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "SessionInvite"
        WHERE "sessionId" = ${currentSession.id}
          AND "userId" = ${user.id}
          AND status = 'ACTIVE'
        FOR SHARE
      `;
      if (!invites.length) return false;
    }

    if (isolationEnabled) {
      const memberships = await tx.$queryRaw<{ userId: string }[]>`
        SELECT "userId" FROM "Membership"
        WHERE "communityId" = ${currentSession.communityId}
          AND "userId" = ${user.id}
          AND status = 'ACTIVE'
        FOR SHARE
      `;
      if (!memberships.length) return false;
    }

    await tx.sessionVoicePresenceInterval.upsert(upsert);
    return true;
  });
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
