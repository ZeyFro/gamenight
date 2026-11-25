import { getScopedPrisma } from "@/lib/community-scoped-client";
import { prisma } from "@/lib/prisma";
import { captainIdOf, captainSelect } from "@/lib/tournament-team-captain";
import { privateTeamTournamentWhere } from "@/lib/tournament-team-guards";
import { getTournamentTeamsCommunityId } from "@/lib/tournament-teams";
import { uniqueGameOptions } from "@/lib/game-search";

/** Tournois d'équipes visibles par `userId` (publics, ou privés qu'il organise ou où l'une de ses équipes est invitée/inscrite). */
export async function listTeamTournaments(userId: string, communityId: string) {
  if (await getTournamentTeamsCommunityId(userId) !== communityId) return [];
  const scopedDb = await getScopedPrisma(userId);
  return scopedDb.tournament.findMany({
    where: { communityId, teamSettings: { isNot: null }, status: { in: ["REGISTRATION", "IN_PROGRESS", "DONE"] }, ...privateTeamTournamentWhere(userId) },
    select: {
      id: true, name: true, status: true, createdAt: true, game: { select: { name: true } }, teamSettings: { select: { isPrivate: true, maxTeams: true } },
      _count: { select: { teamEntries: { where: { status: "REGISTERED" } } } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

/** Équipes dont `userId` est le capitaine (formulaires d'inscription). */
export async function listCaptainedTeams(userId: string, communityId: string) {
  if (await getTournamentTeamsCommunityId(userId) !== communityId) return [];
  const scopedDb = await getScopedPrisma(userId);
  const teams = await scopedDb.communityTeam.findMany({
    where: { communityId, members: { some: { userId } } },
    select: { id: true, name: true, ...captainSelect(communityId) },
    orderBy: { name: "asc" },
  });
  return teams.filter((team) => captainIdOf(team) === userId).map((team) => ({ id: team.id, name: team.name }));
}

/** Équipes de la communauté proposables à une invitation (tournoi privé). */
export async function listInvitableTeams(userId: string, communityId: string) {
  if (await getTournamentTeamsCommunityId(userId) !== communityId) return [];
  const scopedDb = await getScopedPrisma(userId);
  return scopedDb.communityTeam.findMany({
    where: { communityId, members: { some: { user: { memberships: { some: { communityId, status: "ACTIVE" } } } } } },
    select: { id: true, name: true }, orderBy: { name: "asc" }, take: 200,
  });
}

/**
 * Jeux proposables à la création, sans doublon visible dans le `<select>`.
 * Un même jeu peut exister en deux lignes (import Steam sans `igdbId`, puis
 * ajout IGDB/manuel portant le même nom) : le sélecteur natif affichait alors
 * deux fois le même titre. On replie sur la première ligne (ordre stable nom
 * puis id) : c'est son `id` qui part dans le formulaire, donc
 * `createTeamTournament` enregistre bien le jeu affiché. Les jeux réellement
 * distincts et les éditions différentes gardent chacun leur entrée.
 */
export async function listTournamentGames() {
  const games = await prisma.game.findMany({
    select: { id: true, name: true, igdbId: true, steamAppId: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: 500,
  });
  return uniqueGameOptions(games).map(({ id, name }) => ({ id, name }));
}

/**
 * Vue complète d'un tournoi d'équipes pour `userId`, ou `null` (inexistant, autre communauté, ou privé sans lien avec lui : indistinguables).
 * `viewer` indique ses rôles : organisateur, arbitre (organisateur ou ADMIN/OWNER), équipes qu'il capitaine (inscription, invitation) et
 * équipes de bracket qu'il capitaine (déclaration de résultat).
 */
export async function getTeamTournamentView(userId: string, communityId: string, tournamentId: string) {
  if (await getTournamentTeamsCommunityId(userId) !== communityId) return null;
  const scopedDb = await getScopedPrisma(userId);
  const tournament = await scopedDb.tournament.findFirst({
    where: { id: tournamentId, communityId, teamSettings: { isNot: null }, ...privateTeamTournamentWhere(userId) },
    select: {
      id: true, name: true, status: true, createdById: true, game: { select: { name: true } },
      createdBy: { select: { discordName: true } },
      teamSettings: { select: { isPrivate: true, maxTeams: true, registrationClosesAt: true } },
      teamEntries: {
        select: { teamId: true, status: true, tournamentTeamId: true, team: { select: { name: true, ...captainSelect(communityId) } } },
        orderBy: { createdAt: "asc" },
      },
      matches: {
        select: {
          id: true, round: true, position: true, team1Id: true, team2Id: true, winnerTeamId: true, completedAt: true, score1: true, score2: true,
          team1: { select: { name: true } }, team2: { select: { name: true } },
          reports: { select: { teamId: true, winnerTeamId: true, score1: true, score2: true } },
        },
        orderBy: [{ round: "asc" }, { position: "asc" }],
      },
    },
  });
  if (!tournament?.teamSettings) return null;
  const membership = await prisma.membership.findUnique({ where: { communityId_userId: { communityId, userId } }, select: { role: true } });
  const isOrganizer = tournament.createdById === userId;
  const captained = tournament.teamEntries.filter((entry) => captainIdOf(entry.team) === userId);
  return {
    id: tournament.id, name: tournament.name, status: tournament.status, gameName: tournament.game.name, organizerName: tournament.createdBy.discordName,
    settings: tournament.teamSettings,
    entries: tournament.teamEntries.map((entry) => ({ teamId: entry.teamId, teamName: entry.team.name, status: entry.status })),
    matches: tournament.matches,
    viewer: {
      isOrganizer,
      isReferee: isOrganizer || membership?.role === "ADMIN" || membership?.role === "OWNER",
      captainEntryTeamIds: captained.map((entry) => ({ teamId: entry.teamId, status: entry.status })),
      captainBracketTeamIds: captained.flatMap((entry) => (entry.tournamentTeamId ? [entry.tournamentTeamId] : [])),
    },
  };
}
