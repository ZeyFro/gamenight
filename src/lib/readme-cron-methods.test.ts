import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Garde-fou de dérive : la colonne « Méthodes » du tableau « V2 — Référence :
 * routes cron et backfill » du README doit correspondre aux méthodes réellement
 * exportées par chaque route (GET / POST). Elle sert à configurer cron-job.org :
 * une méthode fausse donne un 405 silencieux.
 */

const SECTION_TITLE = "## V2 — Référence : routes cron et backfill";
const EXPORT_RE = /export\s+(?:async\s+function|const|function)\s+(GET|POST)\b/g;

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return routeFiles(path);
    return name === "route.ts" ? [path] : [];
  });
}

function codeMethods(): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const prefix of ["cron", "backfill"]) {
    for (const file of routeFiles(join("src", "app", "api", prefix))) {
      const route = file.split("\\").join("/").replace(/^src\/app/, "").replace(/\/route\.ts$/, "");
      const methods = [...readFileSync(file, "utf8").matchAll(EXPORT_RE)].map((m) => m[1]);
      result.set(route, [...new Set(methods)].sort());
    }
  }
  return result;
}

function readmeMethods(): Map<string, string[]> {
  const readme = readFileSync("README.md", "utf8");
  const start = readme.indexOf(SECTION_TITLE);
  const end = readme.indexOf("\n## ", start + SECTION_TITLE.length);
  const section = start === -1 ? "" : readme.slice(start, end === -1 ? undefined : end);
  const result = new Map<string, string[]>();
  for (const line of section.split("\n")) {
    const cells = line.split("|").map((c) => c.trim());
    const route = /^`(\/api\/(?:cron|backfill)\/[a-z0-9-]+)`$/.exec(cells[1] ?? "")?.[1];
    if (!route) continue;
    result.set(route, (cells[2] ?? "").split(",").map((m) => m.trim()).filter(Boolean).sort());
  }
  return result;
}

const fromCode = codeMethods();
const fromReadme = readmeMethods();

describe("README « routes cron et backfill » : méthodes HTTP", () => {
  it("lit au moins une route dans le code et dans le tableau", () => {
    expect(fromCode.size).toBeGreaterThan(0);
    expect(fromReadme.size).toBeGreaterThan(0);
  });

  it.each([...fromCode.entries()])("%s : méthodes du README = méthodes exportées", (route, methods) => {
    expect(methods.length, `${route} n'exporte ni GET ni POST`).toBeGreaterThan(0);
    expect(
      fromReadme.get(route),
      `Colonne « Méthodes » du README à corriger pour ${route} (code : ${methods.join(", ")})`
    ).toEqual(methods);
  });
});
