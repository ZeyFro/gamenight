import { describe, expect, it } from "vitest";
import { communityTeamSchema } from "./community-teams-rules";

describe("communityTeamSchema", () => {
  it("normalizes project fields and accepts a bounded roster", () => {
    expect(communityTeamSchema.parse({
      gameId: "game-1",
      name: "  Expedition Valheim  ",
      description: "  Construire une base durable  ",
      platform: "  PC  ",
      maxMembers: "6",
    })).toEqual({
      gameId: "game-1",
      name: "Expedition Valheim",
      description: "Construire une base durable",
      platform: "PC",
      maxMembers: 6,
    });
  });

  it.each(["0", "1", "21", "abc"]) ("rejects unsafe roster size %s", (maxMembers) => {
    expect(communityTeamSchema.safeParse({
      gameId: "game-1", name: "Team", description: "Projet", platform: "PC", maxMembers,
    }).success).toBe(false);
  });
});
