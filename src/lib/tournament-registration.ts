import { prisma } from "@/lib/prisma";
import { canAccessTournament } from "@/lib/community-access";
import { lockCommunityProgress } from "@/lib/member-stats";
import { statsCommunityIdForSession } from "@/lib/community-stats";
import { scopedTransactionPrisma } from "@/lib/community-scoped-client";
import { isCommunityIsolationEnabled } from "@/lib/community-isolation";
import { buildBracketInTransaction } from "@/lib/tournaments";
import { enqueueTournamentThreadMember } from "@/lib/tournament-announce";
import { isUniqueConstraintViolation } from "@/lib/xp-actions";

export async function registerTournamentParticipant(userId: string, tournamentId: string): Promise<"registered" | "already" | "unavailable"> {
  if (!(await canAccessTournament(userId, tournamentId))) return "unavailable";
  return prisma.$transaction(async (tx) => {
    const [tournament] = await tx.$queryRaw<
      { id: string; status: string; maxPlayers: number; announceViaBot: boolean; communityId: string | null }[]
    >`SELECT id, status, "maxPlayers", "announceViaBot", "communityId" FROM "Tournament" WHERE id = ${tournamentId} FOR UPDATE`;
    if (!tournament || tournament.status !== "REGISTRATION") return "unavailable";
    const communityId = await statsCommunityIdForSession(tournament.communityId);
    if (!(await lockCommunityProgress(tx, communityId, userId))) return "unavailable";
    const scopedDb = scopedTransactionPrisma(tx, isCommunityIsolationEnabled() ? { communityIds: [communityId], includesDefault: false } : null);
    const participants = await scopedDb.tournamentParticipant.findMany({ where: { tournamentId }, select: { userId: true } });
    if (participants.some(participant => participant.userId === userId)) return "already";
    if (participants.length >= tournament.maxPlayers) return "unavailable";
    try {
      await scopedDb.tournamentParticipant.create({ data: { tournamentId, userId } });
    } catch (error) {
      if (isUniqueConstraintViolation(error)) return "already";
      throw error;
    }
    if (tournament.announceViaBot) await enqueueTournamentThreadMember(tournamentId, userId, tx);
    await scopedDb.communityMemberStats.createMany({ data: [{ communityId, userId }], skipDuplicates: true });
    await scopedDb.communityMemberStats.update({ where: { communityId_userId: { communityId, userId } }, data: { tournamentsParticipatedCount: { increment: 1 } } });
    if (participants.length + 1 >= tournament.maxPlayers) await buildBracketInTransaction(tx, tournamentId);
    return "registered";
  });
}
