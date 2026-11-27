import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { scopedPrisma, scopedTransactionPrisma } from "@/lib/community-scoped-client";
import { dissolutionBlocker, recordTeamDissolution } from "@/lib/community-teams";
import { requestTeamSpaceAfterDissolution } from "@/lib/discord-team-space-hooks";

/**
 * D5 : supprimer son compte est AUSSI un départ. Si la personne est le DERNIER membre actif d'une équipe, l'équipe est dissoute et ses deux
 * salons sont supprimés par la file (identifiants enregistrés seulement). Les mêmes blocages que la dissolution manuelle (défi en cours,
 * signalement ou contestation ouverts) ne REFUSENT PAS la suppression du compte (droit à l'effacement : jamais bloqué pendant des
 * semaines) : le compte est effacé, la ligne de membre disparaît, mais l'équipe reste NON dissoute (salons intacts, recrutement fermé)
 * tant que le blocage existe ; le balayage \`sweepDissolvedTeamSpaces\` (cron des rappels) la dissout ensuite quand il tombe.
 * La confirmation explicite est celle, forte, de la suppression de compte (pseudo exact ou SUPPRIMER), et la page liste ces équipes avant.
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

export interface EmptiedTeamsOutcome {
  /** Lignes de membre retirées (toutes, pour les équipes réellement dissoutes). */
  removed: number;
  /** Équipes réellement dissoutes : seules celles-ci voient leurs salons supprimés. */
  dissolved: LastMemberTeam[];
  /** Équipes conservées (nouvel arrivant ou blocage ouvert) : jamais dissoutes ici. */
  kept: string[];
}

/**
 * DANS la transaction de suppression de compte. La ligne de l'équipe est verrouillée (FOR UPDATE) : une arrivée concurrente (clé étrangère,
 * FOR KEY SHARE) attend, et celles déjà validées sont vues par le RECOMPTAGE. Seule une équipe qui n'a réellement plus d'autre membre actif
 * ET aucun blocage ouvert est dissoute ; sinon seule la ligne de la personne disparaîtra (boucle générique du plan de suppression).
 */
export async function dissolveEmptiedTeams(tx: Prisma.TransactionClient, userId: string, teams: readonly LastMemberTeam[]): Promise<EmptiedTeamsOutcome> {
  const outcome: EmptiedTeamsOutcome = { removed: 0, dissolved: [], kept: [] };
  for (const team of teams) {
    const scopedDb = scopedTransactionPrisma(tx, { communityIds: [team.communityId], includesDefault: false });
    await tx.$queryRaw`SELECT "id" FROM "CommunityTeam" WHERE "id" = ${team.teamId} AND "communityId" = ${team.communityId} FOR UPDATE`;
    const others = await scopedDb.communityTeamMember.count({
      where: { teamId: team.teamId, communityId: team.communityId, userId: { not: userId }, user: { memberships: { some: { communityId: team.communityId, status: "ACTIVE" } } } },
    });
    if (others > 0) { outcome.kept.push(team.name); continue; }
    // L'équipe n'accepte plus de candidats dès qu'elle est vide, bloquée ou non.
    await scopedDb.communityTeam.updateMany({ where: { id: team.teamId, communityId: team.communityId }, data: { isRecruiting: false } });
    if (await dissolutionBlocker(scopedDb, team.communityId, team.teamId)) { outcome.kept.push(team.name); continue; }
    outcome.removed += (await scopedDb.communityTeamMember.deleteMany({ where: { teamId: team.teamId, communityId: team.communityId } })).count;
    outcome.dissolved.push(team);
  }
  return outcome;
}

/**
 * Après la suppression : journal de la dissolution (D5 « inscrite au journal »), puis file d'attente seulement (aucun appel Discord).
 * Aucun échec ne défait la suppression du compte : ils sont journalisés, et le balayage rattrape toute équipe vide aux salons existants.
 */
export async function recordAndRequestDissolvedTeams(userId: string, teams: readonly LastMemberTeam[]): Promise<void> {
  for (const team of teams) {
    await recordTeamDissolution(userId, team.communityId, team.teamId, "account_deleted");
    await requestTeamSpaceAfterDissolution({
      communityId: team.communityId, teamId: team.teamId, actorUserId: userId, formerMemberDiscordIds: team.formerMemberDiscordIds,
    });
  }
}
