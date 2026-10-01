import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Garde-fou : un fichier `"use server"` ne peut exporter QUE des fonctions
 * async. Toute autre valeur (const, let, var, class, enum, objet…) fait
 * lever à Next, à l'évaluation du module, « A "use server" file can only
 * export async functions » → HTTP 500 sur TOUTES les actions du fichier,
 * avant la moindre ligne de code (cas réel : « Jouer maintenant »). Ni
 * `tsc`, ni `eslint`, ni `next build`, ni vitest ne le détectent : seul le
 * runtime Next le fait. Les types (`export type`/`interface`) sont effacés
 * à la compilation et restent autorisés.
 */

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : listSourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const FORBIDDEN_EXPORT = /^export\s+(?:const|let|var|class|enum)\s+(\w+)/;

describe("fichiers \"use server\"", () => {
  it("n'exportent que des fonctions async (aucun export const/let/var/class/enum)", () => {
    const offenders: string[] = [];
    for (const file of listSourceFiles("src")) {
      const lines = readFileSync(file, "utf8").split(/\r?\n/);
      const firstCode = lines.find((l) => l.trim() !== "" && !l.trim().startsWith("//") && !l.trim().startsWith("/*") && !l.trim().startsWith("*"));
      if (!firstCode || !/^["']use server["'];?$/.test(firstCode.trim())) continue;
      for (const line of lines) {
        const match = FORBIDDEN_EXPORT.exec(line);
        if (match) offenders.push(`${file.replaceAll("\\", "/")}: export ${match[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
