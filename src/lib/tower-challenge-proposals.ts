import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { scopedTransactionPrisma } from "@/lib/community-scoped-client";
import { resolveActiveCommunityId } from "@/lib/community-isolation";
import {
  isTowerChallengeProposalsEnabled, TOWER_PROPOSAL_DAY_MS, towerChallengeProposalSchema, towerProposalBlock,
  towerProposalDecisionSchema, canProposeTowerChallenge, type ProposalBlock,
} from "@/lib/tower-challenge-proposal-rules";

const TX = { timeout: 5000, maxWait: 1000 } as const;
const id = z.string().min(1).max(191).regex(/^[a-zA-Z0-9_-]+$/);

function enabled(): boolean {
  return process.env.TOWER_CHALLENGES_ENABLED === "true" && isTowerChallengeProposalsEnabled();
}

/** Communauté active du membre si les drapeaux sont allumés (l'appartenance est revérifiée à chaque accès en base). */
export async function getTowerProposalsCommunityId(userId: string): Promise<string | null> {
  if (!enabled()) return null;
  return resolveActiveCommunityId(userId);
}

type Member = { role: string };

/** Membre ACTIF d'une communauté ACTIVE dont la Tour est allumée ; `lock` verrouille sa ligne (limites sans course). */
async function withMember<T>(communityId: string, userId: string, lock: boolean, work: (scopedDb: Prisma.TransactionClient, tx: Prisma.TransactionClient, member: Member) => Promise<T>) {
  return prisma.$transaction(async tx => {
    const [member] = lock
      ? await tx.$queryRaw<Member[]>`
        SELECT m.role FROM "Membership" m JOIN "Community" c ON c.id = m."communityId"
        WHERE m."communityId" = ${communityId} AND m."userId" = ${userId} AND m.status = 'ACTIVE'
          AND c.status = 'ACTIVE' AND c."towerChallengesEnabled" = true
        FOR UPDATE OF m FOR SHARE OF c`
      : await tx.$queryRaw<Member[]>`
        SELECT m.role FROM "Membership" m JOIN "Community" c ON c.id = m."communityId"
        WHERE m."communityId" = ${communityId} AND m."userId" = ${userId} AND m.status = 'ACTIVE'
          AND c.status = 'ACTIVE' AND c."towerChallengesEnabled" = true
        FOR SHARE OF m, c`;
    if (!member) return { status: "UNAVAILABLE" } as const;
    return work(scopedTransactionPrisma(tx, { communityIds: [communityId], includesDefault: false }), tx, member);
  }, TX);
}

async function floorsOf(scopedDb: Prisma.TransactionClient, communityId: string, userId: string): Promise<bigint> {
  const progress = await scopedDb.towerChallengeProgress.findUnique({ where: { communityId_userId: { communityId, userId } }, select: { floorsClimbed: true } });
  return progress?.floorsClimbed ?? BigInt(0);
}

export type ProposeStatus = "SUBMITTED" | "DUPLICATE" | ProposalBlock | "INVALID" | "DISABLED" | "UNAVAILABLE";

/** Dépose une proposition PENDING ; rien n'entre au catalogue avant la validation du staff. */
export async function proposeTowerChallenge(input: { communityId: string; userId: string; content: unknown }, current = new Date()): Promise<{ status: ProposeStatus }> {
  const actor = z.object({ communityId: id, userId: id }).safeParse(input);
  const content = towerChallengeProposalSchema.safeParse(input.content);
  if (!actor.success || !content.success) return { status: "INVALID" };
  if (!enabled()) return { status: "DISABLED" };
  const { communityId, userId } = actor.data;
  return withMember(communityId, userId, true, async scopedDb => {
    const floors = await floorsOf(scopedDb, communityId, userId);
    const since = new Date(current.getTime() - TOWER_PROPOSAL_DAY_MS);
    const [lastDayCount, pendingCount] = await Promise.all([
      scopedDb.towerChallengeProposal.count({ where: { communityId, proposerId: userId, createdAt: { gt: since } } }),
      scopedDb.towerChallengeProposal.count({ where: { communityId, proposerId: userId, status: "PENDING" } }),
    ]);
    const block = towerProposalBlock({ floorsClimbed: floors, lastDayCount, pendingCount });
    if (block) return { status: block } as const;
    const title = { equals: content.data.title, mode: "insensitive" as const };
    const [catalogue, pending] = await Promise.all([
      scopedDb.towerChallengeDefinition.findFirst({ where: { communityId, mode: "SOLO", active: true, title }, select: { id: true } }),
      scopedDb.towerChallengeProposal.findFirst({ where: { communityId, status: "PENDING", title }, select: { id: true } }),
    ]);
    if (catalogue || pending) return { status: "DUPLICATE" } as const;
    await scopedDb.towerChallengeProposal.create({
      data: { communityId, proposerId: userId, title: content.data.title, instructions: content.data.instructions, rewardFloors: content.data.rewardFloors, createdAt: current },
    });
    return { status: "SUBMITTED" } as const;
  });
}

/** Aperçu pour le joueur : éligibilité, limites restantes et ses propositions récentes. */
export async function getTowerProposalOverview(input: { communityId: string; userId: string }, current = new Date()) {
  const actor = z.object({ communityId: id, userId: id }).safeParse(input);
  if (!actor.success) return { status: "INVALID" } as const;
  if (!enabled()) return { status: "DISABLED" } as const;
  const { communityId, userId } = actor.data;
  return withMember(communityId, userId, false, async scopedDb => {
    const floors = await floorsOf(scopedDb, communityId, userId);
    const [mine, lastDayCount, pendingCount] = await Promise.all([
      scopedDb.towerChallengeProposal.findMany({
        where: { communityId, proposerId: userId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 20,
        select: { id: true, title: true, rewardFloors: true, status: true, createdAt: true, decisionNote: true },
      }),
      scopedDb.towerChallengeProposal.count({ where: { communityId, proposerId: userId, createdAt: { gt: new Date(current.getTime() - TOWER_PROPOSAL_DAY_MS) } } }),
      scopedDb.towerChallengeProposal.count({ where: { communityId, proposerId: userId, status: "PENDING" } }),
    ]);
    return {
      status: "OVERVIEW", eligible: canProposeTowerChallenge(floors), block: towerProposalBlock({ floorsClimbed: floors, lastDayCount, pendingCount }), mine,
    } as const;
  });
}

/** File du staff (OWNER/ADMIN) : propositions en attente. */
export async function listPendingTowerProposals(input: { communityId: string; userId: string }) {
  const actor = z.object({ communityId: id, userId: id }).safeParse(input);
  if (!actor.success) return { status: "INVALID" } as const;
  if (!enabled()) return { status: "DISABLED" } as const;
  const { communityId, userId } = actor.data;
  return withMember(communityId, userId, false, async (scopedDb, _tx, member) => {
    if (member.role !== "OWNER" && member.role !== "ADMIN") return { status: "FORBIDDEN" } as const;
    const proposals = await scopedDb.towerChallengeProposal.findMany({
      where: { communityId, status: "PENDING" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 50,
      select: { id: true, title: true, instructions: true, rewardFloors: true, createdAt: true, proposer: { select: { discordName: true } } },
    });
    return { status: "PENDING_LIST", proposals } as const;
  });
}

export type DecideProposalStatus = "APPROVED" | "REJECTED" | "DUPLICATE" | "NOT_FOUND" | "ALREADY_DECIDED" | "FORBIDDEN" | "INVALID" | "DISABLED" | "UNAVAILABLE";

/** Le staff approuve (création d'un défi solo ACTIF au catalogue) ou rejette ; une décision est définitive. */
export async function decideTowerProposal(input: { communityId: string; userId: string; decision: unknown }, current = new Date()): Promise<{ status: DecideProposalStatus }> {
  const actor = z.object({ communityId: id, userId: id }).safeParse(input);
  const decision = towerProposalDecisionSchema.safeParse(input.decision);
  if (!actor.success || !decision.success) return { status: "INVALID" };
  if (!enabled()) return { status: "DISABLED" };
  const { communityId, userId } = actor.data;
  return withMember(communityId, userId, false, async (scopedDb, _tx, member) => {
    if (member.role !== "OWNER" && member.role !== "ADMIN") return { status: "FORBIDDEN" } as const;
    await scopedDb.$queryRaw`SELECT id FROM "TowerChallengeProposal" WHERE id = ${decision.data.proposalId} AND "communityId" = ${communityId} FOR UPDATE`;
    const proposal = await scopedDb.towerChallengeProposal.findFirst({
      where: { id: decision.data.proposalId, communityId }, select: { id: true, status: true, title: true, instructions: true, rewardFloors: true },
    });
    if (!proposal) return { status: "NOT_FOUND" } as const;
    if (proposal.status !== "PENDING") return { status: "ALREADY_DECIDED" } as const;
    const base = { decidedAt: current, decidedById: userId, decisionNote: decision.data.note || null };
    if (!decision.data.approve) {
      await scopedDb.towerChallengeProposal.update({ where: { id: proposal.id }, data: { ...base, status: "REJECTED" } });
      return { status: "REJECTED" } as const;
    }
    const duplicate = await scopedDb.towerChallengeDefinition.findFirst({
      where: { communityId, mode: "SOLO", active: true, title: { equals: proposal.title, mode: "insensitive" } }, select: { id: true },
    });
    if (duplicate) return { status: "DUPLICATE" } as const;
    const definition = await scopedDb.towerChallengeDefinition.create({
      data: { communityId, mode: "SOLO", title: proposal.title, instructions: proposal.instructions, rewardFloors: proposal.rewardFloors, active: true },
      select: { id: true },
    });
    await scopedDb.towerChallengeProposal.update({ where: { id: proposal.id }, data: { ...base, status: "APPROVED", definitionId: definition.id } });
    return { status: "APPROVED" } as const;
  });
}
