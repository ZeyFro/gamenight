import type { TournamentStatus } from "@prisma/client";

export function isTournamentPredictionsEnabled(): boolean {
  return process.env.TOURNAMENT_PREDICTIONS_ENABLED === "true";
}

export function canPredictTournamentTarget(
  status: TournamentStatus,
  participants: string[],
  predictedUserId: string,
  match: { player1Id: string | null; player2Id: string | null; winnerId: string | null; completedAt: Date | null } | null,
): boolean {
  if (!match) return status === "REGISTRATION" && participants.includes(predictedUserId);
  return status === "IN_PROGRESS" && !!match.player1Id && !!match.player2Id &&
    !match.winnerId && !match.completedAt && [match.player1Id, match.player2Id].includes(predictedUserId);
}

export function predictionWinner(status: TournamentStatus, championId: string | null, matchWinnerId: string | null): string | null {
  if (status === "CANCELLED") return null;
  return matchWinnerId ?? (status === "DONE" ? championId : null);
}
