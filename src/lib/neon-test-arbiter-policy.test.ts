import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
// Operational scripts deliberately run as native ESM, outside the application.
import { additions, arbiter, authorize, requireSequenceUsage, first, second, predecessors, requirePredecessors, validateOnly } from "../../scripts/neon-test-arbiter/policy.mjs";
const baseline = JSON.parse(readFileSync("scripts/neon-test/baseline.json", "utf8"));
const valid = () => Object.entries(predecessors(baseline)).map(([migration_name, checksum]) => ({ migration_name, checksum, finished_at: new Date(), rolled_back_at: null }));

it("refuse tout droit de séquence manquant sans l'ajouter", () => {
  expect(() => requireSequenceUsage(true)).not.toThrow();
  for (const missing of [false, null, undefined, "true"]) expect(() => requireSequenceUsage(missing)).toThrow("NEON_TEST_ARBITER_SEQUENCE_PRIVILEGES");
});

describe("prévalidation de la seule migration arbitre", () => {
  it("exige main et refuse toute demande d'application ou argument CLI", () => {
    expect(() => authorize({ GITHUB_REF: "refs/heads/main", OPERATION: "validate" })).not.toThrow();
    for (const config of [{ GITHUB_REF: "refs/heads/feature", OPERATION: "validate" }, { GITHUB_REF: "refs/heads/main", OPERATION: "apply" }, { GITHUB_REF: "refs/heads/main", OPERATION: "validate", APPLY_AUTHORIZATION: "yes" }, { GITHUB_REF: "refs/heads/main", OPERATION: "validate", CONFIRMATION: "yes" }]) expect(() => authorize(config)).toThrow();
    expect(() => authorize({ GITHUB_REF: "refs/heads/main", OPERATION: "validate" }, ["--execute"])).toThrow();
  });
  it("admet exactement les 118 antécédents puis 370 et 406 terminées", () => {
    expect(() => requirePredecessors(valid(), baseline)).not.toThrow();
    expect(Object.keys(predecessors(baseline)).slice(-2)).toEqual([first, second]);
    expect(() => predecessors({ ...baseline, [arbiter]: additions[arbiter] })).toThrow();
  });
  it.each([118, 119, 121])("arrête la phase %i avant toute sonde de schéma ou runner", async count => {
    const rows = valid();
    if (count < 120) rows.length = count;
    else rows.push({ migration_name: arbiter, checksum: additions[arbiter], finished_at: new Date(), rolled_back_at: null });
    const check = vi.fn(); const run = vi.fn();
    await expect(validateOnly({ history: async () => rows, baseline, check, run })).rejects.toThrow("NEON_TEST_ARBITER_PREDECESSORS_REQUIRED");
    expect(check).not.toHaveBeenCalled(); expect(run).not.toHaveBeenCalled();
  });
  it.each(["checksum", "unfinished", "rolledback", "duplicate", "unexpected"])("refuse un historique %s sans lancer le runner", async defect => {
    const rows = valid(); const row = rows.at(-1)!;
    if (defect === "checksum") row.checksum = "0".repeat(64);
    if (defect === "unfinished") Object.assign(row, { finished_at: null });
    if (defect === "rolledback") Object.assign(row, { rolled_back_at: new Date() });
    if (defect === "duplicate") Object.assign(row, rows[0]);
    if (defect === "unexpected") row.migration_name = "20261107000000_unapproved_xp";
    const run = vi.fn();
    await expect(validateOnly({ history: async () => rows, baseline, check: vi.fn(), run })).rejects.toThrow();
    expect(run).not.toHaveBeenCalled();
  });
  it("arrête immédiatement si les contrôles échouent", async () => {
    const run = vi.fn();
    await expect(validateOnly({ history: async () => valid(), baseline, check: async () => { throw new Error("schema"); }, run })).rejects.toThrow("schema");
    expect(run).not.toHaveBeenCalled();
  });
  it("appelle uniquement le dry-run officiel de 407 après les contrôles", async () => {
    const order: string[] = []; const run = vi.fn(async () => { order.push("dry-run"); });
    await validateOnly({ history: async () => valid(), baseline, check: async () => { order.push("checked"); }, run });
    expect(order).toEqual(["checked", "dry-run"]);
    expect(run).toHaveBeenCalledExactlyOnceWith(["scripts/db-migrate.mjs", `--expect=${arbiter}`]);
  });
});
