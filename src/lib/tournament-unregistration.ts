import { prisma } from "@/lib/prisma";
import { canAccessTournament } from "@/lib/community-access";
import { lockCommunityProgress } from "@/lib/member-stats";
import { statsCommunityIdForSession } from "@/lib/community-stats";
import { scopedTransactionPrisma } from "@/lib/community-scoped-client";

/**
 * Désinscription d'un tournoi — SEULE implémentation, partagée par le site
 * (`unregisterFromTournamentAction`) et Discord (`/tournoi desinscription`).
 *
 * Réservée à soi-même (l'appelant passe toujours l'identité de la session
 * serveur, jamais un identifiant fourni par l'utilisateur) et uniquement tant
 * que le tournoi n'a pas démarré.
 *
 * Concurrence : verrouille D'ABORD la ligne `Tournament` (`FOR UPDATE`), comme
 * `registerTournamentParticipant` et `buildBracketInTransaction`, puis relit
 * `status` — une désinscription ne peut donc pas s'intercaler entre la lecture
 * des participants et l'écriture du bracket.
 *
 * Décrémente `tournamentsParticipatedCount` seulement si une ligne a réellement
 * été retirée : un double appel est sans effet, comme une inscription absente.
 */
export async function unregisterTournamentParticipant(userId: string, tournamentId: string): Promise<boolean> {
  if (!(await canAccessTournament(userId, tournamentId))) return false;
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string; status: string; communityId: string | null }[]>`
      SELECT id, status, "communityId" FROM "Tournament" WHERE id = ${tournamentId} FOR UPDATE
    `;
    const tournament = locked[0];
    if (!tournament || tournament.status !== "REGISTRATION") return false;
    const communityId = await statsCommunityIdForSession(tournament.communityId);
    if (!(await lockCommunityProgress(tx, communityId, userId))) return false;
    const scopedDb = scopedTransactionPrisma(tx, { communityIds: [communityId], includesDefault: false });

    const deleted = await tx.tournamentParticipant.deleteMany({ where: { tournamentId, userId } });
    if (deleted.count > 0) {
      // Les inscriptions historiques hors default n'ont pas de compteur attribuable.
      await scopedDb.communityMemberStats.updateMany({
        where: { communityId, userId, tournamentsParticipatedCount: { gt: 0 } },
        data: { tournamentsParticipatedCount: { decrement: 1 } },
      });
    }
    return true;
  });
}
