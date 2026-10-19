import { createHash, randomBytes } from "node:crypto";
import { resolveActiveCommunityId } from "@/lib/community-isolation";
import { prisma } from "@/lib/prisma";
import { scopedPrisma } from "@/lib/community-scoped-client";
import { accessibleSessionWhere } from "@/lib/session-access";
import { wallClockNow } from "@/lib/wallclock";
import { buildIcalCalendar } from "@/lib/ical-calendar";

export function isCalendarFeedEnabled(): boolean {
  return process.env.CALENDAR_SUBSCRIPTIONS_ENABLED === "true";
}

const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

async function currentCommunity(userId: string) {
  const communityId = await resolveActiveCommunityId(userId);
  if (!communityId) return null;
  return prisma.membership.findFirst({
    where: { userId, communityId, status: "ACTIVE", community: { status: "ACTIVE" } },
    select: { community: { select: { id: true, name: true, slug: true } } },
  }).then((membership) => membership?.community ?? null);
}

function scopeFor(community: { id: string; slug: string }) {
  return { communityIds: [community.id], includesDefault: community.slug === "default" };
}

export async function createCalendarFeedToken(userId: string): Promise<{ token: string; communityName: string } | null> {
  if (!isCalendarFeedEnabled()) return null;
  const community = await currentCommunity(userId);
  if (!community) return null;

  const token = randomBytes(32).toString("base64url");
  const scopedDb = scopedPrisma(scopeFor(community));
  await scopedDb.calendarFeedToken.upsert({
    where: { userId_communityId: { userId, communityId: community.id } },
    create: { userId, communityId: community.id, tokenHash: tokenHash(token) },
    update: { tokenHash: tokenHash(token), createdAt: new Date(), revokedAt: null },
  });
  return { token, communityName: community.name };
}

export async function revokeCalendarFeedToken(userId: string): Promise<boolean> {
  if (!isCalendarFeedEnabled()) return false;
  const community = await currentCommunity(userId);
  if (!community) return false;
  const scopedDb = scopedPrisma(scopeFor(community));
  await scopedDb.calendarFeedToken.updateMany({
    where: { userId, communityId: community.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return true;
}

export async function readCalendarFeed(token: string, origin: string): Promise<string | null> {
  if (!isCalendarFeedEnabled() || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  let baseUrl: URL;
  try {
    baseUrl = new URL(origin);
  } catch {
    return null;
  }
  if (baseUrl.protocol !== "https:" && baseUrl.protocol !== "http:") return null;

  const hash = tokenHash(token);
  // Read the bearer through its non-collective owner; all token writes and
  // session reads still go through the community-scoped client.
  const owner = await prisma.user.findFirst({
    where: { calendarFeedTokens: { some: { tokenHash: hash, revokedAt: null } } },
    select: {
      id: true,
      calendarFeedTokens: {
        where: { tokenHash: hash, revokedAt: null },
        select: { community: { select: { id: true, name: true, slug: true, status: true } } },
      },
    },
  });
  const community = owner?.calendarFeedTokens[0]?.community;
  if (!owner || !community || community.status !== "ACTIVE") return null;
  const membership = await prisma.membership.findFirst({
    where: { userId: owner.id, communityId: community.id, status: "ACTIVE", community: { status: "ACTIVE" } },
    select: { id: true },
  });
  if (!membership) return null;

  const scope = scopeFor(community);
  const scopedDb = scopedPrisma(scope);
  const sessions = await scopedDb.session.findMany({
    where: {
      AND: [
        { date: { gte: wallClockNow() }, status: { in: ["VOTING", "SCHEDULED"] } },
        community.slug === "default"
          ? { OR: [{ communityId: community.id }, { communityId: null }] }
          : { communityId: community.id },
        accessibleSessionWhere(owner.id, scope),
      ],
    },
    select: { id: true, date: true, status: true, decidedGame: { select: { name: true } } },
    orderBy: { date: "asc" },
  });
  return buildIcalCalendar(sessions.map((session) => ({
    id: session.id,
    date: session.date,
    title: session.decidedGame?.name ? `Soirée GameNight — ${session.decidedGame.name}` : "Soirée GameNight",
    status: session.status === "SCHEDULED" ? "SCHEDULED" : "VOTING",
    url: new URL(`/sessions/${encodeURIComponent(session.id)}`, baseUrl.origin).toString(),
  })));
}
