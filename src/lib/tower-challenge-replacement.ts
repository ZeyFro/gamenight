import { randomInt } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { scopedTransactionPrisma } from "@/lib/community-scoped-client";
import {
  isTowerChallengeReplacementEnabled, pickReplacementDefinition, towerReplacementBlock, type ReplacementBlock,
} from "@/lib/tower-challenge-replacement-rules";

const id = z.string().min(1).max(191).regex(/^[a-zA-Z0-9_-]+$/);
const actorSchema = z.object({ communityId: id, userId: id });
const replaceSchema = actorSchema.extend({ attemptId: id });
const TX = { timeout: 5000, maxWait: 1000 } as const;

function enabled(): boolean {
  return process.env.TOWER_CHALLENGES_ENABLED === "true" && isTowerChallengeReplacementEnabled();
}

type Actor = z.infer<typeof actorSchema>;

/** Défis Tower allumés pour la communauté ACTIVE et membre ACTIVE : revérifié dans la transaction. */
async function withMember<T>(actor: Actor, work: (scopedDb: Prisma.TransactionClient, tx: Prisma.TransactionClient) => Promise<T>) {
  return prisma.$transaction(async tx => {
    const [row] = await tx.$queryRaw<{ ok: boolean }[]>`
      SELECT true AS ok FROM "Membership" m JOIN "Community" c ON c.id = m."communityId"
      WHERE m."communityId" = ${actor.communityId} AND m."userId" = ${actor.userId} AND m.status = 'ACTIVE'
        AND c.status = 'ACTIVE' AND c."towerChallengesEnabled" = true
      FOR SHARE OF m, c
    `;
    if (!row) return { status: "UNAVAILABLE" } as const;
    return work(scopedTransactionPrisma(tx, { communityIds: [actor.communityId], includesDefault: false }), tx);
  }, TX);
}

async function ownedGameIds(tx: Prisma.TransactionClient, userId: string): Promise<Set<string>> {
  const owned = await tx.userGame.findMany({ where: { userId, owned: true }, select: { gameId: true } });
  return new Set(owned.map(row => row.gameId));
}

/** Défi solo en cours remplaçable (jeu exigé non possédé), pour afficher le bouton sur /tower. */
export async function getTowerReplacementOffer(input: unknown, current = new Date()) {
  const parsed = actorSchema.safeParse(input);
  if (!parsed.success) return { status: "INVALID" } as const;
  if (!enabled()) return { status: "DISABLED" } as const;
  const actor = parsed.data;
  return withMember(actor, async (scopedDb, tx) => {
    const attempt = await scopedDb.towerChallengeAttempt.findFirst({
      where: { communityId: actor.communityId, userId: actor.userId, teamId: null, status: "ASSIGNED", expiresAt: { gt: current } },
      orderBy: [{ assignedAt: "desc" }, { id: "desc" }],
      select: { id: true, status: true, teamId: true, expiresAt: true, definition: { select: { gameId: true } } },
    });
    if (!attempt) return { status: "NONE" } as const;
    const replaced = await scopedDb.towerChallengeReplacement.findFirst({ where: { attemptId: attempt.id }, select: { id: true } });
    const owned = await ownedGameIds(tx, actor.userId);
    const block = towerReplacementBlock({ ...attempt, requiredGameId: attempt.definition.gameId, alreadyReplaced: replaced !== null }, owned, current);
    if (block || !attempt.definition.gameId) return { status: "NONE" } as const;
    const game = await tx.game.findUnique({ where: { id: attempt.definition.gameId }, select: { name: true } });
    return { status: "OFFER", attemptId: attempt.id, gameName: game?.name ?? null } as const;
  });
}

export type ReplaceStatus = "REPLACED" | "NO_EQUIVALENT" | "NOT_FOUND" | "BLOCKED" | "INVALID" | "DISABLED" | "UNAVAILABLE";

/**
 * Remplace le défi solo `attemptId` par un défi équivalent du catalogue (même nombre d'étages). Aucun quota n'est
 * consommé (`lastSoloClaimAt` et l'échéance de 48 h restent inchangées), une seule fois par attribution, journalisé
 * dans `TowerChallengeReplacement`. Aucune notification.
 */
export async function replaceTowerChallenge(input: unknown, current = new Date()): Promise<{ status: ReplaceStatus; block?: ReplacementBlock; title?: string }> {
  const parsed = replaceSchema.safeParse(input);
  if (!parsed.success) return { status: "INVALID" };
  if (!enabled()) return { status: "DISABLED" };
  const { communityId, userId, attemptId } = parsed.data;
  return withMember({ communityId, userId }, async (scopedDb, tx) => {
    await scopedDb.$queryRaw`SELECT id FROM "TowerChallengeAttempt" WHERE id = ${attemptId} AND "communityId" = ${communityId} AND "userId" = ${userId} FOR UPDATE`;
    const attempt = await scopedDb.towerChallengeAttempt.findFirst({
      where: { id: attemptId, communityId, userId },
      select: { id: true, status: true, teamId: true, expiresAt: true, definitionId: true, rewardFloors: true, definition: { select: { gameId: true } } },
    });
    if (!attempt) return { status: "NOT_FOUND" } as const;
    const replaced = await scopedDb.towerChallengeReplacement.findFirst({ where: { attemptId }, select: { id: true } });
    const owned = await ownedGameIds(tx, userId);
    const block = towerReplacementBlock({ ...attempt, requiredGameId: attempt.definition.gameId, alreadyReplaced: replaced !== null }, owned, current);
    if (block || !attempt.definition.gameId) return { status: "BLOCKED", block: block ?? "no_game_required" } as const;
    const candidates = await scopedDb.towerChallengeDefinition.findMany({
      where: { communityId, active: true, mode: "SOLO", rewardFloors: attempt.rewardFloors, id: { not: attempt.definitionId } },
      select: { id: true, title: true, instructions: true, rewardFloors: true, gameId: true },
    });
    const seen = await scopedDb.towerChallengeAttempt.findMany({
      where: { communityId, userId, definitionId: { in: candidates.map(candidate => candidate.id) } }, select: { definitionId: true }, distinct: ["definitionId"],
    });
    const chosen = pickReplacementDefinition(candidates, {
      currentId: attempt.definitionId, rewardFloors: attempt.rewardFloors, ownedGameIds: owned,
      seenIds: new Set(seen.map(row => row.definitionId)),
    }, randomInt);
    if (!chosen) return { status: "NO_EQUIVALENT" } as const;
    await scopedDb.towerChallengeAttempt.update({
      where: { id: attemptId }, data: { definitionId: chosen.id, title: chosen.title, instructions: chosen.instructions },
    });
    await scopedDb.towerChallengeReplacement.create({
      data: { communityId, attemptId, userId, fromDefinitionId: attempt.definitionId, toDefinitionId: chosen.id, requiredGameId: attempt.definition.gameId },
    });
    return { status: "REPLACED", title: chosen.title } as const;
  });
}
