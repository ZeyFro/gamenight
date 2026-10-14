import { beforeEach, describe, expect, it, vi } from "vitest";

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { messageTemplate: { findMany } } }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { logger } from "@/lib/logger";
import {
  ALL_MESSAGE_CATEGORIES,
  CATEGORY_VARIABLES,
  findInvalidCategoryVariables,
  pickMessageTemplate,
  substituteVariables,
  variablesForCategories,
} from "./message-templates";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("variablesForCategories", () => {
  it("renvoie l'union dédoublonnée des variables", () => {
    const vars = variablesForCategories(["REMINDER_24H", "REMINDER_2H", "SESSION_CREATED"]);
    expect(vars).toEqual(["pote", "jeu", "heure", "date", "createur"]);
  });

  it("renvoie [] sans catégorie", () => {
    expect(variablesForCategories([])).toEqual([]);
  });
});

describe("findInvalidCategoryVariables", () => {
  it("ne signale rien quand toutes les variables sont autorisées", () => {
    expect(findInvalidCategoryVariables("{date} à {heure} par {createur}", ["SESSION_CREATED"])).toEqual([]);
  });

  it("vérifie chaque catégorie individuellement (pas l'union)", () => {
    expect(
      findInvalidCategoryVariables("{jeu} à {heure}", ["REMINDER_24H", "SESSION_CREATED"])
    ).toEqual([{ category: "SESSION_CREATED", variable: "jeu" }]);
  });

  it("dédoublonne les variables répétées dans le texte", () => {
    expect(findInvalidCategoryVariables("{x} {x}", ["LEVEL_UP"])).toEqual([
      { category: "LEVEL_UP", variable: "x" },
    ]);
  });

  it("ignore un texte sans variable", () => {
    expect(findInvalidCategoryVariables("Salut", ALL_MESSAGE_CATEGORIES)).toEqual([]);
  });
});

describe("substituteVariables", () => {
  it("remplace toutes les occurrences sans warning", () => {
    expect(substituteVariables("{a}-{a}-{b}", { a: "1", b: "2" })).toBe("1-1-2");
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("conserve littéralement les noms et jeux contenant des marqueurs de remplacement", () => {
    expect(substituteVariables("{pote} joue à {jeu}", {
      pote: "Zoé $& {jeu}", jeu: "Portal {$`} $$",
    })).toBe("Zoé $& {jeu} joue à Portal {$`} $$");
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("ne développe pas une variable à l'intérieur d'une valeur, quel que soit l'ordre", () => {
    for (const vars of [{ pote: "{jeu}", jeu: "Portal" }, { jeu: "Portal", pote: "{jeu}" }]) {
      expect(substituteVariables("Salut {pote}, {jeu}", vars)).toBe("Salut {jeu}, Portal");
    }
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("remplace une variable connue manquante par un texte générique et logue", () => {
    expect(substituteVariables("Partie de {jeu} à {heure}", { heure: "20h" })).toBe(
      "Partie de le jeu à 20h"
    );
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it("variable inconnue : le nom avec espaces à la place des _", () => {
    expect(substituteVariables("{mon_truc}", {})).toBe("mon truc");
  });
});

describe("pickMessageTemplate", () => {
  it("interroge les templates actifs de la catégorie", async () => {
    findMany.mockResolvedValue([{ text: "Hello {user}" }]);
    expect(await pickMessageTemplate("BADGE_UNLOCKED", { user: "Zoé" })).toBe("Hello Zoé");
    expect(findMany).toHaveBeenCalledWith({
      where: { active: true, categories: { has: "BADGE_UNLOCKED" } },
    });
  });

  it("tire au hasard parmi les templates", async () => {
    findMany.mockResolvedValue([{ text: "A" }, { text: "B" }]);
    const spy = vi.spyOn(Math, "random").mockReturnValue(0.99);
    expect(await pickMessageTemplate("LEVEL_UP", {})).toBe("B");
    spy.mockRestore();
  });

  it("retombe sur le message de repli sans template actif, pour chaque catégorie", async () => {
    findMany.mockResolvedValue([]);
    for (const category of ALL_MESSAGE_CATEGORIES) {
      const vars = Object.fromEntries(CATEGORY_VARIABLES[category].map((v) => [v, `<${v}>`]));
      const text = await pickMessageTemplate(category, vars);
      expect(text.trim()).not.toBe("");
      expect(text).not.toMatch(/\{[a-z_]+\}/);
    }
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
