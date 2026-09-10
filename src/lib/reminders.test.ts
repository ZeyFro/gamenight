import { describe, it, expect } from "vitest";
import { applyReminderResults, computeTimingsDue, parseRemindersSent } from "@/lib/reminders";

describe("parseRemindersSent", () => {
  it("filtre un tableau de strings valide", () => {
    expect(parseRemindersSent(["1440", "120"])).toEqual(["1440", "120"]);
  });

  it("ignore les entrées non-string et les valeurs non-tableau", () => {
    expect(parseRemindersSent(["1440", 120, null])).toEqual(["1440"]);
    expect(parseRemindersSent(null)).toEqual([]);
    expect(parseRemindersSent(undefined)).toEqual([]);
    expect(parseRemindersSent("not an array")).toEqual([]);
  });
});

describe("computeTimingsDue", () => {
  it("timing dû : temps restant <= timing", () => {
    const due = computeTimingsDue(
      {
        date: new Date("2026-06-15T20:00:00Z"),
        reminderTimings: [90],
        remindersSent: [],
      },
      new Date("2026-06-15T19:00:00Z") // 60 min avant
    );
    expect(due).toEqual([90]);
  });

  it("timing pas encore dû : temps restant > timing", () => {
    const due = computeTimingsDue(
      {
        date: new Date("2026-06-15T20:00:00Z"),
        reminderTimings: [30],
        remindersSent: [],
      },
      new Date("2026-06-15T19:00:00Z") // 60 min avant, rappel à 30 min pas encore dû
    );
    expect(due).toEqual([]);
  });

  it("timing déjà envoyé : exclu même si dû", () => {
    const due = computeTimingsDue(
      {
        date: new Date("2026-06-15T20:00:00Z"),
        reminderTimings: [90, 30],
        remindersSent: ["90"],
      },
      new Date("2026-06-15T19:35:00Z") // 25 min avant : 90 ET 30 sont dus, 90 déjà envoyé
    );
    expect(due).toEqual([30]);
  });

  it("reminderTimings vide : jamais aucun rappel dû", () => {
    const due = computeTimingsDue(
      { date: new Date("2026-06-15T20:00:00Z"), reminderTimings: [], remindersSent: [] },
      new Date("2026-06-15T19:00:00Z")
    );
    expect(due).toEqual([]);
  });

  it("heure d'hiver (15 janvier) — arithmétique normale", () => {
    const due = computeTimingsDue(
      { date: new Date("2026-01-15T20:00:00Z"), reminderTimings: [90], remindersSent: [] },
      new Date("2026-01-15T19:00:00Z")
    );
    expect(due).toEqual([90]);
  });

  it("heure d'été (15 juillet) — même arithmétique que l'hiver", () => {
    // `computeTimingsDue` ne lit jamais l'heure réelle ni le fuseau — elle
    // soustrait deux `Date` déjà en représentation horloge murale
    // (`now` vient de `wallClockNow()`, `date` de `parseDateAndTime` côté
    // création). Le calcul est donc rigoureusement identique été/hiver ;
    // seule la conversion heure réelle → horloge murale dans
    // `wallClockNow()` elle-même gère la bascule DST (déjà fixée,
    // inchangée par cette PR).
    const due = computeTimingsDue(
      { date: new Date("2026-07-15T20:00:00Z"), reminderTimings: [90], remindersSent: [] },
      new Date("2026-07-15T19:00:00Z")
    );
    expect(due).toEqual([90]);
  });

  it("proximité de minuit : le passage de jour ne casse pas la soustraction en ms", () => {
    const due = computeTimingsDue(
      { date: new Date("2026-01-15T00:10:00Z"), reminderTimings: [20], remindersSent: [] },
      new Date("2026-01-14T23:55:00Z") // 15 min avant, à cheval sur le changement de jour
    );
    expect(due).toEqual([20]);
  });

  it("bascule DST (nuit CET→CEST, 29 mars 2026) : 24h d'horloge murale restent 1440 min, que la nuit ait réellement duré 23h ou non", () => {
    // Le groupe est réputé dans un seul fuseau, et les dates saisies/
    // stockées sont volontairement des valeurs "horloge murale" plutôt que
    // de vrais instants UTC (cf. commentaire en tête de `wallclock.ts`) :
    // l'app raisonne en "24h affichées sur l'horloge", pas en durée réelle
    // écoulée. `computeTimingsDue` ne fait qu'une soustraction entre deux
    // valeurs déjà dans cette représentation, donc la nuit du changement
    // d'heure (23h réelles ce printemps-là, l'heure 02h-03h n'existe pas)
    // ne peut PAS la faire dérailler différemment d'une nuit normale :
    // "24h d'horloge murale plus tard" reste 1440 minutes pile, comme
    // voulu. La seule vraie complexité DST (convertir l'instant réel en
    // horloge murale) vit entièrement dans `wallClockNow()`, déjà
    // correcte et non modifiée par cette PR — donc hors scope ici.
    const dueExact = computeTimingsDue(
      { date: new Date("2026-03-29T20:00:00Z"), reminderTimings: [1440], remindersSent: [] },
      new Date("2026-03-28T20:00:00Z") // exactement 24h d'horloge murale avant
    );
    expect(dueExact).toEqual([1440]);

    const notYetDue = computeTimingsDue(
      { date: new Date("2026-03-29T20:00:00Z"), reminderTimings: [1439], remindersSent: [] },
      new Date("2026-03-28T20:00:00Z")
    );
    expect(notYetDue).toEqual([]);
  });

  it("bascule DST inverse (nuit CEST→CET, 25 octobre 2026) : même comportement", () => {
    const due = computeTimingsDue(
      { date: new Date("2026-10-26T20:00:00Z"), reminderTimings: [1440], remindersSent: [] },
      new Date("2026-10-25T20:00:00Z")
    );
    expect(due).toEqual([1440]);
  });
});

describe("applyReminderResults", () => {
  it("succès : le timing est ajouté", () => {
    expect(applyReminderResults([], [{ minutes: 60, ok: true }])).toEqual(["60"]);
  });

  it("échec : le timing n'est PAS ajouté — reste réessayable", () => {
    expect(applyReminderResults([], [{ minutes: 60, ok: false }])).toEqual([]);
  });

  it("préserve les remindersSent existants", () => {
    expect(applyReminderResults(["1440"], [{ minutes: 60, ok: true }])).toEqual(["1440", "60"]);
  });

  it("déduplique un timing déjà présent", () => {
    expect(applyReminderResults(["60"], [{ minutes: 60, ok: true }])).toEqual(["60"]);
  });

  it("mix succès/échec dans le même run : chacun traité indépendamment", () => {
    expect(
      applyReminderResults(
        [],
        [
          { minutes: 1440, ok: true },
          { minutes: 120, ok: false },
        ]
      )
    ).toEqual(["1440"]);
  });
});
