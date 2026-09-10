import { describe, it, expect } from "vitest";
import { isAdminUser, parseAdminDiscordIds } from "@/lib/admin-rules";

describe("isAdminUser (PR Accès & secrets)", () => {
  it("role=USER, discordId absent de la liste : refusé", () => {
    expect(isAdminUser({ discordId: "1", role: "USER" }, new Set())).toBe(false);
    expect(isAdminUser({ discordId: "1", role: "USER" }, new Set(["2"]))).toBe(false);
  });

  it("role=ADMIN en base : passe, même hors liste", () => {
    expect(isAdminUser({ discordId: "1", role: "ADMIN" }, new Set())).toBe(true);
  });

  it("discordId dans ADMIN_DISCORD_IDS : passe même si role=USER (filet anti-verrouillage)", () => {
    expect(isAdminUser({ discordId: "1", role: "USER" }, new Set(["1"]))).toBe(true);
  });

  it("role=ADMIN ET dans la liste : passe (cas cumulatif, pas de conflit)", () => {
    expect(isAdminUser({ discordId: "1", role: "ADMIN" }, new Set(["1"]))).toBe(true);
  });
});

describe("parseAdminDiscordIds", () => {
  it("découpe une liste CSV et retire les espaces", () => {
    expect(parseAdminDiscordIds("123, 456 ,789")).toEqual(new Set(["123", "456", "789"]));
  });

  it("valeur absente ou vide : ensemble vide", () => {
    expect(parseAdminDiscordIds(undefined)).toEqual(new Set());
    expect(parseAdminDiscordIds("")).toEqual(new Set());
  });

  it("ignore les entrées vides (virgules en trop)", () => {
    expect(parseAdminDiscordIds("123,,456,")).toEqual(new Set(["123", "456"]));
  });

  it("un seul id sans virgule", () => {
    expect(parseAdminDiscordIds("123456789012345678")).toEqual(
      new Set(["123456789012345678"])
    );
  });
});
