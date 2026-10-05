import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Garde-fou : aucune URL de base hébergée (Neon) ni chaîne de connexion
 * Postgres avec identifiants en dur dans `src`. La base ne vient que de
 * `DATABASE_URL` / `TEST_DATABASE_URL` (jamais Neon en test ni en local).
 * Le domaine est assemblé ici pour que ce fichier ne se détecte pas lui-même.
 */

const NEON_HOST = ["neon", "tech"].join(".");
const CONNECTION_STRING = /postgres(?:ql)?:\/\/[^\s"'`:@/]+:[^\s"'`@/]+@/;

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = join(dir, d.name).replaceAll("\\", "/");
    if (d.isDirectory()) return walk(p);
    return /\.(ts|tsx|mjs|js)$/.test(d.name) ? [p] : [];
  });
}

/** Chaînes de connexion locales de test, autorisées (hôte 127.0.0.1 / localhost). */
function isLocal(line: string): boolean {
  return /@(127\.0\.0\.1|localhost)[:/]/.test(line);
}

describe("pas de base hébergée en dur dans src", () => {
  const files = walk("src");

  it("aucune occurrence du domaine Neon", () => {
    const hits = files.filter((f) => readFileSync(f, "utf8").includes(NEON_HOST));
    expect(hits).toEqual([]);
  });

  it("aucune chaîne de connexion Postgres non locale", () => {
    const hits: string[] = [];
    for (const f of files) {
      readFileSync(f, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (CONNECTION_STRING.test(line) && !isLocal(line)) hits.push(`${f}:${i + 1}`);
        });
    }
    expect(hits).toEqual([]);
  });
});
