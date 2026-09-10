import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { isVotingOpen } from "@/lib/sessions";

/**
 * Fix bug remonté (vote inter-session, PR 1) — `toggleVote` dérive
 * désormais la session UNIQUEMENT depuis `Proposal.sessionId` (jamais d'un
 * `sessionId` transmis par le client, retiré de `toggleVoteSchema`/
 * `VoteButton` — vérifiable au diff). La garantie testable ici est la
 * logique de décision pure dont ce fix dépend : `isVotingOpen`, qui décide
 * si le vote sur LA session réellement associée à la proposition est
 * encore ouvert. Pas de scénario Prisma de bout en bout (aucun mock Prisma
 * dans ce projet, cf. `xp-actions.test.ts`) — l'action elle-même reste non
 * testée ici, seule sa logique de décision l'est.
 */
describe("isVotingOpen", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T10:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("true : statut VOTING et deadline pas encore atteinte", () => {
    expect(
      isVotingOpen({
        status: "VOTING",
        date: new Date("2026-06-16T20:00:00Z"),
        votingDeadline: new Date("2026-06-16T18:00:00Z"),
      })
    ).toBe(true);
  });

  it("false : deadline déjà dépassée", () => {
    expect(
      isVotingOpen({
        status: "VOTING",
        date: new Date("2026-06-16T20:00:00Z"),
        votingDeadline: new Date("2026-06-15T09:00:00Z"),
      })
    ).toBe(false);
  });

  it("false : session pas (ou plus) en statut VOTING, même si la deadline n'est pas dépassée", () => {
    expect(
      isVotingOpen({
        status: "SCHEDULED",
        date: new Date("2026-06-16T20:00:00Z"),
        votingDeadline: new Date("2026-06-16T18:00:00Z"),
      })
    ).toBe(false);
  });

  it("sans votingDeadline explicite, retombe sur la date de la session", () => {
    expect(
      isVotingOpen({
        status: "VOTING",
        date: new Date("2026-06-16T20:00:00Z"),
        votingDeadline: null,
      })
    ).toBe(true);
    expect(
      isVotingOpen({
        status: "VOTING",
        date: new Date("2026-06-15T09:00:00Z"),
        votingDeadline: null,
      })
    ).toBe(false);
  });
});
