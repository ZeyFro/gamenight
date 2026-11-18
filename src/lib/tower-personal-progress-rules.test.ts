import { describe, expect, it } from "vitest";
import { countCompletedTowerSeasons, countValidatedChallengesInCurrentSeason } from "./tower-personal-progress-rules";

const at = (value: string) => new Date(value);
const credit = (value: string, floors = 1) => ({ rewardedAt: at(value), floors });

// Bornes de Paris (fin exclusive, décision du 17/11/2026) : S1 2026-2027 = [1er déc. 2026, 1er avr. 2027[ ;
// S2 = [1er avr., 1er juil.[ ; Été = [1er juil., 1er sept.[ ; S3 = [1er sept., 1er déc.[ ; sans intersaison.
describe("saisons Tower terminées par un joueur (Q2)", () => {
  it("ne compte rien sans crédit, même si des saisons sont finies", () => {
    expect(countCompletedTowerSeasons([], at("2028-01-10T12:00:00Z"))).toBe(0);
  });

  it("ne compte pas la saison en cours, même avec des étages crédités", () => {
    expect(countCompletedTowerSeasons([credit("2027-02-10T10:00:00Z", 3)], at("2027-03-31T21:59:59.999Z"))).toBe(0);
  });

  it("compte la saison à l'instant exact de sa fin exclusive (1er avril 00:00 Paris, après le changement d'heure)", () => {
    expect(countCompletedTowerSeasons([credit("2027-02-10T10:00:00Z")], at("2027-03-31T22:00:00.000Z"))).toBe(1);
  });

  it("compte une seule fois une saison avec plusieurs crédits, et chaque saison distincte une fois", () => {
    const credits = [
      credit("2027-01-05T10:00:00Z"), credit("2027-02-05T10:00:00Z", 3), credit("2027-03-01T10:00:00Z", 2),
      credit("2027-04-15T10:00:00Z"),
    ];
    expect(countCompletedTowerSeasons(credits, at("2027-06-30T21:59:59Z"))).toBe(1);
    expect(countCompletedTowerSeasons(credits, at("2027-06-30T22:00:00Z"))).toBe(2);
  });

  it("l'été est une saison active : un crédit de juillet compte dès le 1er septembre", () => {
    const credits = [credit("2027-07-20T10:00:00Z")];
    expect(countCompletedTowerSeasons(credits, at("2027-08-31T21:59:59.999Z"))).toBe(0);
    expect(countCompletedTowerSeasons(credits, at("2027-08-31T22:00:00.000Z"))).toBe(1);
  });

  it("sans intersaison : chaque crédit, même du 1er janvier ou fin mars, appartient à une saison", () => {
    const credits = [credit("2027-01-02T10:00:00Z", 3), credit("2027-03-30T10:00:00Z", 3)];
    expect(countCompletedTowerSeasons(credits, at("2027-03-31T21:59:59.999Z"))).toBe(0);
    expect(countCompletedTowerSeasons(credits, at("2027-03-31T22:00:00.000Z"))).toBe(1); // S1 2026-2027, une seule saison
  });

  it("rattache un crédit à la saison de sa date, à la milliseconde près des bornes", () => {
    const now = at("2027-05-01T10:00:00Z");
    // Dernière milliseconde de S1 : S1 terminée. Première milliseconde de S2 : saison en cours le 1er mai.
    expect(countCompletedTowerSeasons([credit("2027-03-31T21:59:59.999Z")], now)).toBe(1);
    expect(countCompletedTowerSeasons([credit("2027-03-31T22:00:00.000Z")], now)).toBe(0);
    // Minuit Paris du 1er décembre 2026 (CET) : début de S1 ; une milliseconde avant, c'est S3 2026 (finie aussi).
    expect(countCompletedTowerSeasons([credit("2026-11-30T23:00:00.000Z")], now)).toBe(1);
    expect(countCompletedTowerSeasons([credit("2026-11-30T22:59:59.999Z")], now)).toBe(1);
    expect(countCompletedTowerSeasons([credit("2026-11-30T22:59:59.999Z"), credit("2026-11-30T23:00:00.000Z")], now)).toBe(2);
  });

  it("ne dépend pas de l'ordre des crédits et ne les modifie pas", () => {
    const credits = [credit("2027-09-15T10:00:00Z"), credit("2027-01-10T10:00:00Z"), credit("2027-07-10T10:00:00Z")];
    const frozen = JSON.stringify(credits);
    const now = at("2027-12-05T10:00:00Z");
    expect(countCompletedTowerSeasons(credits, now)).toBe(3);
    expect(countCompletedTowerSeasons([...credits].reverse(), now)).toBe(3);
    expect(JSON.stringify(credits)).toBe(frozen);
  });

  it("refuse des données invalides plutôt que de compter faux", () => {
    expect(() => countCompletedTowerSeasons([credit("2027-02-10T10:00:00Z", -1)], at("2027-06-01T10:00:00Z"))).toThrow(RangeError);
    expect(() => countCompletedTowerSeasons([credit("2027-02-10T10:00:00Z", 1.5)], at("2027-06-01T10:00:00Z"))).toThrow(RangeError);
    expect(() => countCompletedTowerSeasons([{ rewardedAt: new Date(NaN), floors: 1 }], at("2027-06-01T10:00:00Z"))).toThrow(RangeError);
    expect(() => countCompletedTowerSeasons([credit("2027-02-10T10:00:00Z")], new Date(NaN))).toThrow(RangeError);
  });
});

describe("défis validés sur la saison en cours (High Ranker, décision du 17/11/2026)", () => {
  const now = at("2027-05-10T12:00:00Z"); // S2 2027 = [1er avr., 1er juil.[
  it("ne compte que les crédits de la saison en cours, fin exclusive", () => {
    const credits = [
      credit("2027-03-31T21:59:59Z"), credit("2027-03-31T22:00:00Z"), credit("2027-05-01T10:00:00Z"),
      credit("2027-06-30T21:59:59.999Z"), credit("2027-06-30T22:00:00Z"), credit("2027-07-05T10:00:00Z"),
    ];
    expect(countValidatedChallengesInCurrentSeason(credits, now)).toBe(3);
  });
  it("compte un défi par crédit, quel que soit son nombre d'étages", () => {
    expect(countValidatedChallengesInCurrentSeason([credit("2027-04-02T10:00:00Z", 1), credit("2027-04-03T10:00:00Z", 3)], now)).toBe(2);
  });
  it("vaut 0 sans crédit et pour un crédit hors saison courante", () => {
    expect(countValidatedChallengesInCurrentSeason([], now)).toBe(0);
    expect(countValidatedChallengesInCurrentSeason([credit("2027-03-30T10:00:00Z")], now)).toBe(0);
    // Lancement : S1 2026-2027 est active dès le 1er décembre 2026 00:00 Paris, sans intersaison.
    expect(countValidatedChallengesInCurrentSeason([credit("2026-12-02T10:00:00Z")], at("2026-12-03T10:00:00Z"))).toBe(1);
  });
  it("refuse une date invalide", () => {
    expect(() => countValidatedChallengesInCurrentSeason([{ rewardedAt: new Date(NaN), floors: 1 }], now)).toThrow(RangeError);
  });
});
