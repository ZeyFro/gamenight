import { describe, expect, it } from "vitest";
import { instantSessionRemainingMs } from "@/lib/instant-session-countdown";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

describe("instantSessionRemainingMs", () => {
  it("repart du temps restant serveur et ne retire que le temps écoulé localement", () => {
    expect(instantSessionRemainingMs({
      remainingAtLoadMs: 2 * HOUR,
      loadedAtMs: 1_000_000,
      nowMs: 1_000_000 + MINUTE,
      ended: false,
    })).toBe(2 * HOUR - MINUTE);
  });

  it("ignore un expiresAt décalé : deux heures serveur restent deux heures", () => {
    // Le serveur a calculé 2 h avec l'horloge murale Paris ; le navigateur,
    // lui, verrait `expiresAt` à 3 h. Le helper ne consulte pas cette date.
    expect(instantSessionRemainingMs({
      remainingAtLoadMs: 2 * HOUR,
      loadedAtMs: 0,
      nowMs: 0,
      ended: false,
    })).toBe(2 * HOUR);
  });

  it("ne descend jamais sous zéro et force zéro pour une session terminée", () => {
    expect(instantSessionRemainingMs({ remainingAtLoadMs: MINUTE, loadedAtMs: 0, nowMs: 2 * MINUTE, ended: false })).toBe(0);
    expect(instantSessionRemainingMs({ remainingAtLoadMs: HOUR, loadedAtMs: 0, nowMs: 0, ended: true })).toBe(0);
  });
});
