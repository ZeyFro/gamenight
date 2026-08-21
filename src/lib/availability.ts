export interface WeeklySlot {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

export interface OverrideForDate {
  available: boolean;
  startTime: string | null;
  endTime: string | null;
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/**
 * `endTime <= startTime` signifie un créneau qui traverse minuit
 * (ex. 21:00–00:00, ou 23:00–02:00) : on considère alors que le créneau
 * couvre [startTime, 24:00[ ∪ [00:00, endTime[.
 */
function isTimeWithinSlot(
  minutes: number,
  startTime: string,
  endTime: string
): boolean {
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  if (end <= start) {
    return minutes >= start || minutes < end;
  }
  return minutes >= start && minutes < end;
}

/**
 * Un utilisateur est dispo à `sessionDate` si :
 * - une AvailabilityOverride existe pour ce jour-là → elle prime seule
 *   (indisponible si `available=false` ; sinon dispo, toute la journée si
 *   aucun horaire précisé, sinon seulement dans le créneau donné) ;
 * - sinon on retombe sur les WeeklyAvailability du jour de la semaine
 *   correspondant.
 */
export function isAvailableAt(
  sessionDate: Date,
  weeklySlots: WeeklySlot[],
  override: OverrideForDate | undefined
): boolean {
  const minutes = sessionDate.getUTCHours() * 60 + sessionDate.getUTCMinutes();

  if (override) {
    if (!override.available) return false;
    if (!override.startTime || !override.endTime) return true;
    return isTimeWithinSlot(minutes, override.startTime, override.endTime);
  }

  const dayOfWeek = sessionDate.getUTCDay();
  return weeklySlots.some(
    (slot) =>
      slot.dayOfWeek === dayOfWeek &&
      isTimeWithinSlot(minutes, slot.startTime, slot.endTime)
  );
}
