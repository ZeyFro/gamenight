import { describe, expect, it } from "vitest";
import {
  assertExpectedMatchesDerived, assertRolloutMigrationsPending, deriveRolloutMigrations, EXPECTED_ROLLOUT_MIGRATIONS as E,
} from "../../scripts/xp-rollout-migration-gate.mjs";

const applied: string[] = ["20261018120000_previous_change"];
const all: string[] = [...applied, ...E];

describe("garde du lot complet XP + vocal", () => {
  it("la liste attendue compte 6 migrations (2 XP + 4 vocales), triées", () => {
    expect(E).toHaveLength(6);
    expect(E.filter((n: string) => n.includes("voice"))).toHaveLength(4);
    expect([...E]).toEqual([...E].sort());
  });
  it("accepte le lot complet en attente", () => {
    expect(assertRolloutMigrationsPending(all, applied)).toEqual(E);
  });
  it("accepte une reprise partielle (suite contiguë du lot)", () => {
    expect(assertRolloutMigrationsPending(all, [...applied, ...E.slice(0, 4)])).toEqual(E.slice(4));
  });
  it("refuse une migration manquante dans le checkout", () => {
    expect(() => assertRolloutMigrationsPending([...applied, ...E.slice(0, 5)], applied)).toThrow(/lot complet attendu/);
  });
  it("refuse une migration en trop", () => {
    expect(() => assertRolloutMigrationsPending([...all, "20261023120000_surprise"], applied)).toThrow(/lot complet attendu/);
  });
  it("refuse un lot non contigu (vocal appliqué sans XP)", () => {
    expect(() => assertRolloutMigrationsPending(all, [...applied, E[1]])).toThrow(/lot complet attendu/);
  });
  it("refuse une liste attendue dans le mauvais ordre", () => {
    expect(() => assertRolloutMigrationsPending(all, applied, { expected: [...E].reverse() })).toThrow(/ordre d'application/);
  });
  it("refuse une migration inachevée", () => {
    expect(() => assertRolloutMigrationsPending(all, [...applied, E[0]], { unfinished: [E[1]] })).toThrow(/inachevée/);
  });
  it("refuse un historique absent du checkout", () => {
    expect(() => assertRolloutMigrationsPending(all, [...applied, "20261001000000_gone"])).toThrow(/absentes du checkout/);
  });
  it("déduit le lot de checkout moins référence et le compare à la liste attendue", () => {
    const derived = deriveRolloutMigrations([...all, ...all], applied);
    expect(derived).toEqual(E);
    expect(assertExpectedMatchesDerived(E, derived)).toEqual(E);
    expect(() => assertExpectedMatchesDerived(E, E.slice(0, 5))).toThrow(/diffère/);
    expect(() => assertExpectedMatchesDerived([...E].reverse(), [...E].reverse())).toThrow(/ordre d'application/);
  });
});
