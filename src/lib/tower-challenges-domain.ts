import { z } from "zod";
import {
  getTowerParisDayKey,
  canClaimSoloChallenge,
  canSubmitChallengeProof,
  canReceiveChallengeReward,
} from "./tower-challenge-rules";

export { getTowerParisDayKey, canClaimSoloChallenge, canSubmitChallengeProof, canReceiveChallengeReward };

export const challengeDefinitionId = z.string().min(1).max(191).regex(/^[a-zA-Z0-9_-]+$/);
export type ChallengeDefinitionId = z.infer<typeof challengeDefinitionId>;

export const soloChallengeDefinitionSchema = z.object({
  id: challengeDefinitionId,
  title: z.string().trim().min(1).max(120),
  instructions: z.string().trim().min(1).max(1500),
  rewardFloors: z.number().int().min(1).max(20),
  gameId: z.string().nullable(),
});
export type SoloChallengeDefinition = z.infer<typeof soloChallengeDefinitionSchema>;

export const isSoloChallengeDefinition = soloChallengeDefinitionSchema;

export type ChallengePlays = {
  playedDefinitionIds: readonly ChallengeDefinitionId[];
  ownedGameIds: readonly string[];
};

/**
 * Retourne les défis disponibles pour un joueur.
 *
 * - Défis sans gameId jouables par tout le monde.
 * - Défis avec gameId jouables uniquement si le joueur les possède.
 * - Par défaut, préfère les défis non encore joués ; les défis joués ne sont
 *   utilisables que si aucun défis non joué n'est disponible (règle cohérente
 *   avec `claimSoloTowerChallenge`).
 */
export function availableSoloChallenges(
  definitions: readonly SoloChallengeDefinition[],
  plays: ChallengePlays,
  preferUnseen: boolean = true,
): readonly SoloChallengeDefinition[] {
  const played = new Set(plays.playedDefinitionIds);
  let pool = definitions.filter((d) => {
    if (!plays.ownedGameIds.length) return d.gameId === null;
    return d.gameId === null || plays.ownedGameIds.includes(d.gameId);
  });
  if (preferUnseen && pool.length) {
    const unseen = pool.filter((d) => !played.has(d.id));
    if (unseen.length) pool = unseen;
  }
  // ordre déterministe pour les tests
  return [...pool].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Choix déterministe d'un défi parmi les disponibles.
 * seed optionnel pour la reproductibilité des tests ; sans seed,
 * retourne le premier (ordre déterministe de availableSoloChallenges).
 */
export function pickSoloChallenge(
  available: readonly SoloChallengeDefinition[],
  seed?: string,
): SoloChallengeDefinition | null {
  if (!available.length) return null;
  const pool = available;
  if (seed) {
    let h = 0;
    for (let i = 0; i < seed.length; i++) {
      h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
    }
    const idx = Math.abs(h) % pool.length;
    return pool[idx];
  }
  return pool[0];
}

export type SoloChallengeAssignment = {
  definitionId: ChallengeDefinitionId;
  title: string;
  instructions: string;
  rewardFloors: number;
};

export function toSoloChallengeAssignment(definition: SoloChallengeDefinition): SoloChallengeAssignment {
  return {
    definitionId: definition.id,
    title: definition.title,
    instructions: definition.instructions,
    rewardFloors: definition.rewardFloors,
  };
}

export type AttemptStatus =
  | { kind: "pending"; assignedAt: Date; expiresAt: Date }
  | { kind: "valid" }
  | { kind: "expired" }
  | { kind: "submitted" }
  | { kind: "rejected" };

export function attemptStatus(
  assignedAt: Date,
  now: Date,
  submitted: boolean,
): AttemptStatus {
  const current = now.getTime();
  if (submitted) return { kind: "submitted" };
  if (current >= new Date(assignedAt.getTime() + 48 * 60 * 60 * 1000).getTime()) {
    return { kind: "expired" };
  }
  return { kind: "pending", assignedAt, expiresAt: new Date(assignedAt.getTime() + 48 * 60 * 60 * 1000) };
}
