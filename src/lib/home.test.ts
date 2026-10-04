import { beforeEach, describe, expect, it, vi } from "vitest";

const { prisma, getCalendarData } = vi.hoisted(() => ({
  prisma: {
    groupSessionStats: { findUnique: vi.fn() },
    groupGameStat: { findFirst: vi.fn() },
    user: { findFirst: vi.fn(), count: vi.fn() },
    gameNews: { findMany: vi.fn() },
  },
  getCalendarData: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma }));
vi.mock("@/lib/calendar", () => ({ getCalendarData }));
vi.mock("@/lib/session-access", () => ({ accessibleSessionWhere: vi.fn() }));

import { getGroupStats, getRecentGameNews, getWeekAvailability } from "./home";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getGroupStats", () => {
  it("valeurs par défaut sans donnée", async () => {
    prisma.groupSessionStats.findUnique.mockResolvedValue(null);
    prisma.groupGameStat.findFirst.mockResolvedValue(null);
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.user.count.mockResolvedValue(0);
    expect(await getGroupStats()).toEqual({
      totalSessionsPlayed: 0,
      mostPlayedGame: null,
      bestActiveStreak: null,
      activePlayers: 0,
    });
  });

  it("agrège les compteurs durables, le meilleur streak actif et les joueurs actifs", async () => {
    prisma.groupSessionStats.findUnique.mockResolvedValue({ totalSessionsPlayed: 12 });
    prisma.groupGameStat.findFirst.mockResolvedValue({
      playCount: 4,
      game: { name: "Mario Kart", coverUrl: "https://img/mk.jpg" },
    });
    prisma.user.findFirst.mockResolvedValue({ discordName: "Zoé", streakCount: 7 });
    prisma.user.count.mockResolvedValue(5);

    expect(await getGroupStats()).toEqual({
      totalSessionsPlayed: 12,
      mostPlayedGame: { name: "Mario Kart", coverUrl: "https://img/mk.jpg", count: 4 },
      bestActiveStreak: { discordName: "Zoé", streakCount: 7 },
      activePlayers: 5,
    });
  });

  it("n'utilise jamais les lignes Session (compteurs durables uniquement)", async () => {
    prisma.groupSessionStats.findUnique.mockResolvedValue(null);
    prisma.groupGameStat.findFirst.mockResolvedValue(null);
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.user.count.mockResolvedValue(0);
    await getGroupStats();
    expect(prisma.groupSessionStats.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "global" } })
    );
  });

  it("fenêtres temporelles : streak actif 24 h, joueur actif 7 jours", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-05T12:00:00.000Z"));
    prisma.groupSessionStats.findUnique.mockResolvedValue(null);
    prisma.groupGameStat.findFirst.mockResolvedValue(null);
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.user.count.mockResolvedValue(0);
    try {
      await getGroupStats();
    } finally {
      vi.useRealTimers();
    }
    const streakWhere = prisma.user.findFirst.mock.calls[0][0].where;
    expect(streakWhere.streakCount).toEqual({ gt: 0 });
    expect(streakWhere.streakLastActiveAt.gte).toEqual(new Date("2026-10-04T12:00:00.000Z"));
    const activeWhere = prisma.user.count.mock.calls[0][0].where;
    expect(activeWhere.streakLastActiveAt.gte).toEqual(new Date("2026-09-28T12:00:00.000Z"));
  });
});

describe("getRecentGameNews", () => {
  it("transforme les lignes du cache avec la limite par défaut de 5", async () => {
    const publishedAt = new Date("2026-10-01T00:00:00Z");
    prisma.gameNews.findMany.mockResolvedValue([
      { id: "n1", title: "Patch 1.2", url: "https://x/1", publishedAt, game: { name: "Dota", coverUrl: null } },
    ]);
    expect(await getRecentGameNews()).toEqual([
      { id: "n1", gameName: "Dota", gameCoverUrl: null, title: "Patch 1.2", url: "https://x/1", publishedAt },
    ]);
    expect(prisma.gameNews.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { publishedAt: "desc" }, take: 5 })
    );
  });

  it("respecte une limite explicite", async () => {
    prisma.gameNews.findMany.mockResolvedValue([]);
    await getRecentGameNews(2);
    expect(prisma.gameNews.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 2 }));
  });
});

describe("getWeekAvailability", () => {
  const day = (iso: string, availableUserIds: string[]) => ({
    date: new Date(`${iso}T00:00:00.000Z`),
    hours: [
      { hour: 19, availableUserIds: ["x", "y", "z"] },
      { hour: 20, availableUserIds },
    ],
  });

  it("lit les dispos de 20 h, compte les potes et marque le meilleur jour", async () => {
    getCalendarData.mockResolvedValue({
      users: [{ id: "a" }, { id: "b" }, { id: "c" }],
      days: [day("2026-10-05", ["a"]), day("2026-10-06", ["a", "b"]), day("2026-10-07", [])],
    });
    const result = await getWeekAvailability("viewer");

    expect(result.map((d) => d.availableCount)).toEqual([1, 2, 0]);
    expect(result.every((d) => d.totalUsers === 3)).toBe(true);
    expect(result.map((d) => d.isBest)).toEqual([false, true, false]);
    expect(result[1].href).toContain("2026-10-06");
    expect(getCalendarData).toHaveBeenCalledWith(expect.any(Date), expect.any(Date), "viewer");
  });

  it("égalité : le premier jour est le meilleur ; personne de dispo : aucun meilleur", async () => {
    getCalendarData.mockResolvedValue({
      users: [{ id: "a" }],
      days: [day("2026-10-05", ["a"]), day("2026-10-06", ["a"])],
    });
    expect((await getWeekAvailability("v")).map((d) => d.isBest)).toEqual([true, false]);

    getCalendarData.mockResolvedValue({
      users: [{ id: "a" }],
      days: [day("2026-10-05", []), day("2026-10-06", [])],
    });
    expect((await getWeekAvailability("v")).some((d) => d.isBest)).toBe(false);
  });

  it("jour sans créneau de 20 h : 0 dispo", async () => {
    getCalendarData.mockResolvedValue({
      users: [{ id: "a" }],
      days: [{ date: new Date("2026-10-05T00:00:00.000Z"), hours: [] }],
    });
    expect((await getWeekAvailability("v"))[0].availableCount).toBe(0);
  });
});
