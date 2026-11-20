import { z } from "zod";

/**
 * Recruteurs d'équipe, relance/expiration des candidatures et invités de tournoi (décision du 18/11/2026).
 * OFF par défaut : actif seulement si la valeur vaut exactement `true`. Sans ce drapeau, aucune table ajoutée
 * par la migration `team_recruiters_guest` n'est lue ni écrite.
 */
export function isTeamRecruitersEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.TEAM_RECRUITERS_ENABLED === "true";
}

/** MP de candidature : exige aussi l'executor de notifications et le jeton du bot (aucun appel Discord direct). */
export function teamApplicationNoticesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return isTeamRecruitersEnabled(env) && env.TEAM_APPLICATIONS_ENABLED === "true"
    && env.NOTIFICATION_EXECUTOR_ENABLED === "true" && Boolean(env.DISCORD_BOT_TOKEN?.trim());
}

/** Décision du propriétaire : le capitaine nomme 2 recruteurs au plus. */
export const MAX_TEAM_RECRUITERS = 2;
/** Effectif maximal d'une équipe (décision §26) : plafond dur, même si une ligne historique dit davantage. */
export const TEAM_HARD_MAX_MEMBERS = 8;
/** Relance unique, 48 h après le dépôt. */
export const APPLICATION_REMINDER_AFTER_MS = 48 * 60 * 60 * 1000;
/** Expiration, 7 jours après le dépôt. */
export const APPLICATION_EXPIRY_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

export const teamRecruiterSchema = z.object({
  teamId: z.string().trim().min(1).max(191),
  userId: z.string().trim().min(1).max(191),
});

export const teamGuestInviteSchema = z.object({
  teamId: z.string().trim().min(1).max(191),
  tournamentId: z.string().trim().min(1).max(191),
  userId: z.string().trim().min(1).max(191),
});

export type ApplicationLifecycleStep = "none" | "remind" | "expire";

/**
 * Étape due pour une candidature EN ATTENTE : `expire` à 7 jours (même si la relance n'a jamais été
 * envoyée : une seule relance, jamais rattrapée après l'échéance), `remind` à 48 h tant que la relance
 * n'est pas partie, sinon `none`.
 */
export function applicationLifecycleStep(input: { createdAt: Date; reminderSentAt: Date | null }, now: Date): ApplicationLifecycleStep {
  const age = now.getTime() - input.createdAt.getTime();
  if (age >= APPLICATION_EXPIRY_AFTER_MS) return "expire";
  if (!input.reminderSentAt && age >= APPLICATION_REMINDER_AFTER_MS) return "remind";
  return "none";
}

/** Décideurs d'une candidature : le responsable, plus les recruteurs nommés (si le drapeau est actif), sans doublon. */
export function applicationApproverIds(input: { leaderId: string | null; recruiterIds: readonly string[] }): string[] {
  const ids = new Set<string>();
  if (input.leaderId) ids.add(input.leaderId);
  for (const id of input.recruiterIds) ids.add(id);
  return [...ids];
}

export type RecruiterBlock = "forbidden" | "not_member" | "already" | "limit" | "self_leader";

/** Pourquoi la nomination d'un recruteur est refusée, `null` si elle est possible. Le capitaine n'a pas besoin de l'être. */
export function recruiterNominationBlock(input: {
  actorIsLeader: boolean; targetIsLeader: boolean; targetIsActiveMember: boolean; alreadyRecruiter: boolean; currentCount: number;
}): RecruiterBlock | null {
  if (!input.actorIsLeader) return "forbidden";
  if (input.targetIsLeader) return "self_leader";
  if (!input.targetIsActiveMember) return "not_member";
  if (input.alreadyRecruiter) return "already";
  if (input.currentCount >= MAX_TEAM_RECRUITERS) return "limit";
  return null;
}

export type GuestBlock =
  | "forbidden" | "tournament_closed" | "already_member" | "not_active" | "already_guest" | "roster_full" | "own_team_entered";

/**
 * Invité d'une autre équipe pour un tournoi. Le joueur garde son équipe principale : il ne peut pas être invité par
 * sa propre équipe (il en fait déjà partie). Pas de plafond autre que l'effectif de 8 (membres + invités acceptés ou en attente).
 */
export function teamGuestBlock(input: {
  actorIsLeader: boolean; tournamentRegistrationOpen: boolean; targetIsTeamMember: boolean; targetIsActive: boolean;
  existingStatus: "INVITED" | "ACCEPTED" | "DECLINED" | "REVOKED" | null; rosterSize: number;
}): GuestBlock | null {
  if (!input.actorIsLeader) return "forbidden";
  if (!input.tournamentRegistrationOpen) return "tournament_closed";
  if (input.targetIsTeamMember) return "already_member";
  if (!input.targetIsActive) return "not_active";
  if (input.existingStatus === "INVITED" || input.existingStatus === "ACCEPTED") return "already_guest";
  if (input.rosterSize >= TEAM_HARD_MAX_MEMBERS) return "roster_full";
  return null;
}
