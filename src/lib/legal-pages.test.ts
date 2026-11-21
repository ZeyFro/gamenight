import { describe, expect, it } from "vitest";
import { LEGAL_LINKS, getLegalConfig, isLegalPagesEnabled } from "./legal-pages";

describe("interrupteur LEGAL_PAGES_ENABLED", () => {
  it("n'est actif que pour la valeur exacte « true »", () => {
    expect(isLegalPagesEnabled({})).toBe(false);
    for (const value of ["", "TRUE", "1", "yes", " true", "false"]) expect(isLegalPagesEnabled({ LEGAL_PAGES_ENABLED: value })).toBe(false);
    expect(isLegalPagesEnabled({ LEGAL_PAGES_ENABLED: "true" })).toBe(true);
  });
});

describe("configuration légale : jamais d'information inventée", () => {
  it("tout est vide (null) sans variable", () => {
    expect(getLegalConfig({})).toEqual({ publisher: null, director: null, contactEmail: null, minAge: null });
  });
  it("accepte seulement un e-mail valide et un âge 13, 15 ou 16", () => {
    expect(getLegalConfig({ LEGAL_CONTACT_EMAIL: "pas-un-mail" }).contactEmail).toBeNull();
    expect(getLegalConfig({ LEGAL_CONTACT_EMAIL: " contact@exemple.fr " }).contactEmail).toBe("contact@exemple.fr");
    for (const age of ["12", "14", "18", "abc", ""]) expect(getLegalConfig({ LEGAL_MIN_AGE: age }).minAge).toBeNull();
    for (const age of ["13", "15", "16"]) expect(getLegalConfig({ LEGAL_MIN_AGE: age }).minAge).toBe(Number(age));
  });
  it("normalise les espaces de l'éditeur et vide les valeurs blanches", () => {
    expect(getLegalConfig({ LEGAL_PUBLISHER: "  Asso \n Test  ", LEGAL_PUBLICATION_DIRECTOR: "   " })).toMatchObject({ publisher: "Asso Test", director: null });
  });
  it("expose les trois pages", () => {
    expect(LEGAL_LINKS.map((l) => l.href)).toEqual(["/mentions-legales", "/confidentialite", "/conditions"]);
  });
});
