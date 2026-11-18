import { describe, expect, it } from "vitest";
import { withStartupRetry } from "./local-chromium";

describe("withStartupRetry", () => {
  it("renvoie le résultat dès la première tentative réussie, sans relance", async () => {
    let calls = 0;
    expect(await withStartupRetry(async () => { calls++; return "ok"; })).toBe("ok");
    expect(calls).toBe(1);
  });

  it("relance une fois après un échec de démarrage puis réussit", async () => {
    let calls = 0;
    const result = await withStartupRetry(async () => {
      calls++;
      if (calls === 1) throw new Error("Chromium non prêt");
      return "ok";
    });
    expect(result).toBe("ok");
    expect(calls).toBe(2);
  });

  it("propage la dernière erreur quand toutes les tentatives échouent, sans boucle infinie", async () => {
    let calls = 0;
    await expect(withStartupRetry(async () => { calls++; throw new Error(`échec ${calls}`); })).rejects.toThrow("échec 2");
    expect(calls).toBe(2);
  });
});
