export type AttendanceXpSettings = {
  attendanceXpEnabled: boolean;
  attendanceBonusXp: number;
  absencePenaltyXp: number;
};

export const MAX_ATTENDANCE_XP = 20;

export function attendanceRatePercent(present: number, total: number): number | null {
  return total > 0 ? Math.round((present / total) * 100) : null;
}

export function attendanceXpAmount(settings: AttendanceXpSettings, present: boolean): number {
  if (!settings.attendanceXpEnabled) return 0;
  return present ? settings.attendanceBonusXp : -settings.absencePenaltyXp;
}

export function absencePenaltyAmount(configuredPenalty: number, currentXp: number): number {
  return Math.min(Math.max(0, configuredPenalty), Math.max(0, currentXp));
}

export function parseAttendanceXpSettings(input: {
  enabled: unknown;
  bonusXp: unknown;
  absencePenaltyXp: unknown;
}): AttendanceXpSettings | null {
  if (input.enabled !== "true" && input.enabled !== "false") return null;
  const parseAmount = (value: unknown) => {
    if (typeof value !== "string" || !/^\d{1,2}$/.test(value)) return null;
    const amount = Number(value);
    return amount <= MAX_ATTENDANCE_XP ? amount : null;
  };
  const attendanceBonusXp = parseAmount(input.bonusXp);
  const absencePenaltyXp = parseAmount(input.absencePenaltyXp);
  if (attendanceBonusXp === null || absencePenaltyXp === null) return null;
  return { attendanceXpEnabled: input.enabled === "true", attendanceBonusXp, absencePenaltyXp };
}
