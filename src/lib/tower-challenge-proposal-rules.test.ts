import { describe, expect, it } from "vitest";
import {
  canProposeTowerChallenge, isTowerChallengeProposalsEnabled, towerChallengeProposalSchema, towerProposalBlock,
  towerProposalDecisionSchema, TOWER_PROPOSALS_MAX_PENDING, TOWER_PROPOSALS_PER_DAY,
} from "./tower-challenge-proposal-rules";

describe("propositions de défis : règles pures", () => {
  it.each([undefined, "", "false", "TRUE", "1"])("drapeau %o : éteint", value => {
    expect(isTowerChallengeProposalsEnabled({ TOWER_CHALLENGE_PROPOSALS_ENABLED: value })).toBe(false);
  });
  it("drapeau true : allumé", () => {
    expect(isTowerChallengeProposalsEnabled({ TOWER_CHALLENGE_PROPOSALS_ENABLED: "true" })).toBe(true);
  });

  it.each([[0, false], [29, false], [30, true], [99, true], [100, true], [500, true]])("%i étages : proposer = %s", (floors, expected) => {
    expect(canProposeTowerChallenge(floors)).toBe(expected);
    expect(canProposeTowerChallenge(BigInt(floors))).toBe(expected);
  });

  it("borne le barème à 1-3 étages et reprend les limites du parseur /tower-admin ajouter", () => {
    const ok = { title: "Titre", instructions: "Consigne", rewardFloors: 2 };
    expect(towerChallengeProposalSchema.safeParse(ok).success).toBe(true);
    for (const rewardFloors of [0, 4, 20, 1.5, -1]) expect(towerChallengeProposalSchema.safeParse({ ...ok, rewardFloors }).success).toBe(false);
    expect(towerChallengeProposalSchema.safeParse({ ...ok, title: "x".repeat(121) }).success).toBe(false);
    expect(towerChallengeProposalSchema.safeParse({ ...ok, title: "x".repeat(120) }).success).toBe(true);
    expect(towerChallengeProposalSchema.safeParse({ ...ok, instructions: "x".repeat(1501) }).success).toBe(false);
    expect(towerChallengeProposalSchema.safeParse({ ...ok, instructions: "x".repeat(1500) }).success).toBe(true);
    expect(towerChallengeProposalSchema.safeParse({ ...ok, title: "   " }).success).toBe(false);
  });

  it("applique les limites par joueur : grade, 24 h, propositions en attente", () => {
    expect(towerProposalBlock({ floorsClimbed: 10, lastDayCount: 0, pendingCount: 0 })).toBe("not_ranker");
    expect(towerProposalBlock({ floorsClimbed: 30, lastDayCount: TOWER_PROPOSALS_PER_DAY - 1, pendingCount: 0 })).toBeNull();
    expect(towerProposalBlock({ floorsClimbed: 30, lastDayCount: TOWER_PROPOSALS_PER_DAY, pendingCount: 0 })).toBe("daily_limit");
    expect(towerProposalBlock({ floorsClimbed: 120, lastDayCount: 0, pendingCount: TOWER_PROPOSALS_MAX_PENDING })).toBe("pending_limit");
  });

  it("valide la décision du staff", () => {
    expect(towerProposalDecisionSchema.safeParse({ proposalId: "p", approve: true }).success).toBe(true);
    expect(towerProposalDecisionSchema.safeParse({ proposalId: "", approve: true }).success).toBe(false);
    expect(towerProposalDecisionSchema.safeParse({ proposalId: "p", approve: false, note: "x".repeat(501) }).success).toBe(false);
    expect(towerProposalDecisionSchema.safeParse({ proposalId: "p" }).success).toBe(false);
  });
});
