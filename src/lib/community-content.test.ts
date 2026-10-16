import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ activeDb: vi.fn(), findMany: vi.fn() }));
vi.mock("@/lib/community-scoped-client", () => ({ getActiveScopedPrisma: mocks.activeDb }));

import { getCommunityQuizGames } from "./community-content";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.activeDb.mockResolvedValue({ groupGameStat: { findMany: mocks.findMany } });
});

describe("getCommunityQuizGames", () => {
  it("loads only played games from the viewer's active scoped client", async () => {
    mocks.findMany.mockResolvedValue([{ game: { name: "Game", coverUrl: null, igdbDetails: null } }]);
    await expect(getCommunityQuizGames("viewer")).resolves.toEqual([{ name: "Game", coverUrl: null, details: null }]);
    expect(mocks.activeDb).toHaveBeenCalledWith("viewer");
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { playCount: { gt: 0 } },
      take: 100,
      select: { game: { select: { name: true, coverUrl: true, igdbDetails: true } } },
    }));
  });
});
