import { prisma } from "@/lib/prisma";
import { XP_AMOUNTS } from "@/lib/xp";
import { getDefaultCommunityId } from "@/lib/default-community";
import { statsCommunityIdForSession } from "@/lib/community-stats";
import { scopedPrisma, scopedTransactionPrisma } from "@/lib/community-scoped-client";
import { cronCommunityScope, isCommunityIsolationEnabled } from "@/lib/community-isolation";
import { lockCommunityProgress } from "@/lib/member-stats";
import { isUniqueConstraintViolation } from "@/lib/xp-actions";
import type { XpReason } from "@prisma/client";

/**
 * Backfill XP (chantier XP/niveaux/rangs) — attribue rétroactivement l'XP
 * "participation" (Axe 1) à partir de l'historique déjà en base : sessions
 * créées, votes existants, participations aux sessions décidées, dispos
 * hebdo déjà réglées, Steam déjà lié.
 *
 * Convertie depuis `prisma/backfill-xp.mjs` (PR "build ne fait plus que
 * compiler") : importe directement `XP_AMOUNTS` de `@/lib/xp` au lieu de
 * le dupliquer — l'ancienne version Node/ESM autonome ne pouvait pas
 * résoudre l'alias `@/...`.
 *
 * Idempotent via la même contrainte unique que `awardXp`
 * (`XpEvent[userId, reason, sourceId]`), donc sûr à rejouer indéfiniment :
 * le chemin "live" (`awardXp`, `src/lib/xp-actions.ts`) et ce passage de
 * réconciliation écrivent tous les deux dans le même ledger idempotent,
 * aucune double comptabilisation possible.
 *
 * Ne déclenche JAMAIS de notif Discord "level up" : contrairement à
 * `awardXp` (chemin live), écrit directement en base sans passer par la
 * détection de passage de niveau — un backfill qui spammerait le salon de
 * dizaines de "level up" rétroactifs serait absurde.
 *
 * Limite assumée et documentée (pas de contournement possible sans
 * historiser les votes, hors scope) : seuls les votes ENCORE PRÉSENTS en
 * base sont visibles au backfill — un vote posé puis retiré n'a laissé
 * aucune trace.
 */

async function awardXpRaw(userId: string, communityId: string | null, reason: XpReason, sourceId: string, amount: number): Promise<void> {
  const id = await statsCommunityIdForSession(communityId);
  const defaultId = await getDefaultCommunityId();
  // Steam et disponibilités sont des premiers gestes globaux historiques.
  // Une récompense live sur B ne doit pas être recréditée dans default par cron.
  try {
    await prisma.$transaction(async (tx) => {
      if (!(await lockCommunityProgress(tx, id, userId))) return;
      if (reason === "STEAM_LINK_FIRST" || reason === "AVAILABILITY_FIRST") {
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
        if (await tx.user.findFirst({ where: { id: userId, xpEvents: { some: { reason, sourceId } } }, select: { id: true } })) return;
      }
      const scopedDb = scopedTransactionPrisma(tx, isCommunityIsolationEnabled() ? { communityIds: [...new Set([id, defaultId])], includesDefault: false } : null);
      // Les événements pré-migration ont été conservés dans default. Ne pas
      // recréer ailleurs le même gain historique lors d'une réconciliation.
      if (id !== defaultId && await scopedDb.xpEvent.findFirst({ where: { communityId: defaultId, userId, reason, sourceId }, select: { id: true } })) return;
      await scopedDb.xpEvent.create({ data: { communityId: id, userId, reason, sourceId, amount } });
      await scopedDb.communityMemberStats.createMany({ data: [{ communityId: id, userId }], skipDuplicates: true });
      await scopedDb.communityMemberStats.update({ where: { communityId_userId: { communityId: id, userId } }, data: { xpTotal: { increment: amount }, xpBalance: { increment: amount } } });
    });
  } catch (error) {
    if (!isUniqueConstraintViolation(error)) throw error;
  }
}

async function backfillCreateSession(
  sessions: { id: string; createdById: string; communityId: string | null }[]
): Promise<void> {
  for (const s of sessions) {
    await awardXpRaw(s.createdById, s.communityId, "CREATE_SESSION", s.id, XP_AMOUNTS.CREATE_SESSION);
  }
}

async function backfillVotes(): Promise<void> {
  const votes = await prisma.vote.findMany({ select: { userId: true, proposalId: true, proposal: { select: { session: { select: { communityId: true } } } } } });
  for (const v of votes) {
    // sourceId = proposalId (pas l'id du Vote) : même convention que le
    // chemin live, cf. src/app/sessions/actions.ts.
    await awardXpRaw(v.userId, v.proposal.session.communityId, "VOTE", v.proposalId, XP_AMOUNTS.VOTE);
  }
}

async function backfillParticipation(
  sessions: { id: string; status: string; decidedGameId: string | null; communityId: string | null }[]
): Promise<void> {
  const decided = sessions.filter(
    (s) => (s.status === "SCHEDULED" || s.status === "DONE") && s.decidedGameId
  );
  for (const s of decided) {
    const winningProposal = await prisma.proposal.findFirst({
      where: { sessionId: s.id, gameId: s.decidedGameId! },
      select: { id: true },
    });
    if (!winningProposal) continue;

    const winnerVotes = await prisma.vote.findMany({
      where: { proposalId: winningProposal.id },
      select: { userId: true },
    });
    for (const v of winnerVotes) {
      await awardXpRaw(v.userId, s.communityId, "PARTICIPATE", s.id, XP_AMOUNTS.PARTICIPATE);
    }
  }
}

async function backfillAvailabilityFirst(): Promise<void> {
  const rows = await prisma.weeklyAvailability.findMany({
    distinct: ["userId"],
    select: { userId: true },
  });
  for (const { userId } of rows) {
    await awardXpRaw(userId, await getDefaultCommunityId(), "AVAILABILITY_FIRST", userId, XP_AMOUNTS.AVAILABILITY_FIRST);
  }
}

async function backfillSteamLinkFirst(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { steamId64: { not: null } },
    select: { id: true },
  });
  for (const { id } of users) {
    await awardXpRaw(id, await getDefaultCommunityId(), "STEAM_LINK_FIRST", id, XP_AMOUNTS.STEAM_LINK_FIRST);
  }
}

export async function backfillXp(): Promise<void> {
  const scopedDb = scopedPrisma(await cronCommunityScope());
  const sessions = await scopedDb.session.findMany({
    select: { id: true, communityId: true, createdById: true, status: true, decidedGameId: true },
  });

  await backfillCreateSession(sessions);
  await backfillVotes();
  await backfillParticipation(sessions);
  await backfillAvailabilityFirst();
  await backfillSteamLinkFirst();
}
