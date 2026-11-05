import { afterEach, describe, expect, it, vi } from "vitest";
import { isProductionTowerTestAccount } from "./tower-test-accounts";

const account = (discordId: string | null, discordName: string) => ({ discordId, discordName });

describe("comptes de test Tower", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("exclut un identifiant configuré même après un changement de nom", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("TOWER_TEST_ACCOUNT_IDENTIFIERS", " 999999999999999999 , faux-pseudo ");
    expect(isProductionTowerTestAccount(account("999999999999999999", "autre"))).toBe(true);
  });

  it("ne bloque jamais un joueur sur son nom affiché", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("TOWER_TEST_ACCOUNT_IDENTIFIERS", "999999999999999999, faux-pseudo");
    expect(isProductionTowerTestAccount(account("111111111111111111", "melah3"))).toBe(false);
    expect(isProductionTowerTestAccount(account(null, "faux-pseudo"))).toBe(false);
  });

  it.each(["preview", "development", ""])("autorise la recette hors Production (%s)", environment => {
    vi.stubEnv("VERCEL_ENV", environment);
    vi.stubEnv("TOWER_TEST_ACCOUNT_IDENTIFIERS", "999999999999999999");
    expect(isProductionTowerTestAccount(account("999999999999999999", "test"))).toBe(false);
  });
});
