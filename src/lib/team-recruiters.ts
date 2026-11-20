import { Prisma } from "@prisma/client";
import { getScopedPrisma, scopedTransactionPrisma } from "@/lib/community-scoped-client";
import { prisma } from "@/lib/prisma";
import { getTeamApplicationsCommunityId } from "@/lib/team-applications";
import { leaderIdOf, leaderSelect } from "@/lib/team-leader";
import {
  isTeamRecruitersEnabled, recruiterNominationBlock, teamGuestBlock, type GuestBlock, type RecruiterBlock,
} from "@/lib/team-recruiters-rules";

/** Communauté active de l'utilisateur si recruteurs/invités, candidatures, équipes et appartenance l'autorisent. */
export async function getTeamRecruitersCommunityId(userId: string): Promise<string | null> {
  if (!isTeamRecruitersEnabled()) return null;
  return getTeamApplicationsCommunityId(userId);
}

const activeMemberWhere = (communityId: string) => ({
  user: { memberships: { some: { communityId, status: "ACTIVE" as const } } },
});

async function canUse(tx: Prisma.TransactionClient, userId: string, communityId: string): Promise<boolean> {
  const [membership, community] = await Promise.all([
    tx.membership.findUnique({ where: { communityId_userId: { communityId, userId } }, select: { status: true } }),
    tx.community.findUnique({ where: { id: communityId }, select: { status: true, communityTeamsEnabled: true } }),
  ]);
  return membership?.status === "ACTIVE" && community?.status === "ACTIVE" && community.communityTeamsEnabled;
}

async function serializable<T>(run: () => Promise<T>): Promise<T> {
  for (let retry = 0; ; retry++) {
    try {
      return await run();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034" && retry < 3) continue;
      throw error;
    }
  }
}

export type NominateResult = "added" | RecruiterBlock | "missing" | "unavailable";

/** Le capitaine nomme un recruteur parmi les membres actifs de son équipe : 2 au plus, protégé contre la concurrence (sérialisable + unique). */
export async function addTeamRecruiter(userId: string, communityId: string, input: { teamId: string; userId: string }): Promise<NominateResult> {
  if (await getTeamRecruitersCommunityId(userId) !== communityId) return "unavailable";
  try {
    return await serializable(() => prisma.$transaction(async (tx) => {
      if (!await canUse(tx, userId, communityId)) return "unavailable";
      const scopedDb = scopedTransactionPrisma(tx, { communityIds: [communityId], includesDefault: false });
      const team = await scopedDb.communityTeam.findFirst({ where: { id: input.teamId, communityId }, select: leaderSelect(communityId) });
      if (!team) return "missing";
      const leaderId = leaderIdOf(team);
      const [member, existing, currentCount] = await Promise.all([
        scopedDb.communityTeamMember.findFirst({ where: { teamId: input.teamId, communityId, userId: input.userId, ...activeMemberWhere(communityId) }, select: { id: true } }),
        scopedDb.communityTeamRecruiter.findUnique({ where: { teamId_userId: { teamId: input.teamId, userId: input.userId } }, select: { id: true } }),
        scopedDb.communityTeamRecruiter.count({ where: { teamId: input.teamId, communityId } }),
      ]);
      const block = recruiterNominationBlock({
        actorIsLeader: leaderId === userId, targetIsLeader: input.userId === leaderId, targetIsActiveMember: Boolean(member),
        alreadyRecruiter: Boolean(existing), currentCount,
      });
      if (block) return block;
      await scopedDb.communityTeamRecruiter.create({ data: { communityId, teamId: input.teamId, userId: input.userId, namedById: userId } });
      return "added";
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return "already";
    throw error;
  }
}

/** Le capitaine retire un recruteur ; un recruteur peut aussi se retirer lui-même. */
export async function removeTeamRecruiter(userId: string, communityId: string, input: { teamId: string; userId: string }): Promise<"removed" | "forbidden" | "missing" | "unavailable"> {
  if (await getTeamRecruitersCommunityId(userId) !== communityId) return "unavailable";
  const scopedDb = await getScopedPrisma(userId);
  const team = await scopedDb.communityTeam.findFirst({ where: { id: input.teamId, communityId }, select: leaderSelect(communityId) });
  if (!team) return "missing";
  if (leaderIdOf(team) !== userId && input.userId !== userId) return "forbidden";
  const deleted = await scopedDb.communityTeamRecruiter.deleteMany({ where: { teamId: input.teamId, communityId, userId: input.userId } });
  return deleted.count ? "removed" : "missing";
}

/** Recruteurs d'une équipe (affichage : visible aux membres actifs de la communauté). */
export async function listTeamRecruiters(userId: string, communityId: string, teamId: string) {
  if (await getTeamRecruitersCommunityId(userId) !== communityId) return [];
  const scopedDb = await getScopedPrisma(userId);
  return scopedDb.communityTeamRecruiter.findMany({
    where: { communityId, teamId, user: { memberships: { some: { communityId, status: "ACTIVE" } } } },
    select: { userId: true, user: { select: { discordName: true } } },
    orderBy: { createdAt: "asc" },
  });
}

export type InviteGuestResult = "invited" | GuestBlock | "missing" | "unavailable";

/**
 * Le responsable invite un joueur d'une AUTRE équipe (ou sans équipe) à jouer un tournoi pour la sienne. L'invitation ne
 * touche jamais l'équipe principale de l'invité (une seule par joueur et par communauté).
 */
export async function inviteTeamGuest(userId: string, communityId: string, input: { teamId: string; tournamentId: string; userId: string }): Promise<InviteGuestResult> {
  if (await getTeamRecruitersCommunityId(userId) !== communityId) return "unavailable";
  try {
    return await serializable(() => prisma.$transaction(async (tx) => {
      if (!await canUse(tx, userId, communityId)) return "unavailable";
      const scopedDb = scopedTransactionPrisma(tx, { communityIds: [communityId], includesDefault: false });
      const [team, tournament] = await Promise.all([
        scopedDb.communityTeam.findFirst({ where: { id: input.teamId, communityId }, select: leaderSelect(communityId) }),
        scopedDb.tournament.findFirst({ where: { id: input.tournamentId, communityId }, select: { status: true } }),
      ]);
      if (!team || !tournament) return "missing";
      const [targetMember, targetMembership, existing, memberCount, guestCount] = await Promise.all([
        scopedDb.communityTeamMember.findFirst({ where: { teamId: input.teamId, communityId, userId: input.userId }, select: { id: true } }),
        tx.membership.findUnique({ where: { communityId_userId: { communityId, userId: input.userId } }, select: { status: true } }),
        scopedDb.teamTournamentGuest.findUnique({ where: { tournamentId_userId: { tournamentId: input.tournamentId, userId: input.userId } }, select: { status: true, teamId: true } }),
        scopedDb.communityTeamMember.count({ where: { teamId: input.teamId, communityId, ...activeMemberWhere(communityId) } }),
        scopedDb.teamTournamentGuest.count({ where: { teamId: input.teamId, tournamentId: input.tournamentId, communityId, status: { in: ["INVITED", "ACCEPTED"] } } }),
      ]);
      // Une invitation d'une autre équipe encore active bloque aussi : un joueur n'est invité que par une équipe par tournoi.
      const existingStatus = existing && (existing.teamId !== input.teamId && (existing.status === "INVITED" || existing.status === "ACCEPTED") ? "ACCEPTED" : existing.status);
      const block = teamGuestBlock({
        actorIsLeader: leaderIdOf(team) === userId, tournamentRegistrationOpen: tournament.status === "REGISTRATION",
        targetIsTeamMember: Boolean(targetMember), targetIsActive: targetMembership?.status === "ACTIVE",
        existingStatus: existingStatus ?? null, rosterSize: memberCount + guestCount,
      });
      if (block) return block;
      const data = { status: "INVITED" as const, invitedById: userId, teamId: input.teamId, decidedAt: null, createdAt: new Date() };
      if (existing) {
        await scopedDb.teamTournamentGuest.update({ where: { tournamentId_userId: { tournamentId: input.tournamentId, userId: input.userId } }, data });
      } else {
        await scopedDb.teamTournamentGuest.create({ data: { communityId, tournamentId: input.tournamentId, userId: input.userId, ...data } });
      }
      return "invited";
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return "already_guest";
    throw error;
  }
}

/** L'invité accepte ou refuse ; seul l'invité répond, seulement tant que l'invitation est en attente et le tournoi ouvert. */
export async function respondToTeamGuestInvitation(userId: string, communityId: string, guestId: string, accept: boolean): Promise<"accepted" | "declined" | "missing" | "unavailable"> {
  if (await getTeamRecruitersCommunityId(userId) !== communityId) return "unavailable";
  const scopedDb = await getScopedPrisma(userId);
  const updated = await scopedDb.teamTournamentGuest.updateMany({
    where: { id: guestId, communityId, userId, status: "INVITED", tournament: { status: "REGISTRATION" } },
    data: { status: accept ? "ACCEPTED" : "DECLINED", decidedAt: new Date() },
  });
  if (!updated.count) return "missing";
  return accept ? "accepted" : "declined";
}

/** Le responsable de l'équipe retire une invitation (en attente ou acceptée) tant que le tournoi n'a pas démarré. */
export async function revokeTeamGuest(userId: string, communityId: string, guestId: string): Promise<"revoked" | "forbidden" | "missing" | "unavailable"> {
  if (await getTeamRecruitersCommunityId(userId) !== communityId) return "unavailable";
  const scopedDb = await getScopedPrisma(userId);
  const guest = await scopedDb.teamTournamentGuest.findFirst({
    where: { id: guestId, communityId, status: { in: ["INVITED", "ACCEPTED"] }, tournament: { status: "REGISTRATION" } },
    select: { team: { select: leaderSelect(communityId) } },
  });
  if (!guest) return "missing";
  if (leaderIdOf(guest.team) !== userId) return "forbidden";
  const updated = await scopedDb.teamTournamentGuest.updateMany({
    where: { id: guestId, communityId, status: { in: ["INVITED", "ACCEPTED"] } }, data: { status: "REVOKED", decidedAt: new Date() },
  });
  return updated.count ? "revoked" : "missing";
}

/** Invitations reçues par l'utilisateur (tournois encore ouverts), les plus récentes d'abord. */
export async function listMyGuestInvitations(userId: string, communityId: string) {
  if (await getTeamRecruitersCommunityId(userId) !== communityId) return [];
  const scopedDb = await getScopedPrisma(userId);
  return scopedDb.teamTournamentGuest.findMany({
    where: { communityId, userId, status: { in: ["INVITED", "ACCEPTED"] }, tournament: { status: "REGISTRATION" } },
    select: { id: true, status: true, team: { select: { name: true } }, tournament: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
    take: 25,
  });
}

/** Invités d'une équipe pour les tournois encore ouverts (affichage au responsable). */
export async function listTeamGuests(userId: string, communityId: string, teamId: string) {
  if (await getTeamRecruitersCommunityId(userId) !== communityId) return [];
  const scopedDb = await getScopedPrisma(userId);
  return scopedDb.teamTournamentGuest.findMany({
    where: { communityId, teamId, status: { in: ["INVITED", "ACCEPTED"] }, tournament: { status: "REGISTRATION" } },
    select: { id: true, status: true, user: { select: { discordName: true } }, tournament: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

/** Choix du formulaire d'invitation : tournois encore ouverts et membres actifs de la communauté hors de l'équipe. */
export async function listGuestInviteOptions(userId: string, communityId: string, teamId: string) {
  if (await getTeamRecruitersCommunityId(userId) !== communityId) return { tournaments: [], players: [] };
  const scopedDb = await getScopedPrisma(userId);
  const [tournaments, players] = await Promise.all([
    scopedDb.tournament.findMany({ where: { communityId, status: "REGISTRATION" }, select: { id: true, name: true }, orderBy: { createdAt: "desc" }, take: 25 }),
    prisma.user.findMany({
      where: { memberships: { some: { communityId, status: "ACTIVE" } }, communityTeamMemberships: { none: { teamId } } },
      select: { id: true, discordName: true }, orderBy: { discordName: "asc" }, take: 200,
    }),
  ]);
  return { tournaments, players };
}
