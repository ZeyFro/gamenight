import { describe, it, expect } from "vitest";
import { shouldForceRelogin } from "./force-relogin";

describe("shouldForceRelogin", () => {
  it("session antérieure au déclenchement → déconnexion", () => {
    const forceReloginAt = new Date("2026-01-01T12:00:00.000Z");
    const sessionCreatedAt = new Date("2026-01-01T11:00:00.000Z").getTime();
    expect(shouldForceRelogin(forceReloginAt, sessionCreatedAt)).toBe(true);
  });

  it("session postérieure au déclenchement → valide", () => {
    const forceReloginAt = new Date("2026-01-01T12:00:00.000Z");
    const sessionCreatedAt = new Date("2026-01-01T13:00:00.000Z").getTime();
    expect(shouldForceRelogin(forceReloginAt, sessionCreatedAt)).toBe(false);
  });

  it("égalité stricte des timestamps → déconnexion (choix explicite, cohérent avec 'pas de reboucle')", () => {
    const now = new Date("2026-01-01T12:00:00.000Z");
    expect(shouldForceRelogin(now, now.getTime())).toBe(true);
  });

  it("JWT sans sessionCreatedAt (session antérieure à cette feature) → déconnexion, fail-closed", () => {
    const forceReloginAt = new Date("2026-01-01T12:00:00.000Z");
    expect(shouldForceRelogin(forceReloginAt, undefined)).toBe(true);
    expect(shouldForceRelogin(forceReloginAt, null)).toBe(true);
  });

  it("sessionCreatedAt à 0 (valeur falsy) → traité comme absent, déconnexion fail-closed", () => {
    const forceReloginAt = new Date("2026-01-01T12:00:00.000Z");
    expect(shouldForceRelogin(forceReloginAt, 0)).toBe(true);
  });

  it("forceReloginAt null (jamais déclenché) → toujours valide, quel que soit sessionCreatedAt", () => {
    expect(shouldForceRelogin(null, Date.now())).toBe(false);
    expect(shouldForceRelogin(null, undefined)).toBe(false);
    expect(shouldForceRelogin(null, null)).toBe(false);
  });
});
