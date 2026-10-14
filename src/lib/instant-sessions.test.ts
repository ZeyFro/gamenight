import { describe, expect, it } from "vitest";
import {
  computeCoPresenceMs,
  INSTANT_SESSION_ELIGIBLE_PRESENCE_MS,
  INSTANT_SESSION_MAX_DURATION_MS,
  type PresenceIntervalInput,
} from "@/lib/instant-sessions";
import { instantSessionPurgeEligibility } from "@/lib/retention";

/**
 * V2 — "Jouer maintenant". `computeCoPresenceMs` est PURE (aucune DB,
 * aucun réseau) — les trois scénarios ci-dessous reproduisent EXACTEMENT
 * les exemples de l'énoncé, valeur par valeur.
 */

const MIN_MS = 60_000;

function iv(userId: string, startMin: number, endMin: number | null): PresenceIntervalInput {
  return {
    userId,
    startedAt: new Date(startMin * MIN_MS),
    endedAt: endMin === null ? null : new Date(endMin * MIN_MS),
  };
}

describe("computeCoPresenceMs — présence CONJOINTE (jamais une simple somme individuelle)", () => {
  it("vingt minutes SEUL : zéro minute éligible", () => {
    const totals = computeCoPresenceMs([iv("a", 0, 20)], new Date(20 * MIN_MS));
    expect(totals.get("a")).toBe(0);
  });

  it("dix minutes à deux, cinq minutes seul, puis cinq minutes à deux : quinze minutes éligibles chacun", () => {
    // A : présent en continu de 0 à 20min.
    // B : présent 0-10min, absent 10-15min, présent 15-20min.
    const intervals: PresenceIntervalInput[] = [
      iv("a", 0, 20),
      iv("b", 0, 10),
      iv("b", 15, 20),
    ];
    const totals = computeCoPresenceMs(intervals, new Date(20 * MIN_MS));
    expect(totals.get("a")).toBe(15 * MIN_MS);
    expect(totals.get("b")).toBe(15 * MIN_MS);
  });

  it("dix minutes à trois : dix minutes PAR personne, sans multiplication (jamais 30 minutes pour un seul, jamais divisé)", () => {
    const intervals: PresenceIntervalInput[] = [iv("a", 0, 10), iv("b", 0, 10), iv("c", 0, 10)];
    const totals = computeCoPresenceMs(intervals, new Date(10 * MIN_MS));
    expect(totals.get("a")).toBe(10 * MIN_MS);
    expect(totals.get("b")).toBe(10 * MIN_MS);
    expect(totals.get("c")).toBe(10 * MIN_MS);
  });

  it("seuil d'éligibilité — pile 15 minutes suffit, 14min59s ne suffit pas", () => {
    const intervals: PresenceIntervalInput[] = [
      iv("a", 0, 15),
      iv("b", 0, 15),
    ];
    const exact = computeCoPresenceMs(intervals, new Date(15 * MIN_MS));
    expect(exact.get("a")).toBe(INSTANT_SESSION_ELIGIBLE_PRESENCE_MS);

    const justUnder: PresenceIntervalInput[] = [
      { userId: "a", startedAt: new Date(0), endedAt: new Date(14 * MIN_MS + 59_000) },
      { userId: "b", startedAt: new Date(0), endedAt: new Date(14 * MIN_MS + 59_000) },
    ];
    const under = computeCoPresenceMs(justUnder, new Date(14 * MIN_MS + 59_000));
    expect(under.get("a")!).toBeLessThan(INSTANT_SESSION_ELIGIBLE_PRESENCE_MS);
  });

  it("intervalle encore OUVERT (endedAt: null) fermé à `asOf`, jamais au-delà", () => {
    const intervals: PresenceIntervalInput[] = [
      iv("a", 0, null),
      iv("b", 0, null),
    ];
    const totals = computeCoPresenceMs(intervals, new Date(10 * MIN_MS));
    expect(totals.get("a")).toBe(10 * MIN_MS);
    expect(totals.get("b")).toBe(10 * MIN_MS);
  });

  it("un utilisateur SANS aucun autre participant simultané reste à 0, même avec plusieurs passages", () => {
    // A seul de 0 à 5, puis B seul de 10 à 15 (jamais ensemble) — aucun des
    // deux n'atteint jamais la co-présence.
    const intervals: PresenceIntervalInput[] = [iv("a", 0, 5), iv("b", 10, 15)];
    const totals = computeCoPresenceMs(intervals, new Date(15 * MIN_MS));
    expect(totals.get("a")).toBe(0);
    expect(totals.get("b")).toBe(0);
  });

  it("retourne 0 (pas absent) pour un participant présent dans `intervals`, même sans co-présence — permet d'afficher sa progression", () => {
    const totals = computeCoPresenceMs([iv("solo", 0, 5)], new Date(5 * MIN_MS));
    expect(totals.has("solo")).toBe(true);
    expect(totals.get("solo")).toBe(0);
  });

  it("intervalle dégénéré (endedAt <= startedAt) ignoré silencieusement, jamais une durée négative", () => {
    const totals = computeCoPresenceMs(
      [{ userId: "a", startedAt: new Date(10 * MIN_MS), endedAt: new Date(5 * MIN_MS) }],
      new Date(10 * MIN_MS)
    );
    expect(totals.get("a")).toBe(0);
  });

  it("aucun intervalle → Map vide", () => {
    expect(computeCoPresenceMs([], new Date()).size).toBe(0);
  });
});

describe("constantes — règles produit explicites", () => {
  it("durée maximale : 3 heures", () => {
    expect(INSTANT_SESSION_MAX_DURATION_MS).toBe(3 * 60 * 60 * 1000);
  });
  it("seuil d'éligibilité XP : 15 minutes", () => {
    expect(INSTANT_SESSION_ELIGIBLE_PRESENCE_MS).toBe(15 * 60 * 1000);
  });
});

describe("instantSessionPurgeEligibility (retention.ts) — pure", () => {
  it("ACTIVE — jamais purgée, quel que soit l'âge", () => {
    expect(instantSessionPurgeEligibility({ status: "ACTIVE", endedAt: null })).toEqual({
      eligible: false,
      reason: "active",
    });
  });

  it("ENDED avec endedAt — référence RÉELLE = endedAt, jamais createdAt/expiresAt", () => {
    const endedAt = new Date("2026-01-01T00:00:00.000Z");
    expect(instantSessionPurgeEligibility({ status: "ENDED", endedAt })).toEqual({
      eligible: true,
      referenceDate: endedAt,
    });
  });

  it("ENDED sans endedAt (ne devrait jamais arriver en pratique) — jamais une date inventée", () => {
    expect(instantSessionPurgeEligibility({ status: "ENDED", endedAt: null })).toEqual({
      eligible: false,
      reason: "no_reliable_date",
    });
  });
});
