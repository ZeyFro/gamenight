import { prisma } from "@/lib/prisma";

/**
 * Capitainerie — service métier unique, aligné sur la règle de
 * `community-team-captain` : le capitaine est `CommunityTeam.createdById` tant
 * qu'il est membre actif. Aucune autre source, jamais le premier membre.
 *
 * Une passation qui exige l'accord du destinataire demanderait un modèle
 * « invitation » (migration) : elle n'est pas simulée ici. `transferTeamCaptain`
 * est une décision du capitaine actuel, appliquée immédiatement et
 * idempotente.
 */
export type TeamCaptainState =
  | { status: "found"; captainId: string; captainName: string | null }
  | { status: "none" }
  | { status: "missing" };

export type CaptainTransferResult = "transferred" | "not_captain" | "not_member" | "same" | "missing" | "unavailable";

interface TeamRow {
  createdById: string;
  maxMembers: number;
}

async function loadTeam(teamId: string, communityId: string): Promise<TeamRow | null> {
  const team = await prisma.communityTeam.findFirst({
    where: { id: teamId, communityId },
    select: { createdById: true, maxMembers: true },
  });
  return team ?? null;
}

async function activeMember(teamId: string, communityId: string, userId: string): Promise<boolean> {
  const member = await prisma.communityTeamMember.findUnique({
    where: { teamId_userId: { teamId, userId } },
    select: { communityId: true, user: { select: { memberships: { where: { communityId, status: "ACTIVE" }, select: { id: true } } } } },
  });
  return Boolean(member && member.communityId === communityId && member.user.memberships.length > 0);
}

export async function getTeamCaptain(input: { teamId: string; communityId: string }): Promise<TeamCaptainState> {
  const team = await prisma.communityTeam.findFirst({
    where: { id: input.teamId, communityId: input.communityId },
    select: { createdById: true, createdBy: { select: { discordName: true } } },
  });
  if (!team) return { status: "missing" };
  const isActive = await activeMember(input.teamId, input.communityId, team.createdById);
  if (!isActive) return { status: "none" };
  return { status: "found", captainId: team.createdById, captainName: team.createdBy.discordName ?? null };
}

/** Seul le capitaine actif gère l'équipe ; un membre ordinaire n'a aucun droit. */
export async function canManageTeam(input: { teamId: string; communityId: string; userId: string }): Promise<boolean> {
  const state = await getTeamCaptain({ teamId: input.teamId, communityId: input.communityId });
  return state.status === "found" && state.captainId === input.userId;
}

/**
 * Passation : le capitaine actuel désigne un membre actif. Le nouveau capitaine
 * doit déjà appartenir à l'équipe (aucune promotion par simple identifiant).
 */
export async function transferTeamCaptain(input: {
  teamId: string;
  communityId: string;
  actorId: string;
  newCaptainUserId: string;
}): Promise<CaptainTransferResult> {
  const team = await loadTeam(input.teamId, input.communityId);
  if (!team) return "missing";
  if (!(await activeMember(input.teamId, input.communityId, input.actorId))) return "unavailable";
  if (team.createdById !== input.actorId) return "not_captain";
  if (team.createdById === input.newCaptainUserId) return "same";
  if (!(await activeMember(input.teamId, input.communityId, input.newCaptainUserId))) return "not_member";

  // Mise à jour conditionnelle : si un autre transfert a eu lieu entre-temps,
  // `count` vaut 0 et rien n'est écrasé (idempotent, sans écrasement aveugle).
  const updated = await prisma.communityTeam.updateMany({
    where: { id: input.teamId, communityId: input.communityId, createdById: input.actorId },
    data: { createdById: input.newCaptainUserId },
  });
  return updated.count === 1 ? "transferred" : "not_captain";
}

/** Libellés honnêtes pour les commandes : jamais de succès inventé. */
export function describeCaptainTransfer(result: CaptainTransferResult): string {
  switch (result) {
    case "transferred":
      return "✅ Capitainerie transférée : le nouveau capitaine gère désormais l’équipe.";
    case "same":
      return "Ce membre est déjà capitaine : rien n’a changé.";
    case "not_captain":
      return "Seul le capitaine actuel peut transmettre la capitainerie.";
    case "not_member":
      return "Le nouveau capitaine doit être membre actif de l’équipe.";
    case "missing":
      return "Cette équipe n’existe plus.";
    default:
      return "Ton compte n’est pas membre actif de cette communauté : la capitainerie reste inchangée.";
  }
}
