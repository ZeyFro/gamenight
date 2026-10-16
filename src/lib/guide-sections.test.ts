import { afterEach, describe, expect, it, vi } from "vitest";
import { guideSections } from "./guide-sections";

const base = [{ icon: "📅", title: "Calendrier", lines: ["a"] }];

describe("guideSections (GUIDE_V2_ENABLED)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("éteint par défaut : sections d'origine inchangées", () => {
    vi.stubEnv("GUIDE_V2_ENABLED", "");
    expect(guideSections(base).map((section) => section.title)).toEqual(["Calendrier", "Glossaire débutants"]);
    expect(base).toEqual([{ icon: "📅", title: "Calendrier", lines: ["a"] }]);
  });

  it("n'est actif que pour la valeur exacte « true »", () => {
    vi.stubEnv("GUIDE_V2_ENABLED", "TRUE");
    expect(guideSections(base)).toHaveLength(2);
    vi.stubEnv("GUIDE_V2_ENABLED", "1");
    expect(guideSections(base)).toHaveLength(2);
  });

  it("TOURNAMENT_SCORES_ENABLED : ajoute une ligne de score aux Tournois seulement", () => {
    vi.stubEnv("GUIDE_V2_ENABLED", "true");
    const tournois = () => guideSections(base).find((s) => s.title === "Tournois")!.lines;
    const sans = tournois().length;
    vi.stubEnv("TOURNAMENT_SCORES_ENABLED", "true");
    expect(tournois()).toHaveLength(sans + 1);
  });

  it("ROULETTE_PLAYER_FILTER_ENABLED : ajoute une ligne à la roulette dans Soirées", () => {
    const soirees = [{ icon: "🎯", title: "Soirées", lines: ["a"] }];
    expect(guideSections(soirees)[0].lines).toHaveLength(1);
    vi.stubEnv("ROULETTE_PLAYER_FILTER_ENABLED", "true");
    expect(guideSections(soirees)[0].lines.at(-1)).toMatch(/Roulette/);
    expect(base).toEqual([{ icon: "📅", title: "Calendrier", lines: ["a"] }]);
  });

  it("VOTE_VETO_ENABLED : ajoute une ligne de veto aux Soirées, même sans GUIDE_V2_ENABLED", () => {
    const soirees = [{ icon: "🎯", title: "Soirées", lines: ["a"] }];
    expect(guideSections(soirees)[0].lines).toHaveLength(1);
    vi.stubEnv("VOTE_VETO_ENABLED", "true");
    expect(guideSections(soirees)[0].lines).toHaveLength(3);
    expect(guideSections(soirees)[0].lines.at(-1)).toMatch(/Roulette.*veto/);
    expect(base).toEqual([{ icon: "📅", title: "Calendrier", lines: ["a"] }]);
  });

  it("actif : ajoute Jouer maintenant et Tournois après les sections d'origine", () => {
    vi.stubEnv("GUIDE_V2_ENABLED", "true");
    expect(guideSections(base).map((s) => s.title)).toEqual(["Calendrier", "Glossaire débutants", "Jouer maintenant", "Tournois"]);
  });

  it("affiche le lexique des quatre termes sans exiger la V2 et ne modifie pas les sections d'entrée", () => {
    vi.stubEnv("GUIDE_V2_ENABLED", "");
    const sections = guideSections(base);
    const glossary = sections.find((section) => section.title === "Glossaire débutants");
    expect(glossary?.lines.map((line) => line.split(" : ")[0])).toEqual(["Aggro", "Tank", "GG", "Carry"]);
    expect(glossary?.lines[2]).toContain("bien joué");
    expect(base).toEqual([{ icon: "📅", title: "Calendrier", lines: ["a"] }]);
  });
});
