import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { resolveActiveCommunityId } from "@/lib/community-isolation";
import { scopedTransactionPrisma } from "@/lib/community-scoped-client";
import { createOnce } from "@/lib/creation-intent";
import { isCommunityQuickPollsEnabled, isQuickPollClosed, parseQuickPollInput, parseQuickPollOption, quickPollResults } from "@/lib/community-quick-polls-input";
import { wallClockNow } from "@/lib/wallclock";

type Access = { community: { id: string; name: string } };

async function withQuickPolls<T>(userId: string, work: (scopedDb: Prisma.TransactionClient, access: Access) => Promise<T>, expectedCommunityId?: string): Promise<T | null> {
  if (!isCommunityQuickPollsEnabled()) return null;
  const communityId = await resolveActiveCommunityId(userId);
  if (!communityId || (expectedCommunityId !== undefined && expectedCommunityId !== communityId)) return null;
  return prisma.$transaction(async tx => {
    const [community] = await tx.$queryRaw<{ status: string; name: string }[]>`SELECT status, name FROM "Community" WHERE id = ${communityId} FOR SHARE`;
    const [member] = await tx.$queryRaw<{ status: string }[]>`SELECT status FROM "Membership" WHERE "communityId" = ${communityId} AND "userId" = ${userId} FOR SHARE`;
    if (community?.status !== "ACTIVE" || member?.status !== "ACTIVE") return null;
    const scopedDb = scopedTransactionPrisma(tx, { communityIds: [communityId], includesDefault: false });
    return work(scopedDb, { community: { id: communityId, name: community.name } });
  });
}

export async function listCommunityQuickPolls(userId: string, page = 1) {
  if (!Number.isInteger(page) || page < 1 || page > 10000) return null;
  return withQuickPolls(userId, async (scopedDb, access) => {
    const found = await scopedDb.communityQuickPoll.findMany({
      where: { communityId: access.community.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * 50, take: 51,
      select: { id: true, question: true, options: true, endsAt: true },
    });
    const polls = found.slice(0, 50);
    const where = { communityId: access.community.id, pollId: { in: polls.map(poll => poll.id) } };
    const [counts, ownVotes] = await Promise.all([
      scopedDb.communityQuickPollVote.groupBy({ by: ["pollId", "optionIndex"], where, _count: { _all: true } }),
      scopedDb.communityQuickPollVote.findMany({ where: { ...where, userId }, select: { pollId: true, optionIndex: true } }),
    ]);
    const now = wallClockNow();
    return { ...access, hasNext: found.length > 50, polls: polls.map(poll => ({
      ...poll,
      results: quickPollResults(poll.options, counts.filter(row => row.pollId === poll.id).map(row => ({ optionIndex: row.optionIndex, count: row._count._all }))),
      selectedOption: ownVotes.find(vote => vote.pollId === poll.id)?.optionIndex ?? null,
      closed: isQuickPollClosed(poll.endsAt, now),
    })) };
  });
}

export async function createCommunityQuickPoll(userId: string, input: unknown, expectedCommunityId?: string, creationKey?: string) {
  const data = parseQuickPollInput(input);
  if (!data) return "invalid" as const;
  return await withQuickPolls(userId, async (scopedDb, access) => {
    const now = wallClockNow();
    const saved = await createOnce(userId, "community-quick-poll", creationKey,
      () => scopedDb.communityQuickPoll.create({ data: { question: data.question, options: data.options, communityId: access.community.id, createdById: userId, endsAt: new Date(now.getTime() + data.durationMinutes * 60000), createdAt: now }, select: { id: true } }),
      poll => poll.id,
      (_tx, id) => scopedDb.communityQuickPoll.findFirstOrThrow({ where: { id, communityId: access.community.id, createdById: userId }, select: { id: true } }),
      scopedDb,
    );
    return saved.result ? "saved" as const : "unavailable" as const;
  }, expectedCommunityId) ?? "unavailable";
}

export async function voteCommunityQuickPoll(userId: string, pollId: unknown, rawOption: unknown, expectedCommunityId?: string) {
  const optionIndex = parseQuickPollOption(rawOption);
  if (optionIndex === null || typeof pollId !== "string" || !pollId || pollId.length > 100) return "invalid" as const;
  return await withQuickPolls(userId, async (scopedDb, access) => {
    // Relire l’échéance après le verrou : un vote en attente peut expirer pendant ce temps.
    await scopedDb.$queryRaw`SELECT id FROM "CommunityQuickPoll" WHERE id = ${pollId} AND "communityId" = ${access.community.id} FOR UPDATE`;
    const poll = await scopedDb.communityQuickPoll.findFirst({ where: { id: pollId, communityId: access.community.id }, select: { options: true, endsAt: true } });
    if (!poll) return "unavailable" as const;
    if (isQuickPollClosed(poll.endsAt, wallClockNow())) return "closed" as const;
    if (optionIndex >= poll.options.length) return "invalid" as const;
    await scopedDb.communityQuickPollVote.upsert({
      where: { pollId_userId: { pollId, userId } },
      create: { pollId, userId, communityId: access.community.id, optionIndex }, update: { optionIndex },
    });
    return "saved" as const;
  }, expectedCommunityId) ?? "unavailable";
}
