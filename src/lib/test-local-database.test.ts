import { describe, expect, it } from "vitest";
import { assertLocalTestDatabase } from "./test-local-database";

describe("garde d'hôte des suites d'intégration", () => {
  it("accepte 127.0.0.1 et localhost, refuse tout autre hôte, protocole ou valeur illisible", () => {
    const url = (host: string) => `${"postgresql:"}//u:p@${host}/db`;
    expect(() => assertLocalTestDatabase(url("127.0.0.1:55439"))).not.toThrow();
    expect(() => assertLocalTestDatabase(url("localhost"))).not.toThrow();
    for (const bad of [url("db.example.invalid"), url("10.0.0.5"), "http://127.0.0.1/x", "n'importe quoi", undefined]) {
      expect(() => assertLocalTestDatabase(bad as string | undefined)).toThrow(/refus \(aucune requête envoyée\)/);
    }
  });
});
