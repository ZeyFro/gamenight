import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { expect, it } from "vitest";
const require = createRequire(import.meta.url);
const workflow = require("js-yaml").load(readFileSync(".github/workflows/neon-test-apply.yml", "utf8"));
it("reste manuel, protégé et désactivé pour apply par défaut", () => {
  expect(Object.keys(workflow.on)).toEqual(["workflow_dispatch"]);
  expect(workflow.on.workflow_dispatch.inputs.operation.default).toBe("validate");
  expect(workflow.on.workflow_dispatch.inputs.dry_run_id.required).toBe(true);
  expect(workflow.on.workflow_dispatch.inputs.dry_run_id.default).toBeUndefined();
  expect(workflow.jobs["migration-test"].environment).toBe("neon-migration-test");
  expect(workflow.jobs["migration-test"].if).toContain("refs/heads/main");
  expect(workflow.concurrency.group).toBe("neon-test-migrations-370-406");
  expect(workflow.concurrency["cancel-in-progress"]).toBe(false);
});
it("scelle le baseline et n'assemble que la première migration avant les contrôles", () => {
  const steps = workflow.jobs["migration-test"].steps;
  const baseline = steps.find((s: { name?: string }) => s.name?.includes("118-migration"));
  expect(baseline.with.ref).toBe("6d6e30e76f4f96acb25c37fa6f97f08f42dca6c7");
  const assemble = steps.find((s: { name?: string }) => s.name?.includes("Assemble"));
  expect(assemble.run).toContain("cp -R migration-370/");
  expect(assemble.run).not.toContain("cp -R migration-406/");
  expect(assemble.run).not.toContain("cp scripts/neon-test-preflight.mjs");
  const install = steps.find((s: { name?: string }) => s.name?.includes("Install"));
  expect(install.env).toBeUndefined();
  const operation = steps.at(-1);
  expect(operation.env.APPLY_AUTHORIZATION).toBe("${{ vars.NEON_TEST_APPLY_AUTHORIZATION }}");
  expect(operation.env.GAMENIGHT_MIGRATION_ROLE).not.toBe(operation.env.GAMENIGHT_RUNTIME_ROLE);
});
