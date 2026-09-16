import { describe, it, expect } from "vitest";
import { hasSufficientLeaseRemaining, MIN_CALL_MARGIN_MS } from "@/lib/notification-delivery";

/**
 * Fonction pure, aucune base de données — tourne dans la suite rapide
 * normale (`npx vitest run`), contrairement à `notification-delivery.integration.test.ts`
 * qui nécessite `TEST_DATABASE_URL`. Voir le commentaire de
 * `hasSufficientLeaseRemaining` dans notification-delivery.ts pour le
 * contrat qu'elle matérialise pour le futur client Discord.
 */
describe("hasSufficientLeaseRemaining", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");

  it("true quand il reste largement plus que la marge", () => {
    const reservedUntil = new Date(now.getTime() + 20_000);
    expect(hasSufficientLeaseRemaining(reservedUntil, now)).toBe(true);
  });

  it("false quand il reste moins que la marge", () => {
    const reservedUntil = new Date(now.getTime() + 2_000);
    expect(hasSufficientLeaseRemaining(reservedUntil, now)).toBe(false);
  });

  it("false pile à la marge (strictement supérieur requis, pas égal)", () => {
    const reservedUntil = new Date(now.getTime() + MIN_CALL_MARGIN_MS);
    expect(hasSufficientLeaseRemaining(reservedUntil, now)).toBe(false);
  });

  it("false quand le bail est déjà expiré (reste négatif)", () => {
    const reservedUntil = new Date(now.getTime() - 1_000);
    expect(hasSufficientLeaseRemaining(reservedUntil, now)).toBe(false);
  });

  it("respecte une marge personnalisée", () => {
    const reservedUntil = new Date(now.getTime() + 3_000);
    expect(hasSufficientLeaseRemaining(reservedUntil, now, 1_000)).toBe(true);
    expect(hasSufficientLeaseRemaining(reservedUntil, now, 5_000)).toBe(false);
  });
});
