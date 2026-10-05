import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Garde-fou : `loading.tsx`, `error.tsx`, `global-error.tsx` et `not-found.tsx`
 * doivent exporter un composant par défaut, sinon Next.js échoue à l'exécution
 * (invisible de tsc/lint). `error.tsx` et `global-error.tsx` sont des composants
 * client : « use client » obligatoire.
 */
const NAMES = new Set(["loading.tsx", "error.tsx", "global-error.tsx", "not-found.tsx"]);
const CLIENT_ONLY = new Set(["error.tsx", "global-error.tsx"]);

function listBoundaries(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return listBoundaries(path);
    return NAMES.has(name) ? [path.replaceAll("\\", "/")] : [];
  });
}

const files = listBoundaries("src/app");

describe("loading / error / not-found", () => {
  it("existent dans src/app", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("exportent un composant par défaut", () => {
    const missing = files.filter(
      (file) => !/export\s+default\s+(async\s+)?(function|\()|export\s*\{[^}]*\bas\s+default\b|export\s+default\s+\w+/.test(readFileSync(file, "utf8")),
    );
    expect(missing).toEqual([]);
  });

  it("error.tsx et global-error.tsx sont des composants client", () => {
    const notClient = files
      .filter((file) => CLIENT_ONLY.has(file.split("/").pop() ?? ""))
      .filter((file) => !/^\s*["']use client["']/.test(readFileSync(file, "utf8")));
    expect(notClient).toEqual([]);
  });
});
