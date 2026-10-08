import type { OverrideForDate, WeeklySlot } from "@/lib/availability";
import { toDateInputValue, toTimeInputValue } from "@/lib/wallclock";

export interface SlotMember {
  id: string;
  weekly: WeeklySlot[];
  overrides: (OverrideForDate & { date: string })[];
}

export interface SessionSlotSuggestion {
  date: string;
  time: string;
  endDate: string;
  endTime: string;
  availableCount: number;
  totalParticipants: number;
  unknownCount: number;
  creatorAvailable: boolean;
}

type Availability = "available" | "unavailable" | "unknown";
const DAY_MS = 86_400_000;
const minute = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));

/** Mêmes bornes [début, fin[ et conventions de minuit que isAvailableAt.
 * Fusionner les plages évite de confondre deux points disponibles avec une
 * durée entièrement libre (ex. trou de 15 minutes entre deux plages). */
function dayRanges(day: Date, member: SlotMember): [number, number][] | null {
  const override = member.overrides.find((row) => row.date === toDateInputValue(day));
  if (!override && member.weekly.length === 0) return null;
  if (override && !override.available) return [];
  if (override && (!override.startTime || !override.endTime)) return [[0, 1440]];
  const slots = override
    ? [{ startTime: override.startTime!, endTime: override.endTime! }]
    : member.weekly.filter((slot) => slot.dayOfWeek === day.getUTCDay());
  return slots.flatMap((slot): [number, number][] => {
    // Une ancienne valeur malformée ne doit jamais rendre une plage libre
    // par propagation de NaN dans le calcul de couverture.
    if (![slot.startTime, slot.endTime].every((time) => /^([01]\d|2[0-3]):[0-5]\d$/.test(time))) return [];
    const start = minute(slot.startTime), end = minute(slot.endTime);
    return end <= start ? [[0, end], [start, 1440]] : [[start, end]];
  }).sort((a, b) => a[0] - b[0]);
}

export function availabilityDuring(start: Date, end: Date, member: SlotMember): Availability {
  let unknown = false;
  for (let day = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())); day < end; day = new Date(day.getTime() + DAY_MS)) {
    const ranges = dayRanges(day, member);
    if (ranges === null) { unknown = true; continue; }
    const from = Math.max(0, (start.getTime() - day.getTime()) / 60_000);
    const to = Math.min(1440, (end.getTime() - day.getTime()) / 60_000);
    let covered = from;
    for (const [left, right] of ranges) {
      if (left > covered) break;
      covered = Math.max(covered, right);
      if (covered >= to) break;
    }
    if (covered < to) return "unavailable";
  }
  return unknown ? "unknown" : "available";
}

/** Sept soirées, départs toutes les 30 min de 18 h à 23 h 30.
 * Une option par jour, max trois : disponibilité maximale puis date la plus
 * proche. Un organisateur explicitement indisponible élimine le créneau.
 * Une absence de saisie est signalée, jamais comptée comme une disponibilité. */
export function suggestSessionSlots(members: SlotMember[], creatorId: string, now: Date, durationMinutes: number): SessionSlotSuggestion[] {
  if (![60, 90, 120, 180].includes(durationMinutes) || !Number.isFinite(now.getTime())) return [];
  const participants = [...new Map(members.map((member) => [member.id, member])).values()];
  if (!participants.some((member) => member.id === creatorId)) return [];
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const candidates: SessionSlotSuggestion[] = [];
  for (let offset = 0; offset < 7; offset++) {
    for (let minutes = 18 * 60; minutes < 24 * 60; minutes += 30) {
      const start = new Date(today + offset * DAY_MS + minutes * 60_000);
      if (start.getTime() < now.getTime() + 30 * 60_000) continue;
      const end = new Date(start.getTime() + durationMinutes * 60_000);
      const states = participants.map((member) => ({ id: member.id, state: availabilityDuring(start, end, member) }));
      const creator = states.find((member) => member.id === creatorId)!;
      if (creator.state === "unavailable") continue;
      const available = states.filter((member) => member.state === "available");
      if (!available.length || (participants.length > 1 && !available.some((member) => member.id !== creatorId))) continue;
      candidates.push({ date: toDateInputValue(start), time: toTimeInputValue(start), endDate: toDateInputValue(end), endTime: toTimeInputValue(end), availableCount: available.length, totalParticipants: participants.length, unknownCount: states.filter((member) => member.state === "unknown").length, creatorAvailable: creator.state === "available" });
    }
  }
  candidates.sort((a, b) => b.availableCount - a.availableCount || a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  const days = new Set<string>();
  return candidates.filter((candidate) => {
    if (days.has(candidate.date)) return false;
    days.add(candidate.date); return true;
  }).slice(0, 3);
}
