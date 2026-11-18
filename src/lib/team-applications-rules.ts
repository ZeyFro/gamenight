import { z } from "zod";

/** Candidatures d'équipe (cahier §11.1). OFF par défaut : actif seulement si la valeur vaut exactement `true`. */
export function isTeamApplicationsEnabled(): boolean {
  return process.env.TEAM_APPLICATIONS_ENABLED === "true";
}

export const TEAM_APPLICATION_MESSAGE_MAX = 500;

export const teamApplicationSchema = z.object({
  teamId: z.string().trim().min(1).max(191),
  message: z.string().trim().min(1).max(TEAM_APPLICATION_MESSAGE_MAX),
});

/**
 * Responsable d'une équipe : le capitaine (`captainId`, à défaut le créateur) tant qu'il est membre actif de la
 * communauté, sinon le membre actif le plus ancien (même règle que `setCommunityTeamRecruitment`,
 * `src/lib/community-teams.ts`).
 */
export function resolveTeamLeaderId(team: {
  captainId: string | null;
  createdById: string;
  leaderIsActive: boolean;
  oldestActiveMemberId: string | null;
}): string | null {
  return team.leaderIsActive ? (team.captainId ?? team.createdById) : team.oldestActiveMemberId;
}

export type ApplyBlock = "already_member" | "pending" | "closed" | "full";

/** Pourquoi une candidature est refusée, `null` si elle peut être déposée. Une candidature refusée ou retirée peut être renvoyée. */
export function teamApplicationBlock(input: {
  isMember: boolean;
  isRecruiting: boolean;
  activeMembers: number;
  maxMembers: number;
  existingStatus: "PENDING" | "ACCEPTED" | "DECLINED" | "WITHDRAWN" | null;
}): ApplyBlock | null {
  if (input.isMember) return "already_member";
  if (!input.isRecruiting) return "closed";
  if (input.activeMembers >= input.maxMembers) return "full";
  if (input.existingStatus === "PENDING") return "pending";
  return null;
}
