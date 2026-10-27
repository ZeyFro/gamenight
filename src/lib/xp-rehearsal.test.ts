import { describe, expect, it } from "vitest";
import {
  assertOutsideRepo, assertRehearsalTarget, assertStepOrder, compareFingerprints, computeFingerprint, REQUIRES, STEPS,
} from "../../scripts/xp-backup-restore.mjs";

const ok = { host: "127.0.0.1", port: "55472", container: "gn-a2-pg-20261023", database: "gamenight_xp_full_1" };

describe("garde-fous de cible de la répétition XP", () => {
  it("accepte uniquement 127.0.0.1 et une base gamenight_xp_*", () => {
    expect(assertRehearsalTarget(ok)).toEqual(ok);
  });
  it.each([
    ["hôte distant", { ...ok, host: "db.example.invalid" }, /Hôte refusé/],
    ["localhost", { ...ok, host: "localhost" }, /Hôte refusé/],
    ["base hors motif", { ...ok, database: "postgres" }, /Base refusée/],
    ["base de test partagée", { ...ok, database: "gamenight_test" }, /Base refusée/],
    ["nom Neon", { ...ok, container: "neon-prod" }, /Neon/],
    ["port invalide", { ...ok, port: "5432x" }, /Port invalide/],
    ["conteneur invalide", { ...ok, container: "a b" }, /Conteneur invalide/],
  ])("refuse : %s", (_label, target, message) => {
    expect(() => assertRehearsalTarget(target)).toThrow(message);
  });
  it("refuse un dossier de sauvegarde dans le dépôt", () => {
    expect(() => assertOutsideRepo("C:/repo/logs", "C:/repo")).toThrow(/dans le dépôt/);
    expect(() => assertOutsideRepo("C:/repo", "C:/repo")).toThrow(/dans le dépôt/);
    expect(assertOutsideRepo("C:/Temp/x", "C:/repo")).toMatch(/Temp/);
  });
});

const raw = {
  counts: "User|2\nXpEvent|3",
  digests: "User|aaa\nXpEvent|bbb",
  balances: "c1|u1|100\nc1|u2|2147483647\nc2|u1|2147483647",
};

describe("empreinte des données", () => {
  it("somme exacte des soldes au-delà de 2^31 (BigInt) et comptages", () => {
    const fp = computeFingerprint(raw);
    expect(fp.balanceSum).toBe("4294967394");
    expect(fp.balanceRows).toBe(3);
    expect(fp.counts).toEqual({ User: 2, XpEvent: 3 });
  });
  it("est déterministe et identique pour des entrées identiques", () => {
    expect(compareFingerprints(computeFingerprint(raw), computeFingerprint({ ...raw }))).toEqual({ identical: true, differences: [] });
  });
  it("détecte un solde, un comptage ou un condensat modifié", () => {
    const base = computeFingerprint(raw);
    expect(compareFingerprints(base, computeFingerprint({ ...raw, balances: raw.balances.replace("|100", "|101") })).differences).toContain("balanceDigest");
    expect(compareFingerprints(base, computeFingerprint({ ...raw, counts: "User|2\nXpEvent|4" })).differences).toContain("counts");
    expect(compareFingerprints(base, computeFingerprint({ ...raw, digests: "User|aaa\nXpEvent|ccc" })).differences).toContain("digests");
  });
  it("sensible à l'ordre des lignes de soldes (tri SQL obligatoire)", () => {
    const swapped = "c1|u2|2147483647\nc1|u1|100\nc2|u1|2147483647";
    expect(compareFingerprints(computeFingerprint(raw), computeFingerprint({ ...raw, balances: swapped })).identical).toBe(false);
  });
});

describe("ordonnancement des étapes", () => {
  it("accepte le déroulé canonique complet", () => {
    expect(assertStepOrder([...STEPS])).toBe(true);
  });
  it("la migration exige sauvegarde ET barrière avant", () => {
    expect(() => assertStepOrder(["preflight", "baseline-main", "seed", "backup", "migrate"])).toThrow(/sans prérequis barrier-close/);
    expect(() => assertStepOrder(["preflight", "baseline-main", "seed", "barrier-close", "backup"])).toThrow(/sans prérequis backup/);
  });
  it("refuse hors ordre, répétée, inconnue", () => {
    expect(() => assertStepOrder(["preflight", "seed", "baseline-main"])).toThrow(/hors ordre|sans prérequis/);
    expect(() => assertStepOrder(["preflight", "preflight"])).toThrow(/répétée/);
    expect(() => assertStepOrder(["inconnue"])).toThrow(/inconnue/);
  });
  it("le repli exige la sauvegarde et la migration ; la réouverture exige la vérification", () => {
    expect(REQUIRES["fallback-restore"]).toEqual(["backup", "migrate"]);
    expect(REQUIRES["barrier-open"]).toContain("verify");
    expect(STEPS.indexOf("barrier-close")).toBeLessThan(STEPS.indexOf("migrate"));
    expect(STEPS.indexOf("backup")).toBeLessThan(STEPS.indexOf("barrier-close"));
  });
});
