import { TOURNAMENT_XP_MIN_ESTABLISHED_PARTICIPANTS } from "@/lib/xp";
import { TOWER_VOTER_MIN_TENURE_MS, towerVoterEligibility } from "@/lib/tower-vote-eligibility";

// XP de tournoi (audit du 23/11/2026, constat 1.11) : versée seulement si au moins TOURNAMENT_XP_MIN_ESTABLISHED_PARTICIPANTS
// participants sont des membres actifs « établis ». Même ancienneté que les votants des preuves Tower (Membership.joinedAt de la
// communauté, 3 jours par décision de Maxime) : on réutilise la constante et la règle, sans les dupliquer ; si l'ancienneté des
// tournois devait un jour différer de celle des votants, ce serait ici qu'il faudrait les séparer.
export const TOURNAMENT_XP_MIN_TENURE_MS = TOWER_VOTER_MIN_TENURE_MS;

export interface TournamentParticipantMembership {
  status: string | null | undefined;
  joinedAt: Date | null | undefined;
}

/** Participants dont la Membership est active depuis au moins `TOURNAMENT_XP_MIN_TENURE_MS` ; sans Membership = non établi. */
export function countEstablishedParticipants(participants: readonly TournamentParticipantMembership[], now: Date): number {
  return participants.filter((p) => towerVoterEligibility({ status: p.status, joinedAt: p.joinedAt, now }) === "ELIGIBLE").length;
}

/** Vrai quand le tournoi compte assez de participants établis pour verser de l'XP. */
export function isTournamentXpEligible(participants: readonly TournamentParticipantMembership[], now: Date): boolean {
  return countEstablishedParticipants(participants, now) >= TOURNAMENT_XP_MIN_ESTABLISHED_PARTICIPANTS;
}
