import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { wallClockNow, formatDurationFr } from "@/lib/wallclock";

describe("wallClockNow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renvoie l'heure de Paris (CET, UTC+1) en hiver, pas l'heure UTC", () => {
    // 2026-01-15T12:00:00Z réel → 13:00 à Paris (CET = UTC+1).
    vi.setSystemTime(new Date("2026-01-15T12:00:00Z"));
    const now = wallClockNow();
    expect(now.getUTCHours()).toBe(13);
    expect(now.getUTCMinutes()).toBe(0);
    expect(now.getUTCDate()).toBe(15);
  });

  it("renvoie l'heure de Paris (CEST, UTC+2) en été, pas l'heure UTC", () => {
    // 2026-07-15T12:00:00Z réel → 14:00 à Paris (CEST = UTC+2).
    vi.setSystemTime(new Date("2026-07-15T12:00:00Z"));
    const now = wallClockNow();
    expect(now.getUTCHours()).toBe(14);
  });

  it("gère le passage à l'heure d'été (dernier dimanche de mars 2026, 2h → 3h à Paris)", () => {
    // Juste avant le changement : encore CET (UTC+1).
    vi.setSystemTime(new Date("2026-03-29T00:30:00Z"));
    expect(wallClockNow().getUTCHours()).toBe(1);

    // Juste après le changement (2h Paris devient 3h) : CEST (UTC+2).
    vi.setSystemTime(new Date("2026-03-29T01:30:00Z"));
    expect(wallClockNow().getUTCHours()).toBe(3);
  });

  it("gère le passage à l'heure d'hiver (dernier dimanche d'octobre 2026, CEST → CET)", () => {
    // Deux instants espacés d'exactement 48h en UTC, encadrant le
    // changement d'heure (01:00 UTC le 25/10/2026) : si l'heure locale
    // suivait un simple décalage fixe, l'heure du jour serait identique
    // des deux côtés. Ici elle diffère d'1h, preuve que le décalage
    // CEST(+2)/CET(+1) est bien recalculé dynamiquement (donnée IANA).
    vi.setSystemTime(new Date("2026-10-24T12:00:00Z")); // avant, CEST (+2)
    const before = wallClockNow().getUTCHours();

    vi.setSystemTime(new Date("2026-10-26T12:00:00Z")); // après, CET (+1)
    const after = wallClockNow().getUTCHours();

    expect(before).toBe(14);
    expect(after).toBe(13);
  });
});

describe("formatDurationFr", () => {
  it("formate en minutes sous l'heure", () => {
    expect(formatDurationFr(0)).toBe("0 min");
    expect(formatDurationFr(5 * 60_000)).toBe("5 min");
    expect(formatDurationFr(45 * 60_000)).toBe("45 min");
  });

  it("formate en heures entre 1h et 24h", () => {
    expect(formatDurationFr(60 * 60_000)).toBe("1 h");
    expect(formatDurationFr(3 * 60 * 60_000)).toBe("3 h");
    expect(formatDurationFr(23 * 60 * 60_000)).toBe("23 h");
  });

  it("formate en jours à partir de 24h", () => {
    expect(formatDurationFr(24 * 60 * 60_000)).toBe("1 j");
    expect(formatDurationFr(2 * 24 * 60 * 60_000)).toBe("2 j");
  });

  it("ne renvoie jamais une durée négative (clamp à 0)", () => {
    expect(formatDurationFr(-5000)).toBe("0 min");
  });
});
