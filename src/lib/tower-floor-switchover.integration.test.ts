import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { levelForXp, rankForLevel } from "./xp";

/**
 * Cahier §22.2 « Bascule depuis les anciens étages » (décision §7.2 du 18/11) : un ancien membre garde son niveau,
 * son étage XP et son rang XP ; ses étages Tower et son grade Tower partent de zéro et ne se gagnent que par les défis.
 * Vérifié sur PostgreSQL réel : la lecture de la progression Tower ne modifie aucune donnée XP, et un défi validé
 * ajoute des étages Tower sans toucher à l'XP déjà acquise.
 */
const url = process.env.TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (!["postgres:", "postgresql:"].includes(target.protocol) || target.hostname !== "127.0.0.1" || target.searchParams.has("host")) {
    throw new Error("PostgreSQL loopback isolé requis");
  }
}
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: url ? new PrismaClient({ datasourceUrl: url }) : {} };
});

describe.skipIf(!url)("bascule depuis les anciens étages (§22.2)", () => {
  let db: PrismaClient;
  let progress: typeof import("./tower-personal-progress");
  const scope = "switchover-" + randomUUID();
  const communityId = scope + "-community";
  const id = (name: string) => scope + "-" + name;
  const veteranXp = 250_000;
  const now = new Date("2027-05-10T12:00:00Z");

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as PrismaClient;
    progress = await import("./tower-personal-progress");
  });
  async function cleanup() {
    await db.community.deleteMany({ where: { id: communityId } });
    await db.user.deleteMany({ where: { id: { startsWith: scope } } });
  }
  afterAll(async () => { if (db) { await cleanup(); await db.$disconnect(); } vi.unstubAllEnvs(); });
  beforeEach(async () => {
    vi.stubEnv("TOWER_CHALLENGES_ENABLED", "true");
    await cleanup();
    await db.community.create({ data: { id: communityId, name: communityId, slug: communityId, status: "ACTIVE", discordGuildId: scope, towerChallengesEnabled: true } });
    for (const name of ["veteran", "viewer"]) {
      await db.user.create({ data: { id: id(name), discordId: id(name), discordName: name, xpTotal: name === "veteran" ? veteranXp : 0, streakCount: 12 } });
      await db.membership.create({ data: { communityId, userId: id(name), status: "ACTIVE" } });
    }
    await db.communityMemberStats.create({ data: { communityId, userId: id("veteran"), xpTotal: veteranXp, xpBalance: 4_000, streakCount: 12 } });
    await db.towerChallengeDefinition.create({ data: { id: communityId + "-def", communityId, title: "Défi", instructions: "Consigne", rewardFloors: 3 } });
  });
  const xpSnapshot = async () => ({
    user: await db.user.findUniqueOrThrow({ where: { id: id("veteran") }, select: { xpTotal: true, streakCount: true } }),
    stats: await db.communityMemberStats.findUniqueOrThrow({ where: { communityId_userId: { communityId, userId: id("veteran") } }, select: { xpTotal: true, xpBalance: true, streakCount: true } }),
  });
  const read = () => progress.getTowerPersonalProgress({ viewerId: id("viewer"), memberId: id("veteran"), communityId }, now);

  it("un ancien membre garde niveau, étage XP et rang XP ; ses étages Tower partent de zéro (Régulars)", async () => {
    const before = await xpSnapshot();
    const level = levelForXp(before.stats.xpTotal);
    expect(level).toBeGreaterThan(1);
    expect(await read()).toMatchObject({ status: "PROGRESS", floorsClimbed: "0", seasonChallenges: 0, rank: "Régulars" });
    const after = await xpSnapshot();
    expect(after).toEqual(before);
    expect(levelForXp(after.stats.xpTotal)).toBe(level);
    expect(rankForLevel(levelForXp(after.stats.xpTotal))).toEqual(rankForLevel(level));
    expect(await db.towerChallengeProgress.count({ where: { communityId, userId: id("veteran") } })).toBe(0);
  });

  it("les étages Tower ne se gagnent que par les défis validés, sans changer l'XP acquise", async () => {
    const before = await xpSnapshot();
    await db.towerChallengeAttempt.create({ data: {
      communityId, userId: id("veteran"), definitionId: communityId + "-def", requestKey: "switchover-1", title: "Défi", instructions: "Consigne",
      rewardFloors: 3, status: "APPROVED", assignedAt: new Date("2027-05-01T10:00:00Z"), expiresAt: new Date("2027-05-03T10:00:00Z"), rewardedAt: new Date("2027-05-02T10:00:00Z"),
    } });
    await db.towerChallengeProgress.create({ data: { communityId, userId: id("veteran"), floorsClimbed: BigInt(3) } });
    expect(await read()).toMatchObject({ floorsClimbed: "3", seasonChallenges: 1, rank: "Régulars", next: { rank: "Ranker", floorsMissing: "27" } });
    expect(await xpSnapshot()).toEqual(before);
  });
});
