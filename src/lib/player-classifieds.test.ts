import { describe, expect, it } from "vitest";
import { playerClassifiedExpiresAt, playerClassifiedSchema } from "./player-classifieds-rules";

describe("player classifieds", () => {
  it("accepts a game and trims a short message", () => {
    expect(playerClassifiedSchema.safeParse({ gameId: "game-1", message: "  Il nous manque un joueur.  " })).toMatchObject({
      success: true,
      data: { gameId: "game-1", message: "Il nous manque un joueur." },
    });
  });

  it("rejects an empty game or a message over 240 characters", () => {
    expect(playerClassifiedSchema.safeParse({ gameId: "", message: "ok" }).success).toBe(false);
    expect(playerClassifiedSchema.safeParse({ gameId: "game-1", message: "x".repeat(241) }).success).toBe(false);
  });

  it("expires after 24 hours", () => {
    const createdAt = new Date("2026-10-17T10:00:00.000Z");
    expect(playerClassifiedExpiresAt(createdAt).toISOString()).toBe("2026-10-18T10:00:00.000Z");
  });
});
