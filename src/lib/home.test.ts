import { beforeEach, describe, expect, it, vi } from "vitest";

const { prisma, scopedDb, getCalendarData } = vi.hoisted(() => ({
  prisma: {
    game: { findUnique: vi.fn() },
    user: { findFirst: vi.fn(), count: vi.fn() },
    gameNews: { findMany: vi.fn() },
  },
  // PR9 : compteurs de groupe lus via le client scopé (communauté active).
  scopedDb: {
    groupSessionStats: { aggregate: vi.fn() },
    session: { count: vi.fn() },
    groupGameStat: { groupBy: vi.fn(), aggregate: vi.fn(), findMany: vi.fn() },
    communityMemberStats: { findFirst: vi.fn(), count: vi.fn() },
  },
  getCalendarData: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma }));
vi.mock("@/lib/calendar", () => ({ getCalendarData }));
vi.mock("@/lib/session-access", () => ({ accessibleSessionWhere: vi.fn() }));
vi.mock("@/lib/community-scoped-client", () => ({ getActiveScopedPrisma: vi.fn(async () => scopedDb) }));
vi.mock("@/lib/community-stats", () => ({ writeCommunityIdForUser: vi.fn(async () => "community") }));
vi.mock("@/lib/community-isolation", () => ({
  creationMemberUserWhere: vi.fn(async () => ({})),
  memberUserWhereFor: vi.fn(async () => ({})),
}));

import { getGroupStats, getRecentGameNews, getWeekAvailability } from "./home";

beforeEach(() => {
  vi.clearAllMocks();
});

const emptyStats = () => {
  prisma.user.count.mockResolvedValue(9); // membres actifs du serveur (toi compris)
  scopedDb.groupSessionStats.aggregate.mockResolvedValue({ _sum: { totalSessionsPlayed: null } });
  scopedDb.session.count.mockResolvedValue(0);
  scopedDb.groupGameStat.groupBy.mockResolvedValue([]);
  scopedDb.groupGameStat.aggregate.mockResolvedValue({ _sum: { totalPlayMinutes: null } });
  scopedDb.groupGameStat.findMany.mockResolvedValue([]);
  scopedDb.communityMemberStats.findFirst.mockResolvedValue(null);
  scopedDb.communityMemberStats.count.mockResolvedValue(0);
};

describe("getGroupStats", () => {
  it("valeurs par défaut sans donnée", async () => {
    emptyStats();
    expect(await getGroupStats("viewer")).toEqual({
      totalSessionsPlayed: 0,
      mostPlayedGame: null,
      totalPlayMinutes: 0,
      gamePlayTimes: [],
      bestActiveStreak: null,
      activePlayers: 0,
      members: 9,
    });
  });

  it("agrège les compteurs durables, le meilleur streak actif et les joueurs actifs", async () => {
    scopedDb.groupSessionStats.aggregate.mockResolvedValue({ _sum: { totalSessionsPlayed: 12 } });
    scopedDb.groupGameStat.groupBy.mockResolvedValue([{ gameId: "g1", _sum: { playCount: 4 } }]);
    scopedDb.groupGameStat.aggregate.mockResolvedValue({ _sum: { totalPlayMinutes: 180 } });
    scopedDb.groupGameStat.findMany.mockResolvedValue([{ gameId: "g1", totalPlayMinutes: 180, game: { name: "Mario Kart" } }]);
    prisma.game.findUnique.mockResolvedValue({ name: "Mario Kart", coverUrl: "https://img/mk.jpg" });
    scopedDb.communityMemberStats.findFirst.mockResolvedValue({ user: { discordName: "Zoé" }, streakCount: 7 });
    scopedDb.communityMemberStats.count.mockResolvedValue(5);

    expect(await getGroupStats("viewer")).toEqual({
      totalSessionsPlayed: 12,
      mostPlayedGame: { name: "Mario Kart", coverUrl: "https://img/mk.jpg", count: 4 },
      totalPlayMinutes: 180,
      gamePlayTimes: [{ gameId: "g1", name: "Mario Kart", playedMinutes: 180 }],
      bestActiveStreak: { discordName: "Zoé", streakCount: 7 },
      activePlayers: 5,
      members: 9,
    });
    expect(prisma.game.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "g1" } }));
  });

  it("les soirées terminées encore présentes ne servent que de minimum au compteur durable (le plus grand l'emporte, jamais une addition)", async () => {
    emptyStats();
    scopedDb.groupSessionStats.aggregate.mockResolvedValue({ _sum: { totalSessionsPlayed: 5 } });
    scopedDb.session.count.mockResolvedValue(28);
    expect((await getGroupStats("viewer")).totalSessionsPlayed).toBe(28);
    scopedDb.session.count.mockResolvedValue(3);
    expect((await getGroupStats("viewer")).totalSessionsPlayed).toBe(5);
    expect(scopedDb.session.count).toHaveBeenCalledWith({ where: { status: "DONE" } });
  });

  it("lit les compteurs durables de la communauté affichée", async () => {
    emptyStats();
    await getGroupStats("viewer");
    expect(scopedDb.groupSessionStats.aggregate).toHaveBeenCalledWith({ where: { communityId: { in: ["community"] } }, _sum: { totalSessionsPlayed: true } });
    expect(scopedDb.groupGameStat.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ by: ["gameId"], orderBy: { _sum: { playCount: "desc" } }, take: 1 })
    );
  });

  it("jamais « 0 soirée jouée » à côté d'un jeu joué 8 fois, ni plus de joueurs actifs que de membres", async () => {
    emptyStats();
    scopedDb.groupSessionStats.aggregate.mockResolvedValue({ _sum: { totalSessionsPlayed: 0 } });
    scopedDb.groupGameStat.groupBy.mockResolvedValue([{ gameId: "g1", _sum: { playCount: 8 } }]);
    prisma.game.findUnique.mockResolvedValue({ name: "Deadlock", coverUrl: null });
    scopedDb.communityMemberStats.count.mockResolvedValue(12);
    const stats = await getGroupStats("viewer");
    expect(stats.totalSessionsPlayed).toBe(8);
    expect(stats.mostPlayedGame?.count).toBe(8);
    expect(stats.activePlayers).toBe(9);
    expect(stats.members).toBe(9);
  });

  it("fenêtres temporelles : streak actif 24 h, joueur actif 7 jours", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-05T12:00:00.000Z"));
    emptyStats();
    try {
      await getGroupStats("viewer");
    } finally {
      vi.useRealTimers();
    }
    const streakWhere = scopedDb.communityMemberStats.findFirst.mock.calls[0][0].where;
    expect(streakWhere.communityId).toEqual({ in: ["community"] });
    expect(streakWhere.streakCount).toEqual({ gt: 0 });
    expect(streakWhere.streakLastActiveAt.gte).toEqual(new Date("2026-10-04T12:00:00.000Z"));
    const activeWhere = scopedDb.communityMemberStats.count.mock.calls[0][0].where;
    expect(activeWhere.streakLastActiveAt.gte).toEqual(new Date("2026-09-28T12:00:00.000Z"));
  });
});

describe("getRecentGameNews", () => {
  const publishedAt = new Date("2026-10-01T00:00:00Z");
  const row = (id: string, title: string) => ({ id, title, url: "https://x/" + id, publishedAt, game: { name: "Dota", coverUrl: null } });

  it("transforme les lignes du cache (titre français) et lit assez de candidats pour filtrer", async () => {
    prisma.gameNews.findMany.mockResolvedValue([row("n1", "Mise à jour 1.2 : les nouveautés de la saison")]);
    expect(await getRecentGameNews()).toEqual([
      { id: "n1", gameName: "Dota", gameCoverUrl: null, title: "Mise à jour 1.2 : les nouveautés de la saison", url: "https://x/n1", publishedAt },
    ]);
    expect(prisma.gameNews.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { publishedAt: "desc" }, take: 60 }));
  });

  it("masque l'anglais et le russe, ne garde que le français", async () => {
    prisma.gameNews.findMany.mockResolvedValue([
      row("en", "Patch Notes 1.2"),
      row("ru", "Обновление 1.2: новые карты"),
      row("fr", "Le patch de l'été arrive demain"),
      row("en2", "Summer Sale is live now"),
    ]);
    expect((await getRecentGameNews()).map(item => item.id)).toEqual(["fr"]);
  });

  it("respecte une limite explicite sur les actualités françaises", async () => {
    prisma.gameNews.findMany.mockResolvedValue([
      row("a", "Nouvelle extension disponible dès aujourd'hui"), row("b", "Le correctif de la saison est disponible"), row("c", "Découvrez notre nouveau mode de jeu"),
    ]);
    expect((await getRecentGameNews(2)).map(item => item.id)).toEqual(["a", "b"]);
  });

  it("aucune actualité française : liste vide (la card n'est pas affichée)", async () => {
    prisma.gameNews.findMany.mockResolvedValue([row("en", "Patch Notes 1.2"), row("ru", "Новости игры")]);
    expect(await getRecentGameNews()).toEqual([]);
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
