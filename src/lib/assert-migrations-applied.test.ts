import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { evaluateGate, gateDatabaseUrl, listLocalMigrations, run } from "../../scripts/assert-migrations-applied.mjs";

const collect = () => {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, log: (m: string) => out.push(m), fail: (m: string) => err.push(m) };
};

describe("décision de la garde de migration (pure)", () => {
  it("ok quand tout est appliqué, même si la base a des migrations en plus", () => {
    expect(evaluateGate({ local: ["a", "b"], applied: ["a", "b", "c"], unfinished: 0 })).toEqual({ ok: true, pending: [], unfinished: 0 });
  });
  it("refuse une migration en attente", () => {
    expect(evaluateGate({ local: ["a", "b"], applied: ["a"], unfinished: 0 })).toMatchObject({ ok: false, pending: ["b"] });
  });
  it("refuse une migration inachevée même si tout est listé", () => {
    expect(evaluateGate({ local: ["a"], applied: ["a"], unfinished: 1 }).ok).toBe(false);
  });
});

describe("choix de l'URL de lecture", () => {
  it("préfère l'URL dédiée en lecture seule à DATABASE_URL, sinon se rabat dessus", () => {
    expect(gateDatabaseUrl({ MIGRATION_GATE_DATABASE_URL: "dedie", DATABASE_URL: "appli" })).toBe("dedie");
    expect(gateDatabaseUrl({ DATABASE_URL: "appli" })).toBe("appli");
    expect(gateDatabaseUrl({})).toBeUndefined();
  });
  it("le code source n'envoie qu'une lecture : requêtes fixes, sans interpolation", () => {
    const src = readFileSync("scripts/assert-migrations-applied.mjs", "utf8");
    const queries = src.match(/\$(?:queryRaw|executeRaw)Unsafe\(\s*[`"][^`"]*[`"]/g) ?? [];
    expect(queries.length).toBe(3);
    for (const q of queries) expect(q).not.toContain("${");
    expect(src).not.toMatch(/console\.(log|error)\([^)]*(url|URL)[^)]*\)/);
  });
});

describe("liste des migrations locales", () => {
  it("ne retient que les dossiers horodatés, triés, sans migration_lock.toml", () => {
    const dir = mkdtempSync(join(tmpdir(), "gate-"));
    try {
      mkdirSync(join(dir, "20261102000000_b"));
      mkdirSync(join(dir, "20261101000000_a"));
      mkdirSync(join(dir, "pas_une_migration"));
      writeFileSync(join(dir, "migration_lock.toml"), "provider = \"postgresql\"\n");
      expect(listLocalMigrations(dir)).toEqual(["20261101000000_a", "20261102000000_b"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("garde de build : comportement selon l'environnement (sans base)", () => {
  it("ne fait rien hors production, sans lire la base", async () => {
    const c = collect();
    expect(await run({ VERCEL_ENV: "preview", MIGRATION_GATE_ENFORCE: "true" }, c)).toBe(0);
    expect(await run({ MIGRATION_GATE_ENFORCE: "true" }, c)).toBe(0);
    expect(c.err).toEqual([]);
  });

  it("mode rapport : jamais bloquant, même sans URL ou base injoignable", async () => {
    const c = collect();
    expect(await run({ VERCEL_ENV: "production" }, c)).toBe(0);
    expect(await run({ VERCEL_ENV: "production", MIGRATION_GATE_ENFORCE: "yes", DATABASE_URL: "postgresql://u:p@127.0.0.1:1/x" }, c)).toBe(0);
    expect(c.out.join("\n")).toContain("mode rapport");
  });

  it("application stricte : échec fermé sans URL, et base injoignable", async () => {
    const c = collect();
    expect(await run({ VERCEL_ENV: "production", MIGRATION_GATE_ENFORCE: "true" }, c)).toBe(1);
    const unreachable = collect();
    expect(await run({ VERCEL_ENV: "production", MIGRATION_GATE_ENFORCE: "true", DATABASE_URL: "postgresql://u:secret@127.0.0.1:1/x" }, unreachable)).toBe(1);
    expect(unreachable.err.join("\n")).toContain("base illisible");
    expect(unreachable.err.join("\n")).not.toContain("secret");
    expect(unreachable.err.join("\n")).not.toContain("127.0.0.1");
  });
});

const testUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testUrl)("garde de build contre une vraie base PostgreSQL de test", () => {
  let appliedNames: string[] = [];
  let scratch = "";

  const dirWith = (names: string[]) => {
    const dir = join(scratch, `case-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir);
    for (const name of names) mkdirSync(join(dir, name));
    return dir;
  };
  const env = (dir: string, enforce: boolean) => ({
    VERCEL_ENV: "production",
    DATABASE_URL: testUrl,
    MIGRATION_GATE_DIR: dir,
    ...(enforce ? { MIGRATION_GATE_ENFORCE: "true" } : {}),
  });

  beforeAll(async () => {
    scratch = mkdtempSync(join(tmpdir(), "gate-db-"));
    const db = new PrismaClient({ datasourceUrl: testUrl });
    try {
      const rows = await db.$queryRawUnsafe<{ migration_name: string }[]>(
        `SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`,
      );
      appliedNames = rows.map((row) => row.migration_name);
    } finally {
      await db.$disconnect();
    }
  });
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));

  it("la base de test contient des migrations appliquées (garde contre un test à vide)", () => {
    expect(appliedNames.length).toBeGreaterThan(100);
  });

  it("schéma à jour : build autorisé en application stricte", async () => {
    const c = collect();
    expect(await run(env(dirWith(appliedNames), true), c)).toBe(0);
    expect(c.out.join("\n")).toContain("application stricte");
    expect(c.out.join("\n")).toContain("Schéma à jour");
  });

  it("migrations du dépôt réel : toutes appliquées sur la base de test", async () => {
    expect(await run({ ...env("prisma/migrations", true) }, collect())).toBe(0);
  });

  it("migration en attente : build REFUSÉ en application stricte, avec son nom", async () => {
    const pending = "29991231000000_nouvelle_migration_en_attente";
    const c = collect();
    expect(await run(env(dirWith([...appliedNames, pending]), true), c)).toBe(1);
    expect(c.err.join("\n")).toContain(`En attente : ${pending}`);
    expect(c.err.join("\n")).toContain("le déploiement précédent reste servi");
    const everything = [...c.out, ...c.err].join("\n");
    expect(everything).not.toContain("postgresql://");
    expect(everything).not.toContain("postgres:test");
  });

  it("même cas en mode rapport : signalé mais jamais bloquant", async () => {
    const pending = "29991231000000_nouvelle_migration_en_attente";
    const c = collect();
    expect(await run(env(dirWith([...appliedNames, pending]), false), c)).toBe(0);
    expect(c.err.join("\n")).toContain(`En attente : ${pending}`);
    expect(c.err.join("\n")).toContain("aurait été refusé");
  });

  it("ne modifie rien : le nombre de lignes de _prisma_migrations est inchangé", async () => {
    const db = new PrismaClient({ datasourceUrl: testUrl });
    try {
      const count = async () => (await db.$queryRawUnsafe<{ n: number }[]>(`SELECT COUNT(*)::int AS n FROM "_prisma_migrations"`))[0].n;
      const before = await count();
      await run(env(dirWith([...appliedNames, "29991231000000_x"]), true), collect());
      expect(await count()).toBe(before);
    } finally {
      await db.$disconnect();
    }
  });
});
