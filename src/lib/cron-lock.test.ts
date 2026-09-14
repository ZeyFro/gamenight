import { describe, it, expect } from "vitest";
import { isLockAvailable, CRON_LOCK_LEASE_MS } from "@/lib/cron-lock";

describe("isLockAvailable (PR Verrou global cron rappels)", () => {
  const now = new Date("2026-09-14T12:00:00.000Z");

  it("jamais posé (lockedAt null) : disponible", () => {
    expect(isLockAvailable(null, now)).toBe(true);
  });

  it("posé il y a moins longtemps que le bail : indisponible", () => {
    const lockedAt = new Date(now.getTime() - CRON_LOCK_LEASE_MS / 2);
    expect(isLockAvailable(lockedAt, now)).toBe(false);
  });

  it("posé exactement au bail : indisponible (strictement supérieur exigé)", () => {
    const lockedAt = new Date(now.getTime() - CRON_LOCK_LEASE_MS);
    expect(isLockAvailable(lockedAt, now)).toBe(false);
  });

  it("posé plus longtemps que le bail : disponible (exécution précédente présumée morte)", () => {
    const lockedAt = new Date(now.getTime() - CRON_LOCK_LEASE_MS - 1);
    expect(isLockAvailable(lockedAt, now)).toBe(true);
  });

  it("bail personnalisé : respecte le paramètre plutôt que la constante par défaut", () => {
    const lockedAt = new Date(now.getTime() - 5_000);
    expect(isLockAvailable(lockedAt, now, 10_000)).toBe(false);
    expect(isLockAvailable(lockedAt, now, 1_000)).toBe(true);
  });
});
