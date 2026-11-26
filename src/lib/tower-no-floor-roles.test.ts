import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Cahier §6.3 / C010 : « Aucun nouveau rôle Discord permanent par étage ».
 *
 * Les étages sont un compteur en base (`TowerChallengeProgress`, calculé par
 * `tower-personal-progress.ts`). Ce garde-fou vérifie qu'aucun module de
 * progression ou de calcul d'étage ne peut créer un rôle Discord : les seuls
 * appels de création de rôle du dépôt restent limités aux fonctions qui les
 * justifient (grade de jeu, espace d'équipe, soutien Nitro).
 */

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) =>
    statSync(join(dir, name)).isDirectory() ? walk(join(dir, name)) : [join(dir, name)]
  );
}

const sourceFiles = walk("src").filter(
  (file) => /\.(ts|tsx)$/.test(file) && !/\.(test|spec)\./.test(file)
);

const ROLE_CREATION_FILES = [
  "src/lib/booster-support-runner.ts",
  "src/lib/discord-rest.ts",
  "src/lib/discord-role-autocreate.ts",
  "src/lib/discord-role-command.ts",
  "src/lib/discord-team-space-api.ts",
].sort();

const floorModules = [
  "src/lib/tower-progression.ts",
  "src/lib/tower-personal-progress.ts",
  "src/lib/tower-challenges.ts",
  "src/lib/tower-ranks.ts",
];

describe("C010 — aucun rôle Discord créé par la progression d'étage", () => {
  it("les seuls créateurs de rôles sont les fonctions dédiées, jamais la progression", () => {
    const creators = sourceFiles
      .filter((file) => /createGuildRole\s*\(|\.createRole\s*\(/.test(readFileSync(file, "utf8")))
      .sort();
    expect(creators).toEqual(ROLE_CREATION_FILES);
  });

  it("les modules d'étage ne contiennent aucun appel de création de rôle", () => {
    for (const file of floorModules) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/createGuildRole|\.createRole\s*\(/);
    }
  });
});
