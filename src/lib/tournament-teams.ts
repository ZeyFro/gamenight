import { Prisma } from "@prisma/client";
import { getScopedPrisma, scopedPrisma, scopedTransactionPrisma } from "@/lib/community-scoped-client";
import { getCommunityTeamsCommunityId } from "@/lib/community-teams";
import { prisma } from "@/lib/prisma";
import { wallClockNow } from "@/lib/wallclock";
import { advanceWinner, bracketSizeFor, declareWinner, totalRoundsFor } from "@/lib/tournaments";
import { isTournamentScoresEnabled } from "@/lib/tournament-scores";
import { captainIdOf, captainSelect } from "@/lib/tournament-team-captain";
import { enqueueTeamTournamentNotice } from "@/lib/tournament-team-notify";
import {
  agreedScores, compareReports, isTournamentTeamsEnabled, matchReportSchema, maxPlayersForTeams, registrationDeadlinePassed,
  REPORT_REMINDER_AFTER_MS, reportBlock, teamEntryBlock, type EntryBlock, type MatchReportContent, type ReportBlock,
} from "@/lib/tournament-teams-rules";

/** Communauté active de l'utilisateur si le drapeau, les équipes et son appartenance l'autorisent. */
export async function getTournamentTeamsCommunityId(userId: string): Promise<string | null> {
  if (!isTournamentTeamsEnabled()) return null;
  return getCommunityTeamsCommunityId(userId);
}

async function canUse(tx: Prisma.TransactionClient, userId: string, communityId: string): Promise<boolean> {
  const [membership, community] = await Promise.all([
    tx.membership.findUnique({ where: { communityId_userId: { communityId, userId } }, select: { status: true } }),
    tx.community.findUnique({ where: { id: communityId }, select: { status: true, communityTeamsEnabled: true } }),
  ]);
  return membership?.status === "ACTIVE" && community?.status === "ACTIVE" && community.communityTeamsEnabled;
}

/** Conflit sérialisable : P2034 (API Prisma) ou SQLSTATE 40001 remonté par une requête brute (P2010). */
function isSerializationFailure(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  return error.code === "P2034" || (error.code === "P2010" && /40001|could not serialize/i.test(`${error.message} ${JSON.stringify(error.meta ?? {})}`));
}

async function serializable<T>(run: () => Promise<T>): Promise<T> {
  for (let retry = 0; ; retry++) {
    try {
      return await run();
    } catch (error) {
      if (retry < 6 && isSerializationFailure(error)) continue;
      throw error;
    }
  }
}

function shuffle<T>(items: readonly T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

const activeMemberWhere = (communityId: string) => ({ user: { memberships: { some: { communityId, status: "ACTIVE" as const } } } });

// ---------------------------------------------------------------------------------------------------------------------
// Création, invitation, inscription
// ---------------------------------------------------------------------------------------------------------------------

export type CreateTeamTournamentResult = { result: "created"; tournamentId: string } | { result: "invalid_game" | "unavailable" };

/** Un membre actif crée un tournoi d'équipes (public ou privé) pour un jeu : il en est l'organisateur. Aucune annonce publique. */
export async function createTeamTournament(userId: string, communityId: string, input: {
  name: string; gameId: string; maxTeams: number; isPrivate: boolean; registrationClosesAt: Date | null;
}): Promise<CreateTeamTournamentResult> {
  if (await getTournamentTeamsCommunityId(userId) !== communityId) return { result: "unavailable" };
  return prisma.$transaction(async (tx) => {
    if (!await canUse(tx, userId, communityId)) return { result: "unavailable" as const };
    const scopedDb = scopedTransactionPrisma(tx, { communityIds: [communityId], includesDefault: false });
    const game = await scopedDb.game.findUnique({ where: { id: input.gameId }, select: { id: true } });
    if (!game) return { result: "invalid_game" as const };
    const tournament = await scopedDb.tournament.create({
      data: {
        name: input.name, gameId: input.gameId, createdById: userId, communityId, format: "TEAMS",
        maxPlayers: maxPlayersForTeams(input.maxTeams), announceViaBot: false,
      },
      select: { id: true },
    });
    await scopedDb.tournamentTeamSettings.create({
      data: { tournamentId: tournament.id, communityId, isPrivate: input.isPrivate, maxTeams: input.maxTeams, registrationClosesAt: input.registrationClosesAt },
    });
    return { result: "created" as const, tournamentId: tournament.id };
  });
}

export type InviteTeamResult = "invited" | "not_private" | "forbidden" | "closed" | "full" | "already" | "missing" | "unavailable";

/** Tournoi privé : l'organisateur invite une équipe ; le capitaine reçoit un MP et accepte ou refuse. */
export async function inviteTeamToTournament(userId: string, communityId: string, input: { tournamentId: string; teamId: string }): Promise<InviteTeamResult> {
  if (await getTournamentTeamsCommunityId(userId) !== communityId) return "unavailable";
  const outcome = await serializable(() => prisma.$transaction(async (tx) => {
    if (!await canUse(tx, userId, communityId)) return "unavailable" as const;
    const scopedDb = scopedTransactionPrisma(tx, { communityIds: [communityId], includesDefault: false });
    const [tournament, team, existing] = await Promise.all([
      scopedDb.tournament.findFirst({ where: { id: input.tournamentId, communityId }, select: { createdById: true, status: true, teamSettings: { select: { isPrivate: true } } } }),
      scopedDb.communityTeam.findFirst({ where: { id: input.teamId, communityId }, select: { id: true } }),
      scopedDb.tournamentTeamEntry.findUnique({ where: { tournamentId_teamId: { tournamentId: input.tournamentId, teamId: input.teamId } }, select: { id: true, status: true } }),
    ]);
    if (!tournament?.teamSettings || !team) return "missing" as const;
    if (tournament.createdById !== userId) return "forbidden" as const;
    if (!tournament.teamSettings.isPrivate) return "not_private" as const;
    if (tournament.status !== "REGISTRATION") return "closed" as const;
    if (existing?.status === "REGISTERED" || existing?.status === "INVITED") return "already" as const;
    const data = { status: "INVITED" as const, decidedAt: null, createdAt: new Date() };
    const entry = existing
      ? await scopedDb.tournamentTeamEntry.update({ where: { id: existing.id }, data, select: { id: true, createdAt: true } })
      : await scopedDb.tournamentTeamEntry.create({ data: { communityId, tournamentId: input.tournamentId, teamId: input.teamId, ...data }, select: { id: true, createdAt: true } });
    return { invited: entry } as const;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
  if (typeof outcome === "string") return outcome;
  await notifyCaptain(communityId, input.tournamentId, input.teamId, "invited", `${outcome.invited.id}:${outcome.invited.createdAt.getTime()}`);
  return "invited";
}

async function notifyCaptain(communityId: string, tournamentId: string, teamId: string, kind: "invited" | "launched", key: string): Promise<void> {
  const scopedDb = scopedPrisma({ communityIds: [communityId], includesDefault: false });
  const team = await scopedDb.communityTeam.findFirst({ where: { id: teamId, communityId }, select: captainSelect(communityId) });
  const captainId = team ? captainIdOf(team) : null;
  if (captainId) await enqueueTeamTournamentNotice({ communityId, tournamentId, kind, key, recipientIds: [captainId], teamId });
}

/** Notifie les capitaines de toutes les équipes inscrites que le tournoi est lancé (une seule fois par équipe). */
async function notifyLaunched(communityId: string, tournamentId: string): Promise<void> {
  const scopedDb = scopedPrisma({ communityIds: [communityId], includesDefault: false });
  const entries = await scopedDb.tournamentTeamEntry.findMany({ where: { tournamentId, communityId, status: "REGISTERED" }, select: { teamId: true } });
  for (const entry of entries) await notifyCaptain(communityId, tournamentId, entry.teamId, "launched", "launch");
}

export type EnterTeamResult = "registered" | "launched" | EntryBlock | "missing" | "unavailable";

/**
 * Le capitaine inscrit son équipe (tournoi public) ou accepte l'invitation (tournoi privé). La dernière place prise lance
 * le tournoi dans la même transaction (comme les tournois individuels). Les places sont protégées contre la concurrence
 * (verrou de ligne du tournoi + transaction sérialisable).
 */
export async function enterTeamInTournament(userId: string, communityId: string, input: { tournamentId: string; teamId: string }, now: Date = new Date()): Promise<EnterTeamResult> {
  if (await getTournamentTeamsCommunityId(userId) !== communityId) return "unavailable";
  const outcome = await serializable(() => prisma.$transaction(async (tx) => {
    if (!await canUse(tx, userId, communityId)) return "unavailable" as const;
    const [locked] = await tx.$queryRaw<{ status: string }[]>`SELECT status FROM "Tournament" WHERE id = ${input.tournamentId} FOR UPDATE`;
    const scopedDb = scopedTransactionPrisma(tx, { communityIds: [communityId], includesDefault: false });
    const [settings, team, existing, registeredCount] = await Promise.all([
      scopedDb.tournamentTeamSettings.findFirst({ where: { tournamentId: input.tournamentId, communityId }, select: { isPrivate: true, maxTeams: true, registrationClosesAt: true } }),
      scopedDb.communityTeam.findFirst({ where: { id: input.teamId, communityId }, select: { ...captainSelect(communityId), _count: { select: { members: { where: activeMemberWhere(communityId) } } } } }),
      scopedDb.tournamentTeamEntry.findUnique({ where: { tournamentId_teamId: { tournamentId: input.tournamentId, teamId: input.teamId } }, select: { id: true, status: true } }),
      scopedDb.tournamentTeamEntry.count({ where: { tournamentId: input.tournamentId, communityId, status: "REGISTERED" } }),
    ]);
    if (!locked || !settings || !team) return "missing" as const;
    const block = teamEntryBlock({
      registrationOpen: locked.status === "REGISTRATION", deadlinePassed: registrationDeadlinePassed(settings.registrationClosesAt, now),
      isPrivate: settings.isPrivate, existingStatus: existing?.status ?? null, registeredCount, maxTeams: settings.maxTeams,
      actorIsCaptain: captainIdOf(team) === userId, activeMembers: team._count.members,
    });
    if (block) return block;
    if (existing) {
      await scopedDb.tournamentTeamEntry.update({ where: { id: existing.id }, data: { status: "REGISTERED", decidedAt: now } });
    } else {
      await scopedDb.tournamentTeamEntry.create({ data: { communityId, tournamentId: input.tournamentId, teamId: input.teamId, status: "REGISTERED", decidedAt: now } });
    }
    if (registeredCount + 1 >= settings.maxTeams) return (await buildRegisteredTeamBracket(tx, input.tournamentId)) === "launched" ? "launched" as const : "registered" as const;
    return "registered" as const;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
  if (outcome === "launched") await notifyLaunched(communityId, input.tournamentId);
  return outcome;
}

/** Le capitaine refuse une invitation ou retire son équipe tant que le tournoi n'est pas lancé. */
export async function leaveTeamTournament(userId: string, communityId: string, input: { tournamentId: string; teamId: string }): Promise<"declined" | "withdrawn" | "forbidden" | "closed" | "missing" | "unavailable"> {
  if (await getTournamentTeamsCommunityId(userId) !== communityId) return "unavailable";
  return serializable(() => prisma.$transaction(async (tx) => {
    if (!await canUse(tx, userId, communityId)) return "unavailable" as const;
    const [locked] = await tx.$queryRaw<{ status: string }[]>`SELECT status FROM "Tournament" WHERE id = ${input.tournamentId} FOR UPDATE`;
    const scopedDb = scopedTransactionPrisma(tx, { communityIds: [communityId], includesDefault: false });
    const entry = await scopedDb.tournamentTeamEntry.findUnique({
      where: { tournamentId_teamId: { tournamentId: input.tournamentId, teamId: input.teamId } },
      select: { id: true, status: true, communityId: true, team: { select: captainSelect(communityId) } },
    });
    if (!locked || !entry || entry.communityId !== communityId) return "missing" as const;
    if (captainIdOf(entry.team) !== userId) return "forbidden" as const;
    if (locked.status !== "REGISTRATION") return "closed" as const;
    if (entry.status !== "INVITED" && entry.status !== "REGISTERED") return "missing" as const;
    const declined = entry.status === "INVITED";
    await scopedDb.tournamentTeamEntry.update({ where: { id: entry.id }, data: { status: declined ? "DECLINED" : "WITHDRAWN", decidedAt: new Date() } });
    return declined ? "declined" as const : "withdrawn" as const;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
}

// ---------------------------------------------------------------------------------------------------------------------
// Lancement : équipes inscrites -> équipes de bracket
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Fige les équipes inscrites (chacune avec ses membres actifs du moment) en `TournamentTeam` / `TournamentParticipant` puis
 * génère le bracket complet avec les byes, exactement comme `buildBracketInTransaction` pour les équipes tirées au sort : l'avancement, l'XP
 * et la clôture existants s'appliquent sans changement. Verrouille la ligne du tournoi ; à appeler dans la transaction de l'appelant.
 * Aucun effet externe ici.
 */
export async function buildRegisteredTeamBracket(tx: Prisma.TransactionClient, tournamentId: string): Promise<"launched" | "too_few" | "not_open"> {
  const [locked] = await tx.$queryRaw<{ status: string; communityId: string | null }[]>`SELECT status, "communityId" FROM "Tournament" WHERE id = ${tournamentId} FOR UPDATE`;
  if (!locked || locked.status !== "REGISTRATION" || !locked.communityId) return "not_open";
  const communityId = locked.communityId;
  const scopedDb = scopedTransactionPrisma(tx, { communityIds: [communityId], includesDefault: false });
  const settings = await scopedDb.tournamentTeamSettings.findFirst({ where: { tournamentId, communityId }, select: { maxTeams: true } });
  if (!settings) return "not_open";
  const entries = await scopedDb.tournamentTeamEntry.findMany({
    where: { tournamentId, communityId, status: "REGISTERED" },
    orderBy: { createdAt: "asc" },
    select: { id: true, team: { select: { id: true, name: true, members: { where: activeMemberWhere(communityId), orderBy: [{ joinedAt: "asc" }, { userId: "asc" }], select: { userId: true } } } } },
  });
  const playable = entries.filter((entry) => entry.team.members.length > 0);
  if (playable.length < 2) return "too_few";

  const bracketSize = bracketSizeFor(settings.maxTeams);
  const totalRounds = totalRoundsFor(bracketSize);
  const matchCount = bracketSize / 2;
  const shuffled = shuffle(playable);

  const competitorIds: string[] = [];
  let seed = 0;
  for (const [index, entry] of shuffled.entries()) {
    const bracketTeam = await scopedDb.tournamentTeam.create({ data: { tournamentId, name: entry.team.name.slice(0, 80), position: index + 1 }, select: { id: true } });
    for (const member of entry.team.members) {
      seed += 1;
      await scopedDb.tournamentParticipant.upsert({
        where: { tournamentId_userId: { tournamentId, userId: member.userId } },
        create: { tournamentId, userId: member.userId, seed }, update: { seed },
      });
      await scopedDb.tournamentTeamMember.create({ data: { tournamentId, teamId: bracketTeam.id, userId: member.userId } });
    }
    await scopedDb.tournamentTeamEntry.update({ where: { id: entry.id }, data: { tournamentTeamId: bracketTeam.id } });
    competitorIds.push(bracketTeam.id);
  }
  // Équipes inscrites sans aucun membre actif au lancement : retirées (aucune place dans le bracket).
  const emptyEntries = entries.filter((entry) => entry.team.members.length === 0);
  if (emptyEntries.length) await scopedDb.tournamentTeamEntry.updateMany({ where: { id: { in: emptyEntries.map((entry) => entry.id) } }, data: { status: "WITHDRAWN", decidedAt: wallClockNow() } });

  // Statistiques de participation (comme l'inscription individuelle).
  const participantIds = [...new Set(shuffled.flatMap((entry) => entry.team.members.map((member) => member.userId)))];
  await scopedDb.communityMemberStats.createMany({ data: participantIds.map((userId) => ({ communityId, userId })), skipDuplicates: true });
  await scopedDb.communityMemberStats.updateMany({ where: { communityId, userId: { in: participantIds } }, data: { tournamentsParticipatedCount: { increment: 1 } } });

  const round1 = Array.from({ length: matchCount }, (_, position) => ({
    position, team1Id: competitorIds[position] ?? null, team2Id: competitorIds[matchCount + position] ?? null,
  }));
  await scopedDb.tournament.update({ where: { id: tournamentId }, data: { status: "IN_PROGRESS" } });
  await scopedDb.tournamentMatch.createMany({ data: round1.map((match) => ({ tournamentId, round: 1, position: match.position, team1Id: match.team1Id, team2Id: match.team2Id })) });
  for (let round = 2; round <= totalRounds; round++) {
    await scopedDb.tournamentMatch.createMany({
      data: Array.from({ length: bracketSize / 2 ** round }, (_, position) => ({ tournamentId, round, position })),
    });
  }
  for (const match of round1) {
    const winner = match.team1Id && !match.team2Id ? match.team1Id : !match.team1Id && match.team2Id ? match.team2Id : null;
    if (!winner) continue;
    await scopedDb.tournamentMatch.update({
      where: { tournamentId_round_position: { tournamentId, round: 1, position: match.position } },
      data: { winnerTeamId: winner, completedAt: wallClockNow() },
    });
    await advanceWinner(tx, tournamentId, 1, match.position, winner, totalRounds, false, true);
  }
  return "launched";
}

/** L'organisateur lance le tournoi avant que toutes les places soient prises (au moins 2 équipes). */
export async function launchTeamTournament(userId: string, communityId: string, tournamentId: string): Promise<"launched" | "too_few" | "closed" | "forbidden" | "missing" | "unavailable"> {
  if (await getTournamentTeamsCommunityId(userId) !== communityId) return "unavailable";
  const outcome = await serializable(() => prisma.$transaction(async (tx) => {
    if (!await canUse(tx, userId, communityId)) return "unavailable" as const;
    const scopedDb = scopedTransactionPrisma(tx, { communityIds: [communityId], includesDefault: false });
    const tournament = await scopedDb.tournament.findFirst({ where: { id: tournamentId, communityId }, select: { createdById: true, teamSettings: { select: { tournamentId: true } } } });
    if (!tournament?.teamSettings) return "missing" as const;
    if (tournament.createdById !== userId) return "forbidden" as const;
    const built = await buildRegisteredTeamBracket(tx, tournamentId);
    return built === "not_open" ? "closed" as const : built;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
  if (outcome === "launched") await notifyLaunched(communityId, tournamentId);
  return outcome;
}

// ---------------------------------------------------------------------------------------------------------------------
// Résultat confirmé par les deux capitaines
// ---------------------------------------------------------------------------------------------------------------------

export type ReportResult = "confirmed" | "waiting" | "disputed" | ReportBlock | "missing" | "unavailable";

const teamCaptainSelect = (communityId: string) => ({ name: true, registeredEntry: { select: { team: { select: captainSelect(communityId) } } } });

/**
 * Un capitaine déclare le gagnant de son match (et les scores si TOURNAMENT_SCORES_ENABLED). La déclaration est immuable (verrou : une
 * seule par équipe). Quand les deux capitaines ont déclaré : concordantes = match validé par le mécanisme existant
 * (`declareWinner`, avancement, XP, clôture) ; discordantes = désaccord, l'organisateur est prévenu par MP et tranche.
 * La première déclaration prévient le capitaine adverse par MP (une relance unique est envoyée après 12 h).
 */
export async function submitMatchReport(userId: string, communityId: string, input: unknown): Promise<ReportResult> {
  if (await getTournamentTeamsCommunityId(userId) !== communityId) return "unavailable";
  const parsed = matchReportSchema.safeParse(input);
  if (!parsed.success) return "missing";
  const { matchId, winnerTeamId } = parsed.data;
  const scored = isTournamentScoresEnabled() && parsed.data.score1 !== undefined && parsed.data.score2 !== undefined;
  const content: MatchReportContent = { winnerTeamId, score1: scored ? parsed.data.score1 ?? null : null, score2: scored ? parsed.data.score2 ?? null : null };
  const scopedDb = await getScopedPrisma(userId);
  const match = await scopedDb.tournamentMatch.findFirst({
    where: { id: matchId, tournament: { communityId, teamSettings: { isNot: null } } },
    select: {
      id: true, tournamentId: true, completedAt: true, team1Id: true, team2Id: true, tournament: { select: { status: true, createdById: true } },
      team1: { select: teamCaptainSelect(communityId) }, team2: { select: teamCaptainSelect(communityId) },
    },
  });
  if (!match) return "missing";
  const captainOf = (team: typeof match.team1) => (team?.registeredEntry?.team ? captainIdOf(team.registeredEntry.team) : null);
  const actorTeamSlot = captainOf(match.team1) === userId ? 1 : captainOf(match.team2) === userId ? 2 : null;
  const actorTeamId = actorTeamSlot === 1 ? match.team1Id : actorTeamSlot === 2 ? match.team2Id : null;
  const existing = actorTeamId ? await scopedDb.tournamentMatchReport.findUnique({ where: { matchId_teamId: { matchId, teamId: actorTeamId } }, select: { id: true } }) : null;
  const block = reportBlock({
    tournamentInProgress: match.tournament.status === "IN_PROGRESS", matchDecided: match.completedAt !== null,
    bothTeamsKnown: Boolean(match.team1Id && match.team2Id), actorTeamSlot, alreadyReported: existing !== null,
    winnerInMatch: winnerTeamId === match.team1Id || winnerTeamId === match.team2Id,
  });
  if (block) return block;

  let report: { id: string };
  try {
    report = await scopedDb.tournamentMatchReport.create({
      data: { communityId, tournamentId: match.tournamentId, matchId, teamId: actorTeamId as string, winnerTeamId, score1: content.score1, score2: content.score2, reportedById: userId },
      select: { id: true },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return "already_reported";
    throw error;
  }

  const reports = await scopedDb.tournamentMatchReport.findMany({ where: { matchId }, select: { teamId: true, winnerTeamId: true, score1: true, score2: true } });
  const other = reports.find((candidate) => candidate.teamId !== actorTeamId);
  if (!other) {
    const opponentCaptain = captainOf(actorTeamSlot === 1 ? match.team2 : match.team1);
    if (opponentCaptain) await enqueueTeamTournamentNotice({ communityId, tournamentId: match.tournamentId, kind: "report_pending", key: report.id, recipientIds: [opponentCaptain], matchId });
    return "waiting";
  }
  if (compareReports(content, other) === "agree") {
    const result = await declareWinner(matchId, winnerTeamId, userId, scored || other.score1 !== null ? agreedScores(content, other) : undefined, { viaTeamConfirmation: true });
    if (result.ok) return "confirmed";
  }
  await enqueueTeamTournamentNotice({ communityId, tournamentId: match.tournamentId, kind: "dispute", key: `${matchId}:${reports.length}`, recipientIds: [match.tournament.createdById], matchId });
  return "disputed";
}

export type ResolveResult = "resolved" | "forbidden" | "invalid_winner" | "already_decided" | "not_ready" | "inconsistent" | "missing" | "unavailable";

/**
 * Désaccord (ou capitaine absent) : l'organisateur du tournoi ou un ADMIN/OWNER de la communauté tranche. La décision passe par le mécanisme
 * existant avec l'organisateur comme autorité d'enregistrement ; les déclarations des capitaines restent conservées pour l'historique.
 */
export async function resolveMatchByReferee(userId: string, communityId: string, input: { matchId: string; winnerTeamId: string; score1?: number; score2?: number }): Promise<ResolveResult> {
  if (await getTournamentTeamsCommunityId(userId) !== communityId) return "unavailable";
  const scopedDb = await getScopedPrisma(userId);
  const match = await scopedDb.tournamentMatch.findFirst({
    where: { id: input.matchId, tournament: { communityId, teamSettings: { isNot: null } } },
    select: { completedAt: true, team1Id: true, team2Id: true, tournament: { select: { createdById: true, status: true } } },
  });
  if (!match) return "missing";
  const membership = await prisma.membership.findUnique({ where: { communityId_userId: { communityId, userId } }, select: { role: true, status: true } });
  const isReferee = match.tournament.createdById === userId || (membership?.status === "ACTIVE" && (membership.role === "ADMIN" || membership.role === "OWNER"));
  if (!isReferee) return "forbidden";
  if (match.completedAt) return "already_decided";
  if (match.tournament.status !== "IN_PROGRESS" || !match.team1Id || !match.team2Id) return "not_ready";
  if (input.winnerTeamId !== match.team1Id && input.winnerTeamId !== match.team2Id) return "invalid_winner";
  const scores = isTournamentScoresEnabled() && input.score1 !== undefined && input.score2 !== undefined ? { score1: input.score1, score2: input.score2 } : undefined;
  const result = await declareWinner(input.matchId, input.winnerTeamId, match.tournament.createdById, scores, { viaTeamConfirmation: true });
  if (result.ok) return "resolved";
  return result.error ? "inconsistent" : "already_decided";
}

// ---------------------------------------------------------------------------------------------------------------------
// Entretien (cron) : relance de confirmation, verrouillage des inscriptions à l'échéance
// ---------------------------------------------------------------------------------------------------------------------

export interface TeamTournamentMaintenanceReport { communities: number; reminded: number; locked: number }

/**
 * Relance UNE fois le capitaine adverse dont la confirmation attend depuis 12 h, et lance les tournois dont l'échéance d'inscription est
 * passée (au moins 2 équipes ; sinon l'organisateur décide). Idempotent ; MP via la file uniquement.
 */
export async function runTeamTournamentMaintenance(now: Date = new Date()): Promise<TeamTournamentMaintenanceReport> {
  const report: TeamTournamentMaintenanceReport = { communities: 0, reminded: 0, locked: 0 };
  const communities = await prisma.community.findMany({ where: { status: "ACTIVE", communityTeamsEnabled: true }, select: { id: true }, orderBy: { id: "asc" } });
  for (const { id: communityId } of communities) {
    report.communities += 1;
    const scopedDb = scopedPrisma({ communityIds: [communityId], includesDefault: false });
    const dueReports = await scopedDb.tournamentMatchReport.findMany({
      where: {
        communityId, remindedAt: null, createdAt: { lte: new Date(now.getTime() - REPORT_REMINDER_AFTER_MS) },
        match: { completedAt: null, tournament: { status: "IN_PROGRESS" } },
      },
      select: {
        id: true, matchId: true, tournamentId: true, teamId: true,
        match: { select: { team1Id: true, team2Id: true, team1: { select: teamCaptainSelect(communityId) }, team2: { select: teamCaptainSelect(communityId) }, reports: { select: { id: true } } } },
      },
      orderBy: { createdAt: "asc" },
      take: 100,
    });
    for (const due of dueReports) {
      if (due.match.reports.length !== 1) continue;
      const opponent = due.teamId === due.match.team1Id ? due.match.team2 : due.match.team1;
      const captainId = opponent?.registeredEntry?.team ? captainIdOf(opponent.registeredEntry.team) : null;
      if (!captainId) continue;
      const queued = await enqueueTeamTournamentNotice({ communityId, tournamentId: due.tournamentId, kind: "reminder", key: due.id, recipientIds: [captainId], matchId: due.matchId });
      if (queued === "disabled") continue; // File éteinte : la relance n'est pas consommée.
      const updated = await scopedDb.tournamentMatchReport.updateMany({ where: { id: due.id, remindedAt: null }, data: { remindedAt: now } });
      report.reminded += updated.count;
    }
    const overdue = await scopedDb.tournamentTeamSettings.findMany({
      where: { communityId, registrationClosesAt: { lte: now }, tournament: { status: "REGISTRATION" } },
      select: { tournamentId: true }, take: 25,
    });
    for (const { tournamentId } of overdue) {
      const built = await prisma.$transaction((tx) => buildRegisteredTeamBracket(tx, tournamentId), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      if (built === "launched") {
        report.locked += 1;
        await notifyLaunched(communityId, tournamentId);
      }
    }
  }
  return report;
}
