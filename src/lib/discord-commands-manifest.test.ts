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
 * Toute commande routée est déclarée (le patch #416 est intégré au manifeste).
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

  it("toute commande routée est déclarée", () => {
    const routed = [...ROUTER.matchAll(/data\?\.name === "([a-z-]+)"/g)].map((match) => match[1]);
    expect([...new Set(routed)].filter((name) => !names.includes(name))).toEqual([]);
  });

  it("les commandes Tower restent réservées à leurs handlers dédiés", () => {
    expect(names).toEqual(expect.arrayContaining(["gamenight", "tower", "tower-admin"]));
    for (const name of ["tower", "tower-admin"]) {
      expect(ROUTER).toContain(`data?.name === "${name}"`);
    }
  });
});
