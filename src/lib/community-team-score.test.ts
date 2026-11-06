import { describe, expect, it } from "vitest";
import { rankCommunityTeamMembersByXp } from "./community-teams";

describe("rankCommunityTeamMembersByXp", () => {
  it("sums current member XP and sorts ties deterministically", () => {
    const result = rankCommunityTeamMembersByXp([
      { userId: "b", discordName: "B", xpTotal: 120 },
      { userId: "a", discordName: "A", xpTotal: 120 },
      { userId: "c", discordName: "C", xpTotal: 45 },
    ]);

    expect(result).toEqual({
      totalXp: 285,
      members: [
        { userId: "a", discordName: "A", xpTotal: 120 },
        { userId: "b", discordName: "B", xpTotal: 120 },
        { userId: "c", discordName: "C", xpTotal: 45 },
      ],
    });
  });
});
