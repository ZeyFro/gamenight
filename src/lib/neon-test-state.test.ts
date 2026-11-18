import { expect, it } from "vitest";
import { checkSnapshot, schemaForServer } from "../../scripts/neon-test/state.mjs";
const valid = () => ({ schema: "expected", data: { table: { count: 1, hash: "same" } }, runtimeDml: true, teamBackfillInvalid: 0, newValues: 0 });
it("sélectionne exclusivement l'empreinte de la version et de la phase attendues", () => {
  const manifests = { "16": { "118": "pg16" }, "18": { "118": "pg18" } };
  expect(schemaForServer(160000, 118, manifests)).toBe("pg16");
  expect(schemaForServer(180006, 118, manifests)).toBe("pg18");
  expect(() => schemaForServer(170005, 118, manifests)).toThrow("NEON_TEST_SERVER_VERSION");
  expect(() => schemaForServer(180006, 119, manifests)).toThrow("NEON_TEST_SCHEMA_PHASE");
});
it("valide le schéma et les données conservées après chaque étape", () => expect(() => checkSnapshot(valid(), 120, "expected", valid().data)).not.toThrow());
it.each(["schema", "data", "runtimeDml", "teamBackfillInvalid", "newValues"])("arrête sur divergence %s", key => {
  const state = valid();
  if (key === "schema") state.schema = "drift";
  if (key === "data") state.data.table.hash = "changed";
  if (key === "runtimeDml") state.runtimeDml = false;
  if (key === "teamBackfillInvalid") state.teamBackfillInvalid = 1;
  if (key === "newValues") state.newValues = 1;
  expect(() => checkSnapshot(state, 120, "expected", valid().data)).toThrow();
});

it("refuse une identité erronée avant de lire le schéma ou les données", async () => {
  const { readState } = await import("../../scripts/neon-test/state.mjs");
  let queries = 0;
  const db = { $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ $executeRawUnsafe: async () => {}, $queryRawUnsafe: async () => { queries++; return [{}]; } }) };
  await expect(readState(db, "runtime", () => { throw Error("wrong identity"); })).rejects.toThrow("wrong identity");
  expect(queries).toBe(1);
});
