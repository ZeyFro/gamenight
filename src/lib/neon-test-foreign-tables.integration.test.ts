import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { checkForeignTables, checkSnapshot, readState } from "../../scripts/neon-test/state.mjs";

/**
 * Sur le PostgreSQL de test local (127.0.0.1) : `readState` de #419 avec une table étrangère SONDE déclarée, dans une base JETABLE
 * `gamenight_foreign_*` créée par le test (schéma minimal : historique de 118 lignes et les tables lues par readState). Le condensé
 * géré reste celui du schéma sans la sonde ; la sonde est épinglée par son propre condensé ; la modifier, l'absenter ou la relier à une
 * table gérée est refusé ; ses lignes ne sont jamais lues. La base jetable est supprimée en fin de test.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const SCRATCH = `gamenight_foreign_${Date.now()}`;
const PROBE = "zz_foreign_probe";
const noIdentityCheck = () => {};
const declared = (digest?: string) => ({ [PROBE]: { digests: { 16: digest ?? "", 18: digest ?? "" } } });

describe.skipIf(!TEST_DATABASE_URL)("table étrangère déclarée : lecture réelle du catalogue", () => {
  let admin: PrismaClient;
  let db: PrismaClient;
  const urlFor = (database: string) => { const u = new URL(TEST_DATABASE_URL!); u.pathname = `/${database}`; return u.toString(); };
  const drop = () => db.$executeRawUnsafe(`DROP TABLE IF EXISTS "${PROBE}"`);

  beforeAll(async () => {
    if (new URL(TEST_DATABASE_URL!).hostname !== "127.0.0.1") throw new Error("TEST_DATABASE_URL doit viser 127.0.0.1");
    admin = new PrismaClient({ datasourceUrl: urlFor("postgres") });
    await admin.$executeRawUnsafe(`CREATE DATABASE "${SCRATCH}"`);
    db = new PrismaClient({ datasourceUrl: urlFor(SCRATCH) });
    // Schéma minimal lu par readState (phase 118 : historique de 118 lignes, tables de changedColumns, User pour la clé étrangère).
    await db.$executeRawUnsafe(`CREATE TABLE _prisma_migrations (migration_name text, checksum text, finished_at timestamptz, rolled_back_at timestamptz)`);
    await db.$executeRawUnsafe(`INSERT INTO _prisma_migrations SELECT 'm' || lpad(g::text, 3, '0'), 'sum' || g, now(), NULL FROM generate_series(1, 118) g`);
    for (const table of ["User", "Membership", "CommunityTeam", "CommunityTeamMember", "TowerChallengeAttempt", "PlayerClassified"]) {
      await db.$executeRawUnsafe(`CREATE TABLE "${table}" (id text PRIMARY KEY)`);
    }
  }, 60_000);
  afterAll(async () => {
    await db?.$disconnect();
    await admin?.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${SCRATCH}" WITH (FORCE)`);
    await admin?.$disconnect();
  }, 60_000);

  it("la table déclarée est exclue du condensé géré, épinglée, et toute modification est refusée", async () => {
    const baseline = await readState(db, "postgres", noIdentityCheck, {});
    await db.$executeRawUnsafe(`CREATE TABLE "${PROBE}" (id serial PRIMARY KEY, name text NOT NULL, value real)`);

    // Non déclarée : la table inconnue fait diverger le schéma.
    const undeclared = await readState(db, "postgres", noIdentityCheck, {});
    expect(undeclared.schema).not.toBe(baseline.schema);

    // Déclarée : le condensé géré redevient celui du schéma sans la table, et la table a son propre condensé.
    const first = await readState(db, "postgres", noIdentityCheck, declared());
    expect(first.schema).toBe(baseline.schema);
    const pin = first.foreign[PROBE];
    expect(pin).toMatch(/^[0-9a-f]{64}$/);
    expect(first.foreignLinks).toEqual([]);
    expect(checkForeignTables(first, declared(pin))).toEqual([{ table: PROBE, digest: pin }]);
    expect(() => checkForeignTables(first, declared("0".repeat(64)))).toThrow("NEON_TEST_FOREIGN_TABLE");

    // Les lignes ne sont jamais lues : insérer des données ne change aucun condensé.
    await db.$executeRawUnsafe(`INSERT INTO "${PROBE}" (name) VALUES ('ligne')`);
    const withRows = await readState(db, "postgres", noIdentityCheck, declared(pin));
    expect(withRows.foreign[PROBE]).toBe(pin);
    expect(withRows.schema).toBe(baseline.schema);

    // Modifier la table (colonne en plus) : condensé étranger différent, refusé ; schéma géré inchangé.
    await db.$executeRawUnsafe(`ALTER TABLE "${PROBE}" ADD COLUMN extra text`);
    const altered = await readState(db, "postgres", noIdentityCheck, declared(pin));
    expect(altered.schema).toBe(baseline.schema);
    expect(altered.foreign[PROBE]).not.toBe(pin);
    expect(() => checkForeignTables(altered, declared(pin))).toThrow("NEON_TEST_FOREIGN_TABLE");
    await db.$executeRawUnsafe(`ALTER TABLE "${PROBE}" DROP COLUMN extra`);

    // Clé étrangère vers une table gérée : détectée dans le sens table étrangère -> table gérée.
    await db.$executeRawUnsafe(`ALTER TABLE "${PROBE}" ADD COLUMN "userId" text REFERENCES "User"(id)`);
    const linked = await readState(db, "postgres", noIdentityCheck, declared(pin));
    expect(linked.foreignLinks.length).toBe(1);
    expect(() => checkForeignTables({ ...linked, foreign: { [PROBE]: pin } }, declared(pin))).toThrow("NEON_TEST_FOREIGN_TABLE");
    await db.$executeRawUnsafe(`ALTER TABLE "${PROBE}" DROP COLUMN "userId"`);

    // Retour à l'état épinglé, puis absence : déclaration périmée refusée.
    const back = await readState(db, "postgres", noIdentityCheck, declared(pin));
    expect(back.foreign[PROBE]).toBe(pin);
    await drop();
    const gone = await readState(db, "postgres", noIdentityCheck, declared(pin));
    expect(gone.foreign).toEqual({});
    expect(gone.schema).toBe(baseline.schema);
    expect(() => checkForeignTables(gone, declared(pin))).toThrow("NEON_TEST_FOREIGN_TABLE");
    expect(() => checkSnapshot({ ...gone, data: {}, runtimeDml: true, teamBackfillInvalid: 0, newValues: 0 }, 118, gone.schema, undefined, declared(pin))).toThrow("NEON_TEST_FOREIGN_TABLE");
  }, 120_000);
});
