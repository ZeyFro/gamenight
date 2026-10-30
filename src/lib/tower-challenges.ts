import "server-only";
import { randomInt } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { scopedTransactionPrisma } from "@/lib/community-scoped-client";
import { canClaimSoloChallenge, canSubmitChallengeProof, canReceiveChallengeReward, getTowerParisDayKey } from "@/lib/tower-challenge-rules";
import { evaluateChallengeVote } from "@/lib/tower-challenge-voting";
import { enqueueTowerChallengeEvent } from "@/lib/tower-challenge-announcements";
import { TOWER_STARTER_CHALLENGES } from "@/lib/tower-challenge-starter-catalogue";
import { TOWER_TEAM_STARTER_CHALLENGES } from "@/lib/tower-team-challenge-starter-catalogue";
import { getTowerSchoolSeason } from "@/lib/tower-challenge-seasons";

const id = z.string().min(1).max(191).regex(/^[a-zA-Z0-9_-]+$/);
const actorSchema = z.object({ communityId: id, userId: id });
const claimSchema = actorSchema.extend({ requestKey: z.string().regex(/^[a-zA-Z0-9_-]{16,100}$/) });
const attemptSchema = actorSchema.extend({ attemptId: id });
const teamChallengeSchema = actorSchema.extend({ teamId: id });
const proofSchema = attemptSchema.extend({
  proofText: z.string().trim().min(1).max(1500),
  proofChannelId: z.string().regex(/^[0-9]{16,20}$/),
  proofMessageId: z.string().regex(/^[0-9]{16,20}$/),
  publicationConsent: z.boolean(),
});
const voteSchema = attemptSchema.extend({ approve: z.boolean() });
type Actor = z.infer<typeof actorSchema>;
const now = () => new Date(Date.now());

// Entrées internes : l'adaptateur Discord doit authentifier l'acteur et l'origine du bouton.
async function withTower<T>(actor: Actor, work: (scopedDb: Prisma.TransactionClient) => Promise<T>) {
  if (process.env.TOWER_CHALLENGES_ENABLED !== "true") return { status: "DISABLED" } as const;
  return prisma.$transaction(async tx => {
    const [community] = await tx.$queryRaw<{ status: string; towerChallengesEnabled: boolean }[]>`
      SELECT status, "towerChallengesEnabled" FROM "Community"
      WHERE id = ${actor.communityId} FOR SHARE
    `;
    if (community?.status !== "ACTIVE" || !community.towerChallengesEnabled) return { status: "UNAVAILABLE" } as const;
    const [member] = await tx.$queryRaw<{ status: string }[]>`
      SELECT status FROM "Membership"
      WHERE "communityId" = ${actor.communityId} AND "userId" = ${actor.userId} FOR SHARE
    `;
    if (member?.status !== "ACTIVE") return { status: "UNAVAILABLE" } as const;
    const scopedDb = scopedTransactionPrisma(tx, { communityIds: [actor.communityId], includesDefault: false });
    return work(scopedDb);
  }, { timeout: 15000, maxWait: 10000 });
}

async function lockProgress(scopedDb: Prisma.TransactionClient, actor: Actor) {
  await scopedDb.towerChallengeProgress.createMany({ data: [actor], skipDuplicates: true });
  await scopedDb.$queryRaw`
    SELECT "userId" FROM "TowerChallengeProgress"
    WHERE "communityId" = ${actor.communityId} AND "userId" = ${actor.userId} FOR UPDATE
  `;
  return scopedDb.towerChallengeProgress.findUniqueOrThrow({ where: { communityId_userId: actor } });
}

async function rewardedTowerCompletions(scopedDb: Prisma.TransactionClient, actor: Actor, current: Date) {
  const since = new Date(current.getTime() - 48 * 3600000);
  const [solo, team] = await Promise.all([
    scopedDb.towerChallengeAttempt.findMany({
      where: { ...actor, teamId: null, rewardedAt: { gte: since, lte: current } }, select: { rewardedAt: true },
    }),
    scopedDb.towerChallengeAttemptParticipant.findMany({
      where: { ...actor, rewardedAt: { gte: since, lte: current } }, select: { rewardedAt: true },
    }),
  ]);
  return [...solo, ...team].flatMap(row => row.rewardedAt ? [row.rewardedAt] : []);
}

export async function claimSoloTowerChallenge(input: unknown) {
  const parsed = claimSchema.safeParse(input);
  if (!parsed.success) return { status: "INVALID" } as const;
  const { communityId, userId, requestKey } = parsed.data;
  const actor = { communityId, userId };
  return withTower(actor, async scopedDb => {
    const progress = await lockProgress(scopedDb, actor);
    const existing = await scopedDb.towerChallengeAttempt.findUnique({
      where: { communityId_userId_requestKey: { ...actor, requestKey } }, select: { id: true },
    });
    if (existing) return { status: "CLAIMED", attemptId: existing.id, replayed: true } as const;
    const assignedAt = now();
    if (!canClaimSoloChallenge(progress.lastSoloClaimAt, assignedAt)) return { status: "COOLDOWN" } as const;
    const owned = await scopedDb.userGame.findMany({ where: { userId, owned: true }, select: { gameId: true } });
    const candidates = await scopedDb.towerChallengeDefinition.findMany({
      where: { communityId, active: true, mode: "SOLO", OR: [{ gameId: null }, { gameId: { in: owned.map(game => game.gameId) } }] },
      select: { id: true, title: true, instructions: true, rewardFloors: true },
    });
    if (!candidates.length) return { status: "NO_CHALLENGE" } as const;
    const played = await scopedDb.towerChallengeAttempt.findMany({
      where: { communityId, userId, definitionId: { in: candidates.map(candidate => candidate.id) } },
      select: { definitionId: true },
      distinct: ["definitionId"],
    });
    const playedIds = new Set(played.map(attempt => attempt.definitionId));
    const unseen = candidates.filter(candidate => !playedIds.has(candidate.id));
    const pool = unseen.length ? unseen : candidates;
    const chosen = pool[randomInt(pool.length)];
    const attempt = await scopedDb.towerChallengeAttempt.create({
      data: { ...actor, requestKey, definitionId: chosen.id, title: chosen.title, instructions: chosen.instructions,
        rewardFloors: chosen.rewardFloors, assignedAt, expiresAt: new Date(assignedAt.getTime() + 48 * 3600000) },
      select: { id: true },
    });
    await scopedDb.towerChallengeProgress.update({ where: { communityId_userId: actor }, data: { lastSoloClaimAt: assignedAt } });
    return { status: "CLAIMED", attemptId: attempt.id, replayed: false } as const;
  });
}

export async function getTeamDailyTowerChallenge(input: unknown) {
  const parsed = teamChallengeSchema.safeParse(input);
  if (!parsed.success) return { status: "INVALID" } as const;
  const { communityId, userId, teamId } = parsed.data;
  const actor = { communityId, userId };
  return withTower(actor, async scopedDb => {
    const current = now();
    const team = await scopedDb.communityTeam.findFirst({
      where: {
        id: teamId, communityId, community: { status: "ACTIVE", communityTeamsEnabled: true },
        members: { some: { userId, user: { memberships: { some: { communityId, status: "ACTIVE" } } } } },
      },
      select: {
        id: true, name: true,
        members: { where: { user: { memberships: { some: { communityId, status: "ACTIVE" } } } }, select: { userId: true } },
      },
    });
    if (!team) return { status: "UNAVAILABLE" } as const;
    const requestKey = "team-" + getTowerParisDayKey(current);
    let attempt = await scopedDb.towerChallengeAttempt.findFirst({
      where: { communityId, teamId, requestKey },
      select: { id: true, title: true, instructions: true, rewardFloors: true, status: true, assignedAt: true, expiresAt: true, submittedAt: true },
    });
    if (!attempt) {
      const candidates = await scopedDb.towerChallengeDefinition.findMany({
        where: { communityId, active: true, mode: "TEAM" },
        select: { id: true, title: true, instructions: true, rewardFloors: true },
      });
      if (!candidates.length) return { status: "NO_CHALLENGE" } as const;
      const chosen = candidates[randomInt(candidates.length)];
      const assignedAt = current;
      const result = await scopedDb.towerChallengeAttempt.upsert({
        where: { communityId_teamId_requestKey: { communityId, teamId, requestKey } },
        create: {
          ...actor, teamId, requestKey, definitionId: chosen.id, title: chosen.title,
          instructions: chosen.instructions, rewardFloors: chosen.rewardFloors,
          assignedAt, expiresAt: new Date(assignedAt.getTime() + 48 * 3600000),
        },
        update: {},
        select: { id: true, title: true, instructions: true, rewardFloors: true, status: true, assignedAt: true, expiresAt: true, submittedAt: true },
      });
      attempt = result;
    }
    const [participation, participants] = await Promise.all([
      scopedDb.towerChallengeAttemptParticipant.findUnique({
        where: { attemptId_userId: { attemptId: attempt.id, userId } }, select: { rewardedAt: true },
      }),
      scopedDb.towerChallengeAttemptParticipant.count({ where: { communityId, attemptId: attempt.id } }),
    ]);
    return {
      status: "TEAM_CHALLENGE" as const, team: { id: team.id, name: team.name, memberCount: team.members.length },
      attempt, participantCount: participants, joined: Boolean(participation),
      pendingReward: attempt.status === "APPROVED" && Boolean(participation && !participation.rewardedAt),
    };
  });
}

export async function listDiscordTowerTeams(input: unknown) {
  const parsed = actorSchema.safeParse(input);
  if (!parsed.success) return { status: "INVALID" } as const;
  const actor = parsed.data;
  return withTower(actor, async scopedDb => {
    const teams = await scopedDb.communityTeam.findMany({
      where: {
        communityId: actor.communityId, community: { communityTeamsEnabled: true, status: "ACTIVE" },
        members: { some: { userId: actor.userId, user: { memberships: { some: { communityId: actor.communityId, status: "ACTIVE" } } } } },
      },
      select: { id: true, name: true }, orderBy: { name: "asc" }, take: 25,
    });
    return { status: "TEAMS" as const, teams };
  });
}

export async function getTowerTeamDailyStates(input: unknown) {
  const parsed = actorSchema.safeParse(input);
  if (!parsed.success) return { status: "INVALID" } as const;
  const actor = parsed.data;
  return withTower(actor, async scopedDb => {
    const requestKey = "team-" + getTowerParisDayKey(now());
    const teams = await scopedDb.communityTeam.findMany({
      where: {
        communityId: actor.communityId, community: { communityTeamsEnabled: true, status: "ACTIVE" },
        members: { some: { userId: actor.userId, user: { memberships: { some: { communityId: actor.communityId, status: "ACTIVE" } } } } },
      },
      select: {
        id: true, name: true,
        members: { where: { user: { memberships: { some: { communityId: actor.communityId, status: "ACTIVE" } } } }, select: { userId: true } },
        towerChallengeAttempts: {
          where: { communityId: actor.communityId, requestKey }, take: 1,
          select: { id: true, title: true, instructions: true, status: true, rewardFloors: true, expiresAt: true,
            participants: { select: { userId: true, rewardedAt: true } } },
        },
      },
      orderBy: { name: "asc" }, take: 25,
    });
    return { status: "TEAM_STATES" as const, teams: teams.map(team => ({
      id: team.id, name: team.name, memberCount: team.members.length,
      attempt: team.towerChallengeAttempts[0] ? {
        ...team.towerChallengeAttempts[0], participantCount: team.towerChallengeAttempts[0].participants.length,
        joined: team.towerChallengeAttempts[0].participants.some(participant => participant.userId === actor.userId),
        userRewarded: Boolean(team.towerChallengeAttempts[0].participants.find(participant => participant.userId === actor.userId)?.rewardedAt),
        rewardedCount: team.towerChallengeAttempts[0].participants.filter(participant => participant.rewardedAt).length,
        pendingReward: team.towerChallengeAttempts[0].status === "APPROVED"
          && team.towerChallengeAttempts[0].participants.some(participant => participant.userId === actor.userId && !participant.rewardedAt),
      } : null,
    })) };
  });
}

export async function joinTowerTeamChallenge(input: unknown) {
  const parsed = attemptSchema.safeParse(input);
  if (!parsed.success) return { status: "INVALID" } as const;
  const { communityId, userId, attemptId } = parsed.data;
  const actor = { communityId, userId };
  return withTower(actor, async scopedDb => {
    await scopedDb.$queryRaw`SELECT id FROM "TowerChallengeAttempt" WHERE id = ${attemptId} AND "communityId" = ${communityId} FOR UPDATE`;
    const attempt = await scopedDb.towerChallengeAttempt.findFirst({
      where: { id: attemptId, communityId, teamId: { not: null }, status: "ASSIGNED", expiresAt: { gt: now() },
        team: { community: { communityTeamsEnabled: true }, members: { some: { userId, user: { memberships: { some: { communityId, status: "ACTIVE" } } } } } },
      }, select: { id: true, teamId: true },
    });
    if (!attempt?.teamId) return { status: "UNAVAILABLE" } as const;
    const created = await scopedDb.towerChallengeAttemptParticipant.createMany({
      data: [{ communityId, attemptId, userId }], skipDuplicates: true,
    });
    return { status: "JOINED" as const, teamId: attempt.teamId, replayed: created.count === 0 };
  });
}

async function assignDailyTowerTeamChallenges(deadline: Date) {
  const summary = { checked: 0, failed: 0 };
  const guildId = process.env.TOWER_DISCORD_GUILD_ID;
  if (process.env.TOWER_CHALLENGES_ENABLED !== "true" || !/^[0-9]{16,20}$/.test(guildId ?? "")
    || Date.now() >= deadline.getTime()) return summary;
  const teams = await prisma.$transaction(async tx => {
    const community = await tx.community.findFirst({
      where: { discordGuildId: guildId, status: "ACTIVE", towerChallengesEnabled: true, communityTeamsEnabled: true }, select: { id: true },
    });
    if (!community) return [];
    const scopedDb = scopedTransactionPrisma(tx, { communityIds: [community.id], includesDefault: false });
    return scopedDb.communityTeam.findMany({
      where: { communityId: community.id, community: { status: "ACTIVE", communityTeamsEnabled: true },
        members: { some: { user: { memberships: { some: { communityId: community.id, status: "ACTIVE" } } } } } },
      orderBy: { id: "asc" }, take: 100,
      select: { id: true, communityId: true, members: {
        where: { user: { memberships: { some: { communityId: community.id, status: "ACTIVE" } } } },
        orderBy: { joinedAt: "asc" }, take: 1, select: { userId: true },
      } },
    });
  }, { timeout: 5000, maxWait: 1000 });
  for (const team of teams) {
    if (Date.now() >= deadline.getTime()) break;
    const member = team.members[0];
    if (!member) continue;
    try {
      await getTeamDailyTowerChallenge({ communityId: team.communityId, userId: member.userId, teamId: team.id });
      summary.checked++;
    } catch (error) {
      summary.failed++;
      logger.error("tower:attribution-équipe", error, { communityId: team.communityId, teamId: team.id });
    }
  }
  return summary;
}

export async function submitTowerChallengeProof(input: unknown) {
  const parsed = proofSchema.safeParse(input);
  if (!parsed.success) return { status: "INVALID" } as const;
  const { communityId, userId, attemptId, proofText, proofChannelId, proofMessageId, publicationConsent } = parsed.data;
  return withTower({ communityId, userId }, async scopedDb => {
    await scopedDb.$queryRaw`SELECT id FROM "TowerChallengeAttempt" WHERE id = ${attemptId} AND "communityId" = ${communityId} FOR UPDATE`;
    const attempt = await scopedDb.towerChallengeAttempt.findFirst({ where: { id: attemptId, communityId } });
    if (!attempt) return { status: "UNAVAILABLE" } as const;
    if (attempt.teamId) {
      const participant = await scopedDb.towerChallengeAttemptParticipant.findUnique({ where: { attemptId_userId: { attemptId, userId } }, select: { userId: true } });
      if (!participant) return { status: "UNAVAILABLE" } as const;
    } else if (attempt.userId !== userId) return { status: "UNAVAILABLE" } as const;
    if (attempt.submittedAt) {
      if (attempt.proofText !== proofText || attempt.proofChannelId !== proofChannelId || attempt.proofMessageId !== proofMessageId) return { status: "CONFLICT" } as const;
      return { status: "SUBMITTED", replayed: true } as const;
    }
    if (attempt.status !== "ASSIGNED") return { status: "CLOSED" } as const;
    const submittedAt = now();
    if (!canSubmitChallengeProof(attempt.assignedAt, submittedAt) || submittedAt >= attempt.expiresAt) return { status: "EXPIRED" } as const;
    if (attempt.teamId && await scopedDb.towerChallengeAttemptParticipant.count({ where: { communityId, attemptId } }) < 2) {
      return { status: "TEAM_NEEDS_PARTICIPANTS" } as const;
    }
    await scopedDb.towerChallengeAttempt.update({ where: { id: attemptId }, data: {
      status: "SUBMITTED", submittedAt, proofText, proofChannelId, proofMessageId, publicationConsent,
    } });
    await enqueueTowerChallengeEvent(scopedDb, communityId, attemptId, "proof");
    return { status: "SUBMITTED", replayed: false } as const;
  });
}

export async function voteTowerChallenge(input: unknown) {
  const parsed = voteSchema.safeParse(input);
  if (!parsed.success) return { status: "INVALID" } as const;
  const { communityId, userId, attemptId, approve } = parsed.data;
  return withTower({ communityId, userId }, async scopedDb => {
    await scopedDb.$queryRaw`SELECT id FROM "TowerChallengeAttempt" WHERE id = ${attemptId} AND "communityId" = ${communityId} FOR UPDATE`;
    const attempt = await scopedDb.towerChallengeAttempt.findFirst({ where: { id: attemptId, communityId } });
    if (!attempt) return { status: "UNAVAILABLE" } as const;
    if (attempt.userId === userId) return { status: "SELF_VOTE" } as const;
    if (attempt.teamId && await scopedDb.towerChallengeAttemptParticipant.findUnique({
      where: { attemptId_userId: { attemptId, userId } }, select: { userId: true },
    })) return { status: "SELF_VOTE" } as const;
    const createdAt = now();
    if (attempt.status !== "SUBMITTED" || !attempt.submittedAt || createdAt < attempt.submittedAt
      || createdAt.getTime() >= attempt.submittedAt.getTime() + 24 * 3600000) return { status: "CLOSED" } as const;
    const existing = await scopedDb.towerChallengeVote.findUnique({ where: { attemptId_userId: { attemptId, userId } } });
    if (existing) return existing.approve === approve
      ? { status: "VOTED", replayed: true } as const : { status: "ALREADY_VOTED" } as const;
    await scopedDb.towerChallengeVote.create({ data: { communityId, userId, attemptId, approve, createdAt } });
    return { status: "VOTED", replayed: false } as const;
  });
}

async function awardTeamParticipant(scopedDb: Prisma.TransactionClient, input: { communityId: string; attemptId: string; userId: string }, current: Date) {
  const { communityId, attemptId, userId } = input;
  await scopedDb.$queryRaw`SELECT "attemptId" FROM "TowerChallengeAttemptParticipant" WHERE "communityId" = ${communityId} AND "attemptId" = ${attemptId} AND "userId" = ${userId} FOR UPDATE`;
  const participation = await scopedDb.towerChallengeAttemptParticipant.findUnique({
    where: { attemptId_userId: { attemptId, userId } }, select: { rewardedAt: true },
  });
  if (!participation || participation.rewardedAt) return false;
  const actor = { communityId, userId };
  const member = await scopedDb.membership.findUnique({ where: { communityId_userId: actor }, select: { status: true } });
  if (member?.status !== "ACTIVE") return false;
  await lockProgress(scopedDb, actor);
  if (!canReceiveChallengeReward(await rewardedTowerCompletions(scopedDb, actor, current), current)) return false;
  const attempt = await scopedDb.towerChallengeAttempt.findFirst({ where: { id: attemptId, communityId, status: "APPROVED", teamId: { not: null } }, select: { rewardFloors: true } });
  if (!attempt) return false;
  await scopedDb.towerChallengeProgress.update({ where: { communityId_userId: actor }, data: { floorsClimbed: { increment: BigInt(attempt.rewardFloors) } } });
  await scopedDb.towerChallengeAttemptParticipant.update({
    where: { attemptId_userId: { attemptId, userId } }, data: { rewardedAt: current },
  });
  return true;
}

export async function settleTowerChallenge(input: unknown) {
  const parsed = attemptSchema.safeParse(input);
  if (!parsed.success) return { status: "INVALID" } as const;
  const { communityId, userId, attemptId } = parsed.data;
  const actor = { communityId, userId };
  return withTower(actor, async scopedDb => {
    await scopedDb.$queryRaw`SELECT id FROM "TowerChallengeAttempt" WHERE id = ${attemptId} AND "communityId" = ${communityId} FOR UPDATE`;
    const attempt = await scopedDb.towerChallengeAttempt.findFirst({ where: { id: attemptId, communityId } });
    if (!attempt) return { status: "UNAVAILABLE" } as const;
    const participants = attempt.teamId
      ? await scopedDb.towerChallengeAttemptParticipant.findMany({ where: { communityId, attemptId }, orderBy: { userId: "asc" }, select: { userId: true } })
      : [];
    if (attempt.teamId ? !participants.some(participant => participant.userId === userId) : attempt.userId !== userId) return { status: "UNAVAILABLE" } as const;
    if (!attempt.teamId) await lockProgress(scopedDb, actor);
    if (attempt.status === "APPROVED") {
      if (!attempt.teamId) return { status: "APPROVED", rewardFloors: attempt.rewardFloors, replayed: true } as const;
      let rewardedMembers = 0;
      for (const participant of participants) if (await awardTeamParticipant(scopedDb, { communityId, attemptId, userId: participant.userId }, now())) rewardedMembers++;
      const pendingRewards = await scopedDb.towerChallengeAttemptParticipant.count({ where: { communityId, attemptId, rewardedAt: null } });
      const ownReward = await scopedDb.towerChallengeAttemptParticipant.findUnique({ where: { attemptId_userId: { attemptId, userId } }, select: { rewardedAt: true } });
      return { status: "APPROVED", rewardFloors: attempt.rewardFloors, rewardedMembers, pendingRewards, userRewarded: Boolean(ownReward?.rewardedAt), replayed: true } as const;
    }
    if (attempt.status === "REJECTED") return { status: "REJECTED" } as const;
    if (!attempt.submittedAt) return { status: "NO_PROOF" } as const;
    const current = now();
    const votes = await scopedDb.towerChallengeVote.findMany({ where: { attemptId, communityId, ...(participants.length ? { userId: { notIn: participants.map(participant => participant.userId) } } : {}) }, select: { userId: true, approve: true, createdAt: true } });
    const result = evaluateChallengeVote({ authorId: attempt.userId, openedAt: attempt.submittedAt, now: current,
      votes: votes.map(vote => ({ voterId: vote.userId, approve: vote.approve, votedAt: vote.createdAt })),
    });
    if (result.status === "OPEN") return result;
    if (result.status === "REJECTED") {
      await scopedDb.towerChallengeAttempt.update({ where: { id: attemptId }, data: { status: "REJECTED" } });
      return { status: "REJECTED" } as const;
    }
    if (!attempt.teamId) {
      if (!canReceiveChallengeReward(await rewardedTowerCompletions(scopedDb, actor, current), current)) return { status: "DAILY_LIMIT" } as const;
      await scopedDb.towerChallengeProgress.update({ where: { communityId_userId: actor }, data: { floorsClimbed: { increment: BigInt(attempt.rewardFloors) } } });
    }
    await scopedDb.towerChallengeAttempt.update({ where: { id: attemptId }, data: { status: "APPROVED", rewardedAt: current } });
    let rewardedMembers = 0;
    if (attempt.teamId) for (const participant of participants) {
      if (await awardTeamParticipant(scopedDb, { communityId, attemptId, userId: participant.userId }, current)) rewardedMembers++;
    }
    await enqueueTowerChallengeEvent(scopedDb, communityId, attemptId, "success");
    const pendingRewards = attempt.teamId
      ? await scopedDb.towerChallengeAttemptParticipant.count({ where: { communityId, attemptId, rewardedAt: null } }) : 0;
    const ownReward = attempt.teamId
      ? await scopedDb.towerChallengeAttemptParticipant.findUnique({ where: { attemptId_userId: { attemptId, userId } }, select: { rewardedAt: true } })
      : null;
    return { status: "APPROVED", rewardFloors: attempt.rewardFloors, rewardedMembers, pendingRewards,
      ...(attempt.teamId ? { userRewarded: Boolean(ownReward?.rewardedAt) } : {}), replayed: false } as const;
  });
}


// L'appelant est l'endpoint Discord après signature et validation du contexte serveur.
export async function resolveTowerDiscordActor(input: unknown): Promise<Actor | null> {
  const parsed = z.object({
    guildId: z.string().regex(/^[0-9]{16,20}$/),
    discordId: z.string().regex(/^[0-9]{16,20}$/),
    username: z.string().trim().min(1).max(100),
  }).safeParse(input);
  if (!parsed.success || process.env.TOWER_CHALLENGES_ENABLED !== "true") return null;
  const { guildId, discordId, username } = parsed.data;
  return prisma.$transaction(async tx => {
    const [community] = await tx.$queryRaw<{ id: string; status: string; towerChallengesEnabled: boolean }[]>`
      SELECT id, status, "towerChallengesEnabled" FROM "Community"
      WHERE "discordGuildId" = ${guildId} FOR SHARE
    `;
    if (community?.status !== "ACTIVE" || !community.towerChallengesEnabled) return null;
    const user = await tx.user.upsert({
      where: { discordId }, update: {},
      create: { discordId, discordName: username }, select: { id: true },
    });
    const actor = { communityId: community.id, userId: user.id };
    const member = await tx.membership.upsert({
      where: { communityId_userId: actor }, update: {},
      create: { ...actor, role: "MEMBER", status: "ACTIVE" }, select: { status: true },
    });
    return member.status === "ACTIVE" ? actor : null;
  }, { timeout: 15000, maxWait: 10000 });
}

export async function getTowerChallengeState(input: unknown) {
  const parsed = actorSchema.extend({ attemptId: id.optional() }).safeParse(input);
  if (!parsed.success) return { status: "INVALID" } as const;
  const { communityId, userId, attemptId } = parsed.data;
  return withTower({ communityId, userId }, async scopedDb => {
    const [progress, attempts] = await Promise.all([
      scopedDb.towerChallengeProgress.findUnique({ where: { communityId_userId: { communityId, userId } } }),
      scopedDb.towerChallengeAttempt.findMany({
        where: { communityId, userId, ...(attemptId ? { id: attemptId } : {}) },
        orderBy: [{ assignedAt: "desc" }, { id: "desc" }], take: 5,
        select: { id: true, title: true, instructions: true, status: true, rewardFloors: true,
          assignedAt: true, expiresAt: true, submittedAt: true, proofChannelId: true, proofMessageId: true },
      }),
    ]);
    return { status: "STATE", floor: ((progress?.floorsClimbed ?? BigInt(0)) + BigInt(1)).toString(), attempts } as const;
  });
}


// Même déclencheur que la file de notifications ; aucun nouveau service à héberger.
export async function settleDueTowerChallenges(deadline: Date) {
  const summary = { processed: 0, failed: 0 };
  const guildId = process.env.TOWER_DISCORD_GUILD_ID;
  if (process.env.TOWER_CHALLENGES_ENABLED !== "true" || !/^[0-9]{16,20}$/.test(guildId ?? "")
    || !Number.isFinite(deadline.getTime()) || Date.now() >= deadline.getTime()) return summary;
  const assignments = await assignDailyTowerTeamChallenges(deadline);
  summary.failed += assignments.failed;
  const current = now();
  const cutoff = new Date(current.getTime() - 24 * 3600000).toISOString();
  const candidates = await prisma.$transaction(async tx => {
    const community = await tx.community.findFirst({
      where: { discordGuildId: guildId, status: "ACTIVE", towerChallengesEnabled: true }, select: { id: true },
    });
    if (!community) return [];
    const scopedDb = scopedTransactionPrisma(tx, { communityIds: [community.id], includesDefault: false });
    return scopedDb.$queryRaw<{ id: string; userId: string; communityId: string }[]>`
      SELECT a.id, COALESCE(team_member."userId", a."userId") AS "userId", a."communityId" FROM "TowerChallengeAttempt" a
      LEFT JOIN "Membership" m ON m."communityId" = a."communityId" AND m."userId" = a."userId" AND m.status = 'ACTIVE'
      LEFT JOIN LATERAL (
        SELECT p."userId" FROM "TowerChallengeAttemptParticipant" p
        JOIN "Membership" pm ON pm."communityId" = p."communityId" AND pm."userId" = p."userId" AND pm.status = 'ACTIVE'
        WHERE p."attemptId" = a.id AND p."communityId" = a."communityId"
        ORDER BY p."userId" LIMIT 1
      ) team_member ON a."teamId" IS NOT NULL
      LEFT JOIN "TowerChallengeVote" v ON v."attemptId" = a.id AND v."communityId" = a."communityId"
        AND v."userId" <> a."userId" AND v."createdAt" >= a."submittedAt"
        AND v."createdAt" < a."submittedAt" + interval '24 hours'
        AND NOT EXISTS (SELECT 1 FROM "TowerChallengeAttemptParticipant" p WHERE p."attemptId" = a.id AND p."communityId" = a."communityId" AND p."userId" = v."userId")
      WHERE a."communityId" = ${community.id} AND a.status = 'SUBMITTED' AND a."submittedAt" <= ${cutoff}::timestamp
        AND ((a."teamId" IS NULL AND m.status = 'ACTIVE') OR (a."teamId" IS NOT NULL AND team_member."userId" IS NOT NULL))
      GROUP BY a.id, a."userId", a."communityId", a."teamId", a."submittedAt", team_member."userId"
      HAVING COUNT(v.id) >= 3 AND (
        COUNT(v.id) FILTER (WHERE v.approve) = COUNT(v.id) FILTER (WHERE NOT v.approve)
        OR COUNT(v.id) FILTER (WHERE NOT v.approve) * 2 > COUNT(v.id)
        OR a."teamId" IS NOT NULL
        OR (
          COUNT(v.id) FILTER (WHERE v.approve) * 2 > COUNT(v.id)
          AND (
            SELECT COUNT(*) FROM (
              SELECT r."rewardedAt" AS earned_at FROM "TowerChallengeAttempt" r
              WHERE r."communityId" = a."communityId" AND r."userId" = a."userId" AND r."teamId" IS NULL AND r."rewardedAt" IS NOT NULL
              UNION ALL
              SELECT p."rewardedAt" AS earned_at FROM "TowerChallengeAttemptParticipant" p
              WHERE p."communityId" = a."communityId" AND p."userId" = a."userId" AND p."rewardedAt" IS NOT NULL
            ) earned
            WHERE earned.earned_at <= ${current.toISOString()}::timestamp
              AND (earned.earned_at AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Paris')::date
                = (${current.toISOString()}::timestamptz AT TIME ZONE 'Europe/Paris')::date
          ) < 2
        )
      )
      ORDER BY a."submittedAt", a.id LIMIT 25
    `;
  }, { timeout: 5000, maxWait: 1000 });
  for (const candidate of candidates) {
    if (Date.now() >= deadline.getTime()) break;
    try {
      await settleTowerChallenge({ communityId: candidate.communityId, userId: candidate.userId, attemptId: candidate.id });
      summary.processed++;
    } catch (error) {
      summary.failed++;
      logger.error("tower:cloture", error, { attemptId: candidate.id, communityId: candidate.communityId });
    }
  }
  if (Date.now() < deadline.getTime()) {
    const pending = await prisma.$transaction(async tx => {
      const community = await tx.community.findFirst({
        where: { discordGuildId: guildId, status: "ACTIVE", towerChallengesEnabled: true, communityTeamsEnabled: true }, select: { id: true },
      });
      if (!community) return [];
      const scopedDb = scopedTransactionPrisma(tx, { communityIds: [community.id], includesDefault: false });
      return scopedDb.towerChallengeAttemptParticipant.findMany({
        where: {
          communityId: community.id, rewardedAt: null,
          attempt: { status: "APPROVED", teamId: { not: null } },
          user: { memberships: { some: { communityId: community.id, status: "ACTIVE" } } },
        },
        orderBy: [{ joinedAt: "asc" }, { userId: "asc" }], take: 25,
        select: { communityId: true, attemptId: true, userId: true },
      });
    }, { timeout: 5000, maxWait: 1000 });
    for (const participant of pending) {
      if (Date.now() >= deadline.getTime()) break;
      try {
        const result = await withTower({ communityId: participant.communityId, userId: participant.userId }, scopedDb =>
          awardTeamParticipant(scopedDb, participant, now()));
        if (result === true) summary.processed++;
      } catch (error) {
        summary.failed++;
        logger.error("tower:récompense-équipe", error, { attemptId: participant.attemptId, userId: participant.userId });
      }
    }
  }
  return summary;
}


const towerGuildId = z.string().regex(/^[0-9]{16,20}$/);
const towerDefinitionId = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const soloDefinitionInput = z.object({
  guildId: towerGuildId,
  title: z.string().trim().min(1).max(120),
  instructions: z.string().trim().min(1).max(1500),
  rewardFloors: z.number().int().min(1).max(20),
});

export async function addSoloTowerChallengeDefinition(input: unknown) {
  const parsed = soloDefinitionInput.safeParse(input);
  if (!parsed.success) return { status: "INVALID" } as const;
  const { guildId, title, instructions, rewardFloors } = parsed.data;
  return prisma.$transaction(async tx => {
    const community = await tx.community.findFirst({
      where: { discordGuildId: guildId, status: "ACTIVE" }, select: { id: true },
    });
    if (!community) return { status: "UNAVAILABLE" } as const;
    await tx.$queryRaw`SELECT id FROM "Community" WHERE id = ${community.id} FOR UPDATE`;
    const scopedDb = scopedTransactionPrisma(tx, { communityIds: [community.id], includesDefault: false });
    const duplicate = await scopedDb.towerChallengeDefinition.findFirst({
      where: { communityId: community.id, mode: "SOLO", active: true, title: { equals: title, mode: "insensitive" } },
      select: { id: true },
    });
    if (duplicate) return { status: "DUPLICATE" } as const;
    const definition = await scopedDb.towerChallengeDefinition.create({
      data: { communityId: community.id, mode: "SOLO", title, instructions, rewardFloors, active: true },
      select: { id: true },
    });
    return { status: "CREATED", id: definition.id } as const;
  });
}

export async function listSoloTowerChallengeDefinitions(input: unknown) {
  const parsed = z.object({ guildId: towerGuildId, page: z.number().int().min(1).max(10000).optional() }).safeParse(input);
  if (!parsed.success) return { status: "INVALID" } as const;
  const page = parsed.data.page ?? 1;
  return prisma.$transaction(async tx => {
    const community = await tx.community.findFirst({
      where: { discordGuildId: parsed.data.guildId, status: "ACTIVE" }, select: { id: true },
    });
    if (!community) return { status: "UNAVAILABLE" } as const;
    const scopedDb = scopedTransactionPrisma(tx, { communityIds: [community.id], includesDefault: false });
    const where = { communityId: community.id, mode: "SOLO" as const };
    const [definitions, total] = await Promise.all([
      scopedDb.towerChallengeDefinition.findMany({
        where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * 12, take: 12,
        select: { id: true, title: true, rewardFloors: true, active: true },
      }),
      scopedDb.towerChallengeDefinition.count({ where }),
    ]);
    return { status: "LISTED", definitions, page, total } as const;
  });
}

export async function deactivateSoloTowerChallengeDefinition(input: unknown) {
  const parsed = z.object({ guildId: towerGuildId, definitionId: towerDefinitionId }).safeParse(input);
  if (!parsed.success) return { status: "INVALID" } as const;
  return prisma.$transaction(async tx => {
    const community = await tx.community.findFirst({
      where: { discordGuildId: parsed.data.guildId, status: "ACTIVE" }, select: { id: true },
    });
    if (!community) return { status: "UNAVAILABLE" } as const;
    const scopedDb = scopedTransactionPrisma(tx, { communityIds: [community.id], includesDefault: false });
    const definition = await scopedDb.towerChallengeDefinition.findFirst({
      where: { id: parsed.data.definitionId, communityId: community.id, mode: "SOLO" },
      select: { id: true, active: true },
    });
    if (!definition) return { status: "NOT_FOUND" } as const;
    if (!definition.active) return { status: "ALREADY_INACTIVE" } as const;
    await scopedDb.towerChallengeDefinition.update({
      where: { id: definition.id }, data: { active: false },
    });
    return { status: "DEACTIVATED" } as const;
  });
}

export async function importSoloTowerChallengeStarterPack(input: unknown) {
  const parsed = z.object({ guildId: towerGuildId }).safeParse(input);
  if (!parsed.success) return { status: "INVALID" } as const;
  return prisma.$transaction(async tx => {
    const community = await tx.community.findFirst({
      where: { discordGuildId: parsed.data.guildId, status: "ACTIVE" }, select: { id: true },
    });
    if (!community) return { status: "UNAVAILABLE" } as const;
    await tx.$queryRaw`SELECT id FROM "Community" WHERE id = ${community.id} FOR UPDATE`;
    const scopedDb = scopedTransactionPrisma(tx, { communityIds: [community.id], includesDefault: false });
    const existing = await scopedDb.towerChallengeDefinition.findMany({
      where: { communityId: community.id, mode: "SOLO" }, select: { title: true },
    });
    const titles = new Set(existing.map(definition => definition.title.toLowerCase()));
    const missing = TOWER_STARTER_CHALLENGES.filter(challenge => !titles.has(challenge.title.toLowerCase()));
    if (missing.length) await scopedDb.towerChallengeDefinition.createMany({
      data: missing.map(challenge => ({ ...challenge, communityId: community.id, mode: "SOLO" as const, active: true })),
    });
    return { status: "IMPORTED", added: missing.length, alreadyPresent: TOWER_STARTER_CHALLENGES.length - missing.length } as const;
  });
}

export async function importTeamTowerChallengeStarterPack(input: unknown) {
  const parsed = z.object({ guildId: towerGuildId }).safeParse(input);
  if (!parsed.success) return { status: "INVALID" } as const;
  return prisma.$transaction(async tx => {
    const community = await tx.community.findFirst({
      where: { discordGuildId: parsed.data.guildId, status: "ACTIVE", communityTeamsEnabled: true }, select: { id: true },
    });
    if (!community) return { status: "UNAVAILABLE" } as const;
    await tx.$queryRaw`SELECT id FROM "Community" WHERE id = ${community.id} FOR UPDATE`;
    const scopedDb = scopedTransactionPrisma(tx, { communityIds: [community.id], includesDefault: false });
    const existing = await scopedDb.towerChallengeDefinition.findMany({
      where: { communityId: community.id, mode: "TEAM" }, select: { title: true },
    });
    const titles = new Set(existing.map(definition => definition.title.toLowerCase()));
    const missing = TOWER_TEAM_STARTER_CHALLENGES.filter(challenge => !titles.has(challenge.title.toLowerCase()));
    if (missing.length) await scopedDb.towerChallengeDefinition.createMany({
      data: missing.map(challenge => ({ ...challenge, communityId: community.id, mode: "TEAM" as const, active: true })),
    });
    return { status: "IMPORTED", added: missing.length, alreadyPresent: TOWER_TEAM_STARTER_CHALLENGES.length - missing.length } as const;
  });
}


export async function getTowerSeasonLeaderboard(input: unknown) {
  const parsed = actorSchema.safeParse(input);
  if (!parsed.success) return { status: "INVALID" } as const;
  const actor = parsed.data;
  const season = getTowerSchoolSeason(now());
  return withTower(actor, async scopedDb => {
    const totals = await towerSeasonTotals(scopedDb, actor.communityId, season);
    const users = await scopedDb.user.findMany({
      where: { id: { in: totals.map(row => row.userId) } },
      select: { id: true, discordId: true },
    });
    const discordIds = new Map(users.map(user => [user.id, user.discordId]));
    return {
      status: "LEADERBOARD",
      season,
      entries: totals.flatMap(row => {
        const discordId = discordIds.get(row.userId);
        return discordId ? [{ discordId, rewardFloors: row.rewardFloors }] : [];
      }),
    } as const;
  });
}

async function towerSeasonTotals(scopedDb: Prisma.TransactionClient, communityId: string, season: { startAt: Date; endAt: Date }) {
  const rows = await scopedDb.$queryRaw<{ userId: string; rewardFloors: bigint }[]>`
    WITH earned AS (
      SELECT a."userId", a."rewardFloors"
      FROM "TowerChallengeAttempt" a
      WHERE a."communityId" = ${communityId} AND a."teamId" IS NULL AND a.status = 'APPROVED'
        AND a."rewardedAt" >= ${season.startAt} AND a."rewardedAt" < ${season.endAt}
      UNION ALL
      SELECT p."userId", a."rewardFloors"
      FROM "TowerChallengeAttemptParticipant" p
      JOIN "TowerChallengeAttempt" a ON a.id = p."attemptId" AND a."communityId" = p."communityId"
      WHERE p."communityId" = ${communityId} AND a.status = 'APPROVED'
        AND p."rewardedAt" >= ${season.startAt} AND p."rewardedAt" < ${season.endAt}
    )
    SELECT e."userId", SUM(e."rewardFloors")::bigint AS "rewardFloors"
    FROM earned e
    JOIN "Membership" m ON m."userId" = e."userId" AND m."communityId" = ${communityId} AND m.status = 'ACTIVE'
    GROUP BY e."userId"
    ORDER BY "rewardFloors" DESC, e."userId" ASC
    LIMIT 10
  `;
  return rows.map(row => ({ userId: row.userId, rewardFloors: Number(row.rewardFloors) }));
}


const seasonBallotSchema = actorSchema.extend({ voteId: id, candidateUserId: id });

export async function getTowerSeasonVote(input: unknown) {
  const parsed = actorSchema.safeParse(input);
  if (!parsed.success) return { status: "INVALID" } as const;
  const actor = parsed.data;
  const currentSeason = getTowerSchoolSeason(now());
  const season = currentSeason.active
    ? { ...getTowerSchoolSeason(new Date(currentSeason.startAt.getTime() - 1)), active: false }
    : currentSeason;
  return withTower(actor, async scopedDb => {
    const totals = await towerSeasonTotals(scopedDb, actor.communityId, season);
    if (totals.length < 2) return { status: "NO_FINALISTS", season } as const;
    const openedAt = now();
    const closesAt = new Date(openedAt.getTime() + 48 * 3600000);
    await scopedDb.towerSeasonVote.createMany({
      data: [{
        communityId: actor.communityId, seasonName: season.name, seasonStartAt: season.startAt,
        seasonEndAt: season.endAt, opensAt: openedAt, closesAt,
        candidateUserIds: totals.map(row => row.userId),
      }],
      skipDuplicates: true,
    });
    const vote = await scopedDb.towerSeasonVote.findUniqueOrThrow({
      where: { communityId_seasonStartAt: { communityId: actor.communityId, seasonStartAt: season.startAt } },
    });
    const [users, ballots, mine] = await Promise.all([
      scopedDb.user.findMany({ where: { id: { in: vote.candidateUserIds } }, select: { id: true, discordId: true, discordName: true } }),
      now() >= vote.closesAt
        ? scopedDb.towerSeasonVoteBallot.groupBy({ by: ["candidateUserId"], where: { communityId: actor.communityId, voteId: vote.id }, _count: { _all: true } })
        : Promise.resolve([]),
      scopedDb.towerSeasonVoteBallot.findUnique({ where: { voteId_voterUserId: { voteId: vote.id, voterUserId: actor.userId } }, select: { candidateUserId: true } }),
    ]);
    const userById = new Map(users.map(user => [user.id, user]));
    const floorsById = new Map(totals.map(row => [row.userId, row.rewardFloors]));
    const votesByCandidate = new Map(ballots.map(row => [row.candidateUserId, row._count._all]));
    const candidates = vote.candidateUserIds.flatMap(userId => {
      const user = userById.get(userId);
      return user?.discordId ? [{
        userId, discordId: user.discordId, displayName: user.discordName,
        rewardFloors: floorsById.get(userId) ?? 0, votes: votesByCandidate.get(userId) ?? 0,
      }] : [];
    });
    return {
      status: now() < vote.closesAt ? "VOTE_OPEN" : "VOTE_CLOSED",
      voteId: vote.id, season, closesAt: vote.closesAt, candidates,
      myCandidateUserId: mine?.candidateUserId ?? null,
    } as const;
  });
}

export async function castTowerSeasonVote(input: unknown) {
  const parsed = seasonBallotSchema.safeParse(input);
  if (!parsed.success) return { status: "INVALID" } as const;
  const { communityId, userId, voteId, candidateUserId } = parsed.data;
  return withTower({ communityId, userId }, async scopedDb => {
    const vote = await scopedDb.towerSeasonVote.findFirst({ where: { id: voteId, communityId } });
    if (!vote) return { status: "UNAVAILABLE" } as const;
    const current = now();
    if (current < vote.opensAt) return { status: "SEASON_VOTE_NOT_OPEN" } as const;
    if (current >= vote.closesAt) return { status: "SEASON_VOTE_CLOSED" } as const;
    if (!vote.candidateUserIds.includes(candidateUserId)) return { status: "INVALID" } as const;
    if (candidateUserId === userId) return { status: "SEASON_VOTE_SELF" } as const;
    const ballot = await scopedDb.towerSeasonVoteBallot.createMany({
      data: [{ communityId, voteId, voterUserId: userId, candidateUserId }], skipDuplicates: true,
    });
    return { status: ballot.count ? "SEASON_VOTE_SAVED" : "SEASON_VOTE_ALREADY_CAST" } as const;
  });
}
