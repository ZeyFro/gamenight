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

describe("computeTimingsDue — cas courant (cron sans retard, un seul seuil à la fois)", () => {
  it("timing dû : temps restant <= timing", () => {
    const due = computeTimingsDue(
      {
        date: new Date("2026-06-15T20:00:00Z"),
        reminderTimings: [90],
        remindersSent: [],
      },
      new Date("2026-06-15T19:00:00Z") // 60 min avant
    );
    expect(due).toEqual({ toSend: { minutes: 90, actualMinutesRemaining: 60 }, toResolveWithoutSending: [] });
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
    expect(due).toEqual({ toSend: null, toResolveWithoutSending: [] });
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
    expect(due).toEqual({ toSend: { minutes: 30, actualMinutesRemaining: 25 }, toResolveWithoutSending: [] });
  });

  it("reminderTimings vide : jamais aucun rappel dû", () => {
    const due = computeTimingsDue(
      { date: new Date("2026-06-15T20:00:00Z"), reminderTimings: [], remindersSent: [] },
      new Date("2026-06-15T19:00:00Z")
    );
    expect(due).toEqual({ toSend: null, toResolveWithoutSending: [] });
  });

  it("heure d'hiver (15 janvier) — arithmétique normale", () => {
    const due = computeTimingsDue(
      { date: new Date("2026-01-15T20:00:00Z"), reminderTimings: [90], remindersSent: [] },
      new Date("2026-01-15T19:00:00Z")
    );
    expect(due).toEqual({ toSend: { minutes: 90, actualMinutesRemaining: 60 }, toResolveWithoutSending: [] });
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
    expect(due).toEqual({ toSend: { minutes: 90, actualMinutesRemaining: 60 }, toResolveWithoutSending: [] });
  });

  it("proximité de minuit : le passage de jour ne casse pas la soustraction en ms", () => {
    const due = computeTimingsDue(
      { date: new Date("2026-01-15T00:10:00Z"), reminderTimings: [20], remindersSent: [] },
      new Date("2026-01-14T23:55:00Z") // 15 min avant, à cheval sur le changement de jour
    );
    expect(due).toEqual({ toSend: { minutes: 20, actualMinutesRemaining: 15 }, toResolveWithoutSending: [] });
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
    expect(dueExact).toEqual({ toSend: { minutes: 1440, actualMinutesRemaining: 1440 }, toResolveWithoutSending: [] });

    const notYetDue = computeTimingsDue(
      { date: new Date("2026-03-29T20:00:00Z"), reminderTimings: [1439], remindersSent: [] },
      new Date("2026-03-28T20:00:00Z")
    );
    expect(notYetDue).toEqual({ toSend: null, toResolveWithoutSending: [] });
  });

  it("bascule DST inverse (nuit CEST→CET, 25 octobre 2026) : même comportement", () => {
    const due = computeTimingsDue(
      { date: new Date("2026-10-26T20:00:00Z"), reminderTimings: [1440], remindersSent: [] },
      new Date("2026-10-25T20:00:00Z")
    );
    expect(due).toEqual({ toSend: { minutes: 1440, actualMinutesRemaining: 1440 }, toResolveWithoutSending: [] });
  });
});

describe("computeTimingsDue — rattrapage (soirée décidée tard / cron en retard)", () => {
  // Reproduit l'exemple exact de la demande : seuils 12h(720)/2h(120)/
  // 45min(45)/30min(30), premier passage à 40 minutes de l'échéance.
  const LATE_SESSION = {
    date: new Date("2026-06-15T20:00:00Z"),
    reminderTimings: [720, 120, 45, 30],
    remindersSent: [] as string[],
  };

  it("premier passage à 40 minutes : un seul rappel avec le temps RÉELLEMENT restant (40, jamais 45/12h/2h) ; 720/120/45 marqués dépassés", () => {
    const now = new Date("2026-06-15T19:20:00Z"); // 40 min avant
    const result = computeTimingsDue(LATE_SESSION, now);
    expect(result.toSend).toEqual({ minutes: 45, actualMinutesRemaining: 40 });
    expect(result.toResolveWithoutSending.sort((a, b) => a - b)).toEqual([120, 720]);
  });

  it("passage suivant à 39 minutes (après persistance du passage précédent) : rien — 30 pas encore dû, le reste déjà résolu", () => {
    const now39 = new Date("2026-06-15T19:21:00Z"); // 39 min avant
    const sessionAfterFirstPass = {
      ...LATE_SESSION,
      // Simule la persistance après le premier passage (40 min) :
      // 45/120/720 tous marqués résolus (un envoyé, deux dépassés).
      remindersSent: ["45", "120", "720"],
    };
    const result = computeTimingsDue(sessionAfterFirstPass, now39);
    expect(result).toEqual({ toSend: null, toResolveWithoutSending: [] });
  });

  it("passage à 30 minutes : rappel NORMAL (seul seuil restant, temps réel ≈ seuil configuré)", () => {
    const now30 = new Date("2026-06-15T19:30:00Z"); // 30 min avant
    const sessionAt30 = { ...LATE_SESSION, remindersSent: ["45", "120", "720"] };
    const result = computeTimingsDue(sessionAt30, now30);
    expect(result).toEqual({
      toSend: { minutes: 30, actualMinutesRemaining: 30 },
      toResolveWithoutSending: [],
    });
  });

  it("enchaînement complet des 4 passages de l'exemple, avec persistance simulée entre chaque", () => {
    let remindersSent: string[] = [];
    const at = (minutesBefore: number) => new Date(LATE_SESSION.date.getTime() - minutesBefore * 60_000);

    const pass1 = computeTimingsDue({ ...LATE_SESSION, remindersSent }, at(40));
    expect(pass1.toSend).toEqual({ minutes: 45, actualMinutesRemaining: 40 });
    expect(pass1.toResolveWithoutSending.sort((a, b) => a - b)).toEqual([120, 720]);
    remindersSent = [
      ...remindersSent,
      String(pass1.toSend!.minutes),
      ...pass1.toResolveWithoutSending.map(String),
    ];

    const pass2 = computeTimingsDue({ ...LATE_SESSION, remindersSent }, at(39));
    expect(pass2).toEqual({ toSend: null, toResolveWithoutSending: [] });

    const pass3 = computeTimingsDue({ ...LATE_SESSION, remindersSent }, at(30));
    expect(pass3).toEqual({ toSend: { minutes: 30, actualMinutesRemaining: 30 }, toResolveWithoutSending: [] });
    remindersSent = [...remindersSent, String(pass3.toSend!.minutes)];

    // Tous les seuils désormais résolus — plus aucun passage tant que la
    // soirée reste à venir.
    const pass4 = computeTimingsDue({ ...LATE_SESSION, remindersSent }, at(5));
    expect(pass4).toEqual({ toSend: null, toResolveWithoutSending: [] });
  });

  it("un seul seuil dû (pas de rattrapage) : comportement normal, jamais de toResolveWithoutSending inutile", () => {
    const due = computeTimingsDue(
      { date: new Date("2026-06-15T20:00:00Z"), reminderTimings: [720, 120, 45, 30], remindersSent: ["720", "120", "45"] },
      new Date("2026-06-15T19:30:00Z") // 30 min avant → seul 30 est dû
    );
    expect(due).toEqual({ toSend: { minutes: 30, actualMinutesRemaining: 30 }, toResolveWithoutSending: [] });
  });
});

describe("computeTimingsDue — soirée déjà commencée : plus AUCUN compte à rebours", () => {
  it("premier passage après le début : aucun rappel envoyé, tout ce qui restait dû est silencieusement résolu (pas de flush groupé annoncé)", () => {
    const due = computeTimingsDue(
      {
        date: new Date("2026-06-15T20:00:00Z"),
        reminderTimings: [720, 120, 45, 30],
        remindersSent: [],
      },
      new Date("2026-06-15T20:05:00Z") // 5 min APRÈS le début
    );
    expect(due.toSend).toBeNull();
    expect(due.toResolveWithoutSending.sort((a, b) => a - b)).toEqual([30, 45, 120, 720]);
  });

  it("soirée commencée, aucun seuil encore dû (tous déjà résolus) : rien du tout", () => {
    const due = computeTimingsDue(
      {
        date: new Date("2026-06-15T20:00:00Z"),
        reminderTimings: [30],
        remindersSent: ["30"],
      },
      new Date("2026-06-15T20:05:00Z")
    );
    expect(due).toEqual({ toSend: null, toResolveWithoutSending: [] });
  });

  it("pile au début (minutesUntil === 0) : traité comme commencé, pas d'envoi", () => {
    const due = computeTimingsDue(
      { date: new Date("2026-06-15T20:00:00Z"), reminderTimings: [30], remindersSent: [] },
      new Date("2026-06-15T20:00:00Z")
    );
    expect(due).toEqual({ toSend: null, toResolveWithoutSending: [30] });
  });
});

describe("computeTimingsDue — passages concurrents (deux lectures avec le même remindersSent)", () => {
  it("deux appels concurrents avec le même snapshot renvoient EXACTEMENT le même résultat — la convergence réelle vient de l'idempotence de l'enqueue/écriture, jamais d'un état partagé ici (fonction pure)", () => {
    const session = {
      date: new Date("2026-06-15T20:00:00Z"),
      reminderTimings: [720, 120, 45, 30],
      remindersSent: [] as string[],
    };
    const now = new Date("2026-06-15T19:20:00Z");

    const resultA = computeTimingsDue(session, now);
    const resultB = computeTimingsDue(session, now);
    expect(resultA).toEqual(resultB);
    expect(resultA.toSend).toEqual({ minutes: 45, actualMinutesRemaining: 40 });

    // Deux écritures concurrentes de `remindersSent` basées sur CE même
    // résultat convergent vers le même ensemble final (Set, voir
    // `applyReminderResults`) — jamais un seuil compté deux fois ni un
    // état divergent entre les deux "gagnants" d'une course.
    const writeA = applyReminderResults(session.remindersSent, [{ minutes: 45, ok: true }], resultA.toResolveWithoutSending);
    const writeB = applyReminderResults(session.remindersSent, [{ minutes: 45, ok: true }], resultB.toResolveWithoutSending);
    expect(writeA.slice().sort()).toEqual(writeB.slice().sort());
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

  it("seuils obsolètes (staleToMark) : ajoutés INCONDITIONNELLEMENT, même si aucun envoi n'a réussi (voire aucun envoi tenté du tout)", () => {
    expect(applyReminderResults([], [], [720, 120])).toEqual(expect.arrayContaining(["720", "120"]));
    expect(applyReminderResults([], [], [720, 120])).toHaveLength(2);
  });

  it("mélange envoi réussi + seuils obsolètes marqués sans envoi", () => {
    const result = applyReminderResults([], [{ minutes: 45, ok: true }], [720, 120]);
    expect(result.slice().sort()).toEqual(["120", "45", "720"]);
  });

  it("staleToMark déduplique aussi avec l'existant", () => {
    expect(applyReminderResults(["720"], [], [720, 120])).toEqual(expect.arrayContaining(["720", "120"]));
    expect(applyReminderResults(["720"], [], [720, 120])).toHaveLength(2);
  });
});
