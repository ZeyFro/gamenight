import { describe, expect, it } from "vitest";
import {
  isPastRetentionWindow,
  sessionPurgeEligibility,
  tournamentPurgeEligibility,
  RETENTION_CHAT_PURGE_DELAY_DAYS,
} from "@/lib/retention";

/**
 * Chantier nettoyage réel du stockage (V2) — règles d'éligibilité PURES
 * (aucune DB, aucun réseau), partagées EXACTEMENT par le dry-run et
 * l'exécution réelle (`purgeEligibleChatMessagesBatch`/
 * `scheduleDiscordCleanupForEligibleEvents`, mêmes fonctions, jamais deux
 * logiques divergentes) — voir le commentaire de fichier de retention.ts.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

describe("retention — éligibilité (pure)", () => {
  describe("sessionPurgeEligibility", () => {
    it("VOTING/SCHEDULED — jamais purgé, quel que soit l'âge", () => {
      expect(sessionPurgeEligibility({ status: "VOTING", date: new Date("2000-01-01") })).toEqual({
        eligible: false,
        reason: "active",
      });
      expect(sessionPurgeEligibility({ status: "SCHEDULED", date: new Date("2000-01-01") })).toEqual({
        eligible: false,
        reason: "active",
      });
    });

    it("DONE/CANCELLED — référence RÉELLE = Session.date, jamais une date de création", () => {
      const date = new Date("2026-01-01T00:00:00.000Z");
      expect(sessionPurgeEligibility({ status: "DONE", date })).toEqual({ eligible: true, referenceDate: date });
      expect(sessionPurgeEligibility({ status: "CANCELLED", date })).toEqual({ eligible: true, referenceDate: date });
    });
  });

  describe("tournamentPurgeEligibility", () => {
    it("REGISTRATION/IN_PROGRESS — jamais purgé, quel que soit l'âge, indépendamment de tout completedAt ancien", () => {
      const oldMatch = { completedAt: new Date("2000-01-01") };
      expect(
        tournamentPurgeEligibility({ status: "REGISTRATION", cancelledAt: null }, [])
      ).toEqual({ eligible: false, reason: "active" });
      expect(
        tournamentPurgeEligibility({ status: "IN_PROGRESS", cancelledAt: null }, [oldMatch])
      ).toEqual({ eligible: false, reason: "active" });
    });

    it("CANCELLED avec cancelledAt fiable — référence = cancelledAt", () => {
      const cancelledAt = new Date("2026-03-01T00:00:00.000Z");
      expect(tournamentPurgeEligibility({ status: "CANCELLED", cancelledAt }, [])).toEqual({
        eligible: true,
        referenceDate: cancelledAt,
      });
    });

    it("CANCELLED SANS cancelledAt (incohérence défensive) — jamais purgé, jamais une date inventée", () => {
      expect(tournamentPurgeEligibility({ status: "CANCELLED", cancelledAt: null }, [])).toEqual({
        eligible: false,
        reason: "no_reliable_date",
      });
    });

    it("DONE — référence = le PLUS RÉCENT completedAt parmi tous les matchs, jamais le premier ni updatedAt", () => {
      const matches = [
        { completedAt: new Date("2026-01-01T00:00:00.000Z") },
        { completedAt: new Date("2026-01-03T00:00:00.000Z") }, // finale, la plus récente
        { completedAt: new Date("2026-01-02T00:00:00.000Z") },
      ];
      const result = tournamentPurgeEligibility({ status: "DONE", cancelledAt: null }, matches);
      expect(result).toEqual({ eligible: true, referenceDate: new Date("2026-01-03T00:00:00.000Z") });
    });

    it("DONE sans le moindre completedAt connu (incohérence défensive) — jamais purgé, jamais une date inventée", () => {
      expect(tournamentPurgeEligibility({ status: "DONE", cancelledAt: null }, [])).toEqual({
        eligible: false,
        reason: "no_reliable_date",
      });
      expect(
        tournamentPurgeEligibility({ status: "DONE", cancelledAt: null }, [{ completedAt: null }])
      ).toEqual({ eligible: false, reason: "no_reliable_date" });
    });
  });

  describe("isPastRetentionWindow — mêmes limites exactes que la fenêtre d'historique (7 jours, réutilisée telle quelle)", () => {
    const now = new Date("2026-09-28T12:00:00.000Z");

    it("juste EN DEÇÀ de la fenêtre (7 jours moins 1ms) — jamais éligible", () => {
      const referenceDate = new Date(now.getTime() - RETENTION_CHAT_PURGE_DELAY_DAYS * DAY_MS + 1);
      expect(isPastRetentionWindow(referenceDate, now)).toBe(false);
    });

    it("exactement à la limite (7 jours pile) — pas encore éligible (isWithinHistoryWindow est stricte, < jamais <=)", () => {
      const referenceDate = new Date(now.getTime() - RETENTION_CHAT_PURGE_DELAY_DAYS * DAY_MS);
      expect(isPastRetentionWindow(referenceDate, now)).toBe(true);
    });

    it("juste AU-DELÀ de la fenêtre (7 jours + 1ms) — éligible", () => {
      const referenceDate = new Date(now.getTime() - RETENTION_CHAT_PURGE_DELAY_DAYS * DAY_MS - 1);
      expect(isPastRetentionWindow(referenceDate, now)).toBe(true);
    });
  });
});
