import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isTournamentTeamsEnabled } from "@/lib/tournament-teams-rules";

/**
 * Gardes à brancher dans le code des tournois existants. Sans TOURNAMENT_TEAMS_ENABLED aucune requête n'est faite
 * (les tables de la migration `tournament_teams` ne sont jamais lues) et rien ne change.
 */

/** Ce tournoi a-t-il des équipes inscrites (une ligne TournamentTeamSettings) ? Faux, sans lecture, drapeau éteint. */
export async function isRegisteredTeamTournament(tournamentId: string, db: Pick<typeof prisma, "tournamentTeamSettings"> | Prisma.TransactionClient = prisma): Promise<boolean> {
  if (!isTournamentTeamsEnabled()) return false;
  const row = await db.tournamentTeamSettings.findUnique({ where: { tournamentId }, select: { tournamentId: true } });
  return row !== null;
}

/**
 * Condition à ajouter aux LISTES de tournois (accueil, Discord) : exclut les tournois d'équipes privés que `viewerId`
 * n'organise pas et où aucune de ses équipes n'est invitée ou inscrite. Vide drapeau éteint.
 */
export function privateTeamTournamentWhere(viewerId: string | null): Prisma.TournamentWhereInput {
  if (!isTournamentTeamsEnabled()) return {};
  return {
    OR: [
      { teamSettings: null },
      { teamSettings: { is: { isPrivate: false } } },
      ...(viewerId ? [
        { createdById: viewerId },
        { teamEntries: { some: { team: { members: { some: { userId: viewerId } } } } } },
      ] : []),
    ],
  };
}

/** Variante sans lecteur (commandes Discord) : jamais de tournoi privé. */
export function publicTeamTournamentWhere(): Prisma.TournamentWhereInput {
  if (!isTournamentTeamsEnabled()) return {};
  return { NOT: { teamSettings: { is: { isPrivate: true } } } };
}
