import { scopedTransactionPrisma } from "@/lib/community-scoped-client";
import { getIsolationScope } from "@/lib/community-isolation";
import { getDefaultCommunityId } from "@/lib/default-community";
import { prisma } from "@/lib/prisma";
import { eligibleRouletteEntries } from "@/lib/roulette";
import { isRoulettePlayerFilterEnabled, pickRouletteCandidate } from "@/lib/roulette-draw";
import { rouletteVetoRefusal, type RouletteVetoError } from "@/lib/roulette-veto";
import { enqueueRouletteDirectMessageEdits } from "@/lib/roulette-dm";
import { enqueueSessionAnnounceUpdate } from "@/lib/session-announce";
import { isVoteVetoEnabled } from "@/lib/session-veto";
import { wallClockNow } from "@/lib/wallclock";

/** Date neutre quand la roulette n'a pas de soirée (le refus `closed` prime alors). */
const NO_SESSION_DATE = new Date(0);

export type RouletteVetoResult =
  | { ok: true; gameId: string; playerFilterFallback: boolean }
  | { ok: false; error: RouletteVetoError };

/**
 * Veto du jeu tiré par une roulette asynchrone (VOTE_VETO_ENABLED) : un par participant, tant que la soirée issue
 * de la roulette est SCHEDULED et à venir. Relance en excluant tous les jeux vetoés (et le filtre joueurs si actif),
 * puis met à jour le jeu décidé de la soirée ; l'annonce Discord est ÉDITÉE (aucun nouveau ping), dans la même transaction.
 */
export async function vetoRouletteGame(input: { rouletteId: string; userId: string; rng?: () => number }): Promise<RouletteVetoResult> {
  if (!isVoteVetoEnabled()) return { ok: false, error: "disabled" };
  const { rouletteId, userId, rng = Math.random } = input;
  const scope = await getIsolationScope(userId);
  return prisma.$transaction(async (tx): Promise<RouletteVetoResult> => {
    const scopedDb = scopedTransactionPrisma(tx, scope);
    // Sérialise deux vetos simultanés : le second voit le jeu déjà relancé.
    await tx.$queryRaw`SELECT id FROM "Roulette" WHERE id = ${rouletteId} FOR UPDATE`;
    const roulette = await scopedDb.roulette.findUnique({
      where: { id: rouletteId },
      include: { entries: { include: { game: { select: { minPlayers: true, maxPlayers: true } } } } },
    });
    const session = roulette?.resultSessionId ? await scopedDb.session.findUnique({ where: { id: roulette.resultSessionId } }) : null;
    if (!roulette || (roulette.resultSessionId && !session)) return { ok: false, error: "forbidden" };
    const { entries, participantIds } = await eligibleRouletteEntries(tx, roulette);
    const vetoes = await scopedDb.rouletteVeto.findMany({ where: { rouletteId }, select: { userId: true, gameId: true } });
    const refusal = rouletteVetoRefusal({
      rouletteStatus: roulette.status,
      hasResultSession: session !== null && roulette.resultGameId !== null,
      sessionStatus: session?.status ?? "",
      sessionDate: session?.date ?? NO_SESSION_DATE,
      isParticipant: participantIds.includes(userId),
      alreadyVetoed: vetoes.some((v) => v.userId === userId),
      announceViaBot: session?.announceViaBot ?? false,
      now: wallClockNow(),
    });
    if (refusal) return { ok: false, error: refusal };

    const excluded = new Set([...vetoes.map((v) => v.gameId), roulette.resultGameId!]);
    const { chosen, fallback } = pickRouletteCandidate(
      entries.filter((e) => !excluded.has(e.gameId)).map((e) => ({ ...e, ...e.game })),
      { playerCount: participantIds.length, filterEnabled: isRoulettePlayerFilterEnabled(), rng }
    );
    if (!chosen) return { ok: false, error: "no_candidate" };

    const communityId = roulette.communityId ?? (await getDefaultCommunityId());
    await scopedDb.rouletteVeto.create({ data: { rouletteId, userId, gameId: roulette.resultGameId!, communityId } });
    // Même invariant qu'à la création (createRouletteResultSession) : une proposition (le jeu décidé) avec un vote par participant.
    await scopedDb.proposal.deleteMany({ where: { sessionId: session!.id, gameId: roulette.resultGameId! } });
    const proposal = await scopedDb.proposal.create({ data: { sessionId: session!.id, gameId: chosen.gameId, proposedById: chosen.userId } });
    await scopedDb.vote.createMany({ data: participantIds.map((id) => ({ proposalId: proposal.id, userId: id })) });
    await scopedDb.session.update({ where: { id: session!.id }, data: { decidedGameId: chosen.gameId } });
    await scopedDb.roulette.update({ where: { id: rouletteId }, data: { resultGameId: chosen.gameId } });
    await enqueueSessionAnnounceUpdate(session!.id, tx);
    await enqueueRouletteDirectMessageEdits(rouletteId, tx);
    return { ok: true, gameId: chosen.gameId, playerFilterFallback: fallback };
  }, { timeout: 15_000 });
}
