import { describe, expect, it } from "vitest";
import { parseGameEpitaph } from "./community-game-graveyard-input";

describe("cimetière : saisie", () => {
  it("nettoie l’identifiant et l’épitaphe sans interpréter le texte", () => {
    expect(parseGameEpitaph(" game ", "  Ci-gît\n<script>notre backlog</script> ")).toEqual({ gameId: "game", epitaph: "Ci-gît\n<script>notre backlog</script>" });
  });
  it.each([
    [null, "texte"], ["jeu", new File([], "epitaphe.txt")], [" ", "texte"], ["jeu", " "],
    ["x".repeat(101), "texte"], ["jeu", "x".repeat(1001)],
  ])("refuse une saisie invalide %s", (gameId, epitaph) => {
    expect(parseGameEpitaph(gameId, epitaph)).toBeNull();
  });
  it("accepte les bornes exactes", () => {
    expect(parseGameEpitaph("x".repeat(100), "x".repeat(1000))).not.toBeNull();
  });
});
