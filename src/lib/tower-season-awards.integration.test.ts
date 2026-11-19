import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

/**
 * Titres et cadres saisonniers sur PostgreSQL réel : attribution automatique au podium de la dernière saison
 * terminée, idempotence, ex æquo, retard sur contestation ouverte, isolation. Nécessite `TEST_DATABASE_URL` :
 * suite SKIPPÉE sinon.
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
if (!url) console.warn("[tower-season-awards.integration.test] TEST_DATABASE_URL absente : suite SKIPPÉE, distinctions saisonnières NON validées sur SQL réel.");

describe.skipIf(!url)("distinctions saisonnières Tower (PostgreSQL)", () => {
  let db: PrismaClient;
  let lib: typeof import("./tower-season-awards");
  const scope = "awards-" + randomUUID();
  const communityId = scope + "-c";
  const otherId = scope + "-o";
  const id = (name: string) => scope + "-" + name;
  // Été 2027 en cours : la dernière saison terminée est S2 2027 (1er avril – 1er juillet), valable jusqu'à fin de l'été.
  const now = new Date("2027-07-10T12:00:00Z");
  const expiry = new Date("2027-08-31T22:00:00Z");
  const HOUR = 3600000;
  let sequence = 0;

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as PrismaClient;
    lib = await import("./tower-season-awards");
  });
  async function cleanup() {
    // `TowerChallengeAppeal` référence la communauté et sa tentative en `NoAction` : la
    // supprimer explicitement avant la communauté, sinon le nettoyage casse dès qu'un
    // scénario a créé une contestation.
    await db.towerChallengeAppeal.deleteMany({ where: { communityId: { in: [communityId, otherId] } } });
    await db.community.deleteMany({ where: { id: { in: [communityId, otherId] } } });
    await db.user.deleteMany({ where: { id: { startsWith: scope } } });
  }
  afterAll(async () => {
    if (db) { await cleanup(); await db.$disconnect(); }
    vi.unstubAllEnvs();
  });
  async function credit(name: string, floors: number, when: string, community = communityId) {
    const assignedAt = new Date(new Date(when).getTime() - 2 * HOUR);
    return db.towerChallengeAttempt.create({
      data: {
        communityId: community, userId: id(name), definitionId: community + "-def", requestKey: "credit-" + sequence++, title: "Défi", instructions: "Consigne",
        rewardFloors: floors, status: "APPROVED", assignedAt, expiresAt: new Date(assignedAt.getTime() + 48 * HOUR), rewardedAt: new Date(when),
      },
    });
  }
  const awards = () => db.towerSeasonAward.findMany({ where: { communityId }, orderBy: [{ place: "asc" }, { userId: "asc" }] });

  beforeEach(async () => {
    vi.stubEnv("TOWER_CHALLENGES_ENABLED", "true");
    vi.stubEnv("TOWER_SEASON_AWARDS_ENABLED", "true");
    await cleanup();
    await db.community.createMany({
      data: [communityId, otherId].map((target, index) => ({
        id: target, name: target, slug: target, status: "ACTIVE" as const, discordGuildId: scope + "-g" + index, towerChallengesEnabled: true,
      })),
    });
    const names = ["first", "second", "third", "fourth", "left", "outsider"];
    await db.user.createMany({ data: names.map(name => ({ id: id(name), discordId: id(name), discordName: name })) });
    await db.membership.createMany({
      data: names.map(name => ({ communityId: name === "outsider" ? otherId : communityId, userId: id(name), status: name === "left" ? "LEFT" as const : "ACTIVE" as const })),
    });
    await db.towerChallengeDefinition.createMany({ data: [communityId, otherId].map(target => ({ id: target + "-def", communityId: target, title: "Défi", instructions: "Consigne", rewardFloors: 1 })) });
    await credit("first", 3, "2027-04-10T10:00:00Z");
    await credit("first", 3, "2027-04-11T10:00:00Z");
    await credit("second", 3, "2027-05-10T10:00:00Z");
    await credit("second", 1, "2027-05-11T10:00:00Z");
    await credit("third", 3, "2027-06-10T10:00:00Z");
    await credit("fourth", 1, "2027-06-11T10:00:00Z");
    await credit("left", 3, "2027-06-12T10:00:00Z");
    await credit("outsider", 3, "2027-06-12T10:00:00Z", otherId);
  });

  it("est inactif sans le drapeau", async () => {
    vi.stubEnv("TOWER_SEASON_AWARDS_ENABLED", "false");
    expect(await lib.awardTowerSeasonTitles(now)).toEqual({ communities: 0, awarded: 0, delayed: 0, failed: 0 });
    expect(await db.towerSeasonAward.count()).toBe(0);
  });

  it("attribue le podium de la dernière saison terminée, valable jusqu'à la fin de la saison suivante", async () => {
    const summary = await lib.awardTowerSeasonTitles(now);
    expect(summary).toMatchObject({ failed: 0, delayed: 0 });
    const rows = await awards();
    expect(rows.map(row => [row.userId, row.place])).toEqual([[id("first"), 1], [id("second"), 2], [id("third"), 3]]);
    for (const row of rows) {
      expect(row.seasonName).toBe("S2 · 2027");
      expect(row.expiresAt.getTime()).toBe(expiry.getTime());
    }
    // Ni le 4e, ni un ancien membre, ni un joueur d'une autre communauté.
    expect(await db.towerSeasonAward.count({ where: { userId: { in: [id("fourth"), id("left")] } } })).toBe(0);
    expect(await db.towerSeasonAward.count({ where: { communityId: otherId } })).toBe(1);
  });

  it("est rejouable sans doublon et ne modifie pas une attribution existante", async () => {
    await lib.awardTowerSeasonTitles(now);
    const before = await awards();
    const again = await lib.awardTowerSeasonTitles(new Date(now.getTime() + 24 * HOUR));
    expect(again.awarded).toBe(0);
    const after = await awards();
    expect(after).toHaveLength(3);
    expect(after.map(row => row.awardedAt.getTime())).toEqual(before.map(row => row.awardedAt.getTime()));
  });

  it("deux exécutions simultanées ne créent chacune qu'une ligne par joueur et par saison", async () => {
    await Promise.all([lib.awardTowerSeasonTitles(now), lib.awardTowerSeasonTitles(now)]);
    expect(await awards()).toHaveLength(3);
  });

  it("donne la même place aux ex æquo stricts, sans en écarter", async () => {
    await db.towerChallengeAttempt.deleteMany({ where: { communityId } });
    await credit("first", 3, "2027-04-10T10:00:00Z");
    await credit("second", 3, "2027-04-10T10:00:00Z");
    await credit("third", 1, "2027-04-11T10:00:00Z");
    await lib.awardTowerSeasonTitles(now);
    expect((await awards()).map(row => [row.userId, row.place])).toEqual([[id("first"), 1], [id("second"), 1], [id("third"), 3]]);
  });

  it("retarde la communauté tant qu'une contestation est ouverte sur la saison", async () => {
    const attempt = await credit("fourth", 1, "2027-06-20T10:00:00Z");
    await db.towerChallengeAppeal.create({
      data: { communityId, attemptId: attempt.id, authorUserId: id("fourth"), reason: "Contestation", dueAt: new Date(now.getTime() + 24 * HOUR), status: "OPEN" },
    });
    const summary = await lib.awardTowerSeasonTitles(now);
    expect(summary.delayed).toBe(1);
    expect(await awards()).toHaveLength(0);
    expect(await db.towerSeasonAward.count({ where: { communityId: otherId } })).toBe(1);
    await db.towerChallengeAppeal.updateMany({ where: { communityId }, data: { status: "UPHELD" } });
    await lib.awardTowerSeasonTitles(now);
    expect(await awards()).toHaveLength(3);
  });

  it("n'attribue rien sans crédit pendant la saison, et n'écrit aucun XP ni notification", async () => {
    await db.towerChallengeAttempt.deleteMany({ where: { communityId } });
    await lib.awardTowerSeasonTitles(now);
    expect(await awards()).toHaveLength(0);
    expect(await db.xpEvent.count({ where: { communityId } })).toBe(0);
    expect(await db.notificationEvent.count({ where: { communityId } })).toBe(0);
  });

  it("expose les distinctions valables à un autre membre de la communauté, jamais d'une autre communauté", async () => {
    await lib.awardTowerSeasonTitles(now);
    const shown = await lib.getTowerSeasonAwardsForProfile(id("second"), id("first"), now);
    expect(shown.map(award => award.title)).toEqual(["Champion · S2 · 2027"]);
    expect(await lib.getTowerSeasonAwardsForProfile(id("outsider"), id("first"), now)).toEqual([]);
    // Après la fin de la saison suivante, la distinction n'est plus valable.
    expect(await lib.getTowerSeasonAwardsForProfile(id("second"), id("first"), new Date("2027-09-01T00:00:00Z"))).toEqual([]);
  });
});
