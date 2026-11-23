import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { plural } from "./plural";

describe("plural", () => {
  it("0 et 1 : singulier (règle française)", () => {
    expect(plural(0, "soirée")).toBe("soirée");
    expect(plural(1, "soirée")).toBe("soirée");
  });
  it("2 et plus : pluriel", () => {
    expect(plural(2, "soirée")).toBe("soirées");
    expect(plural(18, "jouée", "jouées")).toBe("jouées");
  });
  it("grands nombres", () => {
    for (const count of [100, 1_000, 1_234_567, Number.MAX_SAFE_INTEGER]) expect(plural(count, "joueur")).toBe("joueurs");
  });
  it("pluriels irréguliers fournis par l'appelant", () => {
    expect(plural(1, "jeu", "jeux")).toBe("jeu");
    expect(plural(5, "jeu", "jeux")).toBe("jeux");
    expect(plural(2, "nouveau", "nouveaux")).toBe("nouveaux");
  });
  it("décimaux et négatifs : valeur absolue", () => {
    expect(plural(1.5, "jour")).toBe("jour");
    expect(plural(-1, "place")).toBe("place");
    expect(plural(-3, "place")).toBe("places");
  });
  it("phrases de l'accueil : un seul morceau de texte, sans espace parasite", () => {
    const label = (n: number) => `${n} ${plural(n, "soirée")} ${plural(n, "jouée")}`;
    expect(label(18)).toBe("18 soirées jouées");
    expect(label(1)).toBe("1 soirée jouée");
    expect(`${5} ${plural(5, "joueur")} ${plural(5, "actif")}`).toBe("5 joueurs actifs");
    expect(`${2} ${plural(2, "jour")}`).toBe("2 jours");
  });
});

// Garde : un suffixe de pluriel collé à une expression JSX (`mot{n === 1 ? "" : "s"}`) coupe le texte en plusieurs nœuds.
// Fichiers encore concernés par une PR ouverte, à migrer ensuite (aucun aujourd’hui).
const EN_ATTENTE = new Set<string>([]);
const COUPE = /[\p{L}]\$?\{[^{}`]*\? *"(?:s|x)?" *: *"(?:s|x)?"\}|[\p{L}]\s*\n\s*\{[^{}]*\? *"(?:s|x)?" *: *"(?:s|x)?"\}/u;

describe("pluriel : aucun suffixe collé à une expression", () => {
  it("les fichiers source utilisent plural()", () => {
    const files = execFileSync("git", ["ls-files", "src"], { encoding: "utf8" }).split("\n")
      .filter(file => /\.(tsx|ts)$/.test(file) && !/\.test\.tsx?$/.test(file) && !EN_ATTENTE.has(file));
    const fautifs = files.filter(file => COUPE.test(readFileSync(file, "utf8")));
    expect(fautifs).toEqual([]);
  });
});
