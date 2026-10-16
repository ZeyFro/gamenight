import { prisma } from "@/lib/prisma";
import { getScopedPrisma, scopedTransactionPrisma } from "@/lib/community-scoped-client";
import { statsCommunityIdForSession } from "@/lib/community-stats";
import { isTournamentPredictionsEnabled, canPredictTournamentTarget } from "./tournament-prediction-rules";

export async function submitTournamentPrediction(userId: string, tournamentId: string, target: string, predictedUserId: string): Promise<boolean> {
  if (!isTournamentPredictionsEnabled()) return false;
  const scopedDb = await getScopedPrisma(userId);
  const visible = await scopedDb.tournament.findUnique({ where: { id: tournamentId }, select: { communityId: true } });
  if (!visible) return false;
  const communityId = await statsCommunityIdForSession(visible.communityId);
  return prisma.$transaction(async (tx) => {
    // Ordre de declareWinner : match puis tournoi, pour éviter un interblocage en finale.
    if (target !== "champion") await tx.$queryRaw`SELECT id FROM "TournamentMatch" WHERE id = ${target} AND "tournamentId" = ${tournamentId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "Tournament" WHERE id = ${tournamentId} FOR UPDATE`;
    const [community] = await tx.$queryRaw<{ status: string }[]>`SELECT status FROM "Community" WHERE id = ${communityId} FOR SHARE`;
    const memberships = await tx.$queryRaw<{ userId: string; status: string }[]>`SELECT "userId", status FROM "Membership" WHERE "communityId" = ${communityId} AND "userId" = ANY(${[userId, predictedUserId]}::text[]) ORDER BY "userId" FOR SHARE`;
    if (community?.status !== "ACTIVE" || [userId, predictedUserId].some(id => !memberships.some(m => m.userId === id && m.status === "ACTIVE"))) return false;
    const scopedDb = scopedTransactionPrisma(tx, { communityIds: [communityId], includesDefault: visible.communityId === null });
    const tournament = await scopedDb.tournament.findUnique({ where: { id: tournamentId }, include: { participants: true } });
    if (!tournament) return false;
    const match = target === "champion" ? null : await scopedDb.tournamentMatch.findFirst({ where: { id: target, tournamentId } });
    if (target !== "champion" && !match) return false;
    if (!canPredictTournamentTarget(tournament.status, tournament.participants.map(p => p.userId), predictedUserId, match)) return false;
    const inserted = await scopedDb.tournamentPrediction.createMany({
      data: [{ communityId, tournamentId, voterId: userId, predictedUserId, target }], skipDuplicates: true,
    });
    return inserted.count === 1;
  });
}
