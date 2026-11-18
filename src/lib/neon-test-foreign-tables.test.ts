import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  changedColumns, checkForeignTables, checkSnapshot, digest, foreignDigest, loadForeignTables, splitForeign,
} from "../../scripts/neon-test/state.mjs";

/**
 * Tables étrangères CONNUES de Neon Test (ex. playing_with_neon, table d'exemple de la console Neon) : déclarées une à une avec le
 * condensé de leurs colonnes, contraintes et index, exclues du condensé du schéma géré, mais jamais ignorées.
 */
// Métadonnées lues en lecture seule sur la branche de test (PostgreSQL 18.6) le 8 novembre 2026 — aucune ligne de données.
const observed = () => ({
  columns: [
    { relname: "playing_with_neon", attname: "id", type: "integer", atttypmod: -1, attnotnull: true, def: "nextval('playing_with_neon_id_seq'::regclass)" },
    { relname: "playing_with_neon", attname: "name", type: "text", atttypmod: -1, attnotnull: true, def: null },
    { relname: "playing_with_neon", attname: "value", type: "real", atttypmod: -1, attnotnull: false, def: null },
  ],
  constraints: [
    { relname: "playing_with_neon", conname: "playing_with_neon_id_not_null", contype: "n", convalidated: true, conenforced: true, def: "NOT NULL id" },
    { relname: "playing_with_neon", conname: "playing_with_neon_name_not_null", contype: "n", convalidated: true, conenforced: true, def: "NOT NULL name" },
    { relname: "playing_with_neon", conname: "playing_with_neon_pkey", contype: "p", convalidated: true, conenforced: true, def: "PRIMARY KEY (id)" },
  ],
  indexes: [
    { table_name: "playing_with_neon", name: "playing_with_neon_pkey", indisvalid: true, indisready: true, def: "CREATE UNIQUE INDEX playing_with_neon_pkey ON public.playing_with_neon USING btree (id)" },
  ],
});
const manifest = loadForeignTables();
const pinned = manifest.playing_with_neon.digests["18"] as string;
const state = (over: Record<string, unknown> = {}) => ({
  identity: { version: 180006 }, foreign: { playing_with_neon: pinned }, foreignLinks: [] as string[], ...over,
});

describe("manifeste foreign-tables.json", () => {
  it("déclare playing_with_neon avec un condensé SHA-256 pour PostgreSQL 18, reproductible depuis les métadonnées lues", () => {
    expect(Object.keys(manifest)).toEqual(["playing_with_neon"]);
    expect(pinned).toMatch(/^[0-9a-f]{64}$/);
    expect(foreignDigest(observed())).toBe(pinned);
    expect(manifest.playing_with_neon.origin).toMatch(/console Neon/);
  });
  it("aucune table étrangère ne porte le nom d'une table gérée par les migrations", () => {
    const managed = Object.keys(changedColumns);
    for (const name of Object.keys(manifest)) expect(managed).not.toContain(name);
    expect(readFileSync("prisma/schema.prisma", "utf8")).not.toContain("playing_with_neon");
  });
  it("le condensé est canonique : types JS différents (pilote Prisma, HTTP) donnent le même résultat", () => {
    const variant = observed();
    variant.columns[0].atttypmod = "-1" as unknown as number;
    variant.columns[0].attnotnull = "true" as unknown as boolean;
    variant.constraints[2].convalidated = "true" as unknown as boolean;
    variant.indexes[0].indisvalid = "true" as unknown as boolean;
    expect(foreignDigest(variant)).toBe(pinned);
  });
  it("toute modification de la table change le condensé : colonne, contrainte, index, type, défaut", () => {
    const mutations: Array<(rows: ReturnType<typeof observed>) => void> = [
      rows => rows.columns.push({ relname: "playing_with_neon", attname: "extra", type: "text", atttypmod: -1, attnotnull: false, def: null }),
      rows => { rows.columns[2].attnotnull = true; },
      rows => { rows.columns[1].type = "character varying"; },
      rows => { rows.columns[0].def = null; },
      rows => { rows.constraints.pop(); },
      rows => rows.indexes.push({ table_name: "playing_with_neon", name: "playing_with_neon_name_idx", indisvalid: true, indisready: true, def: "CREATE INDEX playing_with_neon_name_idx ON public.playing_with_neon USING btree (name)" }),
      rows => { rows.indexes[0].indisvalid = false; },
    ];
    for (const mutate of mutations) { const rows = observed(); mutate(rows); expect(foreignDigest(rows)).not.toBe(pinned); }
  });
});

describe("exclusion du condensé géré, sans rien ignorer", () => {
  const managed = { columns: [{ relname: "Membership", attname: "id" }], constraints: [{ relname: "Membership", conname: "Membership_pkey" }], indexes: [{ table_name: "Membership", name: "Membership_pkey" }] };
  const merged = () => { const o = observed(); return { columns: [...managed.columns, ...o.columns], constraints: [...managed.constraints, ...o.constraints], indexes: [...managed.indexes, ...o.indexes] }; };

  it("retire les lignes de la table déclarée : le condensé géré est identique à celui d'un schéma sans elle", () => {
    const split = splitForeign(merged(), manifest);
    expect(split.managed).toEqual(managed);
    expect(digest(split.managed)).toBe(digest(managed));
    expect(Object.keys(split.foreign)).toEqual(["playing_with_neon"]);
  });
  it("une autre table inconnue (non déclarée) reste dans le condensé géré donc fait diverger le schéma", () => {
    const rows = merged();
    rows.columns.push({ relname: "autre_table_inconnue", attname: "id" } as never);
    const split = splitForeign(rows, manifest);
    expect(digest(split.managed)).not.toBe(digest(managed));
    expect(() => checkSnapshot({ schema: digest(split.managed), data: {}, runtimeDml: true, teamBackfillInvalid: 0, newValues: 0, identity: { version: 180006 }, foreign: { playing_with_neon: pinned }, foreignLinks: [] }, 118, digest(managed), undefined, manifest)).toThrow("NEON_TEST_SCHEMA_MISMATCH");
  });
});

describe("checkForeignTables / checkSnapshot", () => {
  it("accepte la table déclarée conforme et la rapporte (jamais silencieuse)", () => {
    expect(checkForeignTables(state(), manifest)).toEqual([{ table: "playing_with_neon", digest: pinned }]);
  });
  it("sans déclaration, aucune table étrangère n'est tolérée ni contrôlée (comportement de #419 inchangé)", () => {
    expect(checkForeignTables({ identity: { version: 180006 } }, {})).toEqual([]);
    const valid = { schema: "expected", data: {}, runtimeDml: true, teamBackfillInvalid: 0, newValues: 0 };
    expect(() => checkSnapshot(valid, 120, "expected", {})).not.toThrow();
  });
  it.each([
    ["table modifiée", state({ foreign: { playing_with_neon: "0".repeat(64) } })],
    ["table déclarée absente (déclaration périmée)", state({ foreign: {} })],
    ["version non épinglée (PostgreSQL 16)", state({ identity: { version: 160015 } })],
    ["clé étrangère entre la table et une table gérée", state({ foreignLinks: ["playing_with_neon_user_fkey"] })],
  ])("refuse : %s", (_label, snapshot) => {
    expect(() => checkForeignTables(snapshot, manifest)).toThrow("NEON_TEST_FOREIGN_TABLE");
  });
  it("refuse une déclaration qui porte sur une table gérée par les migrations", () => {
    expect(() => checkForeignTables(state({ foreign: { Membership: pinned } }), { Membership: { digests: { 18: pinned } } })).toThrow("NEON_TEST_FOREIGN_TABLE");
  });
  it("checkSnapshot enchaîne schéma, puis table étrangère, puis le reste", () => {
    const valid = { ...state(), schema: "expected", data: { t: { count: 1, hash: "h" } }, runtimeDml: true, teamBackfillInvalid: 0, newValues: 0 };
    expect(() => checkSnapshot(valid, 120, "expected", valid.data, manifest)).not.toThrow();
    expect(() => checkSnapshot({ ...valid, schema: "drift" }, 120, "expected", valid.data, manifest)).toThrow("NEON_TEST_SCHEMA_MISMATCH");
    expect(() => checkSnapshot({ ...valid, foreign: {} }, 120, "expected", valid.data, manifest)).toThrow("NEON_TEST_FOREIGN_TABLE");
  });
});
