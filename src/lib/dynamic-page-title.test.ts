import { beforeEach, describe, expect, it, vi } from "vitest";

const { getValidSession } = vi.hoisted(() => ({ getValidSession: vi.fn() }));
vi.mock("@/lib/valid-session", () => ({ getValidSession }));

import { dynamicPageMetadata, isDynamicPageTitleEnabled } from "./dynamic-page-title";

const lookup = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("PAGE_TITLES_ENABLED", "true");
  vi.stubEnv("PAGE_TITLES_DYNAMIC_ENABLED", "true");
  getValidSession.mockResolvedValue({ user: { discordId: "u1" } });
  lookup.mockResolvedValue("Mario Kart");
});

describe("isDynamicPageTitleEnabled", () => {
  it("exige les deux drapeaux, valeur exacte « true »", () => {
    expect(isDynamicPageTitleEnabled({ PAGE_TITLES_ENABLED: "true", PAGE_TITLES_DYNAMIC_ENABLED: "true" })).toBe(true);
    expect(isDynamicPageTitleEnabled({ PAGE_TITLES_DYNAMIC_ENABLED: "true" })).toBe(false);
    expect(isDynamicPageTitleEnabled({ PAGE_TITLES_ENABLED: "true" })).toBe(false);
    for (const value of ["TRUE", "1", " true", ""]) {
      expect(isDynamicPageTitleEnabled({ PAGE_TITLES_ENABLED: "true", PAGE_TITLES_DYNAMIC_ENABLED: value })).toBe(false);
    }
  });
});

describe("dynamicPageMetadata", () => {
  it("drapeau dynamique éteint : titre statique, ni session ni requête", async () => {
    vi.stubEnv("PAGE_TITLES_DYNAMIC_ENABLED", "");
    expect(await dynamicPageMetadata("Fiche du jeu", lookup)).toEqual({ title: "Fiche du jeu" });
    expect(getValidSession).not.toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();
  });

  it("drapeau de base éteint : aucun titre, ni session ni requête", async () => {
    vi.stubEnv("PAGE_TITLES_ENABLED", "");
    expect(await dynamicPageMetadata("Fiche du jeu", lookup)).toEqual({});
    expect(getValidSession).not.toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();
  });

  it("session valide : le nom devient le titre", async () => {
    expect(await dynamicPageMetadata("Fiche du jeu", lookup)).toEqual({ title: "Mario Kart" });
  });

  it("pas de session valide : titre statique, le nom n'est jamais lu", async () => {
    getValidSession.mockResolvedValue(null);
    expect(await dynamicPageMetadata("Fiche du jeu", lookup)).toEqual({ title: "Fiche du jeu" });
    expect(lookup).not.toHaveBeenCalled();
  });

  it.each([null, undefined, "", "   "])("nom introuvable %j : titre statique", async (name) => {
    lookup.mockResolvedValue(name);
    expect(await dynamicPageMetadata("Fiche du jeu", lookup)).toEqual({ title: "Fiche du jeu" });
  });

  it("nom très long : tronqué à 80 caractères", async () => {
    lookup.mockResolvedValue("x".repeat(300));
    const meta = await dynamicPageMetadata("Fiche du jeu", lookup);
    expect(String(meta.title).length).toBe(80);
  });
});
