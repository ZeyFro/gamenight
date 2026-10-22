import type { VoiceInterval } from "./discord-voice-presence";
import { prisma } from "@/lib/prisma";
import { getSessionAccessRole } from "@/lib/session-access";
import { findActiveMembership, hasCommunityRole } from "@/lib/community-access";
import { isAdminUser, parseAdminDiscordIds } from "@/lib/admin-rules";
import { isCommunityIsolationEnabled } from "@/lib/community-isolation";
import { statsCommunityIdForSession } from "@/lib/community-stats";
import { toWallClock, wallClockNow } from "@/lib/wallclock";
import { finalizeVoiceIntervalAtCutoff } from "./voice-presence-policy";
import { fenceSessionVoicePresenceLeasePreservingGap } from "./voice-presence-coordination";
import type { SessionVoiceConfig } from "./session-voice-config";

export { sessionVoiceConfig } from "./session-voice-config";
export type { SessionVoiceConfig } from "./session-voice-config";

// `consentedAt` est un instant réel (comme `startedAt` des intervalles et le défaut `now()` du schéma), jamais une heure murale.
export async function grantSessionVoiceConsent(sessionId: string, userId: string, now = new Date()) {
  return prisma.$transaction(async tx => {
    const users = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "User" WHERE id = ${userId} FOR SHARE`;
    if (!users.length) return false;
    const sessions = await tx.$queryRaw<{ id: string; createdById: string; communityId: string | null }[]>`
      SELECT id, "createdById", "communityId" FROM "Session"
      WHERE id = ${sessionId} AND status = 'SCHEDULED' FOR UPDATE
    `;
    const session = sessions[0];
    if (!session?.communityId) return false;

    if (session.createdById !== userId) {
      const invites = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "SessionInvite" WHERE "sessionId" = ${sessionId} AND "userId" = ${userId} AND status = 'ACTIVE' FOR SHARE
      `;
      if (!invites.length) return false;
    }

    if (isCommunityIsolationEnabled()) {
      const memberships = await tx.$queryRaw<{ userId: string }[]>`
        SELECT "userId" FROM "Membership" WHERE "communityId" = ${session.communityId} AND "userId" = ${userId} AND status = 'ACTIVE' FOR SHARE
      `;
      if (!memberships.length) return false;
    }

    await tx.sessionVoicePresenceConsent.upsert({
      where: { sessionId_userId: { sessionId, userId } },
      create: { sessionId, userId, consentedAt: now },
      update: {},
    });
    return true;
  });
}

export async function withdrawSessionVoiceConsent(sessionId: string, userId: string) {
  return prisma.$transaction(async tx => {
    const users = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    if (!users.length) return false;
    // Keep the lock order User → Session → Consent, matching grant/store and
    // the lease claim's Session lock, so a stale loaded target cannot win a
    // claim after this withdrawal commits.
    const sessions = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Session" WHERE id = ${sessionId} FOR UPDATE
    `;
    if (!sessions.length) return false;
    const consents = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "SessionVoicePresenceConsent" WHERE "sessionId" = ${sessionId} AND "userId" = ${userId} FOR UPDATE
    `;
    const consent = consents[0];
    if (!consent) return false;
    await tx.sessionVoicePresenceInterval.deleteMany({ where: { sessionId, userId } });
    await tx.sessionVoicePresenceConsent.delete({ where: { id: consent.id } });

    const now = wallClockNow();
    const activeConsents = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "SessionVoicePresenceConsent"
      WHERE "sessionId" = ${sessionId}
        AND ("expiresAt" IS NULL OR "expiresAt" > ${now})
      LIMIT 1
      FOR SHARE
    `;
    if (!activeConsents.length) {
      // Fence a collector which was loaded before the last opt-in was removed.
      // Its in-memory Gateway events can no longer persist; normal polling
      // closes the socket after this durable state is observed. Preserve an
      // already open gap so a later consent + fresh snapshot can resolve it.
      await fenceSessionVoicePresenceLeasePreservingGap(tx, sessionId, now);
    }
    return true;
  });
}

export async function storeSessionVoiceInterval(config: SessionVoiceConfig | null, interval: VoiceInterval) {
  if (!config || !config.channelIds.includes(interval.channelId)) return false;
  if (!/^\d{17,20}$/.test(interval.memberKey) || !Number.isFinite(interval.startedAt) || !Number.isFinite(interval.endedAt) || interval.endedAt <= interval.startedAt) return false;
  if (Math.floor((interval.endedAt - interval.startedAt) / 1_000) < 1) return false;
  const usesDefaultGuildFallback = config.defaultGuildId === config.guildId;
  const communityGuildFilter = usesDefaultGuildFallback
    ? { OR: [{ discordGuildId: config.guildId }, { slug: "default", discordGuildId: null }] }
    : { discordGuildId: config.guildId };

  const user = await prisma.user.findUnique({ where: { discordId: interval.memberKey }, select: { id: true } });
  if (!user) return false;
  const session = await prisma.session.findFirst({
    where: {
      id: config.sessionId,
      status: { in: ["SCHEDULED", "DONE"] },
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
  const isolationEnabled = isCommunityIsolationEnabled();
  return prisma.$transaction(async tx => {
    // Lock order: User → Session → Community/config/invite/membership → lease → consent.
    // Session end/cancel also locks Session before changing the durable control row.
    const users = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "User" WHERE id = ${user.id} AND "discordId" = ${interval.memberKey} FOR SHARE
    `;
    if (!users.length) return false;

    const sessions = await tx.$queryRaw<{ id: string; createdById: string; communityId: string | null; status: string }[]>`
      SELECT id, "createdById", "communityId", status FROM "Session"
      WHERE id = ${config.sessionId} AND status IN ('SCHEDULED', 'DONE') AND date <= ${toWallClock(startedAt)}
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
        AND category = 'VOICE' AND "discordChannelId" = ${interval.channelId} AND enabled = true
      FOR SHARE
    `;
    if (!voiceConfigs.length) return false;

    if (currentSession.createdById !== user.id) {
      const invites = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "SessionInvite"
        WHERE "sessionId" = ${currentSession.id} AND "userId" = ${user.id} AND status = 'ACTIVE'
        FOR SHARE
      `;
      if (!invites.length) return false;
    }

    if (isolationEnabled) {
      const memberships = await tx.$queryRaw<{ userId: string }[]>`
        SELECT "userId" FROM "Membership"
        WHERE "communityId" = ${currentSession.communityId} AND "userId" = ${user.id} AND status = 'ACTIVE'
        FOR SHARE
      `;
      if (!memberships.length) return false;
    }

    const controls = await tx.$queryRaw<{
      status: string; generation: number; leaseOwner: string | null; leaseExpiresAt: Date | null; stopAt: Date | null;
    }[]>`
      SELECT status::text AS status, "generation", "leaseOwner", "leaseExpiresAt", "stopAt"
      FROM "SessionVoicePresenceControl" WHERE "sessionId" = ${config.sessionId} FOR SHARE
    `;
    const control = controls[0];
    const now = wallClockNow();
    if (
      !control || control.leaseOwner !== config.workerId || control.generation !== config.generation ||
      !control.leaseExpiresAt || control.leaseExpiresAt <= now
    ) return false;
    const stopping = control.status === "STOP_REQUESTED" && control.stopAt !== null;
    if (control.status !== "ACTIVE" && !stopping) return false;
    if (currentSession.status !== "SCHEDULED" && !stopping) return false;
    if (stopping && startedAt >= control.stopAt!) return false;

    const consents = await tx.$queryRaw<{ id: string; consentedAt: Date }[]>`
      SELECT id, "consentedAt" FROM "SessionVoicePresenceConsent"
      WHERE "sessionId" = ${config.sessionId} AND "userId" = ${user.id}
      FOR SHARE
    `;
    const consent = consents[0];
    if (!consent || startedAt < consent.consentedAt) return false;

    const effective = finalizeVoiceIntervalAtCutoff({
      startedAt: interval.startedAt,
      endedAt: interval.endedAt,
      cutoffAt: stopping ? control.stopAt : null,
      partial: interval.partial === true,
    });
    if (!effective) return false;

    await tx.sessionVoicePresenceInterval.upsert({
      where: { sessionId_userId_channelId_startedAt: {
        sessionId: config.sessionId, userId: user.id, channelId: interval.channelId, startedAt: effective.startedAt,
      } },
      create: {
        sessionId: config.sessionId,
        userId: user.id,
        consentId: consent.id,
        channelId: interval.channelId,
        ...effective,
      },
      update: {
        consentId: consent.id,
        endedAt: effective.endedAt,
        durationSeconds: effective.durationSeconds,
        expiresAt: effective.expiresAt,
        partial: effective.partial,
      },
    });
    return true;
  });
}

export async function readSessionVoicePresence(sessionId: string, viewerId: string) {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { createdById: true, communityId: true, status: true },
  });
  if (!session) return null;

  const viewer = await prisma.user.findUnique({ where: { id: viewerId }, select: { discordId: true, role: true } });
  const isSiteAdmin = !!viewer && isAdminUser(viewer, parseAdminDiscordIds(process.env.ADMIN_DISCORD_IDS));
  const isCreator = session.createdById === viewerId;
  const membership = await findActiveMembership(viewerId, await statsCommunityIdForSession(session.communityId));
  const isCommunityAdmin = !!membership && hasCommunityRole(membership.role, "ADMIN");
  const isAdmin = isSiteAdmin || isCommunityAdmin;
  // Keep the underlying invite role even for an admin so an invited admin can
  // grant personal consent without making unrelated sessions consentable.
  const accessRole = await getSessionAccessRole(viewerId, sessionId);
  const canReadAll = isCreator || isAdmin;
  if (!canReadAll && accessRole !== "guest") return null;

  const ownConsent = await prisma.sessionVoicePresenceConsent.findUnique({
    where: { sessionId_userId: { sessionId, userId: viewerId } },
    select: { id: true, expiresAt: true },
  });
  const now = wallClockNow();
  const consented = !!ownConsent && (ownConsent.expiresAt === null || ownConsent.expiresAt > now);
  const totals = await prisma.sessionVoicePresenceInterval.groupBy({
    by: ["userId"],
    where: {
      sessionId,
      consentId: { not: null },
      expiresAt: { gt: now },
      ...(!canReadAll ? { userId: viewerId } : {}),
    },
    _sum: { durationSeconds: true },
    _max: { partial: true },
  });
  const users = totals.length ? await prisma.user.findMany({
    where: { id: { in: totals.map(row => row.userId) } },
    select: { id: true, discordName: true },
  }) : [];
  const names = new Map(users.map(user => [user.id, user.discordName]));
  const control = await prisma.sessionVoicePresenceControl.findUnique({
    where: { sessionId },
    select: { stopAt: true },
  });
  const retentionExpired = control?.stopAt !== null && control?.stopAt !== undefined
    && control.stopAt.getTime() + 30 * 24 * 60 * 60_000 <= now.getTime();
  const gapRows = retentionExpired ? [] : await prisma.sessionVoicePresenceGap.findMany({
    where: { sessionId, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    orderBy: { startedAt: "asc" },
    select: { startedAt: true, resumedAt: true },
  });
  const gapPeriods = gapRows.map(gap => ({ startedAt: gap.startedAt, resumedAt: gap.resumedAt }));
  return {
    enabled: process.env.VOICE_PRESENCE_ENABLED === "true",
    consented,
    canWithdraw: !!ownConsent,
    canConsent: session.status === "SCHEDULED" && (accessRole === "guest" || isCreator),
    canReadAll,
    hasGaps: gapPeriods.length > 0,
    gapPeriods,
    entries: totals
      .map(row => ({
        userId: row.userId,
        name: names.get(row.userId) ?? "Membre",
        durationSeconds: row._sum.durationSeconds ?? 0,
        partial: row._max.partial ?? false,
      }))
      .sort((a, b) => b.durationSeconds - a.durationSeconds),
  };
}
