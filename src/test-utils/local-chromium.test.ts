import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeProfileDirectory, withStartupRetry } from "./local-chromium";

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

describe("removeProfileDirectory", () => {
  it("réessaie après ENOTEMPTY puis réussit", async () => {
    let calls = 0;
    const waits: number[] = [];
    const removed = await removeProfileDirectory("/tmp/profil", {
      retryDelayMs: 1,
      remove: () => {
        calls++;
        if (calls < 3) throw new Error("ENOTEMPTY: directory not empty");
      },
      wait: async (ms: number) => { waits.push(ms); },
    });
    expect(removed).toBe(true);
    expect(calls).toBe(3);
    expect(waits).toEqual([1, 2]);
  });

  it("abandonne sans lever quand le profil reste occupé (CI rouge évitée)", async () => {
    let calls = 0;
    const removed = await removeProfileDirectory("/tmp/profil", {
      attempts: 4,
      retryDelayMs: 1,
      remove: () => { calls++; throw Object.assign(new Error("ENOTEMPTY"), { code: "ENOTEMPTY" }); },
      wait: async () => undefined,
    });
    expect(removed).toBe(false);
    expect(calls).toBe(4);
  });

  it("supprime réellement un profil temporaire", async () => {
    const directory = mkdtempSync(join(tmpdir(), "gn-remove-"));
    writeFileSync(join(directory, "Preferences"), "{}");
    expect(await removeProfileDirectory(directory, { retryDelayMs: 1 })).toBe(true);
    expect(existsSync(directory)).toBe(false);
    rmSync(directory, { recursive: true, force: true });
  });
});
