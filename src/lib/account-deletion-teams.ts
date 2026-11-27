import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { scopedPrisma, scopedTransactionPrisma } from "@/lib/community-scoped-client";
import { dissolutionBlocker } from "@/lib/community-teams";
import { requestTeamSpaceAfterDissolution } from "@/lib/discord-team-space-hooks";

/**
 * D5 : supprimer son compte est AUSSI un départ. Si la personne est le DERNIER membre actif d'une équipe, l'équipe est dissoute avec les
 * mêmes blocages que la dissolution manuelle (défi non terminé, signalement ou contestation ouverts : la suppression du compte est
 * alors REFUSÉE, rien n'est effacé) ; sinon les salons sont supprimés par la file, par identifiants enregistrés seulement.
 * La confirmation explicite est celle, forte, de la suppression de compte (pseudo exact ou SUPPRIMER).
 */
export interface LastMemberTeam { teamId: string; communityId: string; name: string; formerMemberDiscordIds: string[] }

/** Équipes dont la personne est le dernier membre ACTIF (lecture seule). */
export async function listLastMemberTeams(userId: string): Promise<LastMemberTeam[]> {
  const memberships = await prisma.membership.findMany({ where: { userId, status: "ACTIVE" }, select: { communityId: true } });
  const found: LastMemberTeam[] = [];
  for (const { communityId } of memberships) {
    const scopedDb = scopedPrisma({ communityIds: [communityId], includesDefault: false });
    const mine = await scopedDb.communityTeamMember.findMany({ where: { userId, communityId }, select: { teamId: true, team: { select: { name: true } } } });
    for (const { teamId, team } of mine) {
      const others = await scopedDb.communityTeamMember.count({
        where: { teamId, communityId, userId: { not: userId }, user: { memberships: { some: { communityId, status: "ACTIVE" } } } },
      });
      if (others > 0) continue;
      const rows = await scopedDb.communityTeamMember.findMany({ where: { teamId, communityId }, select: { user: { select: { discordId: true } } }, take: 50 });
      found.push({ teamId, communityId, name: team.name, formerMemberDiscordIds: rows.map((row) => row.user.discordId).filter(Boolean) });
    }
  }
  return found;
}

/** Noms des équipes dont la dissolution est bloquée (défi en cours, signalement ou contestation ouverts). */
export async function blockedLastMemberTeams(db: Prisma.TransactionClient | null, teams: readonly LastMemberTeam[]): Promise<string[]> {
  const blocked: string[] = [];
  for (const team of teams) {
    const scopedDb = db
      ? scopedTransactionPrisma(db, { communityIds: [team.communityId], includesDefault: false })
      : (scopedPrisma({ communityIds: [team.communityId], includesDefault: false }) as unknown as Prisma.TransactionClient);
    if (await dissolutionBlocker(scopedDb, team.communityId, team.teamId)) blocked.push(team.name);
  }
  return blocked;
}

/** Dans la transaction de suppression : l'équipe n'accepte plus de candidats et toutes ses lignes de membre disparaissent. */
export async function dissolveEmptiedTeams(tx: Prisma.TransactionClient, teams: readonly LastMemberTeam[]): Promise<number> {
  let removed = 0;
  for (const team of teams) {
    const scopedDb = scopedTransactionPrisma(tx, { communityIds: [team.communityId], includesDefault: false });
    await scopedDb.communityTeam.updateMany({ where: { id: team.teamId, communityId: team.communityId }, data: { isRecruiting: false } });
    removed += (await scopedDb.communityTeamMember.deleteMany({ where: { teamId: team.teamId, communityId: team.communityId } })).count;
  }
  return removed;
}

/** Après la suppression : file d'attente seulement (aucun appel Discord) ; l'exécution revérifie tout. Un échec n'annule jamais la suppression. */
export async function requestEmptiedTeamsSpaceDeletion(userId: string, teams: readonly LastMemberTeam[]): Promise<void> {
  for (const team of teams) {
    await requestTeamSpaceAfterDissolution({
      communityId: team.communityId, teamId: team.teamId, actorUserId: userId, formerMemberDiscordIds: team.formerMemberDiscordIds,
    });
  }
}
