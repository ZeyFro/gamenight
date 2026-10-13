import { afterEach, describe, expect, it, vi } from "vitest";
import { guideSections } from "./guide-sections";

const base = [{ icon: "📅", title: "Calendrier", lines: ["a"] }];

describe("guideSections (GUIDE_V2_ENABLED)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("éteint par défaut : sections d'origine inchangées", () => {
    vi.stubEnv("GUIDE_V2_ENABLED", "");
    expect(guideSections(base)).toEqual(base);
  });

  it("n'est actif que pour la valeur exacte « true »", () => {
    vi.stubEnv("GUIDE_V2_ENABLED", "TRUE");
    expect(guideSections(base)).toHaveLength(1);
    vi.stubEnv("GUIDE_V2_ENABLED", "1");
    expect(guideSections(base)).toHaveLength(1);
  });

  it("TOURNAMENT_SCORES_ENABLED : ajoute une ligne de score aux Tournois seulement", () => {
    vi.stubEnv("GUIDE_V2_ENABLED", "true");
    const tournois = () => guideSections(base).find((s) => s.title === "Tournois")!.lines;
    const sans = tournois().length;
    vi.stubEnv("TOURNAMENT_SCORES_ENABLED", "true");
    expect(tournois()).toHaveLength(sans + 1);
  });

  it("actif : ajoute Jouer maintenant et Tournois après les sections d'origine", () => {
    vi.stubEnv("GUIDE_V2_ENABLED", "true");
    expect(guideSections(base).map((s) => s.title)).toEqual(["Calendrier", "Jouer maintenant", "Tournois"]);
  });
});
