import { describe, expect, it } from "vitest";
import { DEFAULT_GAME_FILTERS, updateGameFilterQuery } from "./game-filters";

describe("filtres et sélection des participants", () => {
  it("préserve toutes les personnes choisies lors du changement des filtres", () => {
    const query = new URLSearchParams(updateGameFilterQuery("participants=alice&participants=bob&modes=solo&ownedMin=3", { ...DEFAULT_GAME_FILTERS, modes: ["coop"] }));
    expect(query.getAll("participants")).toEqual(["alice", "bob"]);
    expect(query.get("modes")).toBe("coop");
    expect(query.has("ownedMin")).toBe(false);
  });

  it("la remise à zéro des filtres conserve l’intersection demandée", () => {
    const query = new URLSearchParams(updateGameFilterQuery("participants=alice&participants=bob&genres=RPG&yearMin=2020", DEFAULT_GAME_FILTERS));
    expect([...query]).toEqual([["participants", "alice"], ["participants", "bob"]]);
  });
});
