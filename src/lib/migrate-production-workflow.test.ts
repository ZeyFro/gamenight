import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const workflow = require("js-yaml").load(readFileSync(".github/workflows/migrate-production.yml", "utf8"));
const job = workflow.jobs.migrate as {
  if?: string;
  environment?: string;
  env?: Record<string, string>;
  steps: { name?: string; run?: string; if?: string }[];
};

describe("workflow Migrations Production", () => {
  it("ne démarre que sur main, avec approbation d'environnement", () => {
    expect(job.if).toContain("refs/heads/main");
    expect(job.environment).toBe("production-migrations");
    expect(workflow.on.push.branches).toEqual(["main"]);
    expect(workflow.on.push.paths).toEqual(["prisma/migrations/**", "prisma/schema.prisma"]);
    expect(workflow.permissions).toEqual({ contents: "read" });
  });

  it("sérialise les exécutions sans annuler celle en cours", () => {
    expect(workflow.concurrency["cancel-in-progress"]).toBe(false);
  });

  it("lit le secret dédié et refuse l'URL poolée", () => {
    expect(job.env?.DATABASE_URL).toBe("${{ secrets.PRODUCTION_MIGRATION_DATABASE_URL }}");
    const guard = job.steps.find((s) => s.run?.includes("-pooler"));
    expect(guard?.run).toContain("exit 1");
  });

  it("applique deploy une seule fois, entouré de deux status, et explique l'échec", () => {
    const runs = job.steps.map((s) => s.run ?? "");
    const deploy = runs.findIndex((r) => r.includes("prisma migrate deploy"));
    expect(runs.filter((r) => r.includes("prisma migrate deploy"))).toHaveLength(1);
    expect(runs[deploy - 1]).toContain("prisma migrate status || true");
    expect(runs[deploy + 1]).toContain("prisma migrate status");
    expect(runs[deploy + 1]).not.toContain("|| true");
    expect(job.steps.some((s) => s.if?.includes("failure()"))).toBe(true);
  });

  it("écrit l'heure UTC de restauration avant la migration", () => {
    const runs = job.steps.map((s) => s.run ?? "");
    const restore = runs.findIndex((r) => r.includes("GITHUB_STEP_SUMMARY") && r.includes("date -u"));
    expect(restore).toBeGreaterThan(-1);
    expect(restore).toBeLessThan(runs.findIndex((r) => r.includes("prisma migrate deploy")));
  });
});
