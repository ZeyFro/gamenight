import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MANIFEST: Array<{ name?: string }> = JSON.parse(
  readFileSync(new URL("../../scripts/discord-commands.json", import.meta.url), "utf8")
);
const ROUTER = readFileSync(new URL("./discord-interactions.ts", import.meta.url), "utf8");

const names = MANIFEST.filter((command) => typeof command.name === "string").map((command) => command.name as string);

/**
 * Alignement manifeste ↔ routage (`45761cf`).
 *
 * Le manifeste ne déclare que les commandes dont le handler existe : une
 * commande déclarée sans handler produit une commande fantôme côté Discord.
 * Les déclarations de `joueurs`, `projet`, `soiree` et `tournoi` restent
 * volontairement dans le patch #416 (`docs/patches/20261117-declarations-discord-416.md`)
 * pour ne pas toucher la branche réservée : ce test ne les exige donc pas ici.
 */
describe("scripts/discord-commands.json — alignement avec le routage", () => {
  it("aucune commande n'est déclarée deux fois", () => {
    expect(names).toHaveLength(new Set(names).size);
  });

  it("chaque commande déclarée possède un routage réel", () => {
    for (const name of names) {
      const routed =
        ROUTER.includes(`data?.name === "${name}"`) || ROUTER.includes(`data?.name !== "${name}"`);
      expect(routed, `commande déclarée sans handler : ${name}`).toBe(true);
    }
  });

  it("les commandes Freebuff routées et non déclarées sont uniquement celles en attente sur #416", () => {
    const pendingInPatch = ["joueurs", "projet", "soiree", "tournoi"];
    const routed = [...ROUTER.matchAll(/data\?\.name === "([a-z-]+)"/g)].map((match) => match[1]);
    const routedButUndeclared = [...new Set(routed)].filter((name) => !names.includes(name));
    expect(routedButUndeclared.sort()).toEqual([...pendingInPatch].sort());
  });

  it("les commandes Tower restent réservées à leurs handlers dédiés", () => {
    expect(names).toEqual(expect.arrayContaining(["gamenight", "tower", "tower-admin"]));
    for (const name of ["tower", "tower-admin"]) {
      expect(ROUTER).toContain(`data?.name === "${name}"`);
    }
  });
});
