import { describe, expect, it } from "vitest";
import {
  evaluateSeasonVoteQuorum, isChampionTitleActive, isTowerSeasonCompleted,
  shouldDelayPalmaresPublication, towerSeasonContaining,
} from "./tower-season-rules";

const d = (iso: string) => new Date(iso);

describe("isTowerSeasonCompleted (Q2)", () => {
  const endsAt = d("2026-07-01T00:00:00Z");
  it("fin passée et au moins un étage crédité", () => {
    expect(isTowerSeasonCompleted({ endsAt, now: d("2026-07-01T00:00:01Z"), creditedFloors: 1 })).toBe(true);
  });
  it("borne de fin exclusive : à endsAt exactement, terminée ; une ms avant, non", () => {
    expect(isTowerSeasonCompleted({ endsAt, now: endsAt, creditedFloors: 1 })).toBe(true);
    expect(isTowerSeasonCompleted({ endsAt, now: d("2026-06-30T23:59:59.999Z"), creditedFloors: 1 })).toBe(false);
  });
  it("aucun étage crédité : jamais terminée", () => {
    expect(isTowerSeasonCompleted({ endsAt, now: d("2027-01-01T00:00:00Z"), creditedFloors: 0 })).toBe(false);
    expect(isTowerSeasonCompleted({ endsAt, now: d("2027-01-01T00:00:00Z"), creditedFloors: BigInt(0) })).toBe(false);
  });
  it("accepte bigint", () => {
    expect(isTowerSeasonCompleted({ endsAt, now: endsAt, creditedFloors: BigInt(3) })).toBe(true);
  });
  it.each([
    ["étages négatifs", { creditedFloors: -1 }],
    ["étages non entiers", { creditedFloors: 1.5 }],
    ["étages NaN", { creditedFloors: Number.NaN }],
    ["étages bigint négatifs", { creditedFloors: BigInt(-1) }],
    ["fin invalide", { endsAt: new Date("x") }],
    ["now invalide", { now: new Date("x") }],
  ])("%s : RangeError", (_l, patch) => {
    expect(() => isTowerSeasonCompleted({ endsAt, now: endsAt, creditedFloors: 1, ...patch })).toThrow(RangeError);
  });
});

describe("towerSeasonContaining (crédit tardif)", () => {
  const s1 = { id: "S2", startsAt: d("2026-03-28T23:00:00Z"), endsAt: d("2026-06-30T22:00:00Z") };
  const summer = { id: "Été", startsAt: d("2026-06-30T22:00:00Z"), endsAt: d("2026-08-31T22:00:00Z") };
  const seasons = [summer, s1];
  it("rattache au [début, fin) qui contient rewardedAt", () => {
    expect(towerSeasonContaining(d("2026-05-01T00:00:00Z"), seasons)).toBe(s1);
    expect(towerSeasonContaining(d("2026-07-15T00:00:00Z"), seasons)).toBe(summer);
  });
  it("début inclus, fin exclue (la fin d'une saison est le début de la suivante)", () => {
    expect(towerSeasonContaining(s1.startsAt, seasons)).toBe(s1);
    expect(towerSeasonContaining(d("2026-06-30T21:59:59.999Z"), seasons)).toBe(s1);
    expect(towerSeasonContaining(s1.endsAt, seasons)).toBe(summer);
    expect(towerSeasonContaining(summer.endsAt, seasons)).toBeNull();
  });
  it("aucune saison, ou hors intervalle : null", () => {
    expect(towerSeasonContaining(d("2026-05-01T00:00:00Z"), [])).toBeNull();
    expect(towerSeasonContaining(d("2025-01-01T00:00:00Z"), seasons)).toBeNull();
  });
  it("ne mute pas le tableau fourni", () => {
    const copy = [...seasons];
    towerSeasonContaining(d("2026-05-01T00:00:00Z"), seasons);
    expect(seasons).toEqual(copy);
  });
  it("entrées invalides : RangeError", () => {
    expect(() => towerSeasonContaining(new Date("x"), seasons)).toThrow(RangeError);
    expect(() => towerSeasonContaining(d("2026-05-01T00:00:00Z"), [{ startsAt: new Date("x"), endsAt: s1.endsAt }])).toThrow(RangeError);
    expect(() => towerSeasonContaining(d("2026-05-01T00:00:00Z"), [{ startsAt: s1.endsAt, endsAt: s1.startsAt }])).toThrow(RangeError);
    expect(() => towerSeasonContaining(d("2026-05-01T00:00:00Z"), [{ startsAt: s1.startsAt, endsAt: s1.startsAt }])).toThrow(RangeError);
  });
  it("saisons qui se chevauchent : RangeError", () => {
    const overlap = { id: "x", startsAt: d("2026-06-01T00:00:00Z"), endsAt: d("2026-07-10T00:00:00Z") };
    expect(() => towerSeasonContaining(d("2026-05-01T00:00:00Z"), [s1, overlap])).toThrow(RangeError);
  });
});

describe("shouldDelayPalmaresPublication (Q7)", () => {
  it("retarde si une contestation susceptible de modifier le podium est ouverte", () => {
    expect(shouldDelayPalmaresPublication({ openContestationMayChangePodium: true })).toBe(true);
    expect(shouldDelayPalmaresPublication({ openContestationMayChangePodium: false })).toBe(false);
  });
  it("valeur non booléenne : RangeError", () => {
    expect(() => shouldDelayPalmaresPublication({ openContestationMayChangePodium: undefined as unknown as boolean })).toThrow(RangeError);
  });
});

describe("evaluateSeasonVoteQuorum (Q9)", () => {
  it.each([[0, false], [1, false], [2, true], [3, true], [100, true]])("%i votants distincts : quorum %s", (n, expected) => {
    expect(evaluateSeasonVoteQuorum({ distinctEligibleVoters: n })).toEqual({ quorumReached: expected, distinctionAllowed: expected });
  });
  it("dédoublonne un tableau d'identifiants", () => {
    expect(evaluateSeasonVoteQuorum({ distinctEligibleVoters: ["a", "a", "a"] }).quorumReached).toBe(false);
    expect(evaluateSeasonVoteQuorum({ distinctEligibleVoters: ["a", "b", "a"] }).quorumReached).toBe(true);
    expect(evaluateSeasonVoteQuorum({ distinctEligibleVoters: [] }).quorumReached).toBe(false);
    expect(evaluateSeasonVoteQuorum({ distinctEligibleVoters: ["a"] }).distinctionAllowed).toBe(false);
  });
  it("entrées invalides : RangeError", () => {
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => evaluateSeasonVoteQuorum({ distinctEligibleVoters: bad })).toThrow(RangeError);
    }
    expect(() => evaluateSeasonVoteQuorum({ distinctEligibleVoters: ["a", ""] })).toThrow(RangeError);
    expect(() => evaluateSeasonVoteQuorum({ distinctEligibleVoters: ["a", 2 as unknown as string] })).toThrow(RangeError);
  });
});

describe("isChampionTitleActive (Q5)", () => {
  const earned = d("2026-07-02T10:00:00Z");
  const next = d("2026-09-02T10:00:00Z");
  it("actif dès la publication du palmarès gagné (incluse)", () => {
    expect(isChampionTitleActive({ earnedSeasonPalmaresPublishedAt: earned, now: earned })).toBe(true);
    expect(isChampionTitleActive({ earnedSeasonPalmaresPublishedAt: earned, now: d("2026-07-02T09:59:59.999Z") })).toBe(false);
  });
  it("pas de publication suivante : actif indéfiniment", () => {
    expect(isChampionTitleActive({ earnedSeasonPalmaresPublishedAt: earned, nextSeasonPalmaresPublishedAt: null, now: d("2030-01-01T00:00:00Z") })).toBe(true);
    expect(isChampionTitleActive({ earnedSeasonPalmaresPublishedAt: earned, now: d("2030-01-01T00:00:00Z") })).toBe(true);
  });
  it("publication suivante EXCLUE : inactif à l'instant exact", () => {
    expect(isChampionTitleActive({ earnedSeasonPalmaresPublishedAt: earned, nextSeasonPalmaresPublishedAt: next, now: d("2026-09-02T09:59:59.999Z") })).toBe(true);
    expect(isChampionTitleActive({ earnedSeasonPalmaresPublishedAt: earned, nextSeasonPalmaresPublishedAt: next, now: next })).toBe(false);
    expect(isChampionTitleActive({ earnedSeasonPalmaresPublishedAt: earned, nextSeasonPalmaresPublishedAt: next, now: d("2027-01-01T00:00:00Z") })).toBe(false);
  });
  it("palmarès gagné jamais publié : inactif", () => {
    expect(isChampionTitleActive({ earnedSeasonPalmaresPublishedAt: null, now: next })).toBe(false);
    expect(isChampionTitleActive({ earnedSeasonPalmaresPublishedAt: undefined, now: next })).toBe(false);
  });
  it("entrées invalides ou incohérentes : RangeError", () => {
    expect(() => isChampionTitleActive({ earnedSeasonPalmaresPublishedAt: earned, now: new Date("x") })).toThrow(RangeError);
    expect(() => isChampionTitleActive({ earnedSeasonPalmaresPublishedAt: new Date("x"), now: next })).toThrow(RangeError);
    expect(() => isChampionTitleActive({ earnedSeasonPalmaresPublishedAt: earned, nextSeasonPalmaresPublishedAt: new Date("x"), now: next })).toThrow(RangeError);
    expect(() => isChampionTitleActive({ earnedSeasonPalmaresPublishedAt: earned, nextSeasonPalmaresPublishedAt: d("2026-07-01T00:00:00Z"), now: next })).toThrow(RangeError);
    expect(() => isChampionTitleActive({ earnedSeasonPalmaresPublishedAt: null, nextSeasonPalmaresPublishedAt: next, now: next })).toThrow(RangeError);
  });
});
