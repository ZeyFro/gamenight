import { describe, expect, it } from "vitest";
import { safeTowerErrorCategory } from "./discord-tower-error-category";
describe("catégorie d'erreur Tower", () => {
  it("n'émet que les catégories connues", () => {
    expect(safeTowerErrorCategory(new TypeError("private"))).toBe("TypeError");
    expect(safeTowerErrorCategory({ name: "CustomPrivate", message: "token=cookie@email" })).toBe("UnknownTowerError");
    expect(safeTowerErrorCategory(null)).toBe("UnknownTowerError");
  });
});
