import { describe, expect, it } from "vitest";
import { absencePenaltyAmount, attendanceRatePercent, attendanceXpAmount, parseAttendanceXpSettings } from "./session-attendance";

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
