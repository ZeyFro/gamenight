import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

const url = process.env.TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (!["postgres:", "postgresql:"].includes(target.protocol) || target.hostname !== "127.0.0.1" || [...target.searchParams.keys()].some(key => key.toLowerCase() === "host")) {
    throw new Error("PostgreSQL loopback isolé requis");
  }
}
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: url ? new PrismaClient({ datasourceUrl: url }) : {} };
});

describe.skipIf(!url)("#407 — début du délai après annonce effective", () => {
  let db: PrismaClient;
  let submit: typeof import("./tower-challenges").submitTowerChallengeAppeal;
  const prefix = "appeal-notice-" + randomUUID();
  const communityId = prefix + "-community";
  const userId = prefix + "-author";
  const attemptId = prefix + "-attempt";
  const rejectedAt = new Date("2027-04-01T12:00:00Z");
  async function cleanup() {
    await db.community.deleteMany({ where: { id: communityId } });
    await db.user.deleteMany({ where: { id: userId } });
  }
  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as PrismaClient;
    submit = (await import("./tower-challenges")).submitTowerChallengeAppeal;
    const [schema] = await db.$queryRaw<{ ready: boolean }[]>`SELECT to_regclass('public."TowerChallengeAppeal"') IS NOT NULL AS ready`;
    expect(schema.ready, "le schéma local doit inclure la dépendance #406").toBe(true);
  });
  beforeEach(async () => {
    await cleanup();
    vi.stubEnv("TOWER_CHALLENGES_ENABLED", "true");
    vi.stubEnv("TOWER_DISCORD_ANNOUNCE_ENABLED", "false");
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "false");
    vi.spyOn(Date, "now").mockReturnValue(rejectedAt.getTime() + 25 * 3600_000);
    await db.user.create({ data: { id: userId, discordId: userId, discordName: "Auteur local" } });
    await db.community.create({ data: { id: communityId, slug: communityId, name: "Recette annonce", status: "ACTIVE", towerChallengesEnabled: true } });
    await db.membership.create({ data: { communityId, userId, status: "ACTIVE" } });
    const definition = await db.towerChallengeDefinition.create({ data: { communityId, title: "Défi", instructions: "Preuve locale", rewardFloors: 1 } });
    await db.towerChallengeAttempt.create({ data: {
      id: attemptId, communityId, userId, definitionId: definition.id, requestKey: "notice-regression", title: "Défi", instructions: "Preuve locale", rewardFloors: 1,
      status: "REJECTED", assignedAt: new Date(rejectedAt.getTime() - 26 * 3600_000), submittedAt: new Date(rejectedAt.getTime() - 24 * 3600_000),
      expiresAt: new Date(rejectedAt.getTime() + 22 * 3600_000), proofText: "Preuve fictive",
      proofChannelId: "123456789012345678", proofMessageId: "223456789012345678", rewardedAt: null,
    } });
    await db.$executeRaw`UPDATE "TowerChallengeAttempt" SET "rejectedAt" = ${rejectedAt} WHERE id = ${attemptId} AND "communityId" = ${communityId}`;
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    if (db) { await cleanup(); await db.$disconnect(); }
  });

  it("ne déclare pas expirées les 24 heures d'un auteur auquel le résultat n'a jamais été annoncé", async () => {
    expect(await db.notificationEvent.count({ where: { communityId, sourceId: attemptId } })).toBe(0);
    const [existing] = await db.$queryRaw<{ count: bigint }[]>`SELECT COUNT(*)::bigint AS count FROM "TowerChallengeAppeal" WHERE "communityId" = ${communityId} AND "attemptId" = ${attemptId}`;
    expect(existing.count).toBe(BigInt(0));
    const result = await submit({ communityId, userId, attemptId, reason: "Le résultat ne m’a jamais été annoncé." });
    expect(result.status, "les préconditions d'accès et de saisie sont valides").not.toMatch(/INVALID|UNAVAILABLE|DISABLED/);
    // Ne choisit pas une nouvelle API d'attente : vérifie seulement qu'un délai non commencé n'est pas expiré.
    expect(result.status).not.toBe("WINDOW_CLOSED");
  });
});
