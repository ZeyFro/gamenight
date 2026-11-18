import { afterAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { strictNativeConnection } from "../../scripts/neon-test/native-tls.mjs";
import { PATCHED_RUNNER_LIB_SHA256, PINNED_RUNNER_LIB_SHA256, patchRunnerLib } from "../../scripts/neon-test/runner-ssl.mjs";

/**
 * Contre-test de l'ASSEMBLAGE réel du workflow Neon Test : l'étape « Assemble » est extraite du YAML et exécutée telle quelle dans un
 * espace de travail temporaire (runner épinglé #370 @4a18b74 vendu en fixture, empreintes vérifiées), puis le garde d'URL du
 * `db-migrate-lib.mjs` assemblé est exercé avec l'URL réellement produite par strictNativeConnection. Aucune connexion, aucune base.
 */
const require = createRequire(import.meta.url);
const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const fixtures = resolve("scripts/neon-test/fixtures/runner-4a18b74");
const workflow = require("js-yaml").load(readFileSync(".github/workflows/neon-test-apply.yml", "utf8"));
const assemble: string = workflow.jobs["migration-test"].steps.find((s: { name?: string }) => s.name?.includes("Assemble")).run;
const FIRST = "20261104140000_tower_team_membership_policy";
const SECOND = "20261105120000_tower_launch_channels_appeals_matchmaking";

const dirs: string[] = [];
afterAll(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); });

function workspace() {
  const root = mkdtempSync(join(tmpdir(), "neon-assemble-"));
  dirs.push(root);
  mkdirSync(join(root, "migration-370/scripts"), { recursive: true });
  mkdirSync(join(root, `migration-370/prisma/migrations/${FIRST}`), { recursive: true });
  mkdirSync(join(root, "operator/scripts"), { recursive: true });
  mkdirSync(join(root, "operator/prisma/migrations"), { recursive: true });
  for (const file of ["db-migrate.mjs", "db-migrate-lib.mjs"]) cpSync(join(fixtures, file), join(root, "migration-370/scripts", file));
  writeFileSync(join(root, `migration-370/prisma/migrations/${FIRST}/migration.sql`), "SELECT 1;\n");
  cpSync(resolve("scripts/neon-test"), join(root, "scripts/neon-test"), { recursive: true });
  const run = spawnSync("bash", ["-c", assemble], { cwd: root, encoding: "utf8", env: { PATH: process.env.PATH ?? "", NODE_ENV: "test" } });
  return { root, run };
}

// Assemblée comme dans les autres tests Neon Test pour ne pas déclencher le garde « pas de chaîne de connexion non locale en dur ».
const fixture = new URL("postgresql://migrator:fake@127.0.0.1/neondb");
fixture.hostname = "db.example.test";
const target = fixture.href;
const strictUrl = strictNativeConnection(`${target}?sslmode=require&channel_binding=require&connect_timeout=15`);

describe("empreintes du runner épinglé et du correctif", () => {
  it("les fixtures sont exactement les fichiers épinglés #370 @4a18b74", () => {
    expect(sha(readFileSync(join(fixtures, "db-migrate-lib.mjs")))).toBe(PINNED_RUNNER_LIB_SHA256);
    expect(sha(readFileSync(join(fixtures, "db-migrate.mjs")))).toBe("0386242c7da8553f0e85aad419db26d0a8a1aab32ee24dac0f7ada2d80927e0e");
  });
  it("le correctif ne s'applique qu'à la source épinglée et produit l'empreinte attendue", () => {
    const patched = patchRunnerLib(readFileSync(join(fixtures, "db-migrate-lib.mjs"), "utf8"));
    expect(sha(patched)).toBe(PATCHED_RUNNER_LIB_SHA256);
    expect(() => patchRunnerLib(patched)).toThrow("NEON_TEST_RUNNER_LIB_NOT_PINNED");
    expect(() => patchRunnerLib(readFileSync(join(fixtures, "db-migrate-lib.mjs"), "utf8") + "\n")).toThrow("NEON_TEST_RUNNER_LIB_NOT_PINNED");
  });
});

describe("assemblage réel du workflow", () => {
  it("applique le correctif dans l'étape d'assemblage, après la copie du runner, et reste sans migration #406", () => {
    const copy = assemble.indexOf("cp migration-370/scripts/db-migrate-lib.mjs operator/scripts/db-migrate-lib.mjs");
    const patch = assemble.indexOf("node scripts/neon-test/runner-ssl.mjs operator/scripts/db-migrate-lib.mjs");
    expect(copy).toBeGreaterThanOrEqual(0);
    expect(patch).toBeGreaterThan(copy);
    expect(assemble).not.toContain("cp -R migration-406/");
    const { root, run } = workspace();
    expect(run.status, run.stderr + run.stdout).toBe(0);
    expect(existsSync(join(root, `operator/prisma/migrations/${SECOND}`))).toBe(false);
    expect(existsSync(join(root, `operator/prisma/migrations/${FIRST}/migration.sql`))).toBe(true);
  });

  it("l'assemblage produit le db-migrate-lib corrigé (empreinte exacte) et laisse db-migrate.mjs intact", () => {
    const { root } = workspace();
    expect(sha(readFileSync(join(root, "operator/scripts/db-migrate-lib.mjs")))).toBe(PATCHED_RUNNER_LIB_SHA256);
    expect(readFileSync(join(root, "operator/scripts/db-migrate.mjs"), "utf8")).toBe(readFileSync(join(fixtures, "db-migrate.mjs"), "utf8"));
  });

  it("contre-test : le runner épinglé NON corrigé refuse l'URL du workflow (le blocage est bien reproduit)", async () => {
    const { parseTarget } = await import(pathToFileURL(join(fixtures, "db-migrate-lib.mjs")).href);
    expect(() => parseTarget(strictUrl)).toThrow(/Paramètre d'URL non autorisé : sslaccept/);
  });

  it("le runner assemblé accepte l'URL exacte du workflow, et SEULEMENT sslaccept=strict", async () => {
    const { root } = workspace();
    const { parseTarget } = await import(pathToFileURL(join(root, "operator/scripts/db-migrate-lib.mjs")).href);
    expect(new URL(strictUrl).searchParams.get("sslaccept")).toBe("strict");
    expect(parseTarget(strictUrl)).toMatchObject({ host: "db.example.test", database: "neondb", username: "migrator" });
    // Variantes dangereuses ou ambiguës : toutes refusées.
    for (const suffix of [
      "sslmode=require&sslaccept=accept_invalid_certs", "sslmode=require&sslaccept=", "sslmode=require&sslaccept=STRICT",
      "sslmode=require&sslaccept=strict%20", "sslmode=require&sslaccept=strict&sslaccept=strict",
      "sslmode=require&sslaccept=strict&sslaccept=accept_invalid_certs", "sslmode=require&SSLACCEPT=strict", "sslmode=require&sslAccept=strict",
      "sslmode=require&sslaccept=strict&host=autre.example.test", "sslmode=require&sslaccept=strict&sslcert=/tmp/ca",
      "sslmode=require&sslaccept=strict&sslidentity=/tmp/id", "sslmode=require&sslaccept=strict&schema=autre",
      "sslmode=require&sslaccept=strict&options=-c%20role%3Dpostgres", "sslmode=require&sslaccept=strict&service=x",
    ]) {
      expect(() => parseTarget(`${target}?${suffix}`), suffix).toThrow(/Paramètre d'URL non autorisé/);
    }
    // Les paramètres déjà admis par le runner restent admis, rien de plus.
    expect(() => parseTarget(`${target}?sslmode=require&connect_timeout=15`)).not.toThrow();
  });

  it("le CLI assemblé : sslaccept=strict passe le garde d'URL (refus plus loin, avant toute connexion), accept_invalid_certs est refusé", () => {
    const { root } = workspace();
    symlinkSync(resolve("node_modules"), join(root, "operator/node_modules"));
    const run = (query: string) => spawnSync(process.execPath, ["scripts/db-migrate.mjs", "--expect=x"], {
      cwd: join(root, "operator"), encoding: "utf8",
      env: { PATH: process.env.PATH ?? "", MIGRATION_DATABASE_URL: `${target}?${query}`, GAMENIGHT_EXPECTED_TARGET: "autre.example.test/neondb", GAMENIGHT_RUNTIME_ROLE: "runtime", NODE_ENV: "test" },
    });
    const ok = run("sslmode=require&sslaccept=strict");
    expect(ok.status).toBe(2);
    expect(ok.stdout + ok.stderr).toContain("Cible inattendue");           // refusée sur la cible attendue, donc le garde d'URL a laissé passer
    expect(ok.stdout + ok.stderr).not.toContain("Paramètre d'URL non autorisé");
    for (const bad of ["sslmode=require&sslaccept=accept_invalid_certs", "sslmode=require&sslaccept=strict&sslaccept=strict"]) {
      const refused = run(bad);
      expect(refused.status).toBe(2);
      expect(refused.stdout + refused.stderr).toContain("Paramètre d'URL non autorisé : sslaccept");
    }
  });
});
