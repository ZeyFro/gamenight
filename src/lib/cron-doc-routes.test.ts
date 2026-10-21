import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Garde-fou de dérive : toute route `/api/cron/*` et `/api/backfill/*` doit
 * figurer dans le tableau « Routes cron et backfill » du
 * document CRONS (routes et méthodes). Sans lui, chaque nouvelle route
 * oublie le tableau, qui décrit les méthodes disponibles.
 */

const SECTION_TITLE = "## Routes cron et backfill";

function routePaths(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return routePaths(path);
    return name === "route.ts" ? [path] : [];
  });
}

function apiRoutes(prefix: "cron" | "backfill"): string[] {
  return routePaths(join("src", "app", "api", prefix))
    .map((file) => file.split("\\").join("/").replace(/^src\/app/, "").replace(/\/route\.ts$/, ""))
    .sort();
}

const cronsDoc = readFileSync("docs/CRONS.md", "utf8");
const start = cronsDoc.indexOf(SECTION_TITLE);
const end = cronsDoc.indexOf("\n## ", start + SECTION_TITLE.length);
const section = start === -1 ? "" : cronsDoc.slice(start, end === -1 ? undefined : end);

describe("document CRONS « routes cron et backfill » ↔ routes API", () => {
  it("trouve la section de référence et au moins une route de chaque famille", () => {
    expect(start, `Titre introuvable : ${SECTION_TITLE}`).toBeGreaterThanOrEqual(0);
    expect(apiRoutes("cron").length).toBeGreaterThan(0);
    expect(apiRoutes("backfill").length).toBeGreaterThan(0);
  });

  it.each([...apiRoutes("cron"), ...apiRoutes("backfill")])(
    "%s est citée dans le tableau de référence",
    (route) => {
      expect(section, `Ajouter ${route} au tableau du document CRONS`).toContain(`\`${route}\``);
    }
  );

  it("le tableau ne cite aucune route cron/backfill qui n'existe plus", () => {
    const existing = new Set([...apiRoutes("cron"), ...apiRoutes("backfill")]);
    const cited = [...section.matchAll(/`(\/api\/(?:cron|backfill)\/[a-z0-9-]+)`/g)].map((m) => m[1]);
    const stale = [...new Set(cited)].filter((route) => !existing.has(route));
    expect(stale, `Routes citées mais absentes du code : ${stale.join(", ")}`).toEqual([]);
  });
});
