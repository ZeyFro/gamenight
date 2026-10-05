import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Garde-fou : pas de `console.log` oublié dans `src`. Les logs passent par
 * `src/lib/logger.ts` (JSON structuré, exploitable dans Vercel Logs), seul
 * fichier autorisé à appeler `console.log`.
 */

const ALLOWED = new Set(["src/lib/logger.ts"]);

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : listSourceFiles(path);
    return /\.(ts|tsx|mjs)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("console.log", () => {
  it("n'est utilisé que dans le logger structuré", () => {
    const offenders: string[] = [];
    for (const file of listSourceFiles("src")) {
      const normalized = file.replaceAll("\\", "/");
      if (ALLOWED.has(normalized)) continue;
      readFileSync(file, "utf8")
        .split(/\r?\n/)
        .forEach((line, i) => {
          const code = line.trim();
          if (code.startsWith("//") || code.startsWith("*")) return;
          if (/\bconsole\.log\s*\(/.test(code)) offenders.push(`${normalized}:${i + 1}`);
        });
    }
    expect(offenders).toEqual([]);
  });
});
