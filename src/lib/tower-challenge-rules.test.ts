import { describe, expect, it } from "vitest";
import { canClaimSoloChallenge, canSubmitChallengeProof, canReceiveChallengeReward, getTowerParisDayKey } from "./tower-challenge-rules";

const date = (value: string) => new Date(value);
const assigned = date("2026-10-24T12:00:00Z");

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
