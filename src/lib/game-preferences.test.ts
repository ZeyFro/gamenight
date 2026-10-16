import { describe, expect, it } from "vitest";
import { gameParticipantsSchema, gamePreferencesSchema, matchesGameCategory, rankGameSuggestions, type SuggestibleGame } from "./game-preferences";
const game = (id: string, changes: Partial<SuggestibleGame> = {}): SuggestibleGame => ({ id, name: id, isCoop: false, playInfoManual: false, minPlayers: 1, maxPlayers: 4, igdbDetails: { genres: ["Puzzle"], themes: [] }, ...changes });
const taste = (preferredGameCategories: string[] = [], refusedGameCategories: string[] = []) => ({ preferredGameCategories, refusedGameCategories });

describe("préférences, refus et classement", () => {
  it("valide, déduplique et efface les catégories sans autoriser les contradictions", () => {
    expect(gamePreferencesSchema.parse({ preferredGameCategories: ["COOP", "COOP"], refusedGameCategories: ["HORROR"] })).toEqual(taste(["COOP"], ["HORROR"]));
    expect(gamePreferencesSchema.parse(taste())).toEqual(taste());
    expect(gamePreferencesSchema.safeParse(taste(["HORROR"], ["HORROR"])).success).toBe(false);
    expect(gamePreferencesSchema.safeParse(taste([], ["unknown"])).success).toBe(false);
    expect(gamePreferencesSchema.safeParse(taste(Array(100).fill("COOP"))).success).toBe(false);
  });
  it("déduplique le roster et borne toute entrée, sans tronquer", () => {
    expect(gameParticipantsSchema.parse(["a", "a", "b"])).toEqual(["a", "b"]);
    for (const value of [[""], ["x".repeat(101)], Array(101).fill("a"), [new Blob(["a"])]]) expect(gameParticipantsSchema.safeParse(value).success).toBe(false);
  });
  it("ne devine pas l'horreur depuis le nom, et distingue cache ancien/invalide/liste vide", () => {
    expect(matchesGameCategory(game("Horror", { igdbDetails: { genres: ["Puzzle"] } }), "HORROR")).toBeNull();
    expect(matchesGameCategory(game("a", { igdbDetails: { themes: [42] } }), "HORROR")).toBeNull();
    expect(matchesGameCategory(game("Horror"), "HORROR")).toBe(false);
    expect(matchesGameCategory(game("a", { igdbDetails: { themes: [" Horror "] } }), "HORROR")).toBe(true);
  });
  it("la coopération manuelle prime sur le cache ; false non vérifié reste inconnu", () => {
    expect(matchesGameCategory(game("a", { igdbDetails: null }), "COOP")).toBeNull();
    expect(matchesGameCategory(game("a", { playInfoManual: true, igdbDetails: { isCoop: true } }), "COOP")).toBe(false);
    expect(matchesGameCategory(game("a", { igdbDetails: { isCoop: false } }), "COOP")).toBe(false);
  });
  it("un seul refus prime sur toutes les préférences, sans repli", () => {
    const games = [game("horror", { igdbDetails: { themes: ["Horror"] } }), game("unknown", { igdbDetails: null })];
    expect(rankGameSuggestions(games, [taste(["HORROR"]), taste([], ["HORROR"])])).toEqual({ suggestions: [], unknownMetadataCount: 1 });
  });
  it("classe par participants intéressés (pas nombre de catégories), puis nom et id", () => {
    const games = [game("z"), game("a", { igdbDetails: { genres: ["Shooter", "Puzzle"] } }), game("b", { igdbDetails: { genres: ["Shooter"] } })];
    const result = rankGameSuggestions(games, [taste(["PUZZLE", "SHOOTER"]), taste(["SHOOTER"])]);
    expect(result.suggestions.map(g => [g.id, g.preferredByCount])).toEqual([["a", 2], ["b", 2], ["z", 1]]);
  });
  it("filtre les capacités connues et signale les capacités inconnues sans inventer de joueurs", () => {
    const result = rankGameSuggestions([game("too-small", { maxPlayers: 1 }), game("too-large", { minPlayers: 3 }), game("unknown", { minPlayers: null, maxPlayers: null })], [taste(), taste()]);
    expect(result.suggestions).toEqual([{ id: "unknown", name: "unknown", preferredByCount: 0, capacityKnown: false }]);
    expect(rankGameSuggestions([game("unknown", { minPlayers: null })], []).suggestions).toEqual([]);
  });
});
