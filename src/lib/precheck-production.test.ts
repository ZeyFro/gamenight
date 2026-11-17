import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { assertDirectUrl, evaluate } from "../../scripts/precheck-team-membership.mjs";

const require = createRequire(import.meta.url);
const workflow = require("js-yaml").load(readFileSync(".github/workflows/precheck-production.yml", "utf8"));
const job = workflow.jobs.precheck as { if?: string; environment?: string; steps: { run?: string }[] };

describe("script de précontrôle des équipes", () => {
  it("accepte une base saine", () => {
    const r = evaluate({ unfinished: 0, duplicates: 0, orphans: 0, lastMigration: "20261029061000_tower_team_challenges" });
    expect(r.exitCode).toBe(0);
    expect(r.lines.join("\n")).toContain("20261029061000_tower_team_challenges");
  });

  it.each([
    [{ unfinished: 1, duplicates: 0, orphans: 0 }, "inachevée"],
    [{ unfinished: 0, duplicates: 2, orphans: 0 }, "doublon"],
    [{ unfinished: 0, duplicates: 0, orphans: 3 }, "créateur"],
  ])("refuse %j", (counts, mot) => {
    const r = evaluate({ ...counts, lastMigration: "x" });
    expect(r.exitCode).toBe(2);
    expect(r.lines.join("\n")).toContain(mot);
  });

  it("n'écrit que des compteurs, jamais d'identifiant", () => {
    const r = evaluate({ unfinished: 0, duplicates: 5, orphans: 0, lastMigration: "m" });
    expect(r.lines.join("\n")).not.toMatch(/cuid|postgres(ql)?:\/\//);
  });

  it("refuse une URL absente, non PostgreSQL ou poolée", () => {
    expect(() => assertDirectUrl(undefined)).toThrow();
    expect(() => assertDirectUrl("mysql://x")).toThrow();
    expect(() => assertDirectUrl("postgresql://ep-x-pooler.eu.example/db")).toThrow(/pooler/);
    expect(() => assertDirectUrl("postgresql://ep-x.eu.example/db")).not.toThrow();
  });

  it("est en lecture seule dans le script", () => {
    const src = readFileSync("scripts/precheck-team-membership.mjs", "utf8");
    expect(src).toContain("SET TRANSACTION READ ONLY");
    expect(src).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|CREATE)\b/);
  });
});

describe("workflow Précontrôle Production", () => {
  it("manuel, depuis main seulement, avec approbation, sans migration", () => {
    expect(Object.keys(workflow.on)).toEqual(["workflow_dispatch"]);
    expect(job.if).toContain("refs/heads/main");
    expect(job.environment).toBe("production-migrations");
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(workflow.concurrency.group).toBe("migrate-production");
    const runs = job.steps.map((s) => s.run ?? "").join("\n");
    expect(runs).not.toContain("migrate deploy");
    expect(runs).toContain("exit \"$code\"");
  });
});

describe("workflow Précontrôle Production : simulation de la garde et empreinte", () => {
  type Step = { name?: string; run?: string; if?: string; env?: Record<string, string> };
  const steps = job.steps as Step[];
  const gate = steps.find((s) => s.run?.includes("assert-migrations-applied.mjs"));
  const fingerprint = steps.find((s) => s.run?.includes("restore-fingerprint.mjs"));

  it("simule la garde en application stricte, avec le rôle dédié s'il existe", () => {
    expect(gate?.env?.VERCEL_ENV).toBe("production");
    expect(gate?.env?.MIGRATION_GATE_ENFORCE).toBe("true");
    expect(gate?.env?.MIGRATION_GATE_DATABASE_URL).toBe("${{ secrets.MIGRATION_GATE_DATABASE_URL }}");
    expect(gate?.run).toContain('exit "$code"');
  });

  it("l'empreinte et la garde s'exécutent même si le contrôle des équipes refuse, sans survivre à une annulation", () => {
    for (const step of [gate, fingerprint]) expect(step?.if).toBe("${{ !cancelled() }}");
    expect(fingerprint?.run).toContain('exit "$code"');
  });

  it("n'écrit aucun secret : pas de set -x, pas d'écho des variables de connexion", () => {
    const all = steps.map((s) => s.run ?? "").join("\n");
    expect(all).not.toMatch(/set -x|--verbose/);
    expect(all).not.toMatch(/echo[^\n]*(DATABASE_URL|MIGRATION_GATE_DATABASE_URL)/);
  });
});
