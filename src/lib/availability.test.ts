import { describe, expect, it } from "vitest";
import { isAvailableAt, type WeeklySlot } from "./availability";

// 2026-10-05 = lundi (getUTCDay() === 1)
const monday = (hh: number, mm = 0) => new Date(Date.UTC(2026, 9, 5, hh, mm));

const mondayEvening: WeeklySlot = { dayOfWeek: 1, startTime: "20:00", endTime: "23:00" };

describe("isAvailableAt — créneaux hebdomadaires", () => {
  it("dispo dans le créneau du bon jour (début inclus, fin exclue)", () => {
    expect(isAvailableAt(monday(20, 0), [mondayEvening], undefined)).toBe(true);
    expect(isAvailableAt(monday(22, 59), [mondayEvening], undefined)).toBe(true);
    expect(isAvailableAt(monday(23, 0), [mondayEvening], undefined)).toBe(false);
    expect(isAvailableAt(monday(19, 59), [mondayEvening], undefined)).toBe(false);
  });

  it("indispo un autre jour de la semaine ou sans créneau", () => {
    const tuesday = new Date(Date.UTC(2026, 9, 6, 21, 0));
    expect(isAvailableAt(tuesday, [mondayEvening], undefined)).toBe(false);
    expect(isAvailableAt(monday(21), [], undefined)).toBe(false);
  });

  it("créneau traversant minuit (fin <= début)", () => {
    const slot: WeeklySlot = { dayOfWeek: 1, startTime: "23:00", endTime: "02:00" };
    expect(isAvailableAt(monday(23, 30), [slot], undefined)).toBe(true);
    expect(isAvailableAt(monday(1, 0), [slot], undefined)).toBe(true);
    expect(isAvailableAt(monday(2, 0), [slot], undefined)).toBe(false);
    expect(isAvailableAt(monday(12, 0), [slot], undefined)).toBe(false);
  });

  it("21:00–00:00 couvre la soirée jusqu'à minuit", () => {
    const slot: WeeklySlot = { dayOfWeek: 1, startTime: "21:00", endTime: "00:00" };
    expect(isAvailableAt(monday(23, 59), [slot], undefined)).toBe(true);
    expect(isAvailableAt(monday(20, 59), [slot], undefined)).toBe(false);
  });
});

describe("isAvailableAt — exception ponctuelle", () => {
  it("available=false prime sur un créneau hebdo", () => {
    expect(
      isAvailableAt(monday(21), [mondayEvening], { available: false, startTime: null, endTime: null })
    ).toBe(false);
  });

  it("available=true sans horaire = toute la journée, même sans créneau hebdo", () => {
    expect(
      isAvailableAt(monday(4), [], { available: true, startTime: null, endTime: null })
    ).toBe(true);
  });

  it("available=true avec horaire : seulement dans la plage", () => {
    const override = { available: true, startTime: "14:00", endTime: "16:00" };
    expect(isAvailableAt(monday(15), [], override)).toBe(true);
    expect(isAvailableAt(monday(21), [mondayEvening], override)).toBe(false);
  });
});
