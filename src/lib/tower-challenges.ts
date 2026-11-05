import "server-only";
import { randomInt, randomUUID } from "node:crypto";
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
import { createTowerChallengeProofCode, proofTextIncludesTowerCode } from "@/lib/tower-challenge-proof-rules";
import { getPendingProofAgingAction } from "@/lib/tower-challenge-aging-rules";
import { canReviewTowerChallengeAppeal, isTowerChallengeAppealWindowOpen, TOWER_CHALLENGE_APPEAL_WINDOW_MS } from "@/lib/tower-challenge-appeal-rules";

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
const appealSchema = attemptSchema.extend({ reason: z.string().trim().min(1).max(1500) });
const appealDecisionSchema = z.object({
  communityId: id, userId: id, appealId: id,
  decision: z.enum(["UPHELD", "OVERTURNED"]), decisionReason: z.string().trim().min(1).max(1500),
});
const appealArbiterSchema = z.object({ communityId: id, userId: id, appealId: id, arbiterUserId: id });
type Actor = z.infer<typeof actorSchema>;
const now = () => new Date(Date.now());

type ChallengeMeta = {
  id: string;
  proofCode: string | null;
  rejectedAt: Date | null;
  staffReportedAt: Date | null;
  archivedAt: Date | null;
  appealStatus: string | null;
};

async function loadChallengeMeta(scopedDb: Prisma.TransactionClient, communityId: string, attemptId: string): Promise<ChallengeMeta> {
  const [row] = await scopedDb.$queryRaw<ChallengeMeta[]>`
    WITH generated AS (
      UPDATE "TowerChallengeAttempt" SET "proofCode" = COALESCE("proofCode", ${createTowerChallengeProofCode()})
      WHERE id = ${attemptId} AND "communityId" = ${communityId} AND status IN ('ASSIGNED', 'SUBMITTED')
        AND "proofCode" IS NULL
      RETURNING id, "proofCode"
    )
    SELECT a.id, COALESCE(generated."proofCode", a."proofCode") AS "proofCode",
      a."rejectedAt", a."staffReportedAt", a."archivedAt", appeal.status AS "appealStatus"
    FROM "TowerChallengeAttempt" a
    LEFT JOIN generated ON generated.id = a.id
    LEFT JOIN "TowerChallengeAppeal" appeal ON appeal."communityId" = a."communityId" AND appeal."attemptId" = a.id
    WHERE a.id = ${attemptId} AND a."communityId" = ${communityId}
  `;
  if (!row) throw new Error("Tentative Tower introuvable dans sa communauté");
  return row;
}

async function reportAndArchiveUnquorateProofs(scopedDb: Prisma.TransactionClient, communityId: string, current: Date) {
  const candidates = await scopedDb.$queryRaw<{
    id: string;
    status: string;
    submittedAt: Date;
    qualifyingVoteCount: bigint;
    staffReportedAt: Date | null;
    archivedAt: Date | null;
    hasOpenAppeal: boolean;
  }[]>`
    SELECT a.id, a.status, a."submittedAt", a."staffReportedAt", a."archivedAt",
      (SELECT COUNT(*) FROM "TowerChallengeVote" v
        WHERE v."communityId" = a."communityId" AND v."attemptId" = a.id
          AND v."userId" <> a."userId" AND v."createdAt" >= a."submittedAt"
          AND v."createdAt" < a."submittedAt" + interval '24 hours'
          AND NOT EXISTS (SELECT 1 FROM "TowerChallengeAttemptParticipant" p
            WHERE p."communityId" = a."communityId" AND p."attemptId" = a.id AND p."userId" = v."userId")) AS "qualifyingVoteCount",
      EXISTS (SELECT 1 FROM "TowerChallengeAppeal" appeal
        WHERE appeal."communityId" = a."communityId" AND appeal."attemptId" = a.id AND appeal.status = 'OPEN') AS "hasOpenAppeal"
    FROM "TowerChallengeAttempt" a
    WHERE a."communityId" = ${communityId} AND a.status = 'SUBMITTED'
      AND a."submittedAt" <= ${new Date(current.getTime() - TOWER_CHALLENGE_APPEAL_WINDOW_MS)}
      AND a."archivedAt" IS NULL
      AND (a."staffReportedAt" IS NULL OR a."submittedAt" <= ${new Date(current.getTime() - 30 * 24 * 3600000)})
      AND NOT EXISTS (SELECT 1 FROM "TowerChallengeAppeal" appeal
        WHERE appeal."communityId" = a."communityId" AND appeal."attemptId" = a.id AND appeal.status = 'OPEN')
      AND (SELECT COUNT(*) FROM "TowerChallengeVote" v
        WHERE v."communityId" = a."communityId" AND v."attemptId" = a.id
          AND v."userId" <> a."userId" AND v."createdAt" >= a."submittedAt"
          AND v."createdAt" < a."submittedAt" + interval '24 hours'
          AND NOT EXISTS (SELECT 1 FROM "TowerChallengeAttemptParticipant" p
            WHERE p."communityId" = a."communityId" AND p."attemptId" = a.id AND p."userId" = v."userId")) < 3
    ORDER BY a."submittedAt", a.id LIMIT 25 FOR UPDATE OF a SKIP LOCKED
  `;
  let reported = 0;
  let archived = 0;
  for (const candidate of candidates) {
    const action = getPendingProofAgingAction({
      status: candidate.status,
      submittedAt: candidate.submittedAt,
      now: current,
      qualifyingVoteCount: Number(candidate.qualifyingVoteCount),
      staffReportedAt: candidate.staffReportedAt,
      archivedAt: candidate.archivedAt,
      hasOpenAppeal: candidate.hasOpenAppeal,
    });
    if (action === "REPORT_STAFF") {
      const updated = await scopedDb.$executeRaw`
        UPDATE "TowerChallengeAttempt" SET "staffReportedAt" = ${current}
        WHERE id = ${candidate.id} AND "communityId" = ${communityId}
          AND status = 'SUBMITTED' AND "staffReportedAt" IS NULL AND "archivedAt" IS NULL
      `;
      if (updated) reported++;
    } else if (action === "ARCHIVE") {
      const updated = await scopedDb.$executeRaw`
        UPDATE "TowerChallengeAttempt" SET "archivedAt" = ${current}
        WHERE id = ${candidate.id} AND "communityId" = ${communityId}
          AND status = 'SUBMITTED' AND "staffReportedAt" IS NOT NULL AND "archivedAt" IS NULL
      `;
      if (updated) archived++;
    }
  }
  return { reported, archived };
}

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
    if (existing) {
      await loadChallengeMeta(scopedDb, communityId, existing.id);
      return { status: "CLAIMED", attemptId: existing.id, replayed: true } as const;
    }
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
    await loadChallengeMeta(scopedDb, communityId, attempt.id);
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
      select: { id: true, userId: true, title: true, instructions: true, rewardFloors: true, status: true, assignedAt: true, expiresAt: true, submittedAt: true },
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
        select: { id: true, userId: true, title: true, instructions: true, rewardFloors: true, status: true, assignedAt: true, expiresAt: true, submittedAt: true },
      });
      attempt = result;
    }
    const metadata = await loadChallengeMeta(scopedDb, communityId, attempt.id);
    const [participation, participants] = await Promise.all([
      scopedDb.towerChallengeAttemptParticipant.findUnique({
        where: { attemptId_userId: { attemptId: attempt.id, userId } }, select: { rewardedAt: true },
      }),
      scopedDb.towerChallengeAttemptParticipant.count({ where: { communityId, attemptId: attempt.id } }),
    ]);
    return {
      status: "TEAM_CHALLENGE" as const, team: { id: team.id, name: team.name, memberCount: team.members.length },
      attempt: { ...attempt, ...metadata }, participantCount: participants, joined: Boolean(participation),
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
          select: { id: true, userId: true, title: true, instructions: true, status: true, rewardFloors: true, expiresAt: true,
            participants: { select: { userId: true, rewardedAt: true } } },
        },
      },
      orderBy: { name: "asc" }, take: 25,
    });
    const metadata = await Promise.all(teams.flatMap(team => team.towerChallengeAttempts.map(attempt => loadChallengeMeta(scopedDb, actor.communityId, attempt.id))));
    const metadataById = new Map(metadata.map(row => [row.id, row]));
    return { status: "TEAM_STATES" as const, teams: teams.map(team => ({
      id: team.id, name: team.name, memberCount: team.members.length,
      attempt: team.towerChallengeAttempts[0] ? {
        ...team.towerChallengeAttempts[0], ...metadataById.get(team.towerChallengeAttempts[0].id),
        participantCount: team.towerChallengeAttempts[0].participants.length,
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
    const metadata = await loadChallengeMeta(scopedDb, communityId, attemptId);
    if (!metadata.proofCode) return { status: "PROOF_CODE_UNAVAILABLE" } as const;
    if (!proofTextIncludesTowerCode(proofText, metadata.proofCode)) return { status: "PROOF_CODE_REQUIRED" } as const;
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
    const metadata = await loadChallengeMeta(scopedDb, communityId, attemptId);
    if (metadata.archivedAt) return { status: "ARCHIVED" } as const;
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

export async function submitTowerChallengeAppeal(input: unknown) {
  const parsed = appealSchema.safeParse(input);
  if (!parsed.success) return { status: "INVALID" } as const;
  const { communityId, userId, attemptId, reason } = parsed.data;
  return withTower({ communityId, userId }, async scopedDb => {
    const [attempt] = await scopedDb.$queryRaw<{
      id: string; userId: string; status: string; rejectedAt: Date | null; archivedAt: Date | null;
    }[]>`
      SELECT id, "userId", status, "rejectedAt", "archivedAt" FROM "TowerChallengeAttempt"
      WHERE id = ${attemptId} AND "communityId" = ${communityId} FOR UPDATE
    `;
    if (!attempt || attempt.userId !== userId) return { status: "UNAVAILABLE" } as const;
    if (attempt.status !== "REJECTED" || attempt.archivedAt) return { status: "CLOSED" } as const;
    const current = now();
    if (!attempt.rejectedAt || !isTowerChallengeAppealWindowOpen(attempt.rejectedAt, current)) return { status: "WINDOW_CLOSED" } as const;
    const id = randomUUID();
    const created = await scopedDb.$queryRaw<{ id: string }[]>`
      INSERT INTO "TowerChallengeAppeal" (
        id, "communityId", "attemptId", "authorUserId", reason, "createdAt", "dueAt", status
      ) VALUES (
        ${id}, ${communityId}, ${attemptId}, ${userId}, ${reason}, ${current},
        ${new Date(attempt.rejectedAt.getTime() + TOWER_CHALLENGE_APPEAL_WINDOW_MS)}, 'OPEN'
      ) ON CONFLICT ("communityId", "attemptId") DO NOTHING
      RETURNING id
    `;
    return created.length ? { status: "APPEAL_SUBMITTED" } as const : { status: "ALREADY_APPEALED" } as const;
  });
}

export async function getTowerChallengeStaffQueue(input: unknown) {
  const parsed = actorSchema.safeParse(input);
  if (!parsed.success) return { status: "INVALID" } as const;
  const { communityId, userId } = parsed.data;
  return withTower({ communityId, userId }, async scopedDb => {
    const [membership] = await scopedDb.$queryRaw<{ role: string }[]>`
      SELECT role FROM "Membership" WHERE "communityId" = ${communityId} AND "userId" = ${userId} AND status = 'ACTIVE'
    `;
    const isStaff = membership?.role === "ADMIN" || membership?.role === "OWNER";
    const proofs = isStaff ? await scopedDb.$queryRaw<{
      id: string; title: string; userId: string; discordName: string; teamId: string | null; teamName: string | null;
      proofText: string | null; proofChannelId: string | null; proofMessageId: string | null;
      submittedAt: Date; staffReportedAt: Date; archivedAt: Date | null;
    }[]>`
      SELECT a.id, a.title, a."userId", u."discordName", a."teamId", t.name AS "teamName",
        a."proofText", a."proofChannelId", a."proofMessageId", a."submittedAt", a."staffReportedAt", a."archivedAt"
      FROM "TowerChallengeAttempt" a
      JOIN "User" u ON u.id = a."userId"
      LEFT JOIN "CommunityTeam" t ON t.id = a."teamId" AND t."communityId" = a."communityId"
      WHERE a."communityId" = ${communityId} AND a.status = 'SUBMITTED' AND a."staffReportedAt" IS NOT NULL
      ORDER BY a."archivedAt" NULLS FIRST, a."staffReportedAt", a.id LIMIT 50
    ` : [];
    const appeals = await scopedDb.$queryRaw<{
      id: string; attemptId: string; authorUserId: string; authorName: string; reason: string; createdAt: Date;
      dueAt: Date; arbiterUserId: string | null; title: string; proofText: string | null;
      proofChannelId: string | null; proofMessageId: string | null; authorRole: string;
    }[]>`
      SELECT appeal.id, appeal."attemptId", appeal."authorUserId", author."discordName" AS "authorName",
        appeal.reason, appeal."createdAt", appeal."dueAt", appeal."arbiterUserId", a.title,
        a."proofText", a."proofChannelId", a."proofMessageId", COALESCE(author_membership.role, 'MEMBER') AS "authorRole"
      FROM "TowerChallengeAppeal" appeal
      JOIN "TowerChallengeAttempt" a ON a.id = appeal."attemptId" AND a."communityId" = appeal."communityId"
      JOIN "User" author ON author.id = appeal."authorUserId"
      LEFT JOIN "Membership" author_membership ON author_membership."communityId" = appeal."communityId"
        AND author_membership."userId" = appeal."authorUserId" AND author_membership.status = 'ACTIVE'
      WHERE appeal."communityId" = ${communityId} AND appeal.status = 'OPEN'
        AND (
          appeal."arbiterUserId" = ${userId}
          OR (
            ${isStaff} AND appeal."authorUserId" <> ${userId}
            AND COALESCE(author_membership.role, 'MEMBER') NOT IN ('ADMIN', 'OWNER')
            AND NOT EXISTS (SELECT 1 FROM "TowerChallengeAttemptParticipant" p
              WHERE p."communityId" = appeal."communityId" AND p."attemptId" = appeal."attemptId" AND p."userId" = ${userId})
            AND NOT EXISTS (SELECT 1 FROM "TowerChallengeVote" v
              WHERE v."communityId" = appeal."communityId" AND v."attemptId" = appeal."attemptId" AND v."userId" = ${userId})
          )
          OR (
            ${membership?.role === "OWNER"}
            AND COALESCE(author_membership.role, 'MEMBER') IN ('ADMIN', 'OWNER')
          )
        )
      ORDER BY appeal."createdAt", appeal.id LIMIT 50
    `;
    if (!isStaff && appeals.length === 0) return { status: "FORBIDDEN" } as const;
    return { status: "STAFF_QUEUE" as const, isStaff, viewerRole: membership?.role ?? "MEMBER", proofs, appeals };
  });
}

export async function getTowerChallengeArbiterCandidates(input: unknown) {
  const parsed = z.object({ communityId: id, userId: id, appealId: id }).safeParse(input);
  if (!parsed.success) return { status: "INVALID" } as const;
  const { communityId, userId, appealId } = parsed.data;
  return withTower({ communityId, userId }, async scopedDb => {
    const [owner] = await scopedDb.$queryRaw<{ role: string }[]>`
      SELECT role FROM "Membership" WHERE "communityId" = ${communityId} AND "userId" = ${userId} AND status = 'ACTIVE'
    `;
    if (owner?.role !== "OWNER") return { status: "FORBIDDEN" } as const;
    const [appeal] = await scopedDb.$queryRaw<{ attemptId: string; authorUserId: string; authorRole: string; status: string }[]>`
      SELECT appeal."attemptId", appeal."authorUserId", COALESCE(author_membership.role, 'MEMBER') AS "authorRole", appeal.status
      FROM "TowerChallengeAppeal" appeal
      LEFT JOIN "Membership" author_membership ON author_membership."communityId" = appeal."communityId"
        AND author_membership."userId" = appeal."authorUserId" AND author_membership.status = 'ACTIVE'
      WHERE appeal.id = ${appealId} AND appeal."communityId" = ${communityId}
    `;
    if (!appeal || appeal.status !== "OPEN" || !["ADMIN", "OWNER"].includes(appeal.authorRole)) return { status: "UNAVAILABLE" } as const;
    const candidates = await scopedDb.$queryRaw<{ userId: string; discordName: string }[]>`
      SELECT m."userId", u."discordName" FROM "Membership" m JOIN "User" u ON u.id = m."userId"
      WHERE m."communityId" = ${communityId} AND m.status = 'ACTIVE' AND m.role = 'MEMBER'
        AND m."userId" <> ${appeal.authorUserId}
        AND NOT EXISTS (SELECT 1 FROM "TowerChallengeAttemptParticipant" p
          WHERE p."communityId" = ${communityId} AND p."attemptId" = ${appeal.attemptId} AND p."userId" = m."userId")
        AND NOT EXISTS (SELECT 1 FROM "TowerChallengeVote" v
          WHERE v."communityId" = ${communityId} AND v."attemptId" = ${appeal.attemptId} AND v."userId" = m."userId")
      ORDER BY u."discordName", m."userId" LIMIT 100
    `;
    return { status: "CANDIDATES" as const, candidates };
  });
}

export async function appointTowerChallengeArbiter(input: unknown) {
  const parsed = appealArbiterSchema.safeParse(input);
  if (!parsed.success) return { status: "INVALID" } as const;
  const { communityId, userId, appealId, arbiterUserId } = parsed.data;
  return withTower({ communityId, userId }, async scopedDb => {
    const [owner] = await scopedDb.$queryRaw<{ role: string }[]>`
      SELECT role FROM "Membership" WHERE "communityId" = ${communityId} AND "userId" = ${userId} AND status = 'ACTIVE' FOR SHARE
    `;
    if (owner?.role !== "OWNER") return { status: "FORBIDDEN" } as const;
    const [appeal] = await scopedDb.$queryRaw<{ attemptId: string; authorUserId: string; arbiterUserId: string | null; status: string }[]>`
      SELECT "attemptId", "authorUserId", "arbiterUserId", status FROM "TowerChallengeAppeal"
      WHERE id = ${appealId} AND "communityId" = ${communityId} FOR UPDATE
    `;
    if (!appeal || appeal.status !== "OPEN") return { status: "UNAVAILABLE" } as const;
    if (appeal.arbiterUserId) return { status: "ARBITER_ALREADY_SET" } as const;
    const [candidate] = await scopedDb.$queryRaw<{ role: string }[]>`
      SELECT role FROM "Membership" WHERE "communityId" = ${communityId} AND "userId" = ${arbiterUserId} AND status = 'ACTIVE'
    `;
    if (candidate?.role !== "MEMBER" || arbiterUserId === appeal.authorUserId) return { status: "ARBITER_INELIGIBLE" } as const;
    const [involved] = await scopedDb.$queryRaw<{ participant: boolean; voted: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM "TowerChallengeAttemptParticipant" p
        WHERE p."communityId" = ${communityId} AND p."attemptId" = ${appeal.attemptId} AND p."userId" = ${arbiterUserId}) AS participant,
        EXISTS (SELECT 1 FROM "TowerChallengeVote" v
        WHERE v."communityId" = ${communityId} AND v."attemptId" = ${appeal.attemptId} AND v."userId" = ${arbiterUserId}) AS voted
    `;
    if (involved?.participant || involved?.voted) return { status: "ARBITER_INELIGIBLE" } as const;
    await scopedDb.$executeRaw`
      UPDATE "TowerChallengeAppeal" SET "arbiterUserId" = ${arbiterUserId}
      WHERE id = ${appealId} AND "communityId" = ${communityId} AND status = 'OPEN' AND "arbiterUserId" IS NULL
    `;
    return { status: "ARBITER_ASSIGNED" } as const;
  });
}

export async function decideTowerChallengeAppeal(input: unknown) {
  const parsed = appealDecisionSchema.safeParse(input);
  if (!parsed.success) return { status: "INVALID" } as const;
  const { communityId, userId, appealId, decision, decisionReason } = parsed.data;
  return withTower({ communityId, userId }, async scopedDb => {
    const [appeal] = await scopedDb.$queryRaw<{
      id: string; attemptId: string; authorUserId: string; arbiterUserId: string | null; status: string; authorRole: string;
    }[]>`
      SELECT appeal.id, appeal."attemptId", appeal."authorUserId", appeal."arbiterUserId", appeal.status,
        COALESCE(author_membership.role, 'MEMBER') AS "authorRole"
      FROM "TowerChallengeAppeal" appeal
      LEFT JOIN "Membership" author_membership ON author_membership."communityId" = appeal."communityId"
        AND author_membership."userId" = appeal."authorUserId" AND author_membership.status = 'ACTIVE'
      WHERE appeal.id = ${appealId} AND appeal."communityId" = ${communityId} FOR UPDATE OF appeal
    `;
    if (!appeal) return { status: "UNAVAILABLE" } as const;
    if (appeal.status !== "OPEN") return { status: "ALREADY_DECIDED" } as const;
    const [attempt] = await scopedDb.$queryRaw<{
      id: string; userId: string; teamId: string | null; status: string; rewardFloors: number;
      rewardedAt: Date | null; archivedAt: Date | null;
    }[]>`
      SELECT id, "userId", "teamId", status, "rewardFloors", "rewardedAt", "archivedAt"
      FROM "TowerChallengeAttempt" WHERE id = ${appeal.attemptId} AND "communityId" = ${communityId} FOR UPDATE
    `;
    if (!attempt || attempt.userId !== appeal.authorUserId) return { status: "UNAVAILABLE" } as const;
    const [reviewer] = await scopedDb.$queryRaw<{ role: string }[]>`
      SELECT role FROM "Membership" WHERE "communityId" = ${communityId} AND "userId" = ${userId} AND status = 'ACTIVE'
    `;
    if (!reviewer) return { status: "FORBIDDEN" } as const;
    const [involvement] = await scopedDb.$queryRaw<{ participant: boolean; voted: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM "TowerChallengeAttemptParticipant" p
        WHERE p."communityId" = ${communityId} AND p."attemptId" = ${attempt.id} AND p."userId" = ${userId}) AS participant,
        EXISTS (SELECT 1 FROM "TowerChallengeVote" v
        WHERE v."communityId" = ${communityId} AND v."attemptId" = ${attempt.id} AND v."userId" = ${userId}) AS voted
    `;
    if (!canReviewTowerChallengeAppeal({
      reviewerId: userId,
      reviewerRole: reviewer.role as "MEMBER" | "ADMIN" | "OWNER",
      authorId: appeal.authorUserId,
      authorRole: appeal.authorRole as "MEMBER" | "ADMIN" | "OWNER",
      arbiterId: appeal.arbiterUserId,
      isParticipant: Boolean(involvement?.participant),
      hasVoted: Boolean(involvement?.voted),
    })) return { status: "FORBIDDEN" } as const;
    if (attempt.status !== "REJECTED" || attempt.rewardedAt || attempt.archivedAt) return { status: "CLOSED" } as const;
    const current = now();
    if (decision === "OVERTURNED") {
      if (attempt.teamId === null) {
        const actor = { communityId, userId: attempt.userId };
        await lockProgress(scopedDb, actor);
        if (!canReceiveChallengeReward(await rewardedTowerCompletions(scopedDb, actor, current), current)) {
          return { status: "DAILY_LIMIT" } as const;
        }
        const updated = await scopedDb.$executeRaw`
          UPDATE "TowerChallengeAttempt" SET status = 'APPROVED', "rewardedAt" = ${current}
          WHERE id = ${attempt.id} AND "communityId" = ${communityId} AND status = 'REJECTED' AND "rewardedAt" IS NULL
        `;
        if (!updated) return { status: "CLOSED" } as const;
        await scopedDb.towerChallengeProgress.update({
          where: { communityId_userId: actor }, data: { floorsClimbed: { increment: BigInt(attempt.rewardFloors) } },
        });
      } else {
        const participants = await scopedDb.towerChallengeAttemptParticipant.findMany({
          where: { communityId, attemptId: attempt.id }, orderBy: { userId: "asc" }, select: { userId: true },
        });
        if (!participants.length) return { status: "NO_PARTICIPANTS" } as const;
        const updated = await scopedDb.$executeRaw`
          UPDATE "TowerChallengeAttempt" SET status = 'APPROVED', "rewardedAt" = ${current}
          WHERE id = ${attempt.id} AND "communityId" = ${communityId} AND status = 'REJECTED' AND "rewardedAt" IS NULL
        `;
        if (!updated) return { status: "CLOSED" } as const;
        for (const participant of participants) {
          await awardTeamParticipant(scopedDb, { communityId, attemptId: attempt.id, userId: participant.userId }, current);
        }
      }
      await enqueueTowerChallengeEvent(scopedDb, communityId, attempt.id, "success");
    }
    if (decision === "OVERTURNED") {
      await scopedDb.$executeRaw`
        UPDATE "TowerChallengeAppeal" SET status = 'OVERTURNED', "reviewerUserId" = ${userId},
          "decisionReason" = ${decisionReason}, "decidedAt" = ${current}
        WHERE id = ${appealId} AND "communityId" = ${communityId} AND status = 'OPEN'
      `;
    } else {
      await scopedDb.$executeRaw`
        UPDATE "TowerChallengeAppeal" SET status = 'UPHELD', "reviewerUserId" = ${userId},
          "decisionReason" = ${decisionReason}, "decidedAt" = ${current}
        WHERE id = ${appealId} AND "communityId" = ${communityId} AND status = 'OPEN'
      `;
    }
    return { status: decision === "OVERTURNED" ? "APPEAL_OVERTURNED" : "APPEAL_UPHELD" } as const;
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
    const metadata = await loadChallengeMeta(scopedDb, communityId, attemptId);
    if (metadata.archivedAt) return { status: "ARCHIVED" } as const;
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
      await scopedDb.$executeRaw`
        UPDATE "TowerChallengeAttempt" SET status = 'REJECTED', "rejectedAt" = COALESCE("rejectedAt", ${current})
        WHERE id = ${attemptId} AND "communityId" = ${communityId} AND status = 'SUBMITTED'
      `;
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
    const metadata = await Promise.all(attempts.map(attempt => loadChallengeMeta(scopedDb, communityId, attempt.id)));
    const metadataById = new Map(metadata.map(row => [row.id, row]));
    return {
      status: "STATE",
      floor: ((progress?.floorsClimbed ?? BigInt(0)) + BigInt(1)).toString(),
      attempts: attempts.map(attempt => ({ ...attempt, ...metadataById.get(attempt.id) })),
    } as const;
  });
}

export async function getTowerChallengeAppealableAttempts(input: unknown) {
  const parsed = actorSchema.safeParse(input);
  if (!parsed.success) return { status: "INVALID" } as const;
  const { communityId, userId } = parsed.data;
  return withTower({ communityId, userId }, async scopedDb => {
    const current = now();
    const attempts = await scopedDb.$queryRaw<{
      id: string; title: string; rejectedAt: Date; teamName: string | null;
    }[]>`
      SELECT a.id, a.title, a."rejectedAt", team.name AS "teamName"
      FROM "TowerChallengeAttempt" a
      LEFT JOIN "CommunityTeam" team ON team.id = a."teamId" AND team."communityId" = a."communityId"
      LEFT JOIN "TowerChallengeAppeal" appeal ON appeal."communityId" = a."communityId" AND appeal."attemptId" = a.id
      WHERE a."communityId" = ${communityId} AND a."userId" = ${userId} AND a.status = 'REJECTED'
        AND a."rejectedAt" > ${new Date(current.getTime() - 7 * 24 * 3600000)} AND a."rejectedAt" <= ${current}
        AND a."archivedAt" IS NULL AND appeal.id IS NULL
      ORDER BY a."rejectedAt" DESC, a.id LIMIT 25
    `;
    return { status: "APPEALABLE_ATTEMPTS" as const, attempts };
  });
}


// Même déclencheur que la file de notifications ; aucun nouveau service à héberger.
export async function settleDueTowerChallenges(deadline: Date) {
  const summary = { processed: 0, failed: 0, reported: 0, archived: 0 };
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
    try {
      const aging = await prisma.$transaction(async tx => {
        const community = await tx.community.findFirst({
          where: { discordGuildId: guildId, status: "ACTIVE", towerChallengesEnabled: true }, select: { id: true },
        });
        if (!community) return { reported: 0, archived: 0 };
        const scopedDb = scopedTransactionPrisma(tx, { communityIds: [community.id], includesDefault: false });
        return reportAndArchiveUnquorateProofs(scopedDb, community.id, current);
      }, { timeout: 5000, maxWait: 1000 });
      summary.reported += aging.reported;
      summary.archived += aging.archived;
    } catch (error) {
      summary.failed++;
      logger.error("tower:signalement-preuves", error, { guildId });
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
  const rows = await scopedDb.$queryRaw<{ userId: string; rewardFloors: bigint; difficultWins: bigint; reachedAt: Date }[]>`
    WITH earned AS (
      SELECT a."userId", a."rewardFloors", a."rewardedAt" AS "earnedAt"
      FROM "TowerChallengeAttempt" a
      WHERE a."communityId" = ${communityId} AND a."teamId" IS NULL AND a.status = 'APPROVED'
        AND a."rewardedAt" >= ${season.startAt} AND a."rewardedAt" < ${season.endAt}
      UNION ALL
      SELECT p."userId", a."rewardFloors", p."rewardedAt" AS "earnedAt"
      FROM "TowerChallengeAttemptParticipant" p
      JOIN "TowerChallengeAttempt" a ON a.id = p."attemptId" AND a."communityId" = p."communityId"
      WHERE p."communityId" = ${communityId} AND a.status = 'APPROVED'
        AND p."rewardedAt" >= ${season.startAt} AND p."rewardedAt" < ${season.endAt}
    )
    SELECT e."userId", SUM(e."rewardFloors")::bigint AS "rewardFloors",
      /* Le catalogue n’a pas de colonne difficulty : le barème validé 1/2/3 est la source de vérité\n       (1=facile, 2=moyen, 3=difficile). L’attempt conserve rewardFloors en snapshot. */\n      COUNT(*) FILTER (WHERE e."rewardFloors" = 3)::bigint AS "difficultWins",
      MAX(e."earnedAt") AS "reachedAt"
    FROM earned e
    JOIN "Membership" m ON m."userId" = e."userId" AND m."communityId" = ${communityId} AND m.status = 'ACTIVE'
    GROUP BY e."userId"
    ORDER BY "rewardFloors" DESC, "difficultWins" DESC, "reachedAt" ASC, e."userId" ASC
    LIMIT 10
  `;
  return rows.map(row => ({
    userId: row.userId, rewardFloors: Number(row.rewardFloors),
    difficultWins: Number(row.difficultWins), reachedAt: row.reachedAt,
  }));
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
