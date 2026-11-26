import { beforeEach, describe, expect, it, vi } from "vitest";

const queryRaw = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({ prisma: { $queryRaw: queryRaw } }));

import { consumePlayerClassifiedPing, playerClassifiedPingDay, PLAYER_CLASSIFIED_DAILY_PINGS } from "./player-classified-pings";

describe("ping de rôle des annonces joueurs", () => {
  beforeEach(() => queryRaw.mockReset());

  it("compte par jour UTC", () => {
    expect(playerClassifiedPingDay(new Date("2026-11-26T23:30:00Z"))).toEqual(new Date("2026-11-26T00:00:00Z"));
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
