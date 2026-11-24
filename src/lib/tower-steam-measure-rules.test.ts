import { describe, expect, it } from "vitest";
import {
  canReportDoubt, cappedPlaytimeMinutes, evaluateAchievements, evaluatePlaytime, isCoherentMeasure, isDoubtWindowOver, isTowerSteamAutovalidateEnabled,
  measureSummary, playtimeCapDays, playtimeDelta, TOWER_MEASURE_DOUBT_MIN_TENURE_MS, TOWER_MEASURE_DOUBT_WINDOW_MS, TOWER_STEAM_DAILY_CAP_MINUTES,
} from "./tower-steam-measure-rules";

const assignedAt = new Date("2026-12-10T10:00:00Z");
const sec = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

describe("temps de jeu Steam depuis l'attribution", () => {
  it("calcule le delta sans jamais descendre sous zéro", () => {
    expect(playtimeDelta(100, 160)).toBe(60);
    expect(playtimeDelta(100, 90)).toBe(0);
    expect(() => playtimeDelta(Number.NaN, 1)).toThrow();
  });

  it("attend un départ avant de juger, puis compare à l'objectif", () => {
    const now = new Date("2026-12-10T12:00:00Z");
    expect(evaluatePlaytime({ baseline: null, current: 500, target: 60, assignedAt, now })).toEqual({ state: "NEEDS_BASELINE" });
    expect(evaluatePlaytime({ baseline: 500, current: 559, target: 60, assignedAt, now })).toEqual({ state: "WATCHING", value: 59 });
    expect(evaluatePlaytime({ baseline: 500, current: 560, target: 60, assignedAt, now })).toEqual({ state: "ACHIEVED", value: 60 });
  });
});

describe("plafond de 2 h de temps de jeu Steam par jour", () => {
  const at = (iso: string) => new Date(iso);
  const capped = (baseline: number, current: number, assigned: string, now: string) =>
    cappedPlaytimeMinutes({ baseline, current, assignedAt: at(assigned), now: at(now) });

  it("fixe le plafond à 120 minutes par jour", () => {
    expect(TOWER_STEAM_DAILY_CAP_MINUTES).toBe(120);
  });

  it("ne change rien sous le plafond", () => {
    expect(capped(1000, 1090, "2026-12-10T10:00:00Z", "2026-12-10T14:00:00Z")).toBe(90);
    expect(capped(1000, 1120, "2026-12-10T10:00:00Z", "2026-12-10T14:00:00Z")).toBe(120);
    expect(capped(1000, 1000, "2026-12-10T10:00:00Z", "2026-12-10T14:00:00Z")).toBe(0);
  });

  it("plafonne à 120 minutes le premier jour, au-dessus du plafond", () => {
    expect(capped(1000, 1121, "2026-12-10T10:00:00Z", "2026-12-10T14:00:00Z")).toBe(120);
    expect(capped(1000, 5000, "2026-12-10T10:00:00Z", "2026-12-10T10:05:00Z")).toBe(120);
  });

  it("compte au moins un jour, même à l'instant de l'attribution ou si l'horloge recule", () => {
    expect(playtimeCapDays(at("2026-12-10T10:00:00Z"), at("2026-12-10T10:00:00Z"))).toBe(1);
    expect(playtimeCapDays(at("2026-12-10T10:00:00Z"), at("2026-12-10T09:00:00Z"))).toBe(1);
  });

  it("ouvre 120 minutes de plus à chaque jour civil de Paris écoulé", () => {
    // Attribué le 10/12 à 11:00 Paris ; le 11/12 à 11:00 Paris : une date de Paris d'écart.
    expect(playtimeCapDays(at("2026-12-10T10:00:00Z"), at("2026-12-11T10:00:00Z"))).toBe(1);
    expect(capped(0, 400, "2026-12-10T10:00:00Z", "2026-12-11T10:00:00Z")).toBe(120);
    // Le 12/12 à 10:59 Paris (47 h 59 plus tard) : deux dates d'écart, deux fois le plafond.
    expect(playtimeCapDays(at("2026-12-10T10:00:00Z"), at("2026-12-12T09:59:00Z"))).toBe(2);
    expect(capped(0, 400, "2026-12-10T10:00:00Z", "2026-12-12T09:59:00Z")).toBe(240);
    expect(capped(0, 200, "2026-12-10T10:00:00Z", "2026-12-12T09:59:00Z")).toBe(200);
  });

  it("compte les jours à l'heure de Paris, pas en UTC", () => {
    // Attribué à 23:30 Paris le 10/12 (22:30 UTC) ; à 00:00 Paris le 12/12 (23:00 UTC le 11/12) : deux dates de Paris d'écart,
    // alors que les dates UTC ne diffèrent que d'un jour.
    expect(playtimeCapDays(at("2026-12-10T22:30:00Z"), at("2026-12-11T23:00:00Z"))).toBe(2);
    // Une heure après l'attribution, minuit de Paris est franchi mais les 24 h ne sont pas entamées deux fois : 1 jour.
    expect(playtimeCapDays(at("2026-12-10T22:30:00Z"), at("2026-12-10T23:30:00Z"))).toBe(1);
    // Attribué à 00:30 Paris le 11/12 (23:30 UTC le 10/12) ; 22 h 30 plus tard, 23:00 UTC le 11/12 : une seule date de Paris d'écart.
    expect(playtimeCapDays(at("2026-12-10T23:30:00Z"), at("2026-12-11T22:00:00Z"))).toBe(1);
    expect(playtimeCapDays(at("2026-12-10T23:30:00Z"), at("2026-12-11T23:00:00Z"))).toBe(1);
  });

  it("borne par les périodes de 24 h au passage à l'heure d'été (journée de 23 h)", () => {
    // 27/03/2027 à 23:59 Paris (CET) ; 47 h 59 plus tard, il est 00:58 le 30/03 (CEST) : la date de Paris a avancé de 3 jours.
    const start = "2027-03-27T22:59:00Z";
    const later = "2027-03-29T22:58:00Z";
    expect(at(later).getTime() - at(start).getTime()).toBeLessThan(48 * 3600_000);
    expect(playtimeCapDays(at(start), at(later))).toBe(2);
    expect(capped(0, 1000, start, later)).toBe(240);
  });

  it("reste cohérent au passage à l'heure d'hiver (journée de 25 h)", () => {
    // 30/10/2027 à 23:59 Paris (CEST) ; 31/10 à 23:30 Paris (CET) : une date d'écart malgré 24 h 31 écoulées.
    expect(playtimeCapDays(at("2027-10-30T21:59:00Z"), at("2027-10-31T22:30:00Z"))).toBe(1);
    // 01/11 à 22:58 Paris (CET), soit 48 h - 1 min plus tard : deux dates d'écart.
    expect(playtimeCapDays(at("2027-10-30T21:59:00Z"), at("2027-11-01T21:58:00Z"))).toBe(2);
  });

  it("ne dépasse jamais 240 minutes pendant les 48 h d'un défi (AFK 24 h sur 24)", () => {
    const start = at("2026-12-10T10:00:00Z");
    const afkPerMinute = 1; // le jeu reste ouvert : une minute jouée par minute écoulée
    for (let hours = 0; hours <= 48; hours += 1) {
      const now = new Date(start.getTime() - 1 + hours * 3600_000);
      const real = Math.max(0, Math.floor((now.getTime() - start.getTime()) / 60_000) * afkPerMinute);
      expect(cappedPlaytimeMinutes({ baseline: 0, current: real, assignedAt: start, now })).toBeLessThanOrEqual(2 * TOWER_STEAM_DAILY_CAP_MINUTES);
    }
    // Un joueur AFK 24 h (1 440 minutes) ne compte que 120 minutes tant que la date de Paris n'a pas changé.
    expect(capped(0, 1440, "2026-12-10T10:00:00Z", "2026-12-11T09:59:00Z")).toBe(120);
  });

  it("applique le plafond au jugement : un objectif de 180 min n'est pas atteint le premier jour", () => {
    const base = { baseline: 500, current: 2000, target: 180, assignedAt: at("2026-12-10T10:00:00Z") };
    expect(evaluatePlaytime({ ...base, now: at("2026-12-10T20:00:00Z") })).toEqual({ state: "WATCHING", value: 120 });
    expect(evaluatePlaytime({ ...base, now: at("2026-12-12T09:59:00Z") })).toEqual({ state: "ACHIEVED", value: 240 });
    expect(evaluatePlaytime({ ...base, target: 120, now: at("2026-12-10T20:00:00Z") })).toEqual({ state: "ACHIEVED", value: 120 });
  });
});

describe("succès Steam depuis l'attribution", () => {
  const achievements = [
    { apiname: "OLD", achieved: true, unlocktime: sec("2026-12-01T00:00:00Z") },
    { apiname: "NEW_A", achieved: true, unlocktime: sec("2026-12-10T11:00:00Z") },
    { apiname: "NEW_B", achieved: true, unlocktime: sec("2026-12-10T10:00:00Z") },
    { apiname: "LOCKED", achieved: false, unlocktime: 0 },
  ];

  it("ne compte que les déblocages postérieurs à l'attribution", () => {
    expect(evaluateAchievements({ achievements, assignedAt, target: 2, apiName: null })).toEqual({ state: "ACHIEVED", value: 2 });
    expect(evaluateAchievements({ achievements, assignedAt, target: 3, apiName: null })).toEqual({ state: "WATCHING", value: 2 });
  });

  it("exige le succès nommé, et pas un succès déjà débloqué avant l'attribution", () => {
    expect(evaluateAchievements({ achievements, assignedAt, target: 1, apiName: "NEW_A" })).toEqual({ state: "ACHIEVED", value: 1 });
    expect(evaluateAchievements({ achievements, assignedAt, target: 1, apiName: "OLD" })).toEqual({ state: "WATCHING", value: 0 });
    expect(evaluateAchievements({ achievements, assignedAt, target: 1, apiName: "LOCKED" })).toEqual({ state: "WATCHING", value: 0 });
  });
});

describe("signalement d'un doute", () => {
  const joinedAt = new Date("2026-11-01T00:00:00Z");
  const autoValidatedAt = new Date("2026-12-10T12:00:00Z");
  const base = { authorId: "author", reporterId: "voter", reporterStatus: "ACTIVE", reporterJoinedAt: joinedAt, autoValidatedAt, doubtReportedAt: null, now: new Date("2026-12-10T13:00:00Z") };

  it("accepte un membre actif depuis 3 jours pendant la fenêtre", () => {
    expect(canReportDoubt(base)).toEqual({ ok: true });
  });

  it("refuse l'auteur, un compte inactif ou trop récent, un second doute et la fin de fenêtre", () => {
    expect(canReportDoubt({ ...base, reporterId: "author" })).toEqual({ ok: false, reason: "SELF_DOUBT" });
    expect(canReportDoubt({ ...base, reporterStatus: "REMOVED" })).toEqual({ ok: false, reason: "DOUBT_NOT_ACTIVE" });
    expect(canReportDoubt({ ...base, reporterJoinedAt: new Date(base.now.getTime() - TOWER_MEASURE_DOUBT_MIN_TENURE_MS + 1) })).toEqual({ ok: false, reason: "DOUBT_TOO_RECENT" });
    expect(canReportDoubt({ ...base, doubtReportedAt: new Date("2026-12-10T12:30:00Z") })).toEqual({ ok: false, reason: "CLOSED" });
    expect(canReportDoubt({ ...base, now: new Date(autoValidatedAt.getTime() + TOWER_MEASURE_DOUBT_WINDOW_MS) })).toEqual({ ok: false, reason: "CLOSED" });
    expect(canReportDoubt({ ...base, autoValidatedAt: null })).toEqual({ ok: false, reason: "CLOSED" });
  });

  it("ne crédite qu'une fois la fenêtre écoulée", () => {
    expect(isDoubtWindowOver(autoValidatedAt, new Date(autoValidatedAt.getTime() + TOWER_MEASURE_DOUBT_WINDOW_MS - 1))).toBe(false);
    expect(isDoubtWindowOver(autoValidatedAt, new Date(autoValidatedAt.getTime() + TOWER_MEASURE_DOUBT_WINDOW_MS))).toBe(true);
  });
});

describe("définition de mesure et drapeau", () => {
  it("exige une mesure complète et cohérente, tout ou rien", () => {
    expect(isCoherentMeasure({})).toBe(true);
    expect(isCoherentMeasure({ measureKind: "STEAM_PLAYTIME", measureAppId: 440, measureTarget: 60 })).toBe(true);
    expect(isCoherentMeasure({ measureKind: "STEAM_ACHIEVEMENT", measureAppId: 440, measureTarget: 1, measureAchievement: "ACH_1" })).toBe(true);
    expect(isCoherentMeasure({ measureKind: "STEAM_PLAYTIME", measureAppId: 440 })).toBe(false);
    expect(isCoherentMeasure({ measureKind: "STEAM_PLAYTIME", measureAppId: 440, measureTarget: 60, measureAchievement: "ACH_1" })).toBe(false);
    expect(isCoherentMeasure({ measureAppId: 440 })).toBe(false);
  });

  it("résume la mesure en français", () => {
    expect(measureSummary({ kind: "STEAM_PLAYTIME", value: 75, target: 60, achievement: null })).toContain("75 min de jeu");
    expect(measureSummary({ kind: "STEAM_ACHIEVEMENT", value: 1, target: 1, achievement: "ACH_1" })).toContain("ACH_1");
  });

  it("n'est actif que si le drapeau vaut exactement true", () => {
    expect(isTowerSteamAutovalidateEnabled({})).toBe(false);
    expect(isTowerSteamAutovalidateEnabled({ TOWER_STEAM_AUTOVALIDATE_ENABLED: "True" })).toBe(false);
    expect(isTowerSteamAutovalidateEnabled({ TOWER_STEAM_AUTOVALIDATE_ENABLED: "true" })).toBe(true);
  });
});
