import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { EXPECTED_ROLLOUT_MIGRATIONS as E, XP_LOT_RENAMED } from "../../scripts/xp-rollout-migration-gate.mjs";
import {
  formatTimestamp, isBatchAfterOthers, isRewritable, parseTimestamp, planRename, replaceNames, suffixOf, timestampOf,
} from "../../scripts/rename-xp-lot-migrations-lib.mjs";

/**
 * Renommage du lot XP + vocal (phase 4) : le lot doit devenir STRICTEMENT postérieur à toutes les autres migrations (garde chronologique
 * du runner de #370), sans date future, sans toucher au SQL. Cette garde est une garde AVANT MERGE : elle disparaît avec
 * scripts/xp-rollout-migration-gate.mjs une fois le lot dans main (des migrations plus récentes seront alors légitimes).
 */
const batch: string[] = [...E];
const NOW = new Date("2026-12-01T10:00:00Z");
const older = ["20261029061000_tower_team_challenges", "20261104140000_tower_team_membership_policy", "20261106150000_tower_fixed_arbiter"];

describe("plan de renommage du lot", () => {
  it("attribue base, base+1 s, … en conservant l'ordre et les suffixes", () => {
    const mapping = planRename({ batch, others: older, base: "20261201095900", now: NOW });
    expect(mapping.map((m: { to: string }) => timestampOf(m.to))).toEqual([
      "20261201095900", "20261201095901", "20261201095902", "20261201095903", "20261201095904", "20261201095905",
    ]);
    expect(mapping.map((m: { from: string }) => suffixOf(m.from))).toEqual(mapping.map((m: { to: string }) => suffixOf(m.to)));
    expect(isBatchAfterOthers(mapping.map((m: { to: string }) => m.to), older)).toBe(true);
  });
  it("refuse un horodatage dans le futur (aucune date prévisionnelle)", () => {
    expect(() => planRename({ batch, others: older, base: "20261201110000", now: NOW })).toThrow(/futur/);
    expect(() => planRename({ batch, others: older, base: "20270101000000", now: NOW })).toThrow(/futur/);
  });
  it("refuse un lot qui ne serait pas strictement postérieur à toutes les autres migrations (égalité comprise)", () => {
    expect(() => planRename({ batch, others: [...older, "20261201095900_autre_pr"], base: "20261201095900", now: NOW })).toThrow(/postérieur à TOUTES/);
    expect(() => planRename({ batch, others: [...older, "20261201095906_autre_pr"], base: "20261201095900", now: NOW })).toThrow(/postérieur à TOUTES/);
  });
  it("refuse un horodatage mal formé ou inexistant", () => {
    expect(() => parseTimestamp("2026-12-01")).toThrow(/14 chiffres/);
    expect(() => parseTimestamp("20261301000000")).toThrow(/inexistant/);
    expect(formatTimestamp(parseTimestamp("20261201095900"))).toBe("20261201095900");
  });
  it("remplace les anciens noms partout et protège les chemins historiques", () => {
    const mapping = planRename({ batch, others: older, base: "20261201095900", now: NOW });
    expect(replaceNames(`a ${batch[0]} b ${batch[5]}`, mapping)).toBe("a 20261201095900_separate_xp_balance b 20261201095905_shop_balance_purchase_reason");
    expect(isRewritable("prisma/migrations/x/migration.sql")).toBe(false);
    expect(isRewritable("docs/XP-ROLLOUT-DECISION-20261019.md")).toBe(false);
    expect(isRewritable("docs/archive/reprises/x.md")).toBe(false);
    expect(isRewritable("scripts/xp-lot-invariants.mjs")).toBe(true);
  });
});

describe("état du dépôt", () => {
  const migrationsDir = resolve("prisma/migrations");
  const all = readdirSync(migrationsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  const others = all.filter((name) => !batch.includes(name));

  it("le lot est complet dans le checkout", () => {
    for (const name of batch) expect(all).toContain(name);
  });
  it("XP_LOT_RENAMED est cohérent avec les horodatages réels", () => {
    if (XP_LOT_RENAMED) {
      // Renommé : strictement postérieur à toutes les autres migrations, jamais dans le futur.
      expect(isBatchAfterOthers(batch, others)).toBe(true);
      const last = parseTimestamp(timestampOf(batch[batch.length - 1]));
      expect(last.getTime()).toBeLessThanOrEqual(Date.now() + 60_000);
    } else {
      // Avant la phase 4 : le lot est ENCORE plus ancien que des migrations de main (renommage en attente du jalon #370/#406).
      expect(isBatchAfterOthers(batch, others)).toBe(false);
    }
  });
});

describe("script rename-xp-lot-migrations.mjs", () => {
  const roots: string[] = [];
  afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

  function sandbox(otherNames: string[]) {
    const root = mkdtempSync(join(tmpdir(), "xp-rename-"));
    roots.push(root);
    mkdirSync(join(root, "scripts"));
    for (const f of ["rename-xp-lot-migrations.mjs", "rename-xp-lot-migrations-lib.mjs", "xp-rollout-migration-gate.mjs"]) {
      cpSync(resolve("scripts", f), join(root, "scripts", f));
    }
    // Le dépôt de test garde un drapeau « non renommé » quel que soit l'état du vrai dépôt.
    const gate = join(root, "scripts", "xp-rollout-migration-gate.mjs");
    writeFileSync(gate, readFileSync(gate, "utf8").replace("XP_LOT_RENAMED = true;", "XP_LOT_RENAMED = false;"));
    for (const name of [...batch, ...otherNames]) {
      mkdirSync(join(root, "prisma/migrations", name), { recursive: true });
      writeFileSync(join(root, "prisma/migrations", name, "migration.sql"), `-- ${name.slice(15)}\nSELECT 1;\n`);
    }
    mkdirSync(join(root, "docs"));
    writeFileSync(join(root, "docs/LIVRAISON-XP.md"), `# Livraison\n${batch.join("\n")}\n`);
    writeFileSync(join(root, "docs/XP-ROLLOUT-DECISION-20261019.md"), `historique ${batch[0]}\n`);
    for (const cmd of [["init", "-q"], ["config", "user.email", "t@example.org"], ["config", "user.name", "t"], ["add", "-A"], ["commit", "-q", "-m", "init"]]) {
      expect(spawnSync("git", cmd, { cwd: root }).status).toBe(0);
    }
    return root;
  }
  const run = (root: string, ...args: string[]) =>
    spawnSync("node", ["scripts/rename-xp-lot-migrations.mjs", ...args], { cwd: root, encoding: "utf8" });

  it("dry-run : n'écrit rien et affiche le plan", () => {
    const root = sandbox(older);
    const r = run(root);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/dry-run/);
    expect(spawnSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).stdout).toBe("");
  });
  it("refuse (code 2) quand une autre migration est plus récente que l'horodatage choisi", () => {
    const root = sandbox([...older, "20261231235959_autre_pr"]);
    const r = run(root, "--apply");
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/postérieur à TOUTES|futur/);
    expect(existsSync(join(root, "prisma/migrations", batch[0]))).toBe(true);
  });
  it("--apply : renomme, réécrit les références, garde le SQL et l'historique, bascule le drapeau", () => {
    const root = sandbox(older);
    const before = readFileSync(join(root, "prisma/migrations", batch[0], "migration.sql"), "utf8");
    const r = run(root, "--apply");
    expect(r.status, r.stderr).toBe(0);
    const names = readdirSync(join(root, "prisma/migrations"));
    for (const name of batch) expect(names).not.toContain(name);
    const renamed = names.filter((n) => n.endsWith("_separate_xp_balance"));
    expect(renamed).toHaveLength(1);
    expect(readFileSync(join(root, "prisma/migrations", renamed[0], "migration.sql"), "utf8")).toBe(before);
    expect(timestampOf(renamed[0]) > "20261106150000").toBe(true);
    const livraison = readFileSync(join(root, "docs/LIVRAISON-XP.md"), "utf8");
    expect(livraison).toContain(renamed[0]);
    expect(livraison).toContain("Renommage des migrations du lot");
    expect(readFileSync(join(root, "docs/XP-ROLLOUT-DECISION-20261019.md"), "utf8")).toContain(batch[0]); // historique inchangé
    expect(readFileSync(join(root, "scripts/xp-rollout-migration-gate.mjs"), "utf8")).toContain("XP_LOT_RENAMED = true;");
    // idempotent : un second passage ne fait rien
    expect(run(root, "--apply").stdout).toMatch(/Rien à faire/);
  });
});
