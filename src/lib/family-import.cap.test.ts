import { describe, expect, it } from "vitest";
import { FAMILY_IMPORT_MAX_NAMES, parseGameNamesFromText } from "./family-import";

describe("parseGameNamesFromText — plafond de taille", () => {
  it("n'extrait jamais plus de FAMILY_IMPORT_MAX_NAMES noms", () => {
    const text = Array.from({ length: FAMILY_IMPORT_MAX_NAMES + 200 }, (_, i) => `Jeu numero ${i}`).join("\n");
    expect(parseGameNamesFromText(text)).toHaveLength(FAMILY_IMPORT_MAX_NAMES);
  });

  it("sous le plafond : tout est conservé", () => {
    expect(parseGameNamesFromText("Portal\nHades")).toEqual(["Portal", "Hades"]);
  });
});
