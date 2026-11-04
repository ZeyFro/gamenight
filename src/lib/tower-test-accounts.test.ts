import { afterEach, describe, expect, it, vi } from "vitest";
import { isProductionTowerTestAccount } from "./tower-test-accounts";

describe("comptes de test Tower", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("exclut melah3 par défaut uniquement en Production", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    expect(isProductionTowerTestAccount({ discordId: "123", discordName: "melah3" })).toBe(true);
    expect(isProductionTowerTestAccount({ discordId: "123", discordName: "MELAH3" })).toBe(true);
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(isProductionTowerTestAccount({ discordId: "123", discordName: "melah3" })).toBe(false);
  });

  it("ajoute des identifiants configurables par ID ou nom Discord", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("TOWER_TEST_ACCOUNT_IDENTIFIERS", "999999999999999999, RecetteBot ");
    expect(isProductionTowerTestAccount({ discordId: "999999999999999999", discordName: "autre" })).toBe(true);
    expect(isProductionTowerTestAccount({ discordId: "111", discordName: "recettebot" })).toBe(true);
    expect(isProductionTowerTestAccount({ discordId: "111", discordName: "membre-reel" })).toBe(false);
  });

  it("conserve melah3 même si la liste configurée est vide ou différente", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    for (const configured of ["", " , , ", "autre-compte"]) {
      vi.stubEnv("TOWER_TEST_ACCOUNT_IDENTIFIERS", configured);
      expect(isProductionTowerTestAccount({ discordId: null, discordName: " MELAH3 " })).toBe(true);
    }
  });

  it("ne bloque pas les membres dont le nom ressemble seulement à un compte de test", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("TOWER_TEST_ACCOUNT_IDENTIFIERS", "RecetteBot");
    for (const discordName of ["melah30", "vrai-melah3", "RecetteBot2", ""]) {
      expect(isProductionTowerTestAccount({ discordId: null, discordName })).toBe(false);
    }
  });

  it.each(["preview", "development", ""])("autorise la recette hors Production (%s)", environment => {
    vi.stubEnv("VERCEL_ENV", environment);
    vi.stubEnv("TOWER_TEST_ACCOUNT_IDENTIFIERS", "999999999999999999");
    expect(isProductionTowerTestAccount({ discordId: "999999999999999999", discordName: "melah3" })).toBe(false);
  });
});
