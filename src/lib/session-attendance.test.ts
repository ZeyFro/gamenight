import { describe, expect, it } from "vitest";
import { absencePenaltyAmount, attendanceRatePercent, attendanceXpAmount, parseAttendanceXpSettings } from "./session-attendance";
import * as m_p05 from "./session-attendance";

describe("session attendance", () => {
  it("returns no percentage without submitted sessions and rounds to a whole percent", () => {
    expect(attendanceRatePercent(0, 0)).toBeNull();
    expect(attendanceRatePercent(1, 3)).toBe(33);
    expect(attendanceRatePercent(2, 3)).toBe(67);
  });

  it("uses conservative per-community XP only when explicitly enabled", () => {
    expect(attendanceXpAmount({ attendanceXpEnabled: false, attendanceBonusXp: 2, absencePenaltyXp: 1 }, true)).toBe(0);
    expect(attendanceXpAmount({ attendanceXpEnabled: true, attendanceBonusXp: 2, absencePenaltyXp: 1 }, true)).toBe(2);
    expect(attendanceXpAmount({ attendanceXpEnabled: true, attendanceBonusXp: 2, absencePenaltyXp: 1 }, false)).toBe(-1);
  });

  it("does not deduct below zero and rejects unsafe admin values", () => {
    expect(absencePenaltyAmount(1, 0)).toBe(0);
    expect(absencePenaltyAmount(3, 2)).toBe(2);
    expect(parseAttendanceXpSettings({ enabled: "false", bonusXp: "2", absencePenaltyXp: "1" })).toEqual({
      attendanceXpEnabled: false,
      attendanceBonusXp: 2,
      absencePenaltyXp: 1,
    });
    expect(parseAttendanceXpSettings({ enabled: "true", bonusXp: "21", absencePenaltyXp: "1" })).toBeNull();
  });
});

// Tâche Qwen qwen-p05-presence-taux — repris du test de preuve loop/checks (node:test) sous vitest.
describe("session-attendance · p05-presence-taux", () => {
  it('le taux valide est inchange', () => {
    expect(m_p05.attendanceRatePercent(3, 4)).toBe(75);
    expect(m_p05.attendanceRatePercent(4, 4)).toBe(100);
    expect(m_p05.attendanceRatePercent(0, 5)).toBe(0);
    expect(m_p05.attendanceRatePercent(0, 0)).toBe(null);
    expect(m_p05.attendanceRatePercent(1, 3)).toBe(33);
  });
  it('un taux incoherent donne null', () => {
    expect(m_p05.attendanceRatePercent(5, 4)).toBe(null);
    expect(m_p05.attendanceRatePercent(-1, 4)).toBe(null);
    expect(m_p05.attendanceRatePercent(1.5, 4)).toBe(null);
    expect(m_p05.attendanceRatePercent(1, 4.5)).toBe(null);
    expect(m_p05.attendanceRatePercent(Number.NaN, 4)).toBe(null);
    expect(m_p05.attendanceRatePercent(1, Number.POSITIVE_INFINITY)).toBe(null);
  });
  it('les autres fonctions sont inchangees', () => {
    expect(m_p05.MAX_ATTENDANCE_XP).toBe(20);
    expect(m_p05.absencePenaltyAmount(10, 4)).toBe(4);
  });
});
