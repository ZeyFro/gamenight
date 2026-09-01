import { describe, it, expect } from "vitest";
import {
  addDays,
  getWeekStart,
  getMonthGridRange,
  buildCalendarHref,
  findBestSlot,
} from "@/lib/calendar-dates";

describe("addDays", () => {
  it("avance d'un nombre de jours donné, y compris à travers un changement de mois", () => {
    const jan31 = new Date(Date.UTC(2026, 0, 31));
    expect(addDays(jan31, 1)).toEqual(new Date(Date.UTC(2026, 1, 1)));
  });

  it("accepte un nombre de jours négatif", () => {
    const feb1 = new Date(Date.UTC(2026, 1, 1));
    expect(addDays(feb1, -1)).toEqual(new Date(Date.UTC(2026, 0, 31)));
  });
});

describe("getWeekStart", () => {
  it("renvoie le lundi de la semaine pour un jour en milieu de semaine", () => {
    // Mercredi 2026-01-14
    const wednesday = new Date(Date.UTC(2026, 0, 14));
    expect(getWeekStart(wednesday)).toEqual(new Date(Date.UTC(2026, 0, 12)));
  });

  it("revient au lundi précédent pour un dimanche (pas le lundi suivant)", () => {
    // Dimanche 2026-01-18
    const sunday = new Date(Date.UTC(2026, 0, 18));
    expect(getWeekStart(sunday)).toEqual(new Date(Date.UTC(2026, 0, 12)));
  });

  it("renvoie le jour lui-même pour un lundi", () => {
    const monday = new Date(Date.UTC(2026, 0, 12));
    expect(getWeekStart(monday)).toEqual(monday);
  });
});

describe("getMonthGridRange", () => {
  it("couvre des semaines complètes lundi-dimanche englobant tout le mois", () => {
    // Janvier 2026 : le 1er est un jeudi, le 31 un samedi.
    const { start, end } = getMonthGridRange(new Date(Date.UTC(2026, 0, 15)));

    expect(start.getUTCDay()).toBe(1); // lundi
    expect(end.getUTCDay()).toBe(1); // lundi (début de la semaine du dernier jour)
    expect(start.getTime()).toBeLessThanOrEqual(Date.UTC(2026, 0, 1));
    expect(end.getTime()).toBeGreaterThanOrEqual(Date.UTC(2026, 0, 31) - 6 * 86_400_000);
  });
});

describe("buildCalendarHref", () => {
  it("ne pose aucun paramètre pour le mode collectif sans date ni potes", () => {
    expect(buildCalendarHref({ mode: "collectif" })).toBe("/calendrier");
  });

  it("pose date et mode pour le mode individuel avec un pote choisi", () => {
    expect(
      buildCalendarHref({ date: "2026-03-01", mode: "individuel", pote: "user-1" })
    ).toBe("/calendrier?date=2026-03-01&mode=individuel&pote=user-1");
  });

  it("ignore `pote` en mode collectif et `potes` en mode individuel", () => {
    expect(
      buildCalendarHref({ mode: "collectif", pote: "user-1", potes: "a,b" })
    ).toBe("/calendrier?potes=a%2Cb");
    expect(
      buildCalendarHref({ mode: "individuel", potes: "a,b" })
    ).toBe("/calendrier?mode=individuel");
  });
});

describe("findBestSlot", () => {
  it("choisit le créneau avec le plus grand nombre de dispos, tous jours confondus", () => {
    const days = [
      {
        date: new Date(Date.UTC(2026, 0, 12)),
        hours: [
          { hour: 20, availableUserIds: ["a"] },
          { hour: 21, availableUserIds: ["a", "b"] },
        ],
      },
      {
        date: new Date(Date.UTC(2026, 0, 13)),
        hours: [{ hour: 20, availableUserIds: ["a", "b", "c"] }],
      },
    ];

    expect(findBestSlot(days)).toEqual({
      date: days[1].date,
      hour: 20,
      count: 3,
      userIds: ["a", "b", "c"],
    });
  });

  it("renvoie null si personne n'est jamais dispo (tous les créneaux à 0)", () => {
    const days = [
      { date: new Date(Date.UTC(2026, 0, 12)), hours: [{ hour: 20, availableUserIds: [] }] },
    ];
    expect(findBestSlot(days)).toBeNull();
  });

  it("renvoie null pour une liste de jours vide", () => {
    expect(findBestSlot([])).toBeNull();
  });

  it("garde le premier créneau rencontré en cas d'égalité", () => {
    const days = [
      {
        date: new Date(Date.UTC(2026, 0, 12)),
        hours: [
          { hour: 20, availableUserIds: ["a", "b"] },
          { hour: 21, availableUserIds: ["c", "d"] },
        ],
      },
    ];
    expect(findBestSlot(days)?.hour).toBe(20);
  });
});
