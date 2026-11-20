import { describe, expect, it } from "vitest";
import { canClaimSoloChallenge, canSubmitChallengeProof, canReceiveChallengeReward, getTowerParisDayKey, isTowerTeamDailyDue } from "./tower-challenge-rules";
import * as m_p10 from "./tower-challenge-rules";
import * as m_p11 from "./tower-challenge-rules";
import * as m_p12 from "./tower-challenge-rules";
import * as m_p13 from "./tower-challenge-rules";

const date = (value: string) => new Date(value);
const assigned = date("2026-10-24T12:00:00Z");

describe("défi d'équipe : attribuable à partir de 18:00 Europe/Paris", () => {
  it.each([
    // Hiver (CET, UTC+1) : 18:00 Paris = 17:00 UTC.
    ["2027-01-15T16:59:59.999Z", false],
    ["2027-01-15T17:00:00.000Z", true],
    ["2027-01-15T22:59:59.999Z", true],
    ["2027-01-15T23:00:00.000Z", false], // minuit Paris : jour suivant, avant 18:00
    // Été (CEST, UTC+2) : 18:00 Paris = 16:00 UTC.
    ["2027-07-15T15:59:59.999Z", false],
    ["2027-07-15T16:00:00.000Z", true],
    ["2027-07-15T21:59:59.999Z", true],
    ["2027-07-15T22:00:00.000Z", false],
    // Passage à l'heure d'été (28 mars 2027, 01:00 UTC) : 18:00 CEST = 16:00 UTC.
    ["2027-03-28T15:59:59.999Z", false],
    ["2027-03-28T16:00:00.000Z", true],
    // Retour à l'heure d'hiver (31 octobre 2027, 01:00 UTC) : 18:00 CET = 17:00 UTC.
    ["2027-10-31T16:59:59.999Z", false],
    ["2027-10-31T17:00:00.000Z", true],
    // Veille des changements d'heure.
    ["2027-03-27T16:59:59.999Z", false],
    ["2027-03-27T17:00:00.000Z", true],
    ["2027-10-30T15:59:59.999Z", false],
    ["2027-10-30T16:00:00.000Z", true],
  ])("à %s : %s", (iso, due) => {
    expect(isTowerTeamDailyDue(date(iso))).toBe(due);
  });
  it("rejette une date invalide", () => {
    expect(() => isTowerTeamDailyDue(new Date(NaN))).toThrow(RangeError);
  });
});

describe("délais des défis The Tower", () => {
  it("autorise une première attribution", () => {
    expect(canClaimSoloChallenge(null, assigned)).toBe(true);
  });
  it("autorise à 12 heures exactement, pas une milliseconde avant", () => {
    expect(canClaimSoloChallenge(assigned, date("2026-10-24T23:59:59.999Z"))).toBe(false);
    expect(canClaimSoloChallenge(assigned, date("2026-10-25T00:00:00Z"))).toBe(true);
  });
  it("ne raccourcit pas les 12 heures lors du changement d'heure", () => {
    const start = date("2026-10-24T20:00:00Z");
    expect(canClaimSoloChallenge(start, date("2026-10-25T07:00:00Z"))).toBe(false);
    expect(canClaimSoloChallenge(start, date("2026-10-25T08:00:00Z"))).toBe(true);
  });
  it("ferme le dépôt à 48 heures exactement", () => {
    expect(canSubmitChallengeProof(assigned, date("2026-10-26T11:59:59.999Z"))).toBe(true);
    expect(canSubmitChallengeProof(assigned, date("2026-10-26T12:00:00Z"))).toBe(false);
  });
  it("refuse un dépôt antérieur à l'attribution", () => {
    expect(canSubmitChallengeProof(assigned, date("2026-10-24T11:00:00Z"))).toBe(false);
  });
  it("n'autorise pas une nouvelle attribution si la précédente est dans le futur", () => {
    expect(canClaimSoloChallenge(assigned, date("2026-10-24T11:00:00Z"))).toBe(false);
  });
  it("refuse les dates invalides", () => {
    expect(() => canClaimSoloChallenge(null, new Date(NaN))).toThrow(RangeError);
    expect(() => canSubmitChallengeProof(new Date(NaN), assigned)).toThrow(RangeError);
  });
});

describe("quota commun solo/équipe", () => {
  const now = date("2026-10-28T23:15:00Z"); // 29 octobre à Paris.
  it("autorise zéro ou une réussite et bloque la troisième", () => {
    const success = date("2026-10-28T23:01:00Z");
    expect(canReceiveChallengeReward([], now)).toBe(true);
    expect(canReceiveChallengeReward([success], now)).toBe(true);
    expect(canReceiveChallengeReward([success, success], now)).toBe(false);
  });
  it("compte selon minuit Paris, pas minuit UTC", () => {
    expect(canReceiveChallengeReward([
      date("2026-10-28T22:59:59Z"), date("2026-10-28T22:00:00Z"),
    ], now)).toBe(true);
    expect(canReceiveChallengeReward([
      date("2026-10-28T23:00:00Z"), date("2026-10-28T23:10:00Z"),
    ], now)).toBe(false);
  });
  it("utilise aussi le minuit Paris en été", () => {
    expect(canReceiveChallengeReward([
      date("2026-07-01T22:00:00Z"), date("2026-07-01T22:01:00Z"),
    ], date("2026-07-01T22:02:00Z"))).toBe(false);
  });
  it("ne réinitialise pas le quota pendant l'heure répétée d'automne", () => {
    expect(canReceiveChallengeReward([
      date("2026-10-25T00:15:00Z"), date("2026-10-25T01:15:00Z"),
    ], date("2026-10-25T02:00:00Z"))).toBe(false);
  });
  it("refuse un historique invalide ou dans le futur", () => {
    expect(() => canReceiveChallengeReward([new Date(NaN)], now)).toThrow(RangeError);
    expect(() => canReceiveChallengeReward([date("2026-10-29T00:00:00Z")], now)).toThrow(RangeError);
  });
});

describe("jour Tower en Europe/Paris", () => {
  it("bascule à minuit locale et garde un jour stable pendant les changements d'heure", () => {
    expect(getTowerParisDayKey(date("2026-10-28T22:59:59Z"))).toBe("2026-10-28");
    expect(getTowerParisDayKey(date("2026-10-28T23:00:00Z"))).toBe("2026-10-29");
    expect(getTowerParisDayKey(date("2026-10-25T00:30:00Z"))).toBe("2026-10-25");
    expect(getTowerParisDayKey(date("2026-10-25T01:30:00Z"))).toBe("2026-10-25");
  });
});

// Tâche Qwen qwen-p10-solo-attente — repris du test de preuve loop/checks (node:test) sous vitest.
describe("tower-challenge-rules · p10-solo-attente", () => {
  it('attente avant nouvelle attribution solo', () => {
    expect(m_p10.msUntilSoloChallengeAvailable(null, new Date('2026-03-10T10:00:00Z'))).toBe(0);
    const last = new Date('2026-03-10T08:00:00Z');
    expect(m_p10.msUntilSoloChallengeAvailable(last, new Date('2026-03-10T13:00:00Z'))).toBe(7 * 3600000);
    expect(m_p10.msUntilSoloChallengeAvailable(last, new Date('2026-03-10T20:00:00Z'))).toBe(0);
    expect(m_p10.msUntilSoloChallengeAvailable(last, new Date('2026-03-11T08:00:00Z'))).toBe(0);
    expect(() => m_p10.msUntilSoloChallengeAvailable(new Date(NaN), last)).toThrow(RangeError);
  });
});

// Tâche Qwen qwen-p11-preuve-echeance — repris du test de preuve loop/checks (node:test) sous vitest.
describe("tower-challenge-rules · p11-preuve-echeance", () => {
  it('echeance de preuve a 48 h', () => {
    const a = new Date('2026-03-10T08:00:00Z');
    const d = m_p11.challengeProofDeadline(a);
    expect(d instanceof Date).toBeTruthy();
    expect(d.toISOString()).toBe('2026-03-12T08:00:00.000Z');
    expect(a.toISOString()).toBe('2026-03-10T08:00:00.000Z');
    expect(d !== a).toBeTruthy();
    expect(() => m_p11.challengeProofDeadline(new Date(NaN))).toThrow(RangeError);
  });
});

// Tâche Qwen qwen-p12-recompenses-restantes — repris du test de preuve loop/checks (node:test) sous vitest.
describe("tower-challenge-rules · p12-recompenses-restantes", () => {
  it('recompenses restantes aujourd hui (jour Paris)', () => {
    const now = new Date('2026-03-10T22:30:00Z');
    expect(m_p12.remainingChallengeRewardsToday([], now)).toBe(2);
    expect(m_p12.remainingChallengeRewardsToday([new Date('2026-03-10T09:00:00Z')], now)).toBe(1);
    expect(m_p12.remainingChallengeRewardsToday([new Date('2026-03-10T09:00:00Z'), new Date('2026-03-10T10:00:00Z')], now)).toBe(0);
    expect(m_p12.remainingChallengeRewardsToday([new Date('2026-03-10T09:00:00Z'), new Date('2026-03-10T10:00:00Z'), new Date('2026-03-10T11:00:00Z')], now)).toBe(0);
    expect(m_p12.remainingChallengeRewardsToday([new Date('2026-03-09T22:30:00Z')], now)).toBe(2);
    expect(m_p12.remainingChallengeRewardsToday([new Date('2026-03-09T23:30:00Z')], now)).toBe(1);
    expect(() => m_p12.remainingChallengeRewardsToday([new Date('2026-03-11T09:00:00Z')], now)).toThrow(RangeError);
  });
});

// Tâche Qwen qwen-p13-preuve-expiree — repris du test de preuve loop/checks (node:test) sous vitest.
describe("tower-challenge-rules · p13-preuve-expiree", () => {
  it('expiration de la preuve a 48 h', () => {
    const a = new Date('2026-03-10T08:00:00Z');
    expect(m_p13.isChallengeProofExpired(a, new Date('2026-03-12T07:59:59Z'))).toBe(false);
    expect(m_p13.isChallengeProofExpired(a, new Date('2026-03-12T08:00:00Z'))).toBe(true);
    expect(m_p13.isChallengeProofExpired(a, new Date('2026-03-15T08:00:00Z'))).toBe(true);
    expect(m_p13.isChallengeProofExpired(a, new Date('2026-03-10T07:00:00Z'))).toBe(false);
    expect(() => m_p13.isChallengeProofExpired(a, new Date(NaN))).toThrow(RangeError);
  });
});
