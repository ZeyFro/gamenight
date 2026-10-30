import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

describe("build : migrations protégées en Preview", () => {
  it.each(["preview", "production", "development", ""])("exécute le script réel, environnement %s, processus enfants simulés", (environment) => {
    const folder = mkdtempSync(join(tmpdir(), "gamenight-preview-build-"));
    const shim = join(folder, "shim.mjs"), trace = join(folder, "trace.json");
    writeFileSync(shim, `import cp from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { writeFileSync } from "node:fs";
const calls = [];
cp.spawnSync = (_command, args) => { calls.push(args); writeFileSync(process.env.BUILD_TRACE, JSON.stringify(calls)); return { status: 0 }; };
syncBuiltinESMExports();`);
    try {
      const run = spawnSync(process.execPath, ["--import", pathToFileURL(shim).href, resolve("scripts/build.mjs")], { env: { ...process.env, VERCEL_ENV: environment, BUILD_TRACE: trace }, encoding: "utf8" });
      expect(run.status, run.stderr).toBe(0);
      const calls = JSON.parse(readFileSync(trace, "utf8")) as string[][];
      expect(calls).toEqual([
        ["node_modules/prisma/build/index.js", "generate"],
        ["node_modules/next/dist/bin/next", "build"],
      ]);
      expect(calls.flat()).not.toContain("migrate");
      expect(calls.flat()).not.toContain("deploy");
    } finally { rmSync(folder, { recursive: true }); }
  });
});
