import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Garde-fou de dérive (sens inverse de `claude-md-switches.test.ts`) : tout
 * drapeau `process.env.X_ENABLED` lu dans `src` doit être cité dans la section
 * « Switches d'environnement » de CLAUDE.md.
 */

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : listSourceFiles(path);
    return /\.(ts|tsx|mjs)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

function switchesSection(): string {
  const md = readFileSync("CLAUDE.md", "utf8");
  const start = md.indexOf("## Switches d'environnement");
  if (start === -1) return "";
  const rest = md.slice(start + 1);
  const next = rest.search(/^## /m);
  return next === -1 ? rest : rest.slice(0, next);
}

describe("drapeaux *_ENABLED du code ↔ CLAUDE.md", () => {
  const used = new Set<string>();
  for (const file of listSourceFiles("src")) {
    for (const m of readFileSync(file, "utf8").matchAll(/process\.env\.([A-Z][A-Z0-9_]*_ENABLED)\b/g)) {
      used.add(m[1]);
    }
  }

  it("trouve bien des drapeaux dans le code (garde contre un scan vide)", () => {
    expect(used.size).toBeGreaterThan(10);
  });

  it("chaque drapeau lu dans src est cité dans « Switches d'environnement »", () => {
    const section = switchesSection();
    const missing = [...used].filter((v) => !section.includes(`\`${v}\``)).sort();
    expect(missing, `Absents de CLAUDE.md : ${missing.join(", ")}`).toEqual([]);
  });
});
