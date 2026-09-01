import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * `checkRateLimit` garde son état dans un `Map` module-scope (voir
 * rate-limit.ts) — chaque test utilise une clé `action` unique pour ne
 * jamais partager de bucket avec un autre test.
 */
describe("checkRateLimit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("autorise les requêtes sous la limite", () => {
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit("user-1", "test-under-limit", { limit: 5 })).toBe(true);
    }
  });

  it("refuse au-delà de la limite dans la même fenêtre", () => {
    const opts = { limit: 3, windowMs: 60_000 };
    expect(checkRateLimit("user-1", "test-over-limit", opts)).toBe(true);
    expect(checkRateLimit("user-1", "test-over-limit", opts)).toBe(true);
    expect(checkRateLimit("user-1", "test-over-limit", opts)).toBe(true);
    // 4e requête dans la même fenêtre : refusée.
    expect(checkRateLimit("user-1", "test-over-limit", opts)).toBe(false);
  });

  it("autorise à nouveau une fois la fenêtre glissante écoulée", () => {
    const opts = { limit: 2, windowMs: 60_000 };
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    expect(checkRateLimit("user-1", "test-reset", opts)).toBe(true);
    expect(checkRateLimit("user-1", "test-reset", opts)).toBe(true);
    expect(checkRateLimit("user-1", "test-reset", opts)).toBe(false);

    // 61 secondes plus tard : la fenêtre de 60s a entièrement glissé,
    // les deux requêtes précédentes sont élaguées.
    vi.setSystemTime(new Date("2026-01-01T00:01:01Z"));
    expect(checkRateLimit("user-1", "test-reset", opts)).toBe(true);
  });

  it("garde des compteurs indépendants par action et par utilisateur", () => {
    const opts = { limit: 1, windowMs: 60_000 };
    expect(checkRateLimit("user-A", "test-isolation", opts)).toBe(true);
    // Même action, autre user : bucket distinct, toujours autorisé.
    expect(checkRateLimit("user-B", "test-isolation", opts)).toBe(true);
    // Même user, autre action : bucket distinct, toujours autorisé.
    expect(checkRateLimit("user-A", "test-isolation-other", opts)).toBe(true);
    // Même user, même action : bucket déjà plein.
    expect(checkRateLimit("user-A", "test-isolation", opts)).toBe(false);
  });
});
