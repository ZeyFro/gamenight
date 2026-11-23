import { describe, expect, it } from "vitest";
import { isProposalLimitReached, MAX_PROPOSALS_PER_SESSION, PROPOSAL_LIMIT_MESSAGE } from "@/lib/session-proposal-limit";
import { countSessionVoteGains, VOTE_XP_CAP_PER_SESSION } from "@/lib/xp";

/** Audit du 23/11/2026, constat 1.10 : plafonds de propositions par soirée et de gains d'XP « vote » par soirée. */
describe("plafond de propositions par soirée", () => {
  it("valeur proposée : 10 (à valider)", () => {
    expect(MAX_PROPOSALS_PER_SESSION).toBe(10);
  });

  it("les 10 premières propositions passent, la 11ᵉ est refusée", () => {
    for (let existantes = 0; existantes < MAX_PROPOSALS_PER_SESSION; existantes++) {
      expect(isProposalLimitReached(existantes)).toBe(false);
    }
    expect(isProposalLimitReached(MAX_PROPOSALS_PER_SESSION)).toBe(true);
    expect(isProposalLimitReached(MAX_PROPOSALS_PER_SESSION + 5)).toBe(true);
  });

  it("le message est en français, clair, et cite le maximum", () => {
    expect(PROPOSAL_LIMIT_MESSAGE).toContain(String(MAX_PROPOSALS_PER_SESSION));
    expect(PROPOSAL_LIMIT_MESSAGE).toMatch(/proposés/);
  });
});

describe("plafond de gains d'XP « vote » par soirée", () => {
  it("valeur proposée : 10 (à valider), égale au plafond de propositions", () => {
    expect(VOTE_XP_CAP_PER_SESSION).toBe(10);
    expect(VOTE_XP_CAP_PER_SESSION).toBe(MAX_PROPOSALS_PER_SESSION);
  });

  it("compte tous les gains quand aucune proposition n'appartient à une autre soirée", () => {
    expect(countSessionVoteGains(["a", "b", "c"], new Set())).toBe(3);
    expect(countSessionVoteGains([], new Set())).toBe(0);
  });

  it("ignore les gains dont la proposition appartient à une autre soirée", () => {
    expect(countSessionVoteGains(["a", "b", "c", "d"], new Set(["b", "d"]))).toBe(2);
  });

  it("garde les gains d'une proposition retirée (absente de toute soirée) : pas de contournement par retrait", () => {
    // « retiree » n'est dans aucune soirée : elle reste comptée pour celle-ci.
    expect(countSessionVoteGains(["p1", "retiree"], new Set(["ailleurs"]))).toBe(2);
  });
});
