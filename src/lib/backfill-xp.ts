import { prisma } from "@/lib/prisma";
import { XP_AMOUNTS } from "@/lib/xp";
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

async function awardXpRaw(
  userId: string,
  reason: XpReason,
  sourceId: string,
  amount: number
): Promise<void> {
  try {
    await prisma.xpEvent.create({ data: { userId, reason, sourceId, amount } });
  } catch (error) {
    if (isUniqueConstraintViolation(error)) return; // déjà attribué (backfill précédent, ou déjà crédité en live)
    throw error;
  }
  await prisma.user.update({
    where: { id: userId },
    data: { xpTotal: { increment: amount } },
  });
}

async function backfillCreateSession(
  sessions: { id: string; createdById: string }[]
): Promise<void> {
  for (const s of sessions) {
    await awardXpRaw(s.createdById, "CREATE_SESSION", s.id, XP_AMOUNTS.CREATE_SESSION);
  }
}

async function backfillVotes(): Promise<void> {
  const votes = await prisma.vote.findMany({ select: { userId: true, proposalId: true } });
  for (const v of votes) {
    // sourceId = proposalId (pas l'id du Vote) : même convention que le
    // chemin live, cf. src/app/sessions/actions.ts.
    await awardXpRaw(v.userId, "VOTE", v.proposalId, XP_AMOUNTS.VOTE);
  }
}

async function backfillParticipation(
  sessions: { id: string; status: string; decidedGameId: string | null }[]
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
      await awardXpRaw(v.userId, "PARTICIPATE", s.id, XP_AMOUNTS.PARTICIPATE);
    }
  }
}

async function backfillAvailabilityFirst(): Promise<void> {
  const rows = await prisma.weeklyAvailability.findMany({
    distinct: ["userId"],
    select: { userId: true },
  });
  for (const { userId } of rows) {
    await awardXpRaw(userId, "AVAILABILITY_FIRST", userId, XP_AMOUNTS.AVAILABILITY_FIRST);
  }
}

async function backfillSteamLinkFirst(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { steamId64: { not: null } },
    select: { id: true },
  });
  for (const { id } of users) {
    await awardXpRaw(id, "STEAM_LINK_FIRST", id, XP_AMOUNTS.STEAM_LINK_FIRST);
  }
}

export async function backfillXp(): Promise<void> {
  const sessions = await prisma.session.findMany({
    select: { id: true, createdById: true, status: true, decidedGameId: true },
  });

  await backfillCreateSession(sessions);
  await backfillVotes();
  await backfillParticipation(sessions);
  await backfillAvailabilityFirst();
  await backfillSteamLinkFirst();
}
