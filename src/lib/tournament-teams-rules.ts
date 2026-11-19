import { z } from "zod";

/**
 * Tournois par équipes inscrites (décision du 18/11/2026). OFF par défaut : actif seulement si la valeur vaut exactement
 * `true`. Sans ce drapeau aucune table de la migration `tournament_teams` n'est lue ni écrite.
 */
export function isTournamentTeamsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.TOURNAMENT_TEAMS_ENABLED === "true";
}

/** Tournoi d'équipes : 2 à 8 équipes (bracket de 4 ou 8, byes résolus au lancement). */
export const MIN_TOURNAMENT_TEAMS = 2;
export const MAX_TOURNAMENT_TEAMS = 8;
/** Rappel au capitaine adverse si une déclaration attend sa confirmation depuis ce délai (une seule fois). */
export const REPORT_REMINDER_AFTER_MS = 12 * 60 * 60 * 1000;
export const SCORE_MAX = 999;

/** `Tournament.maxPlayers` d'un tournoi TEAMS : le bracket existant vaut `bracketSizeFor(maxPlayers / 2)`. */
export function maxPlayersForTeams(maxTeams: number): number {
  return maxTeams * 2;
}

const idField = z.string().trim().min(1).max(191);

export const createTeamTournamentSchema = z.object({
  name: z.string().trim().min(3).max(80),
  gameId: idField,
  maxTeams: z.coerce.number().int().min(MIN_TOURNAMENT_TEAMS).max(MAX_TOURNAMENT_TEAMS),
  isPrivate: z.boolean().default(false),
  registrationClosesAt: z.date().nullable().default(null),
});

export const teamEntrySchema = z.object({ tournamentId: idField, teamId: idField });

const scoreField = z.preprocess(
  (value) => (value === "" || value === null || value === undefined ? undefined : value),
  z.coerce.number().int().min(0).max(SCORE_MAX).optional(),
);

export const matchReportSchema = z.object({
  matchId: idField,
  winnerTeamId: idField,
  score1: scoreField,
  score2: scoreField,
}).refine((report) => (report.score1 === undefined) === (report.score2 === undefined), { message: "Renseigne les deux scores ou aucun." });

export type MatchReportContent = { winnerTeamId: string; score1: number | null; score2: number | null };

export type ReportOutcome = "agree" | "disagree";

/**
 * Deux déclarations concordent si elles désignent le même gagnant ET, quand les deux portent des scores
 * (TOURNAMENT_SCORES_ENABLED), les mêmes scores. Un score présent d'un seul côté ne crée pas de désaccord :
 * le gagnant fait foi, les scores ne sont conservés que s'ils concordent.
 */
export function compareReports(a: MatchReportContent, b: MatchReportContent): ReportOutcome {
  if (a.winnerTeamId !== b.winnerTeamId) return "disagree";
  const aScored = a.score1 !== null && a.score2 !== null;
  const bScored = b.score1 !== null && b.score2 !== null;
  if (aScored && bScored && (a.score1 !== b.score1 || a.score2 !== b.score2)) return "disagree";
  return "agree";
}

/** Scores à enregistrer sur le match une fois les deux déclarations concordantes. */
export function agreedScores(a: MatchReportContent, b: MatchReportContent): { score1: number; score2: number } | undefined {
  const scored = [a, b].find((report) => report.score1 !== null && report.score2 !== null);
  return scored ? { score1: scored.score1 as number, score2: scored.score2 as number } : undefined;
}

export type EntryBlock = "closed" | "locked" | "full" | "already" | "not_invited" | "forbidden" | "too_small";

/** Pourquoi l'inscription d'une équipe est refusée, `null` si possible. Tournoi privé : sur invitation seulement. */
export function teamEntryBlock(input: {
  registrationOpen: boolean; deadlinePassed: boolean; isPrivate: boolean; existingStatus: "INVITED" | "REGISTERED" | "DECLINED" | "WITHDRAWN" | null;
  registeredCount: number; maxTeams: number; actorIsCaptain: boolean; activeMembers: number;
}): EntryBlock | null {
  if (!input.actorIsCaptain) return "forbidden";
  if (!input.registrationOpen) return "closed";
  if (input.deadlinePassed) return "locked";
  if (input.existingStatus === "REGISTERED") return "already";
  if (input.isPrivate && input.existingStatus !== "INVITED") return "not_invited";
  if (input.registeredCount >= input.maxTeams) return "full";
  if (input.activeMembers < 1) return "too_small";
  return null;
}

export function registrationDeadlinePassed(closesAt: Date | null, now: Date): boolean {
  return closesAt !== null && now.getTime() >= closesAt.getTime();
}

/** Déclaration d'un capitaine : seul un des deux capitaines du match, tant qu'il n'a pas déjà déclaré (verrou). */
export type ReportBlock = "forbidden" | "closed" | "already_reported" | "already_decided" | "invalid_winner" | "not_ready";

export function reportBlock(input: {
  tournamentInProgress: boolean; matchDecided: boolean; bothTeamsKnown: boolean; actorTeamSlot: 1 | 2 | null;
  alreadyReported: boolean; winnerInMatch: boolean;
}): ReportBlock | null {
  if (input.matchDecided) return "already_decided";
  if (!input.tournamentInProgress) return "closed";
  if (!input.bothTeamsKnown) return "not_ready";
  if (input.actorTeamSlot === null) return "forbidden";
  if (input.alreadyReported) return "already_reported";
  if (!input.winnerInMatch) return "invalid_winner";
  return null;
}
