import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { devNull, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decide, isIgnorablePath } from "../../scripts/vercel-ignore-build.mjs";

/**
 * Ignored Build Step Vercel (scripts/vercel-ignore-build.mjs, branché par vercel.json).
 * Code 0 = build ignoré, code 1 = build exécuté. On n'ignore que si TOUS les fichiers
 * modifiés sont prouvés hors application ; au moindre doute on construit.
 */

const PREVIEW = { VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "feature/x", VERCEL_GIT_COMMIT_SHA: "bbb", VERCEL_GIT_PREVIOUS_SHA: "aaa" };

describe("decide — logique pure", () => {
  it("ignore une Preview dont tous les fichiers sont hors application", () => {
    const result = decide({ env: PREVIEW, changedFiles: ["docs/ETAT.md", ".github/workflows/x.yml", "scripts/neon-test/run.mjs", "README.md", ".claude/hooks/guard.mjs"] });
    expect(result.skip).toBe(true);
  });

  it("construit dès qu'un fichier applicatif change", () => {
    for (const file of ["src/app/page.tsx", "src/lib/x.test.ts", "prisma/schema.prisma", "prisma/migrations/2026_x/migration.sql", "package.json", "package-lock.json", "vercel.json", "next.config.ts", "scripts/build.mjs", "scripts/vercel-ignore-build.mjs", "public/logo.png", "tsconfig.json"]) {
      expect(decide({ env: PREVIEW, changedFiles: ["docs/a.md", file] }).skip, file).toBe(false);
    }
  });

  it("construit toujours en production et sur main", () => {
    expect(decide({ env: { ...PREVIEW, VERCEL_ENV: "production" }, changedFiles: ["docs/a.md"] }).skip).toBe(false);
    expect(decide({ env: { ...PREVIEW, VERCEL_GIT_COMMIT_REF: "main" }, changedFiles: ["docs/a.md"] }).skip).toBe(false);
  });

  it("construit si le SHA précédent ou courant est absent (premier déploiement de la branche)", () => {
    expect(decide({ env: { ...PREVIEW, VERCEL_GIT_PREVIOUS_SHA: "" }, changedFiles: ["docs/a.md"] }).skip).toBe(false);
    expect(decide({ env: { ...PREVIEW, VERCEL_GIT_COMMIT_SHA: undefined }, changedFiles: ["docs/a.md"] }).skip).toBe(false);
  });

  it("construit si la liste des fichiers est indéterminable ou vide", () => {
    expect(decide({ env: PREVIEW, changedFiles: null }).skip).toBe(false);
    expect(decide({ env: PREVIEW, changedFiles: [] }).skip).toBe(false);
  });

  it("n'accepte pas un chemin qui ressemble à un chemin ignorable sans l'être", () => {
    for (const path of ["src/docs/page.tsx", "mydocs/a.md", "docs-extra/x.ts", "scripts/neon-test-other/x.mjs", "src/.github/x", "a/README.md", "docs.md/../src/a.ts"]) {
      expect(isIgnorablePath(path), path).toBe(false);
    }
  });
});

describe("script réel sur un dépôt git jetable", () => {
  const SCRIPT = resolve("scripts/vercel-ignore-build.mjs");
  const env = { ...process.env, GIT_CONFIG_GLOBAL: devNull, GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.invalid", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.invalid" };
  let root: string;
  let repo: string;
  let first: string;

  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, env, encoding: "utf8" }).trim();
  const put = (path: string, content: string) => {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), content);
  };
  const commit = (message: string) => {
    git("add", "-A");
    git("-c", "commit.gpgsign=false", "commit", "-q", "-m", message);
    return git("rev-parse", "HEAD");
  };
  const exit = (vercel: Record<string, string>) => {
    const clean = { ...env } as Record<string, string | undefined>;
    for (const key of Object.keys(clean)) if (key.startsWith("VERCEL_")) delete clean[key];
    return spawnSync(process.execPath, [SCRIPT], { cwd: repo, env: { ...clean, ...vercel } as NodeJS.ProcessEnv, encoding: "utf8" });
  };

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "gamenight-vercel-ignore-"));
    repo = join(root, "repo");
    mkdirSync(repo);
    git("init", "-q", "-b", "main");
    put("src/app/page.tsx", "a\n");
    put("docs/a.md", "a\n");
    first = commit("base");
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("code 0 (ignoré) quand seuls des fichiers hors application changent", () => {
    put("docs/b.md", "b\n");
    put(".github/workflows/w.yml", "on: push\n");
    const second = commit("docs");
    const run = exit({ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "docs/x", VERCEL_GIT_PREVIOUS_SHA: first, VERCEL_GIT_COMMIT_SHA: second });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("build IGNORÉ");
  });

  it("code 1 (construit) quand un fichier applicatif change", () => {
    put("src/app/page.tsx", "changed\n");
    const third = commit("code");
    const run = exit({ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "feat/x", VERCEL_GIT_PREVIOUS_SHA: first, VERCEL_GIT_COMMIT_SHA: third });
    expect(run.status).toBe(1);
    expect(run.stdout).toContain("build EXÉCUTÉ");
  });

  it("code 1 quand un fichier applicatif est DÉPLACÉ vers docs/ ou la racine (renommage vu comme suppression + ajout)", () => {
    put("src/lib/moved.ts", "export const moved = 1;\n");
    const before = commit("ajoute moved");
    git("mv", "src/lib/moved.ts", "docs/moved.ts");
    const after = commit("déplace moved vers docs");
    const run = exit({ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "feat/x", VERCEL_GIT_PREVIOUS_SHA: before, VERCEL_GIT_COMMIT_SHA: after });
    expect(run.status).toBe(1);
    expect(run.stdout).toContain("src/lib/moved.ts");
  });

  it("code 0 quand un fichier de docs est simplement renommé dans docs/", () => {
    put("docs/old-name.md", "texte assez long pour que git détecte le renommage correctement\n".repeat(5));
    const before = commit("ajoute docs/old-name.md");
    git("mv", "docs/old-name.md", "docs/new-name.md");
    const after = commit("renomme dans docs");
    const run = exit({ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "docs/x", VERCEL_GIT_PREVIOUS_SHA: before, VERCEL_GIT_COMMIT_SHA: after });
    expect(run.status).toBe(0);
  });

  it("code 1 si le SHA précédent n'existe pas dans le clone (clone superficiel) : fail-safe", () => {
    const head = git("rev-parse", "HEAD");
    const run = exit({ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "docs/x", VERCEL_GIT_PREVIOUS_SHA: "0".repeat(40), VERCEL_GIT_COMMIT_SHA: head });
    expect(run.status).toBe(1);
  });

  it("code 1 en production même si seuls des fichiers de docs changent", () => {
    put("docs/c.md", "c\n");
    const head = commit("docs prod");
    const run = exit({ VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "main", VERCEL_GIT_PREVIOUS_SHA: first, VERCEL_GIT_COMMIT_SHA: head });
    expect(run.status).toBe(1);
  });

  it("code 1 hors d'un dépôt git ou sans variables Vercel", () => {
    expect(exit({}).status).toBe(1);
  });
});

describe("vercel.json", () => {
  const config = JSON.parse(readFileSync(resolve("vercel.json"), "utf8")) as Record<string, unknown>;

  it("branche exactement le script d'ignorance et conserve la région", () => {
    expect(config.ignoreCommand).toBe("node scripts/vercel-ignore-build.mjs");
    expect(config.regions).toEqual(["fra1"]);
  });

  it("ne redéfinit ni le build ni l'installation", () => {
    for (const key of ["buildCommand", "installCommand", "devCommand"]) expect(key in config, key).toBe(false);
  });
});
