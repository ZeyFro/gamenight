import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Garde-fou : aucun `.only` oublié dans les tests. Un `it.only` laisse passer
 * la CI au vert en ignorant silencieusement tous les autres tests du fichier.
 */

const ROOT = "src";
const TEST_FILE = /\.test\.tsx?$/;
const SELF = "src/lib/no-test-only.test.ts";
const ONLY = /\b(?:it|test|describe)\.only\b/;

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = join(dir, d.name).replaceAll("\\", "/");
    if (d.isDirectory()) return walk(p);
    return TEST_FILE.test(d.name) && p !== SELF ? [p] : [];
  });
}

describe("aucun .only oublié dans les tests", () => {
  it("n'a ni it.only, ni test.only, ni describe.only", () => {
    const offenders = walk(ROOT).flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .flatMap((line, i) =>
          // Ignore les mentions dans un commentaire.
          ONLY.test(line) && !/^\s*(?:\/\/|\*|\/\*)/.test(line)
            ? [`${file}:${i + 1}`]
            : [],
        ),
    );
    expect(offenders).toEqual([]);
  });

  it("détecte bien un .only (le motif n'est pas vide)", () => {
    expect(ONLY.test("it.only('x', () => {})")).toBe(true);
    expect(ONLY.test("describe.only('x', () => {})")).toBe(true);
    expect(ONLY.test("it('x', () => {})")).toBe(false);
  });
});
