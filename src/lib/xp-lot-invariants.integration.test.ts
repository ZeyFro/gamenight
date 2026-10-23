import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertLocalTestDatabase } from "./test-local-database";
import { PrismaClient } from "@prisma/client";
import { LOT_MIGRATIONS, assertReadTarget, evaluate } from "../../scripts/xp-lot-invariants.mjs";

// Contrôle d'invariants du lot (scripts/xp-lot-invariants.mjs) sur une base neuve `gamenight_xpinv_*` du PostgreSQL de test
// (127.0.0.1 uniquement) : état « main » (sans les 6 migrations), exécution réelle de scripts/db-migrate.mjs, puis cas négatifs.
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const NEW_DB = `gamenight_xpinv_${Date.now()}`;
const ALL = readdirSync("prisma/migrations", { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
if (!TEST_DATABASE_URL) console.warn("[xp-lot-invariants] TEST_DATABASE_URL absente : tests SKIPPÉS.");

describe("xp-lot-invariants : cible et évaluation (sans base)", () => {
  it("accepte le local, refuse un hôte distant sauf variable d'opérateur identique, sans afficher le mot de passe", () => {
    const remote = `${"postgresql:"}//u:pw-secret@db.example.invalid:5432/appdb`;
    expect(() => assertReadTarget(`${"postgresql:"}//u:p@127.0.0.1:5432/gamenight_x`, undefined)).not.toThrow();
    expect(() => assertReadTarget(remote, undefined)).toThrow(/XP_INVARIANTS_ALLOW_REMOTE/);
    expect(() => assertReadTarget(remote, "db.example.invalid:5432/autre")).toThrow(/refusée/);
    expect(() => assertReadTarget(remote, "db.example.invalid:5432/appdb")).not.toThrow();
    expect(() => assertReadTarget(remote, undefined)).not.toThrow(/pw-secret/);
    expect(() => assertReadTarget("", undefined)).toThrow(/obligatoire/);
  });

  const facts = (over: object = {}) => ({
    migrations: Object.fromEntries(LOT_MIGRATIONS.map((name: string) => [name, "terminée"])), unfinished: [],
    objects: { "colonne CommunityMemberStats.xpBalance": true }, negativeXpTotal: 0, negativeXpBalance: 0, balanceDiffersFromTotal: 0, fingerprint: "abc", ...over,
  });
  it("après : exige 6 terminées, aucun négatif et xpBalance = xpTotal ; réouvert : tolère l'écart de solde", () => {
    expect(evaluate("after", facts(), undefined)).toEqual([]);
    expect(evaluate("after", facts({ negativeXpBalance: 1 }), undefined)).toHaveLength(1);
    expect(evaluate("after", facts({ balanceDiffersFromTotal: 2 }), undefined)).toHaveLength(1);
    expect(evaluate("reopened", facts({ balanceDiffersFromTotal: 2 }), undefined)).toEqual([]);
    expect(evaluate("reopened", facts({ negativeXpBalance: 1 }), undefined)).toHaveLength(1);
    expect(evaluate("after", facts({ migrations: { ...facts().migrations, [LOT_MIGRATIONS[5]]: "absente" } }), undefined)).toHaveLength(1);
    expect(evaluate("after", facts({ unfinished: [LOT_MIGRATIONS[0]] }), undefined)).toHaveLength(1);
    expect(evaluate("after", facts({ fingerprint: "zzz" }), "abc")).toHaveLength(1);
  });
});

describe.skipIf(!TEST_DATABASE_URL)("xp-lot-invariants : base neuve, état main puis lot réel", () => {
  let admin: PrismaClient;
  let db: PrismaClient;
  let workdir: string;
  const url = () => { const u = new URL(TEST_DATABASE_URL!); if (!["127.0.0.1", "localhost"].includes(u.hostname)) throw new Error("PostgreSQL local uniquement"); u.pathname = `/${NEW_DB}`; return u.toString(); };
  const run = (script: string, args: string[], env: Record<string, string> = {}) => {
    const clean: NodeJS.ProcessEnv = { ...process.env }; delete clean.DATABASE_URL;
    return spawnSync(process.execPath, [resolve(script), ...args], { env: { ...clean, ...env }, encoding: "utf8" });
  };
  const check = (phase: string, extra: string[] = []) => run("scripts/xp-lot-invariants.mjs", [`--phase=${phase}`, ...extra], { XP_INVARIANTS_DATABASE_URL: url() });
  const fingerprint = (out: string) => /EMPREINTE (\w{32})/.exec(out)![1];

  beforeAll(async () => {
    assertLocalTestDatabase(TEST_DATABASE_URL); // avant tout client et toute requête
    admin = new PrismaClient({ datasourceUrl: TEST_DATABASE_URL });
    for (const { datname } of await admin.$queryRawUnsafe<{ datname: string }[]>(`SELECT datname FROM pg_database WHERE datname LIKE 'gamenight\\_xpinv\\_%'`)) {
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${datname}" WITH (FORCE)`);
    }
    await admin.$executeRawUnsafe(`CREATE DATABASE "${NEW_DB}"`);
    // État « main » : toutes les migrations sauf les 6 du lot, appliquées par Prisma depuis une copie du dossier prisma/.
    workdir = mkdtempSync(join(tmpdir(), "gn-xpinv-"));
    mkdirSync(join(workdir, "prisma", "migrations"), { recursive: true });
    cpSync("prisma/schema.prisma", join(workdir, "prisma", "schema.prisma"));
    cpSync("prisma/migrations/migration_lock.toml", join(workdir, "prisma", "migrations", "migration_lock.toml"));
    for (const name of ALL.filter((n) => !LOT_MIGRATIONS.includes(n))) cpSync(join("prisma/migrations", name), join(workdir, "prisma", "migrations", name), { recursive: true });
    const baseline = spawnSync(process.execPath, [resolve("node_modules/prisma/build/index.js"), "migrate", "deploy", `--schema=${join(workdir, "prisma", "schema.prisma")}`],
      { env: { ...process.env, DATABASE_URL: url() }, encoding: "utf8" });
    expect(baseline.status, baseline.stdout + baseline.stderr).toBe(0);
    db = new PrismaClient({ datasourceUrl: url() });
    // Données synthétiques : deux membres, objets, ancien achat SHOP_PURCHASE.
    const c = await db.community.create({ data: { slug: "inv", name: "Inv", status: "ACTIVE" } });
    const u1 = await db.user.create({ data: { discordId: "inv-1", discordName: "Inv1" } });
    const u2 = await db.user.create({ data: { discordId: "inv-2", discordName: "Inv2" } });
    await db.$executeRawUnsafe(`INSERT INTO "CommunityMemberStats" ("communityId","userId","xpTotal","equippedTitleId") VALUES ($1,$2,799,'title-strategist'), ($1,$3,0,NULL)`, c.id, u1.id, u2.id);
    await db.$executeRawUnsafe(`INSERT INTO "CommunityMemberCosmetic" ("communityId","userId","itemId") VALUES ($1,$2,'title-strategist')`, c.id, u1.id);
    await db.$executeRawUnsafe(`INSERT INTO "XpEvent" ("id","communityId","userId","reason","sourceId","amount") VALUES ('inv-e1',$1,$2,'SHOP_PURCHASE','title-strategist',-250)`, c.id, u1.id);
  }, 180_000);
  afterAll(async () => {
    await db?.$disconnect();
    await admin?.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${NEW_DB}" WITH (FORCE)`);
    await admin?.$disconnect();
    if (workdir) rmSync(workdir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  }, 60_000);

  let before = "";
  it("état main : phase before OK, phase after en échec (4)", () => {
    const ok = check("before");
    expect(ok.status, ok.stdout + ok.stderr).toBe(0);
    expect(ok.stdout).toContain("INVARIANTS OK (phase before)");
    before = fingerprint(ok.stdout);
    const ko = check("after");
    expect(ko.status).toBe(4);
    expect(ko.stdout).toContain("ECHEC migration 20261019190000_separate_xp_balance : absente");
  });

  it("refus (2) : sans URL, avec hôte distant, argument ou phase inconnus ; aucun secret affiché", () => {
    expect(run("scripts/xp-lot-invariants.mjs", ["--phase=before"]).status).toBe(2);
    const remote = run("scripts/xp-lot-invariants.mjs", ["--phase=before"], { XP_INVARIANTS_DATABASE_URL: `${"postgresql:"}//u:pw-secret@db.example.invalid:5432/appdb` });
    expect(remote.status).toBe(2);
    expect(remote.stdout + remote.stderr).not.toContain("pw-secret");
    expect(run("scripts/xp-lot-invariants.mjs", ["--phase=autre"], { XP_INVARIANTS_DATABASE_URL: url() }).status).toBe(2);
    expect(run("scripts/xp-lot-invariants.mjs", ["--phase=before", "--write"], { XP_INVARIANTS_DATABASE_URL: url() }).status).toBe(2);
  });

  it("progression négative avant le lot : phase before en échec (la contrainte échouerait)", async () => {
    await db.$executeRawUnsafe(`UPDATE "CommunityMemberStats" SET "xpTotal" = -1 WHERE "xpTotal" = 0`);
    const out = check("before");
    expect(out.status).toBe(4);
    expect(out.stdout).toContain("xpTotal < 0");
    await db.$executeRawUnsafe(`UPDATE "CommunityMemberStats" SET "xpTotal" = 0 WHERE "xpTotal" = -1`);
  });

  it("dry-run puis exécution réelle des 6 migrations : phase after OK, empreinte identique, xpBalance = xpTotal", () => {
    const env = { MIGRATION_DATABASE_URL: url(), GAMENIGHT_RUNTIME_ROLE: "gn_runtime_absent" };
    const expectArg = `--expect=${LOT_MIGRATIONS.join(",")}`;
    const dry = run("scripts/db-migrate.mjs", ["--allow-local", expectArg], env);
    expect(dry.status, dry.stdout + dry.stderr).toBe(0);
    expect(dry.stdout).toContain("DRY-RUN");
    expect(check("before").status).toBe(0);
    const exec = run("scripts/db-migrate.mjs", ["--allow-local", expectArg, "--execute", `--confirm-database=${NEW_DB}`], env);
    expect(exec.status, exec.stdout + exec.stderr).toBe(0);
    const after = check("after", [`--expect-fingerprint=${before}`]);
    expect(after.status, after.stdout + after.stderr).toBe(0);
    expect(after.stdout).toContain("INVARIANTS OK (phase after)");
    expect(after.stdout).toContain("2 ligne(s)");
    expect(check("before").status).toBe(4);
  }, 180_000);

  it("dérive d'un ancien writer : after en échec (4), reopened tolère l'écart ; l'empreinte détecte un xpTotal modifié", async () => {
    await db.$executeRawUnsafe(`UPDATE "CommunityMemberStats" SET "xpBalance" = "xpBalance" - 100 WHERE "xpTotal" = 799`);
    const drift = check("after");
    expect(drift.status).toBe(4);
    expect(drift.stdout).toContain("xpBalance <> xpTotal");
    expect(check("reopened", [`--expect-fingerprint=${before}`]).status).toBe(0);
    await db.$executeRawUnsafe(`UPDATE "CommunityMemberStats" SET "xpTotal" = "xpTotal" - 10 WHERE "xpTotal" = 799`);
    const changed = check("reopened", [`--expect-fingerprint=${before}`]);
    expect(changed.status).toBe(4);
    expect(changed.stdout).toContain("empreinte");
  });

  it("migration inachevée : refus d'office (4), objet manquant détecté", async () => {
    await db.$executeRawUnsafe(`UPDATE _prisma_migrations SET finished_at = NULL WHERE migration_name = '${LOT_MIGRATIONS[5]}'`);
    const out = check("reopened");
    expect(out.status).toBe(4);
    expect(out.stdout).toContain("inachevée");
  });

  it("n'écrit jamais : la transaction est READ ONLY (une écriture dans la même session est refusée)", async () => {
    const guard = new PrismaClient({ datasourceUrl: url() });
    try {
      await expect(guard.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
        await tx.$executeRawUnsafe(`UPDATE "CommunityMemberStats" SET "xpTotal" = "xpTotal"`);
      })).rejects.toThrow(/read-only/i);
    } finally { await guard.$disconnect(); }
    const source = (await import("node:fs")).readFileSync("scripts/xp-lot-invariants.mjs", "utf8");
    expect(source).toContain("SET TRANSACTION READ ONLY");
    expect(source).not.toMatch(/\$executeRaw(Unsafe)?\(`\s*(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|CREATE)/i);
  });
});
