import { prisma } from "@/lib/prisma";
import { resolveEffectiveCaptain } from "@/lib/community-team-captain";
import { createPrismaCaptainStore, type CaptainStore } from "@/lib/community-team-captain-store";

/**
 * Capitainerie — service métier unique.
 *
 * Règles tenues ici :
 * - `createdById` est le **créateur historique** : il n'est jamais réécrit ;
 * - `captainId` (PR #370/#408) est le capitaine responsable quand la colonne
 *   existe ; la passation n'écrit que ce champ ;
 * - tant que `captainId` n'est pas migré, le capitaine effectif est le créateur
 *   actif (transition explicite) et **la passation est refusée** :
 *   `captain_source_unavailable` — elle ne serait pas durable ;
 * - jamais le premier membre, jamais un repli silencieux si le capitaine
 *   désigné n'est plus membre.
 */
export type TeamCaptainState =
  | { status: "found"; captainId: string; captainName: string | null; source: "captainId" | "createdById" }
  | { status: "none"; reason: "no_captain" | "captain_not_member" }
  | { status: "missing" };

export type CaptainTransferResult =
  | "transferred"
  | "not_captain"
  | "not_member"
  | "same"
  | "missing"
  | "unavailable"
  | "captain_source_unavailable";

interface TeamMemberRow {
  userId: string;
  name: string | null;
  active: boolean;
}

async function loadTeamMembers(teamId: string, communityId: string): Promise<{ members: TeamMemberRow[]; exists: boolean }> {
  const rows = await prisma.communityTeamMember.findMany({
    where: { teamId, communityId },
    select: {
      userId: true,
      user: {
        select: {
          discordName: true,
          memberships: { where: { communityId, status: "ACTIVE" }, select: { id: true } },
        },
      },
    },
  });
  return {
    exists: true,
    members: rows.map((row) => ({
      userId: row.userId,
      name: row.user.discordName ?? null,
      active: row.user.memberships.length > 0,
    })),
  };
}

async function teamExists(teamId: string, communityId: string): Promise<boolean> {
  const row = await prisma.communityTeam.findFirst({
    where: { id: teamId, communityId },
    select: { id: true },
  });
  return Boolean(row);
}

export async function getTeamCaptain(
  input: { teamId: string; communityId: string },
  store?: CaptainStore
): Promise<TeamCaptainState> {
  const captainStore = store ?? (await createPrismaCaptainStore());
  if (!(await teamExists(input.teamId, input.communityId))) return { status: "missing" };
  const rows = await captainStore.load(input.communityId, [input.teamId]);
  const row = rows.get(input.teamId);
  if (!row) return { status: "missing" };
  const { members } = await loadTeamMembers(input.teamId, input.communityId);
  const activeIds = members.filter((member) => member.active).map((member) => member.userId);
  const effective = resolveEffectiveCaptain({
    createdById: row.createdById,
    captainId: row.captainId,
    activeMemberIds: activeIds,
  });
  if (effective.kind !== "CAPTAIN") {
    return { status: "none", reason: row.captainId ? "captain_not_member" : "no_captain" };
  }
  return {
    status: "found",
    captainId: effective.userId,
    captainName: members.find((member) => member.userId === effective.userId)?.name ?? null,
    source: row.captainId ? "captainId" : "createdById",
  };
}

/** Seul le capitaine effectif gère l'équipe ; un membre ordinaire n'a aucun droit. */
export async function canManageTeam(
  input: { teamId: string; communityId: string; userId: string },
  store?: CaptainStore
): Promise<boolean> {
  const state = await getTeamCaptain({ teamId: input.teamId, communityId: input.communityId }, store);
  return state.status === "found" && state.captainId === input.userId;
}

/**
 * Passation durable : écrit `captainId` uniquement, après vérification du
 * capitaine effectif et de l'adhésion active du successeur. `createdById` reste
 * le créateur historique, intact.
 */
export async function transferTeamCaptain(
  input: {
    teamId: string;
    communityId: string;
    actorId: string;
    newCaptainUserId: string;
  },
  store?: CaptainStore
): Promise<CaptainTransferResult> {
  const captainStore = store ?? (await createPrismaCaptainStore());
  // Sans colonne `captainId`, aucune passation durable n'est possible : on ne
  // détourne pas `createdById` pour simuler un transfert.
  if (!captainStore.supported) return "captain_source_unavailable";
  if (!(await teamExists(input.teamId, input.communityId))) return "missing";

  const rows = await captainStore.load(input.communityId, [input.teamId]);
  const row = rows.get(input.teamId);
  if (!row) return "missing";
  const { members } = await loadTeamMembers(input.teamId, input.communityId);
  const activeIds = members.filter((member) => member.active).map((member) => member.userId);
  const effective = resolveEffectiveCaptain({
    createdById: row.createdById,
    captainId: row.captainId,
    activeMemberIds: activeIds,
  });
  if (effective.kind !== "CAPTAIN") return "unavailable";
  if (effective.userId !== input.actorId) return "not_captain";
  if (effective.userId === input.newCaptainUserId) return "same";
  if (!activeIds.includes(input.newCaptainUserId)) return "not_member";

  const changed = await captainStore.setCaptain({
    teamId: input.teamId,
    communityId: input.communityId,
    expectedCaptainId: effective.userId,
    newCaptainId: input.newCaptainUserId,
  });
  return changed === 1 ? "transferred" : "not_captain";
}

/** Libellés honnêtes : jamais de succès inventé, jamais de mutation implicite. */
export function describeCaptainTransfer(result: CaptainTransferResult): string {
  switch (result) {
    case "transferred":
      return "✅ Capitainerie transférée : le nouveau capitaine gère désormais l’équipe. Le créateur historique reste inchangé.";
    case "same":
      return "Ce membre est déjà capitaine : rien n’a changé.";
    case "not_captain":
      return "Seul le capitaine actuel peut transmettre la capitainerie.";
    case "not_member":
      return "Le nouveau capitaine doit être membre actif de l’équipe.";
    case "missing":
      return "Cette équipe n’existe plus.";
    case "captain_source_unavailable":
      return "La passation n’est pas encore disponible : le champ officiel `captainId` (PR #370/#408) n’est pas migré. Le créateur historique reste capitaine par transition, et rien n’a été modifié.";
    default:
      return "Aucun capitaine actif n’est établi : la capitainerie ne peut pas être transférée dans cet état.";
  }
}
