import { describe, expect, it } from "vitest";
import { monthlyRecapWindows } from "./monthly-recap";

describe("monthlyRecapWindows", () => {
  it("sépare les bornes murales des soirées et les instants réels des horodatages", () => {
    const september = monthlyRecapWindows(2026, 9);
    // Session.date est une heure murale : le 1er septembre à minuit.
    expect(september.sessionStart.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(september.sessionEnd.toISOString()).toBe("2026-09-30T23:59:59.999Z");
    // createdAt est un instant réel : septembre à Paris commence le 31/08 à 22:00 UTC.
    expect(september.instantStart.toISOString()).toBe("2026-08-31T22:00:00.000Z");
    expect(september.instantEnd.toISOString()).toBe("2026-09-30T21:59:59.999Z");
  });

  it("applique le décalage d'été (CEST) au mois de juillet", () => {
    const july = monthlyRecapWindows(2026, 7);
    expect(july.instantStart.toISOString()).toBe("2026-06-30T22:00:00.000Z");
    expect(july.instantEnd.toISOString()).toBe("2026-07-31T21:59:59.999Z");
  });

  it("gère le passage à l'heure d'hiver entre septembre et octobre", () => {
    const october = monthlyRecapWindows(2026, 10);
    expect(october.instantStart.toISOString()).toBe("2026-09-30T22:00:00.000Z");
    // Le 1er novembre à minuit est déjà en CET (UTC+1).
    expect(october.instantEnd.toISOString()).toBe("2026-10-31T22:59:59.999Z");
  });
});
