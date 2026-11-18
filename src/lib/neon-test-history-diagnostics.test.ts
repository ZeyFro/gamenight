import { describe, expect, it } from "vitest";
import { checkHistoryWithDiagnostics, sequence } from "../../scripts/neon-test/apply-policy.mjs";

const name = "20260820141733_init";
const expected = { [name]: "a".repeat(64) };
const valid = () => ({ migration_name: name, checksum: expected[name], finished_at: "done", rolled_back_at: null as string | null });

describe("diagnostic borné de l'historique Neon Test", () => {
  it("ne produit aucun diagnostic pour un historique conforme", () => {
    const reports: unknown[] = [];
    checkHistoryWithDiagnostics([valid()], expected, (r: unknown) => reports.push(r));
    expect(reports).toEqual([]);
  });

  it("identifie le checksum fautif sans rendre l'historique acceptable", () => {
    const reports: unknown[] = [];
    expect(() => checkHistoryWithDiagnostics([{ ...valid(), checksum: "b".repeat(64) }], expected, (r: unknown) => reports.push(r))).toThrow("NEON_TEST_HISTORY_MISMATCH");
    expect(reports).toEqual([{ expectedCount: 1, actualCount: 1, details: [{ migration: name, reasons: ["checksum"], expectedChecksum: expected[name], actualChecksum: "b".repeat(64) }], truncated: false }]);
  });

  it.each(["unfinished", "rolled_back", "duplicate"])("distingue %s et conserve le refus", reason => {
    const first = valid();
    if (reason === "unfinished") first.finished_at = "";
    if (reason === "rolled_back") first.rolled_back_at = "rollback";
    const data = reason === "duplicate" ? [first, first] : [first];
    const reports: Array<{ details: Array<{ reasons: string[] }> }> = [];
    expect(() => checkHistoryWithDiagnostics(data, expected, (r: (typeof reports)[number]) => reports.push(r))).toThrow(/^NEON_TEST_HISTORY_/);
    expect(reports[0].details.some(d => d.reasons.includes(reason))).toBe(true);
  });

  it("signale une migration absente en conservant l'erreur de compte", () => {
    const reports: unknown[] = [];
    expect(() => checkHistoryWithDiagnostics([], expected, (r: unknown) => reports.push(r))).toThrow("NEON_TEST_HISTORY_COUNT");
    expect(reports).toEqual([{ expectedCount: 1, actualCount: 0, details: [{ migration: name, reasons: ["missing"] }], truncated: false }]);
  });

  it("ne journalise jamais un nom ou checksum non approuvé contenant un secret", () => {
    const secret = "synthetic-sensitive-value";
    const reports: unknown[] = [];
    expect(() => checkHistoryWithDiagnostics([{ ...valid(), migration_name: `20260101000000_${secret}`, checksum: secret }], expected, (r: unknown) => reports.push(r))).toThrow();
    expect(JSON.stringify(reports)).not.toContain(secret);
    expect(JSON.stringify(reports)).toContain("unexpected");
    reports.length = 0;
    expect(() => checkHistoryWithDiagnostics([{ ...valid(), checksum: secret }], expected, (r: unknown) => reports.push(r))).toThrow();
    expect(JSON.stringify(reports)).not.toContain(secret);
    expect(JSON.stringify(reports)).toContain("invalid");
  });

  it("borne le rapport à huit lignes sans accepter la dérive", () => {
    const reports: Array<{ details: unknown[]; truncated: boolean }> = [];
    const data = Array.from({ length: 20 }, () => ({ ...valid(), checksum: "b".repeat(64) }));
    expect(() => checkHistoryWithDiagnostics(data, expected, (r: (typeof reports)[number]) => reports.push(r))).toThrow();
    expect(reports[0].details).toHaveLength(8);
    expect(reports[0].truncated).toBe(true);
  });

  it("conserve l'erreur du garde même si la journalisation échoue", () => {
    expect(() => checkHistoryWithDiagnostics([{ ...valid(), checksum: "b".repeat(64) }], expected, () => { throw Error("logger unavailable"); })).toThrow("NEON_TEST_HISTORY_MISMATCH");
  });

  it("interrompt la séquence avant le premier dry-run quand l'historique diverge", async () => {
    const operations: string[] = [];
    await expect(sequence("validate", {
      check: async () => checkHistoryWithDiagnostics([{ ...valid(), checksum: "b".repeat(64) }], expected, () => {}),
      run: async () => { operations.push("run"); },
      addSecond: async () => { operations.push("addSecond"); },
    })).rejects.toThrow("NEON_TEST_HISTORY_MISMATCH");
    expect(operations).toEqual([]);
  });
});
