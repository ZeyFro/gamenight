import { beforeEach, describe, expect, it, vi } from "vitest";

const queryRaw = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({ prisma: { $queryRaw: queryRaw } }));

import { consumePlayerClassifiedPing, playerClassifiedPingDay, PLAYER_CLASSIFIED_DAILY_PINGS } from "./player-classified-pings";

describe("ping de rôle des annonces joueurs", () => {
  beforeEach(() => queryRaw.mockReset());

  it("compte par jour de Paris, pas en UTC", () => {
    // 23 h 30 UTC = 00 h 30 à Paris le lendemain (hiver, UTC+1).
    expect(playerClassifiedPingDay(new Date("2026-11-26T23:30:00Z"))).toEqual(new Date("2026-11-27T00:00:00Z"));
    expect(playerClassifiedPingDay(new Date("2026-11-26T22:59:00Z"))).toEqual(new Date("2026-11-26T00:00:00Z"));
    // Été (UTC+2) : la bascule se fait à 22 h UTC.
    expect(playerClassifiedPingDay(new Date("2026-07-01T21:59:00Z"))).toEqual(new Date("2026-07-01T00:00:00Z"));
    expect(playerClassifiedPingDay(new Date("2026-07-01T22:00:00Z"))).toEqual(new Date("2026-07-02T00:00:00Z"));
  });

  it("refuse au-delà du plafond (aucune ligne retournée par l'upsert conditionnel)", async () => {
    queryRaw.mockResolvedValue([]);
    expect(await consumePlayerClassifiedPing({ communityId: "c1", userId: "u1" })).toBe(false);
    expect(PLAYER_CLASSIFIED_DAILY_PINGS).toBe(3);
    const [query] = queryRaw.mock.calls[0];
    expect(String(query)).toContain("ON CONFLICT");
    expect(String(query)).toContain("count");
  });

  it("autorise tant que le plafond n'est pas atteint", async () => {
    queryRaw.mockResolvedValue([{ count: 2 }]);
    expect(await consumePlayerClassifiedPing({ communityId: "c1", userId: "u1" })).toBe(true);
  });

});
