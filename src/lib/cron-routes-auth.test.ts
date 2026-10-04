import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Garde-fou : toute route `/api/cron/*` et `/api/backfill/*` doit passer par
 * `verifyCronRequest` / `checkCronAuth` (`src/lib/cron-auth.ts`), fail-closed
 * (503 sans `CRON_SECRET`), et l'appeler AVANT tout traitement. Une nouvelle
 * route copiée sans ce contrôle serait publique sans qu'aucun autre test
 * (tsc, lint, build) ne le voie.
 */

const ROOTS = ["src/app/api/cron", "src/app/api/backfill"];

function routeFiles(): string[] {
  return ROOTS.flatMap((root) =>
    readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => join(root, d.name, "route.ts").replaceAll("\\", "/"))
  );
}

describe("routes cron et backfill", () => {
  const files = routeFiles();

  it("en trouve au moins une par dossier", () => {
    expect(files.length).toBeGreaterThanOrEqual(ROOTS.length);
  });

  it.each(files)("%s vérifie l'accès via cron-auth", (file) => {
    const src = readFileSync(file, "utf8");
    expect(src).toMatch(/from\s+["']@\/lib\/cron-auth["']/);
    const call = /\b(?:verifyCronRequest|checkCronAuth)\(/.exec(src);
    expect(call, `${file} n'appelle pas verifyCronRequest/checkCronAuth`).not.toBeNull();
  });

  it.each(files)("%s ne lit pas CRON_SECRET à la main", (file) => {
    // La comparaison maison (===) est ce que cron-auth remplace : pas de timing-safe, pas de 503.
    expect(readFileSync(file, "utf8")).not.toMatch(/authorization["']\)\s*[!=]==/i);
  });
});
