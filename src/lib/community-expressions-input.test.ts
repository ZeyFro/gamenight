import { describe, expect, it } from "vitest";
import { parseCommunityExpression } from "./community-expressions-input";

describe("expressions du serveur : saisie", () => {
  it("nettoie le texte et conserve les sauts de ligne", () => {
    expect(parseCommunityExpression("  Encore une ! ", " Sens\nlocal ")).toEqual({ title: "Encore une !", meaning: "Sens\nlocal" });
  });

  it.each([
    [null, "sens"], ["titre", new File([], "sens.txt")], [" ", "sens"], ["titre", " "],
    ["x".repeat(121), "sens"], ["titre", "x".repeat(2001)],
  ])("refuse une saisie invalide %s", (title, meaning) => {
    expect(parseCommunityExpression(title, meaning)).toBeNull();
  });

  it("accepte les bornes exactes", () => {
    expect(parseCommunityExpression("x".repeat(120), "x".repeat(2000))).not.toBeNull();
  });
});
