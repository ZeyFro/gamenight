import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const workflow = require("js-yaml").load(readFileSync(".github/workflows/migrate-production.yml", "utf8"));
const job = workflow.jobs.migrate as {
  if?: string;
  environment?: string;
  env?: Record<string, string>;
  steps: { name?: string; run?: string; if?: string; env?: Record<string, string> }[];
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
    const guard = job.steps.find((s) => s.run?.includes("-pooler"));
    expect(guard?.run).toContain("exit 1");
    expect(guard?.env?.DATABASE_URL).toBe("${{ secrets.PRODUCTION_MIGRATION_DATABASE_URL }}");
  });

  it("n'expose le secret Production qu'aux étapes qui parlent à la base, jamais à npm ci", () => {
    const steps = job.steps as { name?: string; run?: string; uses?: string; env?: Record<string, string> }[];
    expect(job.env?.DATABASE_URL).toBeUndefined();
    const SECRET = "${{ secrets.PRODUCTION_MIGRATION_DATABASE_URL }}";
    const withSecret = steps.filter((s) => s.env?.DATABASE_URL === SECRET);
    // Garde d'URL, état avant, application, état après : exactement ces quatre étapes.
    expect(withSecret).toHaveLength(4);
    for (const step of withSecret) {
      expect(step.run ?? "").toMatch(/-pooler|prisma migrate (status|deploy)/);
    }
    const install = steps.find((s) => s.run === "npm ci");
    expect(install?.env).toBeUndefined();
    // Aucune autre étape (checkout, setup-node, hook, consignes) n'a accès au secret de migration.
    for (const step of steps.filter((s) => !withSecret.includes(s))) {
      expect(JSON.stringify(step.env ?? {})).not.toContain("PRODUCTION_MIGRATION_DATABASE_URL");
    }
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

  it("relance le déploiement Vercel seulement après la migration réussie, sans afficher le hook", () => {
    const steps = job.steps as { name?: string; run?: string; if?: string; env?: Record<string, string> }[];
    const finalStatus = steps.findIndex((s) => s.run === "npx prisma migrate status");
    const hook = steps.findIndex((s) => s.env?.VERCEL_DEPLOY_HOOK_URL !== undefined);
    expect(hook).toBeGreaterThan(finalStatus);
    expect(steps[hook].if).toContain("success()");
    expect(steps[hook].env?.VERCEL_DEPLOY_HOOK_URL).toBe("${{ secrets.VERCEL_DEPLOY_HOOK_URL }}");
    const run = steps[hook].run ?? "";
    expect(run).toContain("-z \"${VERCEL_DEPLOY_HOOK_URL:-}\"");
    expect(run).not.toMatch(/echo[^\n]*VERCEL_DEPLOY_HOOK_URL/);
    expect(run).not.toMatch(/curl[^\n]*\s-[a-zA-Z]*v|set -x|--verbose/);
    // Un hook en échec ne se fait pas passer pour un échec de migration.
    expect(run).toContain("::warning::");
    // Le hook ne contourne pas l'approbation : même job, même environnement.
    expect(job.environment).toBe("production-migrations");
  });

  it("écrit l'heure UTC de restauration avant la migration", () => {
    const runs = job.steps.map((s) => s.run ?? "");
    const restore = runs.findIndex((r) => r.includes("GITHUB_STEP_SUMMARY") && r.includes("date -u"));
    expect(restore).toBeGreaterThan(-1);
    expect(restore).toBeLessThan(runs.findIndex((r) => r.includes("prisma migrate deploy")));
  });
});
