import { describe, expect, it } from "vitest";
import { canManageTowerIrregular, isIrregularActive, isTowerIrregularGrantsEnabled, towerIrregularTargetSchema } from "./tower-irregular-rules";
import { getTowerPersonalRank } from "./tower-ranks";

describe("Irregular manuel : règles pures", () => {
  it.each([undefined, "", "false", "TRUE", "1"])("drapeau %o : éteint", value => {
    expect(isTowerIrregularGrantsEnabled({ TOWER_IRREGULAR_GRANTS_ENABLED: value })).toBe(false);
  });
  it("n'est allumé que pour la valeur exacte true", () => {
    expect(isTowerIrregularGrantsEnabled({ TOWER_IRREGULAR_GRANTS_ENABLED: "true" })).toBe(true);
  });
  it("réserve l'attribution aux OWNER et ADMIN communautaires", () => {
    expect(canManageTowerIrregular("OWNER")).toBe(true);
    expect(canManageTowerIrregular("ADMIN")).toBe(true);
    expect(canManageTowerIrregular("MEMBER")).toBe(false);
    expect(canManageTowerIrregular(null)).toBe(false);
    expect(canManageTowerIrregular(undefined)).toBe(false);
  });
  it("une attribution révoquée ou absente n'est pas effective", () => {
    expect(isIrregularActive(null)).toBe(false);
    expect(isIrregularActive({ revokedAt: new Date() })).toBe(false);
    expect(isIrregularActive({ revokedAt: null })).toBe(true);
  });
  it("valide l'identifiant cible", () => {
    expect(towerIrregularTargetSchema.safeParse({ userId: "u1" }).success).toBe(true);
    expect(towerIrregularTargetSchema.safeParse({ userId: "  " }).success).toBe(false);
    expect(towerIrregularTargetSchema.safeParse({ userId: "x".repeat(192) }).success).toBe(false);
    expect(towerIrregularTargetSchema.safeParse({ userId: null }).success).toBe(false);
  });
  it("un grade gagné l'emporte sur Irregular, qui l'emporte sur Régulars (aucun droit associé)", () => {
    expect(getTowerPersonalRank(0, 0, { irregularGranted: true })).toBe("Irregular");
    expect(getTowerPersonalRank(30, 0, { irregularGranted: true })).toBe("Ranker");
    expect(getTowerPersonalRank(100, 5, { irregularGranted: true })).toBe("High Ranker");
    expect(getTowerPersonalRank(0, 0, { irregularGranted: false })).toBe("Régulars");
  });
});
