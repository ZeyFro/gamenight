import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { devNull, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { describeViolation, findViolations, parseLsTree } from "../../scripts/check-migrations-immutable.mjs";

/**
 * Garde « migrations Prisma immuables » (scripts/check-migrations-immutable.mjs).
 * Cas positifs (ajout autorisé) et négatifs (modification, suppression, renommage,
 * déplacement, mode, contournement par renommage + modification) sur de VRAIS dépôts
 * git jetables, plus la logique pure sur des entrées simulées.
 */

const SCRIPT = resolve("scripts/check-migrations-immutable.mjs");
const SQL_A = 'CREATE TABLE "A" ("id" TEXT NOT NULL);\n';
const SQL_B = 'CREATE TABLE "B" ("id" TEXT NOT NULL);\n';
const SQL_NEW = 'ALTER TABLE "A" ADD COLUMN "note" TEXT;\n';
const LOCK = 'provider = "postgresql"\n';
const M_A = "prisma/migrations/20260101000000_a/migration.sql";
const M_B = "prisma/migrations/20260102000000_b/migration.sql";
const LOCK_PATH = "prisma/migrations/migration_lock.toml";

const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: devNull,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.invalid",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.invalid",
};

let root: string;
let counter = 0;

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, env: GIT_ENV, encoding: "utf8" });
}

function put(cwd: string, path: string, content: string) {
  mkdirSync(dirname(join(cwd, path)), { recursive: true });
  writeFileSync(join(cwd, path), content);
}

function commit(cwd: string, message: string) {
  git(cwd, "add", "-A");
  git(cwd, "-c", "commit.gpgsign=false", "commit", "-q", "-m", message);
}

/** Dépôt avec une base « main » (2 migrations + verrou) ; renvoie son dossier. */
function baseRepo(): string {
  counter += 1;
  const cwd = join(root, `repo-${counter}`);
  mkdirSync(cwd, { recursive: true });
  git(cwd, "init", "-q", "-b", "main");
  put(cwd, M_A, SQL_A);
  put(cwd, M_B, SQL_B);
  put(cwd, LOCK_PATH, LOCK);
  put(cwd, "README.md", "x\n");
  commit(cwd, "base");
  return cwd;
}

/** Applique `change` sur une branche `pr` issue de main, la commit, et lance la garde. */
function runOnBranch(cwd: string, change: (cwd: string) => void) {
  git(cwd, "checkout", "-q", "-b", "pr");
  change(cwd);
  commit(cwd, "pr");
  return run(cwd, "main", "pr");
}

function run(cwd: string, base: string, head: string) {
  const result = spawnSync(process.execPath, [SCRIPT, "--base", base, "--head", head], { cwd, env: GIT_ENV, encoding: "utf8" });
  return { code: result.status, out: `${result.stdout}${result.stderr}` };
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "gamenight-migrations-immutable-"));
});
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("garde migrations immuables — dépôts git réels", () => {
  it("accepte l'ajout d'une nouvelle migration (cas positif)", () => {
    const repo = baseRepo();
    const { code, out } = runOnBranch(repo, (cwd) => put(cwd, "prisma/migrations/20260201000000_new/migration.sql", SQL_NEW));
    expect(out).toContain("OK");
    expect(code).toBe(0);
  });

  it("accepte plusieurs migrations ajoutées, y compris datées avant la dernière (ordre géré par le runner)", () => {
    const repo = baseRepo();
    const { code } = runOnBranch(repo, (cwd) => {
      put(cwd, "prisma/migrations/20260201000000_new/migration.sql", SQL_NEW);
      put(cwd, "prisma/migrations/20251201000000_older_name/migration.sql", SQL_NEW);
    });
    expect(code).toBe(0);
  });

  it("accepte une PR sans aucun changement de migration", () => {
    const repo = baseRepo();
    expect(runOnBranch(repo, (cwd) => put(cwd, "README.md", "y\n")).code).toBe(0);
  });

  it("refuse la modification du SQL d'une migration existante", () => {
    const repo = baseRepo();
    const { code, out } = runOnBranch(repo, (cwd) => put(cwd, M_A, `${SQL_A}-- discret\n`));
    expect(code).toBe(1);
    expect(out).toContain(`${M_A} : modifié`);
  });

  it("refuse une modification d'un seul octet (fin de ligne)", () => {
    const repo = baseRepo();
    expect(runOnBranch(repo, (cwd) => put(cwd, M_A, SQL_A.replace("\n", "\r\n"))).code).toBe(1);
  });

  it("refuse la suppression d'une migration existante", () => {
    const repo = baseRepo();
    const { code, out } = runOnBranch(repo, (cwd) => rmSync(join(cwd, "prisma/migrations/20260102000000_b"), { recursive: true }));
    expect(code).toBe(1);
    expect(out).toContain(`${M_B} : supprimé`);
  });

  it("refuse le renommage d'un dossier de migration (contenu identique)", () => {
    const repo = baseRepo();
    const { code, out } = runOnBranch(repo, (cwd) =>
      renameSync(join(cwd, "prisma/migrations/20260101000000_a"), join(cwd, "prisma/migrations/20260301000000_a")),
    );
    expect(code).toBe(1);
    expect(out).toContain(`${M_A} : déplacé ou renommé vers prisma/migrations/20260301000000_a/migration.sql`);
  });

  it("refuse le renommage combiné à une modification (contournement par changement de nom)", () => {
    const repo = baseRepo();
    const { code, out } = runOnBranch(repo, (cwd) => {
      rmSync(join(cwd, "prisma/migrations/20260101000000_a"), { recursive: true });
      put(cwd, "prisma/migrations/20260301000000_a/migration.sql", `${SQL_A}ALTER TABLE "A" ADD COLUMN "x" TEXT;\n`);
    });
    expect(code).toBe(1);
    expect(out).toContain(`${M_A} : supprimé`);
  });

  it("refuse le renommage du seul fichier SQL dans son dossier", () => {
    const repo = baseRepo();
    const { code } = runOnBranch(repo, (cwd) =>
      renameSync(join(cwd, M_A), join(cwd, "prisma/migrations/20260101000000_a/migration2.sql")),
    );
    expect(code).toBe(1);
  });

  it("refuse le déplacement de tout le dossier prisma/migrations", () => {
    const repo = baseRepo();
    const { code, out } = runOnBranch(repo, (cwd) => {
      mkdirSync(join(cwd, "db"), { recursive: true });
      renameSync(join(cwd, "prisma/migrations"), join(cwd, "db/migrations"));
    });
    expect(code).toBe(1);
    expect(out).toContain("REFUS : 3 fichier(s)");
    expect(out).toContain(`${M_A} : supprimé`);
    expect(out).toContain(`${LOCK_PATH} : supprimé`);
  });

  it("refuse un changement de casse du chemin", () => {
    const repo = baseRepo();
    const { code } = runOnBranch(repo, (cwd) => {
      rmSync(join(cwd, "prisma/migrations/20260101000000_a"), { recursive: true });
      put(cwd, "prisma/migrations/20260101000000_A/migration.sql", SQL_A);
    });
    expect(code).toBe(1);
  });

  it("refuse un changement de mode (bit exécutable)", () => {
    const repo = baseRepo();
    git(repo, "checkout", "-q", "-b", "pr");
    git(repo, "update-index", "--chmod=+x", M_A); // indépendant du système de fichiers (Windows compris)
    git(repo, "-c", "commit.gpgsign=false", "commit", "-q", "-m", "mode");
    expect(git(repo, "ls-tree", "pr", M_A)).toContain("100755");
    expect(run(repo, "main", "pr").code).toBe(1);
  });

  it("refuse la modification du verrou de fournisseur (migration_lock.toml)", () => {
    const repo = baseRepo();
    const { code, out } = runOnBranch(repo, (cwd) => put(cwd, LOCK_PATH, 'provider = "mysql"\n'));
    expect(code).toBe(1);
    expect(out).toContain(`${LOCK_PATH} : modifié`);
  });

  it("combine ajout autorisé et modification interdite : le refus l'emporte", () => {
    const repo = baseRepo();
    const { code, out } = runOnBranch(repo, (cwd) => {
      put(cwd, "prisma/migrations/20260201000000_new/migration.sql", SQL_NEW);
      put(cwd, M_B, `${SQL_B}-- retouche\n`);
    });
    expect(code).toBe(1);
    expect(out).toContain(`${M_B} : modifié`);
    expect(out).not.toContain("20260201000000_new");
  });

  it("n'identifie pas les migrations d'une PR comme des migrations déjà dans main : ajout puis modification dans la même PR", () => {
    const repo = baseRepo();
    git(repo, "checkout", "-q", "-b", "pr");
    put(repo, "prisma/migrations/20260201000000_new/migration.sql", SQL_NEW);
    commit(repo, "ajout");
    put(repo, "prisma/migrations/20260201000000_new/migration.sql", `${SQL_NEW}-- corrigée avant fusion\n`);
    commit(repo, "correction de ma propre migration");
    expect(run(repo, "main", "pr").code).toBe(0);
  });

  it("ne refuse pas une PR en retard sur main (migrations arrivées dans main depuis le point de départ)", () => {
    const repo = baseRepo();
    git(repo, "checkout", "-q", "-b", "pr");
    put(repo, "prisma/migrations/20260201000000_pr/migration.sql", SQL_NEW);
    commit(repo, "pr");
    git(repo, "checkout", "-q", "main");
    put(repo, "prisma/migrations/20260115000000_main_later/migration.sql", SQL_NEW);
    commit(repo, "main avance");
    const { code, out } = run(repo, "main", "pr");
    expect(out).toContain("OK");
    expect(code).toBe(0);
  });

  it("une PR qui a fusionné main (migrations de main présentes dans la PR) reste conforme", () => {
    const repo = baseRepo();
    git(repo, "checkout", "-q", "-b", "pr");
    put(repo, "prisma/migrations/20260201000000_pr/migration.sql", SQL_NEW);
    commit(repo, "pr");
    git(repo, "checkout", "-q", "main");
    put(repo, "prisma/migrations/20260115000000_main_later/migration.sql", SQL_NEW);
    commit(repo, "main avance");
    git(repo, "checkout", "-q", "pr");
    git(repo, "-c", "commit.gpgsign=false", "merge", "-q", "--no-edit", "main");
    expect(run(repo, "main", "pr").code).toBe(0);
  });

  it("refuse la suppression d'une migration arrivée dans main avant le point de départ, même si la PR l'a supprimée après un merge de main", () => {
    const repo = baseRepo();
    git(repo, "checkout", "-q", "-b", "pr");
    git(repo, "checkout", "-q", "main");
    put(repo, "prisma/migrations/20260115000000_main_later/migration.sql", SQL_NEW);
    commit(repo, "main avance");
    git(repo, "checkout", "-q", "pr");
    git(repo, "-c", "commit.gpgsign=false", "merge", "-q", "--no-edit", "main");
    rmSync(join(repo, "prisma/migrations/20260115000000_main_later"), { recursive: true });
    commit(repo, "supprime une migration de main");
    // main a avancé : la base de comparaison est le merge-base (= main après merge), la suppression est vue.
    const { code, out } = run(repo, "main", "pr");
    expect(code).toBe(1);
    expect(out).toContain("20260115000000_main_later/migration.sql : supprimé");
  });

  it("erreur (2) sans point de départ commun : jamais un succès à vide", () => {
    const repo = baseRepo();
    git(repo, "checkout", "-q", "--orphan", "autre");
    git(repo, "rm", "-rfq", ".");
    put(repo, "README.md", "autre\n");
    commit(repo, "orphelin");
    const { code, out } = run(repo, "main", "autre");
    expect(code).toBe(2);
    expect(out).toContain("aucun point de départ commun");
  });

  it("erreur (2) si la base n'a aucune migration : garde mal configurée", () => {
    counter += 1;
    const repo = join(root, `repo-${counter}`);
    mkdirSync(repo, { recursive: true });
    git(repo, "init", "-q", "-b", "main");
    put(repo, "README.md", "x\n");
    commit(repo, "vide");
    git(repo, "checkout", "-q", "-b", "pr");
    put(repo, M_A, SQL_A);
    commit(repo, "pr");
    const { code, out } = run(repo, "main", "pr");
    expect(code).toBe(2);
    expect(out).toContain("aucune migration à la base");
  });

  it("erreur (2) sans --base, ou avec un argument inconnu", () => {
    const repo = baseRepo();
    const noBase = spawnSync(process.execPath, [SCRIPT], { cwd: repo, env: GIT_ENV, encoding: "utf8" });
    expect(noBase.status).toBe(2);
    const unknown = spawnSync(process.execPath, [SCRIPT, "--force"], { cwd: repo, env: GIT_ENV, encoding: "utf8" });
    expect(unknown.status).toBe(2);
  });

  it("erreur (2) si la révision de base n'existe pas", () => {
    const repo = baseRepo();
    expect(run(repo, "n-existe-pas", "main").code).toBe(2);
  });
});

describe("garde migrations immuables — logique pure", () => {
  const base = new Map([
    ["prisma/migrations/a/migration.sql", "100644:aaa"],
    ["prisma/migrations/b/migration.sql", "100644:bbb"],
  ]);

  it("identique ou ajouts seulement : aucune violation", () => {
    expect(findViolations(base, new Map(base))).toEqual([]);
    expect(findViolations(base, new Map([...base, ["prisma/migrations/c/migration.sql", "100644:ccc"]]))).toEqual([]);
  });

  it("modification, suppression, renommage détectés et décrits", () => {
    const head = new Map([
      ["prisma/migrations/a/migration.sql", "100644:zzz"],
      ["prisma/migrations/b2/migration.sql", "100644:bbb"],
    ]);
    const violations = findViolations(base, head);
    expect(violations.map(describeViolation)).toEqual([
      "prisma/migrations/a/migration.sql : modifié",
      "prisma/migrations/b/migration.sql : déplacé ou renommé vers prisma/migrations/b2/migration.sql",
    ]);
  });

  it("parseLsTree : chemins avec espaces, modes conservés, sortie illisible refusée", () => {
    const parsed = parseLsTree("100644 blob abc\tprisma/migrations/x y/migration.sql\u0000100755 blob def\tprisma/migrations/z/run.sh\u0000");
    expect(parsed.get("prisma/migrations/x y/migration.sql")).toBe("100644:abc");
    expect(parsed.get("prisma/migrations/z/run.sh")).toBe("100755:def");
    expect(() => parseLsTree("n'importe quoi\u0000")).toThrow();
  });
});

describe("workflow CI « Migrations immutables »", () => {
  const workflow = readFileSync(resolve(".github/workflows/migrations-immutable.yml"), "utf8");

  it("se déclenche sur toute pull_request, sans filtre de branche ni de chemin", () => {
    expect(workflow).toMatch(/^on:\s*\n\s+pull_request:\s*$/m);
    expect(workflow).not.toMatch(/branches:|paths:/);
  });

  it("récupère tout l'historique, sans identifiants persistés, avec des permissions minimales", () => {
    expect(workflow).toContain("fetch-depth: 0");
    expect(workflow).toContain("persist-credentials: false");
    expect(workflow).toMatch(/permissions:\s*\n\s+contents: read/);
  });

  it("exécute la copie du script de la branche de base quand elle existe, passe la base par l'environnement", () => {
    expect(workflow).toContain('git show "$BASE_SHA:scripts/check-migrations-immutable.mjs"');
    expect(workflow).toContain("BASE_SHA: ${{ github.event.pull_request.base.sha }}");
    expect(workflow).toContain("HEAD_SHA: ${{ github.event.pull_request.head.sha }}");
    expect(workflow).toContain('--base "$BASE_SHA" --head "$HEAD_SHA"');
    expect(workflow).not.toMatch(/run:[^\n]*\$\{\{/);
  });
});
