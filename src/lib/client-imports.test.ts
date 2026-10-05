import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Garde-fou : un fichier `"use client"` ne doit importer ni Prisma, ni `@/auth`,
 * ni un module Node (`node:*`) : le secret ou la base partiraient dans le bundle
 * navigateur (ou le build casserait, invisible de tsc et lint).
 */

const FORBIDDEN = [
  /^import\s+(?!type\b)[^;]*?from\s+["']@\/lib\/prisma["']/m,
  /^import\s+(?!type\b)[^;]*?from\s+["']@prisma\/client["']/m,
  /^import\s+(?!type\b)[^;]*?from\s+["']@\/auth["']/m,
  /^import\s+(?!type\b)[^;]*?from\s+["']node:/m,
];

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = join(dir, d.name).replaceAll("\\", "/");
    if (d.isDirectory()) return walk(p);
    return /\.tsx?$/.test(d.name) && !/\.test\.tsx?$/.test(d.name) ? [p] : [];
  });
}

function isClient(src: string): boolean {
  return /^\s*(?:\/\*[\s\S]*?\*\/\s*|\/\/.*\n\s*)*["']use client["']/.test(src);
}

describe("fichiers « use client »", () => {
  it("n'importent aucun module serveur (`import type` autorisé) (Prisma, auth, node:*)", () => {
    const offenders: string[] = [];
    for (const file of walk("src")) {
      const src = readFileSync(file, "utf8");
      if (!isClient(src)) continue;
      if (FORBIDDEN.some((re) => re.test(src))) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
