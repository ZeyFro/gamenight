import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID, randomInt } from "node:crypto";
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
  let list: typeof import("./tower-challenges").getTowerChallengeAppealableAttempts;
  const prefix = "appeal-notice-" + randomUUID();
  const guildId = "8" + Date.now() + randomInt(1000, 9999);
  const communityId = prefix + "-community";
  const userId = prefix + "-author";
  const attemptId = prefix + "-attempt";
  const rejectedAt = new Date("2027-04-01T12:00:00Z");
  async function cleanup() {
    await db.notificationEvent.deleteMany({ where: { communityId } });
    await db.$executeRaw`DELETE FROM "TowerChallengeAppeal" WHERE "communityId" = ${communityId}`;
    await db.community.deleteMany({ where: { id: communityId } });
    await db.user.deleteMany({ where: { id: userId } });
  }
  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as PrismaClient;
    submit = (await import("./tower-challenges")).submitTowerChallengeAppeal;
    list = (await import("./tower-challenges")).getTowerChallengeAppealableAttempts;
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
    await db.community.create({ data: { id: communityId, slug: communityId, name: "Recette annonce", status: "ACTIVE", towerChallengesEnabled: true, discordGuildId: guildId } });
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
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
  async function pendingNotice() {
    const event = await db.notificationEvent.create({ data: { communityId, sourceId: attemptId, category: "ACHIEVEMENT", eventType: "TOWER_CHALLENGE_REJECTED", createdAt: rejectedAt } });
    return db.notificationDelivery.create({ data: { eventId: event.id, channel: "DISCORD_CHANNEL", transport: "BOT", operation: "SEND", status: "PENDING", recipientKey: "123456789012345678", targetSlot: guildId + ":TOWER:" + attemptId + ":rejection" } });
  }

  it("ne déclare pas expirées les 24 heures d'un auteur auquel le résultat n'a jamais été annoncé", async () => {
    expect(await db.notificationEvent.count({ where: { communityId, sourceId: attemptId } })).toBe(0);
    const [existing] = await db.$queryRaw<{ count: bigint }[]>`SELECT COUNT(*)::bigint AS count FROM "TowerChallengeAppeal" WHERE "communityId" = ${communityId} AND "attemptId" = ${attemptId}`;
    expect(existing.count).toBe(BigInt(0));
    const result = await submit({ communityId, userId, attemptId, reason: "Le résultat ne m’a jamais été annoncé." });
    expect(result.status, "les préconditions d'accès et de saisie sont valides").not.toMatch(/INVALID|UNAVAILABLE|DISABLED/);
    // Ne choisit pas une nouvelle API d'attente : vérifie seulement qu'un délai non commencé n'est pas expiré.
    expect(result.status).not.toBe("WINDOW_CLOSED");
  });
  it("attend la livraison effective puis ouvre 24 heures, même si l'enqueue est ancien", async () => {
    const delivery = await pendingNotice();
    const actor = { communityId, userId, attemptId, reason: "Demande de réexamen." };
    expect(await submit(actor)).toMatchObject({ status: "AWAITING_ANNOUNCEMENT" });
    expect(await list({ communityId, userId })).toMatchObject({ attempts: [] });
    const sentAt = new Date(Date.now());
    await db.notificationDelivery.update({ where: { id: delivery.id }, data: { status: "SENT", sentAt, discordMessageId: "223456789012345678", discordChannelId: "123456789012345678" } });
    expect(await list({ communityId, userId })).toMatchObject({ attempts: [{ id: attemptId, announcedAt: sentAt }] });
    expect(await submit(actor)).toMatchObject({ status: "APPEAL_SUBMITTED" });
    const [appeal] = await db.$queryRaw<{ dueAt: Date }[]>`SELECT "dueAt" FROM "TowerChallengeAppeal" WHERE "communityId" = ${communityId} AND "attemptId" = ${attemptId}`;
    expect(appeal.dueAt).toEqual(new Date(sentAt.getTime() + 24 * 3600_000));
  });
  it("ferme à 24 heures exactes après la première livraison réussie", async () => {
    const delivery = await pendingNotice();
    const sentAt = new Date(Date.now());
    await db.notificationDelivery.update({ where: { id: delivery.id }, data: { status: "SENT", sentAt, discordMessageId: "223456789012345678", discordChannelId: "123456789012345678" } });
    vi.spyOn(Date, "now").mockReturnValue(sentAt.getTime() + 24 * 3600_000);
    expect(await submit({ communityId, userId, attemptId, reason: "Limite exacte." })).toMatchObject({ status: "WINDOW_CLOSED" });
    expect(await list({ communityId, userId })).toMatchObject({ attempts: [] });
  });
  it("ne réinitialise pas la fenêtre lorsqu'une seconde livraison réussit", async () => {
    const delivery = await pendingNotice();
    const firstSentAt = new Date(Date.now() - 24 * 3600_000);
    await db.notificationDelivery.update({ where: { id: delivery.id }, data: { status: "SENT", sentAt: firstSentAt, discordMessageId: "223456789012345678", discordChannelId: "123456789012345678" } });
    await db.notificationDelivery.create({ data: { eventId: delivery.eventId, channel: "DISCORD_CHANNEL", transport: "BOT", operation: "SEND", status: "SENT", sentAt: new Date(Date.now()), recipientKey: "323456789012345678", discordChannelId: "323456789012345678", discordMessageId: "423456789012345678", targetSlot: guildId + ":TOWER:" + attemptId + ":rejection" } });
    expect(await submit({ communityId, userId, attemptId, reason: "La relance ne crée pas de nouveau délai." })).toMatchObject({ status: "WINDOW_CLOSED" });
  });
});
