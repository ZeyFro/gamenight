import { describe, expect, it } from "vitest";
import { assertTarget, readArgs } from "../../scripts/db-migrate-lib.mjs";

const url = (user: string, host = "db.example.invalid") =>
  `${"postgresql:"}//${user}:secret@${host}/neondb?sslmode=require`;

describe("db-migrate : rôle partagé temporaire", () => {
  it("lit --allow-shared-role comme un drapeau explicite", () => {
    expect(readArgs(["--expect=x", "--allow-shared-role"])).toMatchObject({ allowSharedRole: true });
    expect(() => readArgs(["--allow-shared-role=true"])).toThrow(/drapeau sans valeur/);
  });

  it("refuse le rôle partagé par défaut", () => {
    expect(() => assertTarget({
      migrationUrl: url("neondb_owner"),
      runtimeRole: "neondb_owner",
      expectedTarget: "db.example.invalid/neondb",
      execute: true,
    })).toThrow(/refus par défaut/);
  });

  it("autorise explicitement le rôle partagé avec un avertissement fort", () => {
    const result = assertTarget({
      migrationUrl: url("neondb_owner"),
      runtimeRole: "neondb_owner",
      expectedTarget: "db.example.invalid/neondb",
      execute: true,
      allowSharedRole: true,
    });
    expect(result.warnings.join(" ")).toMatch(/MODE DÉGRADÉ/);
    expect(result.warnings.join(" ")).toMatch(/snapshot Neon frais/);
  });
});
