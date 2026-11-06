import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
const require = createRequire(import.meta.url);
const workflow = require("js-yaml").load(readFileSync(".github/workflows/neon-test-migrations.yml", "utf8"));
const steps = workflow.jobs.migrate.steps as { name?: string; run?: string; env?: Record<string, string>; with?: Record<string,string> }[];
describe("workflow Neon Test : séparation des rôles et préparation sans écriture", () => {
  it("utilise deux cibles directes cohérentes sur la base de test", () => {
    const targets = steps.filter(s => s.env?.GAMENIGHT_EXPECTED_TARGET);
    expect(targets).toHaveLength(2);
    const values = targets.map(step => step.env!.GAMENIGHT_EXPECTED_TARGET!);
    expect(new Set(values).size).toBe(1);
    const target = new URL(`postgresql://${values[0]}`);
    expect(target.hostname.split(".").slice(-2)).toEqual(["neon", "tech"]);
    expect(target.hostname.split(".")[0]).toMatch(/^ep-[a-z0-9-]+$/);
    expect(target.hostname).not.toContain("-pooler");
    expect(target.pathname).toBe("/neondb");
    expect(target.port).toBe("");
    for (const step of targets) {
      expect(step.env?.GAMENIGHT_MIGRATION_ROLE).toBe("${{ vars.GAMENIGHT_MIGRATION_ROLE }}");
      expect(step.env?.GAMENIGHT_MIGRATION_ROLE).not.toBe(step.env?.GAMENIGHT_RUNTIME_ROLE);
    }
  });
  it("utilise le runner chronologique de #370, pas une autre pile", () => {
    expect(steps.find(s => s.name?.includes("reviewed migration runner"))?.with?.ref).toBe("4a18b7491d1887cfc4fe38c7f1e68eb77a7571cb");
  });
  it("paramètre le rôle runtime séparément du login de migration", () => {
    const roles = steps.filter(s => s.env?.GAMENIGHT_RUNTIME_ROLE);
    expect(roles.length).toBeGreaterThan(0);
    for (const s of roles) expect(s.env?.GAMENIGHT_RUNTIME_ROLE).toBe("${{ vars.GAMENIGHT_RUNTIME_ROLE }}");
  });
  it("ne propose aucune exécution avant validation du premier dry-run", () => {
    expect(steps.map(s => s.run ?? "").join("\n")).not.toContain("--execute");
    expect(workflow.on.workflow_dispatch.inputs.operation.options).toEqual(["dry-run"]);
  });
});
