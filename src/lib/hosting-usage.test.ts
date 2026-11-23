import { describe, expect, it } from "vitest";
import { DEFAULT_STORAGE_LIMIT_BYTES, evaluateHostingUsage, isHostingAlertEnabled, levelForPercent } from "./hosting-usage";

describe("HOSTING_ALERT_ENABLED", () => {
  it("n'est actif que pour la valeur exacte « true »", () => {
    expect(isHostingAlertEnabled({})).toBe(false);
    for (const value of ["", "TRUE", "1", "yes", " true"]) expect(isHostingAlertEnabled({ HOSTING_ALERT_ENABLED: value })).toBe(false);
    expect(isHostingAlertEnabled({ HOSTING_ALERT_ENABLED: "true" })).toBe(true);
  });
});

describe("seuils 70 % et 90 %", () => {
  it("classe un pourcentage", () => {
    expect(levelForPercent(null)).toBe("unknown");
    expect(levelForPercent(Number.NaN)).toBe("unknown");
    expect(levelForPercent(0)).toBe("ok");
    expect(levelForPercent(69.9)).toBe("ok");
    expect(levelForPercent(70)).toBe("warn");
    expect(levelForPercent(89.9)).toBe("warn");
    expect(levelForPercent(90)).toBe("critical");
    expect(levelForPercent(250)).toBe("critical");
  });
});

describe("evaluateHostingUsage", () => {
  it("22 Mo (relevé du 22/11) : sain", () => {
    const report = evaluateHostingUsage({ storageBytes: 22 * 1024 ** 2 }, {});
    expect(report.level).toBe("ok");
    expect(report.metrics[0]).toMatchObject({ key: "storage", limit: DEFAULT_STORAGE_LIMIT_BYTES, level: "ok" });
  });
  it("70 % = alerte, 90 % = critique", () => {
    expect(evaluateHostingUsage({ storageBytes: 0.7 * DEFAULT_STORAGE_LIMIT_BYTES }, {}).level).toBe("warn");
    expect(evaluateHostingUsage({ storageBytes: 0.95 * DEFAULT_STORAGE_LIMIT_BYTES }, {}).level).toBe("critical");
  });
  it("mesure inconnue : jamais comptée comme saine ni en alerte", () => {
    const report = evaluateHostingUsage({ storageBytes: null }, {});
    expect(report.metrics[0]).toMatchObject({ used: null, percent: null, level: "unknown" });
    expect(report.level).toBe("unknown");
  });
  it("la limite se corrige par variable ; une valeur invalide revient au défaut", () => {
    expect(evaluateHostingUsage({ storageBytes: 800 }, { HOSTING_STORAGE_LIMIT_BYTES: "1000" }).metrics[0]).toMatchObject({ limit: 1000, percent: 80, level: "warn" });
    for (const bad of ["abc", "0", "-5", ""]) expect(evaluateHostingUsage({ storageBytes: 1 }, { HOSTING_STORAGE_LIMIT_BYTES: bad }).metrics[0].limit).toBe(DEFAULT_STORAGE_LIMIT_BYTES);
  });
  it("rappelle que le temps de calcul Neon se relève à la main", () => {
    expect(evaluateHostingUsage({ storageBytes: 1 }, {}).manual.join(" ")).toContain("Temps de calcul Neon");
  });
});
