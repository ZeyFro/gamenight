import { z } from "zod";

/**
 * Règles pures des rivalités entre équipes (flag `TEAM_RIVALRIES_ENABLED`, OFF par défaut).
 * Défi proposé par le capitaine d'une équipe, accepté par le capitaine adverse ; résultat déclaré
 * par un capitaine puis confirmé par l'AUTRE capitaine. Aucun XP, aucun étage, aucun classement officiel.
 */
export const CHALLENGE_PROPOSAL_TTL_MS = 7 * 24 * 3_600_000;
export const MAX_OPEN_CHALLENGES_PER_TEAM = 5;

export type ChallengeStatus = "PROPOSED" | "ACCEPTED" | "RESULT_REPORTED" | "COMPLETED" | "DECLINED" | "CANCELLED" | "EXPIRED";
export type ChallengeOutcome = "CHALLENGER_WON" | "OPPONENT_WON" | "DRAW";
export const OPEN_STATUSES: readonly ChallengeStatus[] = ["PROPOSED", "ACCEPTED", "RESULT_REPORTED"];

export function teamRivalriesEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.TEAM_RIVALRIES_ENABLED === "true";
}

export const challengeInputSchema = z.object({
  challengerTeamId: z.string().min(1).max(64),
  opponentTeamId: z.string().min(1).max(64),
  gameName: z.string().trim().max(80).optional().transform((value) => value || undefined),
  message: z.string().trim().max(300).optional().transform((value) => value || undefined),
});

export const outcomeSchema = z.enum(["CHALLENGER_WON", "OPPONENT_WON", "DRAW"]);

/** Capitaine effectif : capitaine désigné, sinon créateur (même règle que `/equipes`). */
export function captainIdOf(team: { captainId: string | null; createdById: string }): string {
  return team.captainId ?? team.createdById;
}

export function proposalDecision(input: {
  challengerTeamId: string;
  opponentTeamId: string;
  pairHasOpenChallenge: boolean;
  openForChallenger: number;
  openForOpponent: number;
}): "ok" | "same_team" | "pair_open" | "too_many" {
  if (input.challengerTeamId === input.opponentTeamId) return "same_team";
  if (input.pairHasOpenChallenge) return "pair_open";
  if (input.openForChallenger >= MAX_OPEN_CHALLENGES_PER_TEAM || input.openForOpponent >= MAX_OPEN_CHALLENGES_PER_TEAM) return "too_many";
  return "ok";
}

export interface ChallengeLike {
  status: ChallengeStatus;
  expiresAt: Date;
  challengerTeamId: string;
  opponentTeamId: string;
  reportedByTeamId: string | null;
}

/** Seul le capitaine adverse répond, une proposition échue ne peut plus être acceptée. */
export function respondDecision(challenge: Pick<ChallengeLike, "status" | "expiresAt">, now: Date): "ok" | "not_proposed" | "expired" {
  if (challenge.status !== "PROPOSED") return "not_proposed";
  if (challenge.expiresAt.getTime() <= now.getTime()) return "expired";
  return "ok";
}

export function reportDecision(challenge: Pick<ChallengeLike, "status">): "ok" | "not_accepted" {
  return challenge.status === "ACCEPTED" ? "ok" : "not_accepted";
}

/** Confirmation ou contestation : seulement l'équipe qui n'a PAS déclaré le résultat. */
export function confirmDecision(challenge: ChallengeLike, actorTeamId: string): "ok" | "not_reported" | "same_team" {
  if (challenge.status !== "RESULT_REPORTED") return "not_reported";
  if (!challenge.reportedByTeamId || challenge.reportedByTeamId === actorTeamId) return "same_team";
  return "ok";
}

export interface RecordEntry {
  status: ChallengeStatus;
  outcome: ChallengeOutcome | null;
  challengerTeamId: string;
  opponentTeamId: string;
}

/** Bilan d'une équipe sur les seuls défis COMPLETED (résultat confirmé par les deux capitaines). */
export function computeRecord(entries: readonly RecordEntry[], teamId: string): { played: number; wins: number; losses: number; draws: number } {
  const record = { played: 0, wins: 0, losses: 0, draws: 0 };
  for (const entry of entries) {
    if (entry.status !== "COMPLETED" || !entry.outcome) continue;
    if (entry.challengerTeamId !== teamId && entry.opponentTeamId !== teamId) continue;
    record.played++;
    if (entry.outcome === "DRAW") record.draws++;
    else if ((entry.outcome === "CHALLENGER_WON") === (entry.challengerTeamId === teamId)) record.wins++;
    else record.losses++;
  }
  return record;
}
