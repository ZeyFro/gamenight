import { describe, expect, it } from "vitest";
import {
  canReportDoubt, evaluateAchievements, evaluatePlaytime, isCoherentMeasure, isDoubtWindowOver, isTowerSteamAutovalidateEnabled,
  measureSummary, playtimeDelta, TOWER_MEASURE_DOUBT_MIN_TENURE_MS, TOWER_MEASURE_DOUBT_WINDOW_MS,
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
    expect(evaluatePlaytime({ baseline: null, current: 500, target: 60 })).toEqual({ state: "NEEDS_BASELINE" });
    expect(evaluatePlaytime({ baseline: 500, current: 559, target: 60 })).toEqual({ state: "WATCHING", value: 59 });
    expect(evaluatePlaytime({ baseline: 500, current: 560, target: 60 })).toEqual({ state: "ACHIEVED", value: 60 });
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

  it("accepte un membre actif depuis 7 jours pendant la fenêtre", () => {
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
