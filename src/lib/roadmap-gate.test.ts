import { describe, expect, it } from "vitest";
import { checkMigrationSql, evaluateGate, renderMorning, setItemStatus, summarize } from "../../scripts/roadmap-gate.mjs";

// Porte de merge de la boucle roadmap : cas simulés, sans GitHub.
const MIG = "prisma/migrations/20261016000000_ajoute_sondage/migration.sql";
const OK_SQL = `-- CreateTable
CREATE TABLE "Poll" (
  "id" TEXT NOT NULL,
  "communityId" TEXT NOT NULL,
  CONSTRAINT "Poll_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE UNIQUE INDEX "Poll_communityId_key" ON "Poll"("communityId");
-- AddForeignKey
ALTER TABLE "Poll" ADD CONSTRAINT "Poll_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Session" ADD COLUMN "pollId" TEXT, ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'x';`;

const basePr = () => ({
  branch: "claude/lot2-sondage",
  base: "main",
  body: "Fait.\n<!-- roadmap-item: L2-01 -->",
  title: "feat(sondage): x",
  sameRepo: true,
  files: [{ filename: "src/lib/poll.ts", status: "added" }],
  newMigrations: {} as Record<string, string>,
});

describe("porte de merge — PR de fonctionnalité", () => {
  it("accepte une PR sans migration et exige une revue explicite même pour une migration additive", () => {
    const pr = basePr();
    expect(evaluateGate(pr)).toMatchObject({ ok: true, item: "L2-01", reasons: [] });
    pr.files.push({ filename: MIG, status: "added" });
    pr.newMigrations[MIG] = OK_SQL;
    expect(evaluateGate(pr)).toMatchObject({ ok: false, item: "L2-01" });
    expect(evaluateGate(pr).reasons.join(" ")).toMatch(/revue explicite requise/);
  });

  it("refuse une migration avec DROP", () => {
    const pr = basePr();
    pr.files.push({ filename: MIG, status: "added" });
    pr.newMigrations[MIG] = 'ALTER TABLE "Session" DROP COLUMN "title";';
    const r = evaluateGate(pr);
    expect(r.ok).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/DROP interdit/);
  });

  it("refuse un fichier .github modifié", () => {
    const pr = basePr();
    pr.files.push({ filename: ".github/workflows/ci.yml", status: "modified" });
    const r = evaluateGate(pr);
    expect(r.ok).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/\.github/);
  });

  it("refuse un package.json modifié", () => {
    const pr = basePr();
    pr.files.push({ filename: "package.json", status: "modified" });
    expect(evaluateGate(pr).reasons.join(" ")).toMatch(/package\.json/);
  });

  it("refuse une migration existante modifiée, supprimée ou renommée", () => {
    for (const status of ["modified", "removed", "renamed"]) {
      const pr = basePr();
      pr.files.push({ filename: "prisma/migrations/20250101000000_old/migration.sql", status });
      const r = evaluateGate(pr);
      expect(r.ok, status).toBe(false);
      expect(r.reasons.join(" ")).toMatch(/migration existante/);
    }
  });

  it("refuse les scripts de la boucle, .claude/, la porte et ses tests", () => {
    for (const filename of ["scripts/work-roadmap.ps1", "scripts/roadmap-gate.mjs", ".claude/commands/next-item.md", "src/lib/roadmap-gate.test.ts"]) {
      const pr = basePr();
      pr.files.push({ filename, status: "modified" });
      expect(evaluateGate(pr).ok, filename).toBe(false);
    }
  });

  it("refuse un renommage depuis un fichier protégé", () => {
    const pr = basePr();
    pr.files.push({ filename: "docs/x.yml", status: "renamed", previous_filename: ".github/workflows/ci.yml" } as never);
    expect(evaluateGate(pr).ok).toBe(false);
    pr.files = [{ filename: "docs/old.sql", status: "renamed", previous_filename: MIG } as never];
    expect(evaluateGate(pr).ok).toBe(false);
  });

  it("refuse .env* mais accepte .env.example", () => {
    const pr = basePr();
    pr.files.push({ filename: ".env.example", status: "modified" });
    expect(evaluateGate(pr).ok).toBe(true);
    pr.files.push({ filename: ".env.local", status: "added" });
    expect(evaluateGate(pr).ok).toBe(false);
  });

  it("refuse vercel.json, package-lock.json et next.config.ts", () => {
    for (const filename of ["vercel.json", "package-lock.json", "next.config.ts"]) {
      const pr = basePr();
      pr.files.push({ filename, status: "modified" });
      expect(evaluateGate(pr).ok, filename).toBe(false);
    }
  });

  it("refuse une mauvaise branche, une mauvaise base, un fork, un marqueur absent ou un lot incohérent", () => {
    expect(evaluateGate({ ...basePr(), branch: "feat/x" }).ok).toBe(false);
    expect(evaluateGate({ ...basePr(), base: "claude/lot1-a" }).ok).toBe(false);
    expect(evaluateGate({ ...basePr(), sameRepo: false }).ok).toBe(false);
    expect(evaluateGate({ ...basePr(), body: "", title: "sans id" }).ok).toBe(false);
    expect(evaluateGate({ ...basePr(), body: "<!-- roadmap-item: L3-02 -->" }).ok).toBe(false);
  });

  it("accepte l'identifiant donné dans le titre", () => {
    expect(evaluateGate({ ...basePr(), body: "", title: "feat(x): y [L2-01]" })).toMatchObject({ ok: true, item: "L2-01" });
  });

  it("PR de statut : seul docs/ROADMAP.md est admis", () => {
    const pr = { ...basePr(), branch: "claude/lot2-l2-01-statut", files: [{ filename: "docs/ROADMAP.md", status: "modified" }] };
    expect(evaluateGate(pr).ok).toBe(true);
    pr.files.push({ filename: "src/a.ts", status: "added" });
    expect(evaluateGate(pr).ok).toBe(false);
  });
});

describe("porte de merge — SQL des migrations", () => {
  const check = (sql: string) => checkMigrationSql({ "m.sql": sql });

  it("admet ADD COLUMN nullable ou avec DEFAULT, CREATE INDEX et CREATE TYPE", () => {
    expect(check('ALTER TABLE "User" ADD COLUMN "bio" TEXT;')).toEqual([]);
    expect(check('ALTER TABLE "User" ADD COLUMN "n" INTEGER NOT NULL DEFAULT 0;')).toEqual([]);
    expect(check('CREATE INDEX "User_n_idx" ON "User"("n");')).toEqual([]);
    expect(check("CREATE TYPE \"Kind\" AS ENUM ('A', 'B');")).toEqual([]);
  });

  it.each([
    ['ALTER TABLE "User" RENAME COLUMN "a" TO "b";', /RENAME/],
    ['ALTER TABLE "User" ALTER COLUMN "n" TYPE BIGINT;', /type/],
    ['ALTER TABLE "User" ALTER COLUMN "n" SET DATA TYPE BIGINT;', /type/],
    ['DELETE FROM "User";', /DELETE/],
    ["UPDATE \"User\" SET \"a\" = 'x';", /UPDATE/],
    ['TRUNCATE "User";', /TRUNCATE/],
    ['DROP TABLE "User";', /DROP/],
    ['ALTER TABLE "User" ADD COLUMN "n" INTEGER NOT NULL;', /NOT NULL sans DEFAULT/],
    ['CREATE UNIQUE INDEX "u" ON "User"("email");', /UNIQUE sur une table existante/],
    ['ALTER TABLE "User" ADD CONSTRAINT "u" UNIQUE ("email");', /contrainte sur une table existante/],
    ['ALTER TABLE "User" ADD CONSTRAINT "f" FOREIGN KEY ("a") REFERENCES "B"("id");', /contrainte sur une table existante/],
    ['ALTER TABLE "User" ADD COLUMN "a" TEXT REFERENCES "B"("id");', /clé étrangère/],
    ['ALTER TYPE "Kind" ADD VALUE \'C\';', /non admise/],
    ["DO $$ BEGIN END $$;", /procédural/],
    ['CREATE TABLE IF NOT EXISTS "User" ("id" TEXT); ALTER TABLE "User" ADD CONSTRAINT "u" UNIQUE ("email");', /conditionnel/],
    ['CREATE TABLE "Archive" AS SELECT * FROM "User";', /AS non admis/],
  ])("refuse %s", (sql, re) => {
    const r = check(sql);
    expect(r.length).toBeGreaterThan(0);
    expect(r.join(" ")).toMatch(re);
  });

  it("ne confond pas un commentaire ou une chaîne avec une instruction", () => {
    expect(check("-- DROP TABLE x\nALTER TABLE \"User\" ADD COLUMN \"d\" TEXT DEFAULT 'DROP; DELETE';")).toEqual([]);
  });

  it("admet les contraintes sur une table créée dans la même PR", () => {
    expect(checkMigrationSql({ "a.sql": 'CREATE TABLE "N" ("id" TEXT NOT NULL);', "b.sql": 'ALTER TABLE "N" ADD CONSTRAINT "n" UNIQUE ("id");' })).toEqual([]);
  });
});

describe("statuts et bilan", () => {
  const md = `| ID | Élément | Ce qui reste | Nature | Statut |
|---|---|---|---|---|
| L1-01 | Rappels | x | code | Fait (#229) |
| L2-01 | Sondage | x | code | À faire |
| L5-02 | Galerie | x | produit | À TOI — limites |
`;
  it("met à jour la dernière cellule de la ligne demandée", () => {
    expect(setItemStatus(md, "L2-01", "echec", "CI rouge | test\nlong")).toContain("| L2-01 | Sondage | x | code | ÉCHEC — CI rouge test long |");
    expect(setItemStatus(md, "L2-01", "fait")).toContain("| L2-01 | Sondage | x | code | Fait |");
    expect(() => setItemStatus(md, "L9-99", "fait")).toThrow();
  });
  it("résume les éléments et génère le bilan, d'abord ce qui n'est pas fait", () => {
    expect(summarize(md).map((r) => [r.id, r.nature, r.status])).toEqual([
      ["L1-01", "code", "Fait (#229)"],
      ["L2-01", "code", "À faire"],
      ["L5-02", "produit", "À TOI — limites"],
    ]);
    const out = renderMorning({ startedAt: "t", merged: [{ pr: 5, item: "L1-01", url: "u" }], failed: [], toi: [] }, md, new Date("2026-10-15T00:00:00Z"));
    expect(out).toContain("**1 / 2**");
    expect(out.indexOf("Ce qui n'est PAS fait")).toBeLessThan(out.indexOf("PR fusionnées"));
    expect(renderMorning({ deployFailure: { pr: 9, url: "https://v" } }, md)).toMatch(/^# DÉPLOIEMENT EN ÉCHEC après la PR #9 — https:\/\/v/);
  });
});
