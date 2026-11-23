import { describe, expect, it } from "vitest";
import { TOWER_SOLO_IMPORT_PACK, TOWER_TEAM_IMPORT_PACK, towerChallengeDefinitionContentSchema, towerImportDefinitionData } from "./tower-challenge-import-packs";
import {
  TOWER_CHALLENGE_CATEGORIES,
  towerChallengeCategoryLabel,
  towerChallengeCategoryOf,
  towerProofRuleNotice,
} from "./tower-challenge-categories";
import { TOWER_VARIETY_SOLO_CHALLENGES } from "./tower-variety-catalogue";

const ALL = [...TOWER_SOLO_IMPORT_PACK, ...TOWER_TEAM_IMPORT_PACK];

describe("§8.5 — variété des défis vérifiée par le code", () => {
  it("chaque défi des packs d'import a une catégorie", () => {
    const missing = ALL.filter((entry) => towerChallengeCategoryOf(entry.title) === null).map((entry) => entry.title);
    expect(missing).toEqual([]);
  });

  it("les 9 catégories du cahier sont toutes couvertes, hors jeu compris", () => {
    const present = new Set(ALL.map((entry) => towerChallengeCategoryOf(entry.title)));
    expect([...present].sort()).toEqual(Object.keys(TOWER_CHALLENGE_CATEGORIES).sort());
    for (const category of Object.keys(TOWER_CHALLENGE_CATEGORIES)) {
      expect(ALL.some((entry) => towerChallengeCategoryOf(entry.title) === category), category).toBe(true);
    }
  });

  it("l'import enregistre la catégorie et la règle de preuve", () => {
    const pastProof = TOWER_VARIETY_SOLO_CHALLENGES.find((entry) => entry.allowsPastProof)!;
    expect(towerImportDefinitionData(pastProof)).toMatchObject({ allowsPastProof: true, category: "DECOUVERTE", title: pastProof.title });
    expect(towerImportDefinitionData(TOWER_SOLO_IMPORT_PACK[0])).toMatchObject({ allowsPastProof: false, category: expect.any(String) });
  });

  it("libellés : catégorie inconnue ou vide = rien d'affiché", () => {
    expect(towerChallengeCategoryLabel("HORS_JEU")).toBe("Hors jeu");
    for (const value of [null, undefined, "", "INCONNUE"]) expect(towerChallengeCategoryLabel(value)).toBeNull();
    expect(towerChallengeCategoryOf("  le dessin du héros ")).toBe("HORS_JEU");
  });
});

describe("§9.1 — les défis à preuve ancienne le disent explicitement", () => {
  it("le pack variété passe le parseur d'import", () => {
    for (const entry of TOWER_VARIETY_SOLO_CHALLENGES) expect(towerChallengeDefinitionContentSchema.safeParse(entry).success, entry.title).toBe(true);
  });

  it("un défi qui accepte une preuve ancienne l'annonce dans sa consigne ; les autres exigent une preuve postérieure", () => {
    for (const entry of TOWER_VARIETY_SOLO_CHALLENGES) {
      if (entry.allowsPastProof) {
        expect(entry.instructions).toMatch(/Preuve ancienne acceptée/);
        expect(entry.instructions).toMatch(/code de preuve n'est pas exigé/);
      } else {
        expect(entry.instructions).toMatch(/postérieure à l'attribution/);
        expect(entry.instructions).toMatch(/jamais réutilisée/);
      }
    }
    expect(TOWER_VARIETY_SOLO_CHALLENGES.filter((entry) => entry.allowsPastProof)).toHaveLength(1);
  });

  it("mention affichée au joueur, dans les deux cas", () => {
    expect(towerProofRuleNotice(true)).toMatch(/^Preuve ancienne acceptée/);
    expect(towerProofRuleNotice(false)).toMatch(/postérieure à l'attribution/);
    expect(towerProofRuleNotice(null)).toBe(towerProofRuleNotice(false));
  });

  it("aucun défi des autres packs n'accepte de preuve ancienne", () => {
    const others = ALL.filter((entry) => !TOWER_VARIETY_SOLO_CHALLENGES.includes(entry as (typeof TOWER_VARIETY_SOLO_CHALLENGES)[number]));
    expect(others.every((entry) => entry.allowsPastProof !== true)).toBe(true);
  });
});
