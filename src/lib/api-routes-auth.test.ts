import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Garde-fou : toute route `/api/*` (hors `cron` et `backfill`, couverts par
 * `cron-routes-auth.test.ts`) doit vérifier l'accès : session valide
 * (`getValidSession` / `auth()`) ou secret cron (`cron-auth`). Une route
 * publique doit être listée ici avec sa raison. Une nouvelle route copiée sans
 * contrôle serait ouverte à tous, invisible de tsc, lint et build.
 */

const ROOT = "src/app/api";
const COVERED_ELSEWHERE = new Set(["cron", "backfill"]);

/** Routes volontairement sans session ni cron-auth. */
const PUBLIC_EXCEPTIONS: Record<string, string> = {
  "auth/[...nextauth]": "handlers Auth.js (connexion Discord)",
  "csp-report": "appelée par les navigateurs sans session ; entrée bornée",
  "admin/force-relogin": "protégée par un secret Bearer (CRON_SECRET), pas par session",
};

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = join(dir, d.name).replaceAll("\\", "/");
    if (d.isDirectory()) return walk(p);
    return d.name === "route.ts" ? [p] : [];
  });
}

function routes(): { file: string; name: string }[] {
  return walk(ROOT)
    .map((file) => ({
      file,
      name: file.slice(ROOT.length + 1, -"/route.ts".length),
    }))
    .filter(({ name }) => !COVERED_ELSEWHERE.has(name.split("/")[0]));
}

describe("routes /api hors cron et backfill", () => {
  const all = routes();

  it("en trouve au moins une", () => {
    expect(all.length).toBeGreaterThan(0);
  });

  it("les exceptions listées existent toujours", () => {
    const names = new Set(all.map((r) => r.name));
    for (const name of Object.keys(PUBLIC_EXCEPTIONS)) {
      expect(names.has(name), `exception obsolète : ${name}`).toBe(true);
    }
  });

  it.each(all.filter((r) => !(r.name in PUBLIC_EXCEPTIONS)))(
    "$name exige une session ou le secret cron",
    ({ file }) => {
      const src = readFileSync(file, "utf8");
      const ok =
        /\b(?:getValidSession|auth)\(\)/.test(src) ||
        /\b(?:verifyCronRequest|checkCronAuth)\(/.test(src);
      expect(ok, `${file} ne vérifie ni session ni secret cron`).toBe(true);
    }
  );
});
