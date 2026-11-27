import { beforeEach, describe, expect, it, vi } from "vitest";

const tx = vi.hoisted(() => ({ $queryRaw: vi.fn(), $executeRaw: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: async (work: (client: typeof tx) => unknown) => work(tx) } }));

import { consumePlayerClassifiedPing, playerClassifiedPingDay, PLAYER_CLASSIFIED_DAILY_PINGS } from "./player-classified-pings";

describe("ping de rôle des annonces joueurs", () => {
  beforeEach(() => { tx.$queryRaw.mockReset(); tx.$executeRaw.mockReset(); });

  it("compte par jour de Paris, pas en UTC", () => {
    // 23 h 30 UTC = 00 h 30 à Paris le lendemain (hiver, UTC+1).
    expect(playerClassifiedPingDay(new Date("2026-11-26T23:30:00Z"))).toEqual(new Date("2026-11-27T00:00:00Z"));
    expect(playerClassifiedPingDay(new Date("2026-11-26T22:59:00Z"))).toEqual(new Date("2026-11-26T00:00:00Z"));
    // Été (UTC+2) : la bascule se fait à 22 h UTC.
    expect(playerClassifiedPingDay(new Date("2026-07-01T21:59:00Z"))).toEqual(new Date("2026-07-01T00:00:00Z"));
    expect(playerClassifiedPingDay(new Date("2026-07-01T22:00:00Z"))).toEqual(new Date("2026-07-02T00:00:00Z"));
  });

  it("refuse au-delà du plafond PAR JOUEUR (somme du jour, toutes communautés) sans rien écrire", async () => {
    tx.$queryRaw.mockResolvedValue([{ total: 3 }]);
    expect(await consumePlayerClassifiedPing({ communityId: "c1", userId: "u1" })).toBe(false);
    expect(PLAYER_CLASSIFIED_DAILY_PINGS).toBe(3);
    expect(String(tx.$queryRaw.mock.calls[0][0])).toContain("SUM");
    // verrou advisory (1er appel) mais aucune écriture du compteur
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(String(tx.$executeRaw.mock.calls[0][0])).toContain("pg_advisory_xact_lock");
  });

  it("autorise tant que la somme du jour est sous le plafond, puis incrémente le compteur de la communauté", async () => {
    tx.$queryRaw.mockResolvedValue([{ total: 2 }]);
    expect(await consumePlayerClassifiedPing({ communityId: "c1", userId: "u1" })).toBe(true);
    expect(String(tx.$executeRaw.mock.calls[1][0])).toContain("ON CONFLICT");
  });

  it("base indisponible : aucun ping (jamais un blocage du relais)", async () => {
    tx.$queryRaw.mockRejectedValue(new Error("table absente"));
    expect(await consumePlayerClassifiedPing({ communityId: "c1", userId: "u1" })).toBe(false);
  });

});
