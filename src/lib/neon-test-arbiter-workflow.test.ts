import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { expect, it } from "vitest";
const require = createRequire(import.meta.url);
const load = (name: string) => require("js-yaml").load(readFileSync(name, "utf8"));
const workflow = load(".github/workflows/neon-test-arbiter.yml");
const previous = load(".github/workflows/neon-test-apply.yml");
it("reste manuel, main uniquement et protégé, sans option apply", () => {
  expect(Object.keys(workflow.on)).toEqual(["workflow_dispatch"]);
  expect(workflow.on.workflow_dispatch).toBeNull();
  expect(workflow.permissions).toEqual({ contents: "read" });
  expect(workflow.concurrency).toEqual(previous.concurrency);
  const job = workflow.jobs["migration-test"];
  expect(job.environment).toBe("neon-migration-test");
  expect(job.if).toBe(previous.jobs["migration-test"].if);
  const final = job.steps.at(-1);
  expect(final.env.OPERATION).toBe("validate");
  expect(final.env.APPLY_AUTHORIZATION).toBeUndefined();
  expect(final.env.GAMENIGHT_EXPECTED_TARGET).toBe(previous.jobs["migration-test"].steps.at(-1).env.GAMENIGHT_EXPECTED_TARGET);
  expect(final.env.GAMENIGHT_EXPECTED_TARGET).not.toContain("pooler");
  expect(final.env.GAMENIGHT_EXPECTED_TARGET.endsWith("/neondb")).toBe(true);
  expect(final.env.GAMENIGHT_MIGRATION_ROLE).not.toBe(final.env.GAMENIGHT_RUNTIME_ROLE);
  expect(final.env.MIGRATION_DATABASE_URL).toBe("${{ secrets.MIGRATION_DATABASE_URL }}");
  for (const step of job.steps.slice(0, -1)) expect(step.env).toBeUndefined();
});
it("scelle les quatre sources et assemble uniquement les trois dossiers autorisés", () => {
  const steps = workflow.jobs["migration-test"].steps;
  expect(steps.filter((s: { uses?: string }) => s.uses === "actions/checkout@v4").map((s: { with?: { ref?: string } }) => s.with?.ref).filter(Boolean)).toEqual([
    "6d6e30e76f4f96acb25c37fa6f97f08f42dca6c7", "4a18b7491d1887cfc4fe38c7f1e68eb77a7571cb", "1a495ede501784167b597c43438c1527b2d58082", "5c3e722c83f7898aaa5516e75d7b1b41ee86f3e8",
  ]);
  const assembly = steps.find((s: { name?: string }) => s.name?.includes("Assemble")).run;
  expect(assembly.match(/cp -R migration-/g)).toHaveLength(3);
  expect(assembly).not.toContain("325");
  expect(steps.at(-1).run).toBe("node scripts/neon-test-arbiter/run.mjs");
});
