import { afterEach, describe, expect, it, vi } from "vitest";
import { guideSections } from "./guide-sections";

const base = [{ icon: "📅", title: "Calendrier", lines: ["a"] }];

describe("guideSections (GUIDE_V2_ENABLED)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("réserve la gestion des exploits aux administrateurs et propriétaires communautaires", () => {
    vi.stubEnv("COMMUNITY_HIGHLIGHTS_ENABLED", "true");
    const text = guideSections(base).find(section => section.title === "Exploits et fails")!.lines.join(" ");
    expect(text).toContain("Seuls les administrateurs et propriétaires de la communauté");
    expect(text).not.toContain("L’auteur");
  });

  it("décrit l’annulation des occurrences futures seulement quand le flag est actif", () => {
    const soirees = [{ icon: "🎯", title: "Soirées", lines: ["a"] }];
    vi.stubEnv("SESSION_SERIES_CANCEL_ENABLED", "false");
    expect(guideSections(soirees)[0].lines).toHaveLength(1);
    vi.stubEnv("SESSION_SERIES_CANCEL_ENABLED", "true");
    expect(guideSections(soirees)[0].lines.join(" ")).toContain("occurrences futures");
  });

  it("explique le lien iCal privé et sa révocation seulement quand l’abonnement est actif", () => {
    vi.stubEnv("CALENDAR_SUBSCRIPTIONS_ENABLED", "false");
    expect(guideSections(base)[0].lines.join(" ")).not.toContain("abonnement");
    vi.stubEnv("CALENDAR_SUBSCRIPTIONS_ENABLED", "true");
    expect(guideSections(base)[0].lines.join(" ")).toContain("révoquer");
  });

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

  it("explique les pronostics seulement quand le drapeau est actif", () => {
    vi.stubEnv("GUIDE_V2_ENABLED", "true");
    vi.stubEnv("TOURNAMENT_PREDICTIONS_ENABLED", "false");
    expect(guideSections(base).find(s => s.title === "Tournois")!.lines.join(" ")).not.toContain("Pronostique");
    vi.stubEnv("TOURNAMENT_PREDICTIONS_ENABLED", "true");
    expect(guideSections(base).find(s => s.title === "Tournois")!.lines.join(" ")).toContain("sans mise ni gain");
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
