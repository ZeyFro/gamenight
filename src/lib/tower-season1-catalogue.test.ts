import { describe, expect, it } from "vitest";
import { TOWER_STARTER_CHALLENGES } from "./tower-challenge-starter-catalogue";
import { TOWER_TEAM_STARTER_CHALLENGES } from "./tower-team-challenge-starter-catalogue";

const combined = [...TOWER_STARTER_CHALLENGES, ...TOWER_TEAM_STARTER_CHALLENGES];

describe("catalogue de la saison 1 — /tower-admin importer et importer-equipe", () => {
  it("contient 30 défis dont au moins 8 défis d'équipe", () => {
    expect(TOWER_STARTER_CHALLENGES).toHaveLength(22);
    expect(TOWER_TEAM_STARTER_CHALLENGES).toHaveLength(8);
    expect(combined).toHaveLength(30);
  });
  it("répartit strictement 10 défis faciles, 10 moyens et 10 difficiles", () => {
    for (const floors of [1, 2, 3]) {
      expect(combined.filter((challenge) => challenge.rewardFloors === floors)).toHaveLength(10);
    }
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
