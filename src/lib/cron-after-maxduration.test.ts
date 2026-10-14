import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Garde-fou : une route cron/backfill qui travaille dans `after()` (réponse
 * 202 immédiate, cron-job.org coupe à 30 s) doit déclarer `maxDuration` :
 * sans lui, la plateforme coupe le traitement à la durée par défaut et le
 * log montre un `début` sans `fin`. Invisible de tsc, lint et build.
 */

const ROOTS = ["src/app/api/cron", "src/app/api/backfill"];

function routeFiles(): string[] {
  return ROOTS.flatMap((root) =>
    readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => join(root, d.name, "route.ts").replaceAll("\\", "/"))
  );
}

describe("routes cron et backfill utilisant after()", () => {
  const withAfter = routeFiles().filter((f) =>
    /import\s*\{[^}]*\bafter\b[^}]*\}\s*from\s*["']next\/server["']/.test(readFileSync(f, "utf8"))
  );

  it("en trouve au moins une", () => {
    expect(withAfter.length).toBeGreaterThan(0);
  });

  it.each(withAfter)("%s exporte maxDuration", (file) => {
    expect(readFileSync(file, "utf8")).toMatch(/^export const maxDuration\s*=\s*\d+;?$/m);
  });
});
