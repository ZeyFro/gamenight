import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Garde-fou : pas de prop `whileInView` Framer Motion dans `src` (bug connu :
 * contenu invisible tant que l'IntersectionObserver ne se déclenche pas, cf.
 * `FadeInView` et `BentoCard`). On anime via `initial`/`animate`. Exception
 * historique : `RecapWrapped`, à migrer puis retirer de la liste.
 */

const ALLOWED = new Set(["src/components/RecapWrapped.tsx"]);

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : listSourceFiles(path);
    return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [path] : [];
  });
}

describe("whileInView", () => {
  it("n'est utilisé comme prop JSX que dans les exceptions listées", () => {
    const offenders = listSourceFiles("src")
      .map((file) => file.replaceAll("\\", "/"))
      .filter((file) => !ALLOWED.has(file))
      .filter((file) => /^\s*whileInView=/m.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });
});
