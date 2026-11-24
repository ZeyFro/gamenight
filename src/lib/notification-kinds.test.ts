import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EVENT_KINDS,
  NOTIFICATION_KINDS,
  PUBLIC_MILESTONE_EVENT_TYPES,
  evaluateDeliveryPolicy,
  kindOfEvent,
  type NotificationKind,
} from "@/lib/notification-kinds";

/** Lot 5 Notifications (Q17 à Q19, D09, D10) : chaque type d'événement a un genre, chaque genre ses canaux ; le reste est refusé. */
describe("politique de livraison (évaluée avant tout envoi)", () => {
  it("MP : seulement pour un événement personnel (Q17)", () => {
    for (const eventType of ["SESSION_DM", "TOURNAMENT_DM", "ROULETTE_DM", "INSTANT_SESSION_INVITE", "TEAM_APPLICATION_NOTIFY", "TOWER_AUTO_VALIDATED"]) {
      expect(evaluateDeliveryPolicy({ eventType, channel: "DISCORD_DM" }), eventType).toMatchObject({ allowed: true, kind: "PERSONAL_DM" });
    }
    for (const eventType of ["SESSION_CREATED", "TOURNAMENT_RESULT", "COMMUNITY_SYSTEM_ANNOUNCE", "SESSION_REMINDER", "TOWER_PROOF_SUBMITTED", "SESSION_SPACE_SYNC"]) {
      expect(evaluateDeliveryPolicy({ eventType, channel: "DISCORD_DM" }), eventType).toMatchObject({ allowed: false, reason: "channel_not_allowed_for_kind" });
    }
  });

  it("message public neuf : seulement pour un moment marquant de la liste fermée (Q18, D10)", () => {
    for (const eventType of PUBLIC_MILESTONE_EVENT_TYPES) {
      expect(evaluateDeliveryPolicy({ eventType, channel: "DISCORD_CHANNEL" }), eventType).toMatchObject({ allowed: true, kind: "PUBLIC_MILESTONE" });
    }
    // Un événement personnel ne peut pas ouvrir un message public.
    for (const eventType of ["SESSION_DM", "TOURNAMENT_DM", "ROULETTE_DM", "TEAM_APPLICATION_NOTIFY", "ONBOARDING_REMINDER"]) {
      expect(evaluateDeliveryPolicy({ eventType, channel: "DISCORD_CHANNEL" }), eventType).toMatchObject({ allowed: false });
    }
  });

  it("les mises à jour, fils et mentions de secours restent dans leur message ou leur fil (canal salon seulement)", () => {
    for (const eventType of ["SESSION_MODIFIED", "TOURNAMENT_REMOVED", "SESSION_DATE_CHANGED", "SESSION_REMINDER", "TOURNAMENT_MATCH_RESULT", "SESSION_DM_FALLBACK", "TOURNAMENT_DM_FALLBACK", "TOWER_PROOF_THREAD"]) {
      expect(evaluateDeliveryPolicy({ eventType, channel: "DISCORD_CHANNEL" }), eventType).toMatchObject({ allowed: true });
      expect(evaluateDeliveryPolicy({ eventType, channel: "DISCORD_DM" }), eventType).toMatchObject({ allowed: false });
    }
  });

  it("« Jouer maintenant » : annonce publique dans le salon (jamais en MP), sa mise à jour est une édition, l'invitation reste un MP", () => {
    expect(kindOfEvent("INSTANT_SESSION_ANNOUNCE")).toBe("PUBLIC_MILESTONE");
    expect(kindOfEvent("INSTANT_SESSION_ANNOUNCE_UPDATED")).toBe("PUBLIC_UPDATE");
    expect(evaluateDeliveryPolicy({ eventType: "INSTANT_SESSION_ANNOUNCE", channel: "DISCORD_CHANNEL" })).toMatchObject({ allowed: true });
    expect(evaluateDeliveryPolicy({ eventType: "INSTANT_SESSION_ANNOUNCE", channel: "DISCORD_DM" })).toMatchObject({ allowed: false });
    expect(evaluateDeliveryPolicy({ eventType: "INSTANT_SESSION_INVITE", channel: "DISCORD_DM" })).toMatchObject({ allowed: true });
  });

  it("une action d'administration n'est jamais un MP ni une notification dans l'app", () => {
    for (const eventType of ["SESSION_SPACE_SYNC", "PROJECT_SYNC", "TEAM_SPACE_SYNC", "ROLE_AUTOCREATE", "ROLE_CAPACITY_ALERT", "MODERATION_REPORT", "BOOSTER_SUPPORT_SYNC"]) {
      expect(evaluateDeliveryPolicy({ eventType, channel: "DISCORD_CHANNEL" }), eventType).toMatchObject({ allowed: true, kind: "SYSTEM_ACTION" });
      expect(evaluateDeliveryPolicy({ eventType, channel: "DISCORD_DM" }), eventType).toMatchObject({ allowed: false });
      expect(evaluateDeliveryPolicy({ eventType, channel: "IN_APP" }), eventType).toMatchObject({ allowed: false });
    }
  });

  it("échec fermé : un type inconnu est refusé sur tous les canaux, avec un motif lisible", () => {
    for (const channel of ["DISCORD_DM", "DISCORD_CHANNEL", "IN_APP"]) {
      const decision = evaluateDeliveryPolicy({ eventType: "NOUVEL_EVENEMENT", channel });
      expect(decision).toMatchObject({ allowed: false, kind: null, reason: "unknown_event_type" });
      expect(decision.allowed === false && decision.detail).toContain("NOUVEL_EVENEMENT");
    }
    expect(kindOfEvent("toString")).toBeNull(); // pas de fuite via le prototype
    expect(kindOfEvent("__proto__")).toBeNull();
  });

  it("les sept genres existent et chaque type classé a un genre valide", () => {
    expect([...NOTIFICATION_KINDS].sort()).toEqual(["IN_APP_ONLY", "OPT_IN_ROLE_PING", "PERSONAL_DM", "PUBLIC_MILESTONE", "PUBLIC_UPDATE", "SYSTEM_ACTION", "THREAD_CONTEXT"]);
    for (const kind of Object.values(EVENT_KINDS)) expect(NOTIFICATION_KINDS).toContain(kind as NotificationKind);
  });
});

/**
 * Garde sur le code : tout type d'événement créé dans `src/lib` (littéral `eventType: "X"`, ou constante exportée portant une valeur
 * MAJUSCULES) doit être classé dans la politique. Un nouvel événement non classé serait refusé à l'envoi : le test le dit avant la production.
 */
describe("tous les types d'événements du code sont classés", () => {
  function sources(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return sources(path);
      return /\.ts$/.test(entry.name) && !/\.test\./.test(entry.name) ? [path] : [];
    });
  }
  const code = sources("src").map((file) => readFileSync(file, "utf8")).join("\n");

  it("les littéraux `eventType: \"…\"` sont tous classés", () => {
    const literals = [...new Set([...code.matchAll(/eventType: *"([A-Z][A-Z_]+)"/g)].map((m) => m[1]))];
    const unknown = literals.filter((type) => kindOfEvent(type) === null);
    expect(unknown).toEqual([]);
    expect(literals.length).toBeGreaterThan(20);
  });

  it("les constantes de type d'événement connues sont classées", () => {
    const constants = [...code.matchAll(/(?:SPACE_EVENT|SYNC_EVENT|ALERT_EVENT|AUTOCREATE_EVENT|REPORT_EVENT|NOTIFY|REMINDER|AUTO_VALIDATED|AUTO_VALIDATION|AUTO_VALIDATION_UPDATED|PROOF_THREAD|PROOF_VOTE_UPDATED) *= *"([A-Z_]+)"/g)].map((m) => m[1]);
    expect(constants.length).toBeGreaterThan(8);
    expect(constants.filter((type) => kindOfEvent(type) === null)).toEqual([]);
  });

  it("les types dynamiques des défis Tower et les mentions de secours sont classés", () => {
    for (const type of ["TOWER_PROOF_SUBMITTED", "TOWER_CHALLENGE_APPROVED", "TOWER_CHALLENGE_REJECTED", "SESSION_DM_FALLBACK", "TOURNAMENT_DM_FALLBACK", "ROULETTE_DM_FALLBACK", "INSTANT_SESSION_DM_FALLBACK"]) {
      expect(kindOfEvent(type), type).not.toBeNull();
    }
  });

  it("l'executor évalue la politique AVANT de résoudre le contenu ou d'appeler Discord", () => {
    const executor = readFileSync("src/lib/notification-executor.ts", "utf8");
    const policyAt = executor.indexOf("evaluateDeliveryPolicy({");
    const resolveAt = executor.indexOf("opts.resolver.resolve(");
    expect(policyAt).toBeGreaterThan(0);
    expect(policyAt).toBeLessThan(resolveAt);
    expect(executor).toMatch(/errorClass: "policy:" \+ policy\.reason/);
  });
});
