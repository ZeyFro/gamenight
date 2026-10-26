import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Garde-fou : `.env.example` est versionné, donc il ne doit contenir ni secret
 * ni drapeau allumé. Toute ligne active (`NOM=valeur`) doit avoir une valeur
 * vide, ou figurer dans l'allowlist ci-dessous (URL locale d'exemple).
 */
const ALLOWED_VALUES: Record<string, string> = {
  AUTH_URL: "http://localhost:3000",
  DISCORD_GUILD_AUDIT_ENABLED: "false",
};

const assignments = readFileSync(".env.example", "utf8")
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line !== "" && !line.startsWith("#"))
  .map((line) => {
    const index = line.indexOf("=");
    return { name: line.slice(0, index), value: line.slice(index + 1).trim() };
  });

describe(".env.example", () => {
  it("contient des assignations", () => {
    expect(assignments.length).toBeGreaterThan(0);
  });

  it("n'a aucune valeur renseignée hors allowlist (pas de secret versionné)", () => {
    const filled = assignments
      .filter(({ name, value }) => value !== "" && ALLOWED_VALUES[name] !== value)
      .map(({ name }) => name);
    expect(filled).toEqual([]);
  });

  it("n'allume aucun drapeau", () => {
    const enabled = assignments.filter(({ value }) => value === "true").map(({ name }) => name);
    expect(enabled).toEqual([]);
  });

  it("n'a pas de doublon actif", () => {
    const names = assignments.map(({ name }) => name);
    expect(names.filter((name, i) => names.indexOf(name) !== i)).toEqual([]);
  });
});
