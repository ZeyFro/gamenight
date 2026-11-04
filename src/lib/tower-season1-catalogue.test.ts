import { describe, expect, it } from "vitest";
import { TOWER_STARTER_CHALLENGES, TOWER_SEASON1_SOCIAL_CHALLENGES } from "./tower-challenge-starter-catalogue";
import { TOWER_TEAM_STARTER_CHALLENGES, TOWER_SEASON1_EXTRA_TEAM_CHALLENGES } from "./tower-team-challenge-starter-catalogue";

const combined = [...TOWER_STARTER_CHALLENGES, ...TOWER_SEASON1_SOCIAL_CHALLENGES, ...TOWER_TEAM_STARTER_CHALLENGES, ...TOWER_SEASON1_EXTRA_TEAM_CHALLENGES];

describe("catalogue de la saison 1 — /tower-admin importer et importer-equipe", () => {
  it("contient 36 défis dont 10 défis d'équipe", () => {
    expect(TOWER_STARTER_CHALLENGES).toHaveLength(22);
    expect(TOWER_SEASON1_SOCIAL_CHALLENGES).toHaveLength(4);
    expect(TOWER_TEAM_STARTER_CHALLENGES).toHaveLength(8);
    expect(TOWER_SEASON1_EXTRA_TEAM_CHALLENGES).toHaveLength(2);
    expect(combined).toHaveLength(36);
  });
  it("conserve un socle conséquent dans chaque difficulté", () => {
    expect(combined.filter((challenge) => challenge.rewardFloors === 1)).toHaveLength(13);
    expect(combined.filter((challenge) => challenge.rewardFloors === 2)).toHaveLength(13);
    expect(combined.filter((challenge) => challenge.rewardFloors === 3)).toHaveLength(10);
  });
  it("ajoute au moins quatre défis sociaux et deux défis d'équipe faciles", () => {
    const socialTitles = ["Premier contact GameNight", "Le passeur de jeu", "La soirée surprise", "Le duo de l’inconnu"];
    expect(TOWER_SEASON1_SOCIAL_CHALLENGES.filter((challenge) => socialTitles.includes(challenge.title))).toHaveLength(4);
    expect(TOWER_SEASON1_EXTRA_TEAM_CHALLENGES.filter((challenge) => challenge.rewardFloors === 1)).toHaveLength(2);
  });
  it("ne classe plus l'enquête des cinq détails comme difficile", () => {
    expect(TOWER_STARTER_CHALLENGES.find((challenge) => challenge.title === "L'enquête des cinq détails")?.rewardFloors).toBe(2);
  });
  it("ne crée ni doublons ni titres trop longs pour la base", () => {
    const titles = combined.map((challenge) => challenge.title.trim().toLocaleLowerCase("fr-FR"));
    expect(new Set(titles).size).toBe(combined.length);
    for (const challenge of combined) {
      expect(challenge.title.length).toBeGreaterThan(0);
      expect(challenge.title.length).toBeLessThanOrEqual(120);
      expect(challenge.instructions.length).toBeGreaterThan(0);
      expect(challenge.instructions.length).toBeLessThanOrEqual(1500);
    }
  });
  it("propose au moins cinq défis solo réalisables sur des jeux sans achat", () => {
    const accessible = TOWER_STARTER_CHALLENGES.filter((challenge) =>
      /jeu gratuit|jeu de navigateur|démo gratuite|sans achat/i.test(challenge.instructions)
    );
    expect(accessible.length).toBeGreaterThanOrEqual(5);
  });
});
