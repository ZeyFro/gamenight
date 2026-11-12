import { describe, expect, it } from "vitest";
import { towerWelcomePanel, welcomeActionUrl } from "./tower-onboarding-panel";
describe("panneau accueil Tower", () => {
  it("propose exactement trois actions connues", () => {
    expect(towerWelcomePanel().components[0].components.map(x => x.label)).toEqual([
      "Trouver des joueurs", "Rejoindre une soirée", "Commencer l'Ascension",
    ]);
    expect(welcomeActionUrl("unknown")).toBeNull();
    expect(welcomeActionUrl("players")).toBe("https://gamenight-zeyfro.vercel.app/joueurs");
  });
  it("n'introduit ni mentions ni identifiants privés", () => {
    expect(towerWelcomePanel().allowedMentions.parse).toEqual([]);
    expect(JSON.stringify(towerWelcomePanel())).not.toContain("@everyone");
  });

  it("annonce les activités publiques sans compte et présente l’Ascension comme facultative", () => {
    const { content } = towerWelcomePanel();
    expect(content).toMatch(/salons publics sans compte GameNight/i);
    expect(content).toMatch(/Ascension est facultative/i);
  });
});
