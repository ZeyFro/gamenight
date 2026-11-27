import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

/**
 * C008 — les quatre grades emblématiques (Régulars, Irregular, Ranker, High Ranker) lus depuis la progression
 * réelle de plusieurs membres distincts, sur PostgreSQL. Le grade n'est jamais posé à la main dans le test :
 * seuls les étages crédités, les défis validés de la saison et l'attribution manuelle d'Irregular sont écrits.
 * Nécessite `TEST_DATABASE_URL` : suite SKIPPÉE sinon (aucun faux vert).
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
if (!url) console.warn("[tower-ranks.integration.test] TEST_DATABASE_URL absente : suite SKIPPÉE, grades NON validés sur SQL réel.");

describe.skipIf(!url)("C008 — grades emblématiques (PostgreSQL)", () => {
  let db: PrismaClient;
  let progress: typeof import("./tower-personal-progress");
  let irregular: typeof import("./tower-irregular");
  const scope = "c008-" + randomUUID();
  const communityId = scope + "-community";
  const id = (name: string) => scope + "-" + name;
  // 20 novembre 2026 : saison S3 · 2026 (1er septembre – 1er décembre).
  const now = new Date("2026-11-20T12:00:00Z");
  const seasonCreditAt = new Date("2026-11-10T12:00:00Z");
  const players = ["reader", "regular", "irregular", "ranker", "high"];
  let creditSequence = 0;

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as PrismaClient;
    progress = await import("./tower-personal-progress");
    irregular = await import("./tower-irregular");
  });
  async function cleanup() {
    await db.community.deleteMany({ where: { id: communityId } });
    await db.user.deleteMany({ where: { id: { startsWith: scope } } });
  }
  afterAll(async () => {
    if (db) { await cleanup(); await db.$disconnect(); }
    vi.unstubAllEnvs();
  });
  async function credit(name: string) {
    const assignedAt = new Date(seasonCreditAt.getTime() - 2 * 3600000);
    await db.towerChallengeAttempt.create({ data: {
      communityId, userId: id(name), definitionId: communityId + "-def", requestKey: scope + "-credit-" + creditSequence++,
      title: "Défi validé", instructions: "Consigne", rewardFloors: 1, status: "APPROVED",
      assignedAt, expiresAt: new Date(assignedAt.getTime() + 48 * 3600000), rewardedAt: seasonCreditAt,
    } });
  }
  const rankOf = async (member: string) => {
    const result = await progress.getTowerPersonalProgress({ viewerId: id("reader"), memberId: id(member), communityId }, now);
    if (result.status !== "PROGRESS") throw new Error("Progression attendue pour " + member);
    return result;
  };

  beforeEach(async () => {
    vi.stubEnv("TOWER_CHALLENGES_ENABLED", "true");
    vi.stubEnv("TOWER_IRREGULAR_GRANTS_ENABLED", "true");
    await cleanup();
    await db.community.create({ data: {
      id: communityId, name: communityId, slug: communityId, status: "ACTIVE",
      discordGuildId: scope + "-guild", towerChallengesEnabled: true,
    } });
    await db.user.createMany({ data: players.map(name => ({ id: id(name), discordId: id(name), discordName: name })) });
    await db.membership.createMany({ data: players.map(name => ({
      communityId, userId: id(name), status: "ACTIVE" as const, role: name === "reader" ? ("OWNER" as const) : ("MEMBER" as const),
    })) });
    await db.towerChallengeDefinition.create({ data: {
      id: communityId + "-def", communityId, title: "Défi", instructions: "Consigne", rewardFloors: 1, active: true,
    } });
    await db.towerChallengeProgress.createMany({ data: [
      { communityId, userId: id("reader"), floorsClimbed: BigInt(0) },
      { communityId, userId: id("regular"), floorsClimbed: BigInt(5) },
      { communityId, userId: id("irregular"), floorsClimbed: BigInt(0) },
      { communityId, userId: id("ranker"), floorsClimbed: BigInt(30) },
      { communityId, userId: id("high"), floorsClimbed: BigInt(100) },
    ] });
    // High Ranker : 100 étages ET 5 défis validés pendant la saison en cours.
    for (let index = 0; index < 5; index++) await credit("high");
    expect(await irregular.grantTowerIrregular(id("reader"), communityId, { userId: id("irregular") })).toBe("granted");
  });

  it("C008 — quatre membres distincts obtiennent Régulars, Irregular, Ranker et High Ranker depuis leur progression réelle", async () => {
    const regular = await rankOf("regular");
    expect(regular).toMatchObject({ rank: "Régulars", floorsClimbed: "5", seasonChallenges: 0 });
    const irregularRank = await rankOf("irregular");
    expect(irregularRank).toMatchObject({ rank: "Irregular", floorsClimbed: "0" });
    const ranker = await rankOf("ranker");
    expect(ranker).toMatchObject({ rank: "Ranker", floorsClimbed: "30", seasonChallenges: 0 });
    const high = await rankOf("high");
    expect(high).toMatchObject({ rank: "High Ranker", floorsClimbed: "100", seasonChallenges: 5 });
    expect(high.next).toBeNull();
    // Le lecteur lui-même (Régulars, 0 étage) ne prend pas le grade d'un autre membre.
    expect(await rankOf("reader")).toMatchObject({ rank: "Régulars", floorsClimbed: "0" });
  });

  it("C008 — un grade gagné prime sur l'Irregular, et la révocation rend le grade calculé", async () => {
    await db.towerChallengeProgress.update({ where: { communityId_userId: { communityId, userId: id("irregular") } }, data: { floorsClimbed: BigInt(30) } });
    expect(await rankOf("irregular")).toMatchObject({ rank: "Ranker" });
    expect(await irregular.revokeTowerIrregular(id("reader"), communityId, { userId: id("irregular") })).toBe("revoked");
    expect(await rankOf("irregular")).toMatchObject({ rank: "Ranker" });
    await db.towerChallengeProgress.update({ where: { communityId_userId: { communityId, userId: id("irregular") } }, data: { floorsClimbed: BigInt(5) } });
    expect(await rankOf("irregular")).toMatchObject({ rank: "Régulars" });
  });
});
