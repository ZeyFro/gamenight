import { afterEach, describe, expect, it, vi } from "vitest";
import { excludeVetoed, isVoteVetoEnabled, wouldVetoLeaveCandidate } from "./session-veto";

afterEach(() => vi.unstubAllEnvs());

describe("isVoteVetoEnabled", () => {
  it("actif seulement si la valeur vaut exactement `true`", () => {
    vi.stubEnv("VOTE_VETO_ENABLED", "");
    expect(isVoteVetoEnabled()).toBe(false);
    vi.stubEnv("VOTE_VETO_ENABLED", "TRUE");
    expect(isVoteVetoEnabled()).toBe(false);
    vi.stubEnv("VOTE_VETO_ENABLED", "true");
    expect(isVoteVetoEnabled()).toBe(true);
  });
});

describe("excludeVetoed", () => {
  const props = [{ id: "a" }, { id: "b" }, { id: "c" }];
  it("retire les propositions vetoées, garde l'ordre", () => {
    expect(excludeVetoed(props, new Set(["b"]))).toEqual([{ id: "a" }, { id: "c" }]);
  });
  it("sans veto : liste inchangée", () => {
    expect(excludeVetoed(props, new Set())).toEqual(props);
  });
  it("tout vetoé : liste vide (comme « aucun jouable »)", () => {
    expect(excludeVetoed(props, new Set(["a", "b", "c"]))).toEqual([]);
  });
});

describe("wouldVetoLeaveCandidate", () => {
  it("autorise tant qu'un autre jeu jouable non vetoé reste", () => {
    expect(wouldVetoLeaveCandidate(["a", "b"], new Set(), "a")).toBe(true);
  });
  it("refuse le veto du seul jeu jouable", () => {
    expect(wouldVetoLeaveCandidate(["a"], new Set(), "a")).toBe(false);
  });
  it("refuse si les autres jouables sont déjà vetoés", () => {
    expect(wouldVetoLeaveCandidate(["a", "b"], new Set(["b"]), "a")).toBe(false);
  });
  it("un veto sur un jeu injouable ne retire aucun candidat", () => {
    expect(wouldVetoLeaveCandidate(["a"], new Set(), "zzz")).toBe(true);
  });
  it("re-vetoer un jeu déjà vetoé reste neutre", () => {
    expect(wouldVetoLeaveCandidate(["a", "b"], new Set(["a"]), "a")).toBe(true);
  });
});
