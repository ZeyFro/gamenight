import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { isSessionVisibleInHistory, isVotingOpen } from "@/lib/sessions";

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

/**
 * Cycle de vie de l'historique (V2, bug remonté en test réel — des
 * soirées d'août/début septembre encombraient encore l'historique
 * visible). `now` fixé au 22 septembre 2026 pour ces tests (même
 * `beforeEach`/`afterEach` que `isVotingOpen` ci-dessus).
 */
describe("isSessionVisibleInHistory", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-22T10:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("une soirée encore active (VOTING/SCHEDULED) reste TOUJOURS visible, quel que soit son âge", () => {
    expect(
      isSessionVisibleInHistory({ status: "VOTING", date: new Date("2020-01-01T20:00:00Z") })
    ).toBe(true);
    expect(
      isSessionVisibleInHistory({ status: "SCHEDULED", date: new Date("2020-01-01T20:00:00Z") })
    ).toBe(true);
  });

  it("DONE datée d'il y a moins de 7 jours (16 septembre) : encore visible", () => {
    expect(
      isSessionVisibleInHistory({ status: "DONE", date: new Date("2026-09-16T20:00:00Z") })
    ).toBe(true);
  });

  it("DONE datée d'exactement 7 jours pile (15 septembre 10h) : à la frontière, plus visible (fenêtre en millisecondes pleines, jamais un jour calendaire arrondi)", () => {
    expect(
      isSessionVisibleInHistory({ status: "DONE", date: new Date("2026-09-15T10:00:00Z") })
    ).toBe(false);
  });

  it("DONE datée du 21 septembre : reste visible le 22 (le lendemain) — ne disparaît jamais dès le jour d'après sous prétexte des 'sept jours'", () => {
    expect(
      isSessionVisibleInHistory({ status: "DONE", date: new Date("2026-09-21T20:00:00Z") })
    ).toBe(true);
  });

  it("CANCELLED datée d'il y a plus de 7 jours (1er septembre) : sort de l'historique", () => {
    expect(
      isSessionVisibleInHistory({ status: "CANCELLED", date: new Date("2026-09-01T20:00:00Z") })
    ).toBe(false);
  });

  it("CANCELLED récente (hier) : encore visible — la règle des 7 jours s'applique aussi aux annulations, pas seulement aux soirées jouées", () => {
    expect(
      isSessionVisibleInHistory({ status: "CANCELLED", date: new Date("2026-09-21T20:00:00Z") })
    ).toBe(true);
  });
});
