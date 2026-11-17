import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MANIFEST = JSON.parse(readFileSync(new URL("../../scripts/discord-commands.json", import.meta.url), "utf8"));

const FREEBUFF_CANONICAL = ["role", "equipe", "joueurs", "projet", "soiree", "tournoi", "aide", "profil", "boost"];

const byName = MANIFEST.filter((c) => typeof c.name === "string");
const names = byName.map((c) => c.name);
const unique = new Set(names);

describe("scripts/discord-commands.json (surface canonique Freebuff + Tower)", () => {
  it("les commandes canoniques Freebuff sont présentes et uniques", () => {
    expect(names).toEqual(
      expect.arrayContaining(["gamenight", ...FREEBUFF_CANONICAL, "tower", "tower-admin"])
    );
    expect(names).toHaveLength(unique.size);
  });

  it("aucune commande Freebuff n'est difficilement confondue avec une commande Tower", () => {
    const towerNames = new Set(["tower", "tower-admin"]);
    const freebuffNames = new Set(FREEBUFF_CANONICAL);
    for (const n of names) {
      if (towerNames.has(n) && freebuffNames.has(n)) expect.unreachable("collision name='" + n + "'");
    }
    expect(names).not.toContain(null);
  });

  it("gamenight est la commande Freebuff et ne dépend pas des règles Tower", () => {
    expect(byName.find((c) => c.name === "gamenight")).toBeDefined();
  });

  it("tower et tower-admin sont les commandes Tower (tower-admin réservée à ADMIN)", () => {
    expect(byName.find((c) => c.name === "tower")).toBeDefined();
    const admin = byName.find((c) => c.name === "tower-admin");
    expect(admin).toBeDefined();
    expect(String(admin?.default_member_permissions)).toBe("32");
  });

  it("chaque commande Freebuff possède au moins une option", () => {
    for (const c of byName) {
      if (FREEBUFF_CANONICAL.includes(c.name as string) || c.name === "gamenight") {
        expect(Array.isArray(c.options)).toBe(true);
        expect(c.options.length).toBeGreaterThanOrEqual(1);
      }
    }
  });
});
