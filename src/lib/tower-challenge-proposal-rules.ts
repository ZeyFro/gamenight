import { z } from "zod";
import { compareTowerRanks, getTowerPersonalRank } from "@/lib/tower-ranks";
import { towerChallengeDefinitionContentSchema } from "@/lib/tower-challenge-import-packs";

/**
 * Propositions de défis par les grades élevés (cahier 8.7). OFF par défaut : actif seulement si la valeur vaut
 * exactement `true`. Aucune IA : le staff relit et valide chaque proposition avant son entrée au catalogue.
 */
export function isTowerChallengeProposalsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.TOWER_CHALLENGE_PROPOSALS_ENABLED === "true";
}

/** Barème décidé : facile +1, moyen +2, difficile +3 étages. */
export const TOWER_PROPOSAL_MIN_FLOORS = 1;
export const TOWER_PROPOSAL_MAX_FLOORS = 3;
/** Limites anti-spam par joueur (choix de mise en œuvre, non décidées par le propriétaire) : fenêtre glissante de 24 h. */
export const TOWER_PROPOSALS_PER_DAY = 2;
export const TOWER_PROPOSALS_MAX_PENDING = 5;
export const TOWER_PROPOSAL_DAY_MS = 24 * 3600000;

/** Même parseur de contenu que `/tower-admin ajouter` (titre ≤ 120, consigne ≤ 1500), barème borné à 1-3. */
export const towerChallengeProposalSchema = towerChallengeDefinitionContentSchema.extend({
  rewardFloors: z.number().int().min(TOWER_PROPOSAL_MIN_FLOORS).max(TOWER_PROPOSAL_MAX_FLOORS),
});

export const towerProposalDecisionSchema = z.object({
  proposalId: z.string().trim().min(1).max(191),
  approve: z.boolean(),
  note: z.string().trim().max(500).optional(),
});

/** Ranker et High Ranker proposent ; le grade dépend des étages permanents (30 pour Ranker, High Ranker en inclut ≥ 100). */
export function canProposeTowerChallenge(floorsClimbed: number | bigint): boolean {
  return compareTowerRanks(getTowerPersonalRank(floorsClimbed, 0), "Ranker") >= 0;
}

export type ProposalBlock = "not_ranker" | "daily_limit" | "pending_limit";

export function towerProposalBlock(input: { floorsClimbed: number | bigint; lastDayCount: number; pendingCount: number }): ProposalBlock | null {
  if (!canProposeTowerChallenge(input.floorsClimbed)) return "not_ranker";
  if (input.lastDayCount >= TOWER_PROPOSALS_PER_DAY) return "daily_limit";
  if (input.pendingCount >= TOWER_PROPOSALS_MAX_PENDING) return "pending_limit";
  return null;
}
