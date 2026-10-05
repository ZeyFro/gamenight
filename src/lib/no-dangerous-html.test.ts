import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Garde-fou XSS : `dangerouslySetInnerHTML` est interdit dans `src`, sauf
 * fichier listé ci-dessous (avec la raison). Aucune exception aujourd'hui.
 */

const ALLOWED = new Set<string>([]);

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : listSourceFiles(path);
    return /\.(ts|tsx|mjs)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("dangerouslySetInnerHTML", () => {
  it("n'est utilisé que dans les fichiers de la liste blanche", () => {
    const offenders: string[] = [];
    for (const file of listSourceFiles("src")) {
      const normalized = file.replaceAll("\\", "/");
      if (ALLOWED.has(normalized)) continue;
      readFileSync(file, "utf8")
        .split(/\r?\n/)
        .forEach((line, i) => {
          const code = line.trim();
          if (code.startsWith("//") || code.startsWith("*")) return;
          if (code.includes("dangerouslySetInnerHTML")) offenders.push(`${normalized}:${i + 1}`);
        });
    }
    expect(offenders).toEqual([]);
  });
});
