import { describe, expect, it } from "vitest";
import { countCompletedTowerSeasons } from "./tower-personal-progress-rules";

const at = (value: string) => new Date(value);
const credit = (value: string, floors = 1) => ({ rewardedAt: at(value), floors });

// Bornes de Paris (fin exclusive) : S1 2027 = [4 janv. 00:00, 29 mars 00:00[ ; S2 = [1er avr., 1er juil.[ ;
// Été = [1er juil., 1er sept.[ ; S4 = [1er sept., 1er janv.[.
describe("saisons Tower terminées par un joueur (Q2)", () => {
  it("ne compte rien sans crédit, même si des saisons sont finies", () => {
    expect(countCompletedTowerSeasons([], at("2028-01-10T12:00:00Z"))).toBe(0);
  });

  it("ne compte pas la saison en cours, même avec des étages crédités", () => {
    expect(countCompletedTowerSeasons([credit("2027-02-10T10:00:00Z", 3)], at("2027-03-28T21:59:59.999Z"))).toBe(0);
  });

  it("compte la saison à l'instant exact de sa fin exclusive (29 mars 00:00 Paris, jour du changement d'heure)", () => {
    expect(countCompletedTowerSeasons([credit("2027-02-10T10:00:00Z")], at("2027-03-28T22:00:00.000Z"))).toBe(1);
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

  it("un crédit d'intersaison (1er–3 janvier, 29–31 mars) n'appartient à aucune saison", () => {
    const credits = [credit("2027-01-02T10:00:00Z", 3), credit("2027-03-30T10:00:00Z", 3)];
    expect(countCompletedTowerSeasons(credits, at("2028-06-01T10:00:00Z"))).toBe(0);
  });

  it("rattache un crédit à la saison de sa date, à la milliseconde près des deux bornes", () => {
    const now = at("2027-05-01T10:00:00Z");
    // Dernière milliseconde de S1 : S1 terminée. Première milliseconde après S1 (intersaison) : rien.
    expect(countCompletedTowerSeasons([credit("2027-03-28T21:59:59.999Z")], now)).toBe(1);
    expect(countCompletedTowerSeasons([credit("2027-03-28T22:00:00.000Z")], now)).toBe(0);
    // Première milliseconde de S2 (1er avril 00:00 Paris) : saison en cours le 1er mai, donc pas terminée.
    expect(countCompletedTowerSeasons([credit("2027-03-31T22:00:00.000Z")], now)).toBe(0);
  });

  it("ne dépend pas de l'ordre des crédits et ne les modifie pas", () => {
    const credits = [credit("2027-09-15T10:00:00Z"), credit("2027-01-10T10:00:00Z"), credit("2027-07-10T10:00:00Z")];
    const frozen = JSON.stringify(credits);
    const now = at("2028-01-05T10:00:00Z");
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
