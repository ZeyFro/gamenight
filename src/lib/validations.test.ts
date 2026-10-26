import { describe, it, expect } from "vitest";
import {
  idSchema,
  dateStringSchema,
  timeStringSchema,
  sessionPlayedMinutesSchema,
  hexColorSchema,
  httpUrlSchema,
  createSessionSchema,
  weeklySlotSchema,
  overrideSchema,
  userColorSchema,
  bannerUrlSchema,
  playerCountsSchema,
  addManualGameSchema,
} from "@/lib/validations";

describe("primitives", () => {
  it("idSchema accepte une chaîne non vide, refuse vide/espaces seuls", () => {
    expect(idSchema.safeParse("abc123").success).toBe(true);
    expect(idSchema.safeParse("").success).toBe(false);
    expect(idSchema.safeParse("   ").success).toBe(false);
  });

  it("dateStringSchema exige le format YYYY-MM-DD", () => {
    expect(dateStringSchema.safeParse("2026-06-15").success).toBe(true);
    expect(dateStringSchema.safeParse("15/06/2026").success).toBe(false);
    expect(dateStringSchema.safeParse("2026-6-15").success).toBe(false);
    expect(dateStringSchema.safeParse("").success).toBe(false);
  });

  it("timeStringSchema exige le format HH:mm sur 24h", () => {
    expect(timeStringSchema.safeParse("00:00").success).toBe(true);
    expect(timeStringSchema.safeParse("23:59").success).toBe(true);
    expect(timeStringSchema.safeParse("24:00").success).toBe(false);
    expect(timeStringSchema.safeParse("9:30").success).toBe(false);
    expect(timeStringSchema.safeParse("09:60").success).toBe(false);
  });

  it("sessionPlayedMinutesSchema accepte une durée facultative de 1 à 1440 minutes", () => {
    expect(sessionPlayedMinutesSchema.safeParse(null)).toMatchObject({ success: true, data: undefined });
    expect(sessionPlayedMinutesSchema.safeParse("60")).toMatchObject({ success: true, data: 60 });
    for (const value of ["0", "1441", "1.5", "NaN"]) {
      expect(sessionPlayedMinutesSchema.safeParse(value).success).toBe(false);
    }
  });

  it("hexColorSchema exige #RRGGBB", () => {
    expect(hexColorSchema.safeParse("#8b5cf6").success).toBe(true);
    expect(hexColorSchema.safeParse("#FFFFFF").success).toBe(true);
    expect(hexColorSchema.safeParse("8b5cf6").success).toBe(false);
    expect(hexColorSchema.safeParse("#fff").success).toBe(false);
    expect(hexColorSchema.safeParse("#gggggg").success).toBe(false);
  });

  it("httpUrlSchema exige un préfixe http(s)://", () => {
    expect(httpUrlSchema.safeParse("https://exemple.com/x.jpg").success).toBe(true);
    expect(httpUrlSchema.safeParse("http://exemple.com").success).toBe(true);
    expect(httpUrlSchema.safeParse("javascript:alert(1)").success).toBe(false);
    expect(httpUrlSchema.safeParse("exemple.com").success).toBe(false);
  });
});

describe("createSessionSchema", () => {
  it("accepte une entrée valide avec destinataires", () => {
    const result = createSessionSchema.safeParse({
      date: "2026-06-15",
      time: "20:00",
      notifyUserIds: ["user-1", "user-2"],
    });
    expect(result.success).toBe(true);
  });

  it("accepte une liste de destinataires vide (aucune mention)", () => {
    expect(
      createSessionSchema.safeParse({ date: "2026-06-15", time: "20:00", notifyUserIds: [] })
        .success
    ).toBe(true);
  });

  it("accepte une équipe facultative, mais refuse une référence vide", () => {
    expect(createSessionSchema.safeParse({ date: "2026-06-15", time: "20:00", notifyUserIds: [], communityTeamId: "team-1" }).success).toBe(true);
    expect(createSessionSchema.safeParse({ date: "2026-06-15", time: "20:00", notifyUserIds: [], communityTeamId: "" }).success).toBe(false);
  });

  it("refuse une date ou une heure malformée", () => {
    expect(
      createSessionSchema.safeParse({ date: "invalide", time: "20:00", notifyUserIds: [] })
        .success
    ).toBe(false);
    expect(
      createSessionSchema.safeParse({ date: "2026-06-15", time: "invalide", notifyUserIds: [] })
        .success
    ).toBe(false);
  });
});

describe("weeklySlotSchema", () => {
  it("accepte un jour 0-6 et des horaires valides", () => {
    expect(
      weeklySlotSchema.safeParse({ dayOfWeek: 0, startTime: "21:00", endTime: "00:00" }).success
    ).toBe(true);
    expect(
      weeklySlotSchema.safeParse({ dayOfWeek: 6, startTime: "09:00", endTime: "12:00" }).success
    ).toBe(true);
  });

  it("refuse un jour hors 0-6", () => {
    expect(
      weeklySlotSchema.safeParse({ dayOfWeek: 7, startTime: "09:00", endTime: "12:00" }).success
    ).toBe(false);
    expect(
      weeklySlotSchema.safeParse({ dayOfWeek: -1, startTime: "09:00", endTime: "12:00" }).success
    ).toBe(false);
  });

  it("n'impose pas startTime < endTime (créneau traversant minuit supporté)", () => {
    // 21:00 → 00:00 : endTime <= startTime, valide (voir isAvailableAt).
    const result = weeklySlotSchema.safeParse({
      dayOfWeek: 5,
      startTime: "23:00",
      endTime: "02:00",
    });
    expect(result.success).toBe(true);
  });
});

describe("overrideSchema", () => {
  it("accepte une date avec horaires vides (journée entière)", () => {
    expect(
      overrideSchema.safeParse({ date: "2026-06-15", available: true, startTime: "", endTime: "" })
        .success
    ).toBe(true);
  });

  it("accepte une date avec horaires renseignés, y compris traversant minuit", () => {
    expect(
      overrideSchema.safeParse({
        date: "2026-06-15",
        available: true,
        startTime: "22:00",
        endTime: "01:00",
      }).success
    ).toBe(true);
  });

  it("refuse une date malformée", () => {
    expect(
      overrideSchema.safeParse({ date: "", available: true, startTime: "", endTime: "" }).success
    ).toBe(false);
  });
});

describe("userColorSchema / bannerUrlSchema", () => {
  it("userColorSchema n'accepte qu'un hex valide", () => {
    expect(userColorSchema.safeParse({ color: "#8b5cf6" }).success).toBe(true);
    expect(userColorSchema.safeParse({ color: "violet" }).success).toBe(false);
  });

  it("bannerUrlSchema accepte une URL https d'un hébergeur autorisé ou une chaîne vide (retour au défaut)", () => {
    expect(bannerUrlSchema.safeParse({ bannerUrl: "https://i.imgur.com/x.jpg" }).success).toBe(
      true
    );
    expect(bannerUrlSchema.safeParse({ bannerUrl: "https://exemple.com/x.jpg" }).success).toBe(
      false
    );
    expect(bannerUrlSchema.safeParse({ bannerUrl: "" }).success).toBe(true);
    expect(bannerUrlSchema.safeParse({ bannerUrl: "pas-une-url" }).success).toBe(false);
  });
});

describe("playerCountsSchema", () => {
  it("accepte min/max valides avec max >= min", () => {
    expect(playerCountsSchema.safeParse({ minPlayers: 2, maxPlayers: 4 }).success).toBe(true);
  });

  it("accepte maxPlayers null (non renseigné)", () => {
    expect(playerCountsSchema.safeParse({ minPlayers: 2, maxPlayers: null }).success).toBe(true);
  });

  it("refuse minPlayers hors 1-100", () => {
    expect(playerCountsSchema.safeParse({ minPlayers: 0, maxPlayers: null }).success).toBe(false);
    expect(playerCountsSchema.safeParse({ minPlayers: 101, maxPlayers: null }).success).toBe(
      false
    );
  });

  it("refuse maxPlayers < minPlayers", () => {
    expect(playerCountsSchema.safeParse({ minPlayers: 5, maxPlayers: 2 }).success).toBe(false);
  });
});

describe("addManualGameSchema", () => {
  it("accepte un nom non vide sans igdbId", () => {
    expect(addManualGameSchema.safeParse({ name: "Catan", igdbId: "" }).success).toBe(true);
  });

  it("accepte un igdbId numérique", () => {
    expect(addManualGameSchema.safeParse({ name: "Catan", igdbId: "12345" }).success).toBe(true);
  });

  it("refuse un nom vide", () => {
    expect(addManualGameSchema.safeParse({ name: "", igdbId: "" }).success).toBe(false);
    expect(addManualGameSchema.safeParse({ name: "   ", igdbId: "" }).success).toBe(false);
  });

  it("refuse un igdbId non numérique", () => {
    expect(addManualGameSchema.safeParse({ name: "Catan", igdbId: "abc" }).success).toBe(false);
  });
});
