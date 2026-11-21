import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Garde de structure de `.github/dependabot.yml` (constat V4-01 de l'audit) : sans lui, aucune alerte
 * ni mise à jour automatique n'est proposée pour Next, Auth.js ou Prisma. Pas d'analyseur YAML dans le
 * projet (aucune nouvelle dépendance) : on vérifie les lignes qui comptent.
 */
const file = ".github/dependabot.yml";

describe("configuration Dependabot", () => {
  it("existe et déclare la version 2", () => {
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, "utf8")).toMatch(/^version: 2$/m);
  });

  it("surveille npm et les GitHub Actions, chacun avec une limite de PR ouvertes", () => {
    const text = readFileSync(file, "utf8");
    for (const ecosystem of ["npm", "github-actions"]) expect(text).toContain(`package-ecosystem: "${ecosystem}"`);
    expect((text.match(/open-pull-requests-limit: \d+/g) ?? []).length).toBe(2);
  });

  it("n'ouvre jamais de montée majeure automatique de Next ni de Prisma", () => {
    const text = readFileSync(file, "utf8");
    for (const name of ["next", "prisma", "@prisma/client"]) {
      expect(text).toMatch(new RegExp(`dependency-name: "${name.replace("/", "\\/")}"\\s+update-types: \\["version-update:semver-major"\\]`));
    }
  });
});
