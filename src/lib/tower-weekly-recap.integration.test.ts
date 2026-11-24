import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

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

describe.skipIf(!url)("récapitulatif hebdomadaire Tower (§10.3) : 7 jours, joueurs actifs", () => {
  let db: PrismaClient;
  let recapModule: typeof import("./tower-weekly-recap");
  const scope = "weekly-" + randomUUID();
  const communityId = scope + "-community";
  const otherId = scope + "-other";
  const players = ["reader", "p1", "p2", "p3", "gone", "outsider"];
  const id = (name: string) => scope + "-" + name;
  const current = new Date("2027-05-15T12:00:00Z");
  let sequence = 0;

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as PrismaClient;
    recapModule = await import("./tower-weekly-recap");
  });
  async function clean() {
    await db.community.deleteMany({ where: { id: { in: [communityId, otherId] } } });
    await db.user.deleteMany({ where: { id: { in: players.map(id) } } });
  }
  afterAll(async () => {
    if (db) { await clean(); await db.$disconnect(); }
    vi.unstubAllEnvs();
  });
  beforeEach(async () => {
    vi.stubEnv("TOWER_CHALLENGES_ENABLED", "true");
    await clean();
    await db.user.createMany({ data: players.map((name, index) => ({ id: id(name), discordId: scope + index, discordName: name })) });
    await db.community.createMany({ data: [communityId, otherId].map((cid, index) => ({ id: cid, name: cid, slug: cid, status: "ACTIVE" as const, discordGuildId: scope + index, towerChallengesEnabled: true })) });
    await db.membership.createMany({ data: players.map(name => ({ communityId: name === "outsider" ? otherId : communityId, userId: id(name), status: name === "gone" ? "LEFT" as const : "ACTIVE" as const })) });
    await db.towerChallengeDefinition.create({ data: { id: communityId + "-def", communityId, title: "Défi", instructions: "Consigne", rewardFloors: 2 } });
  });
  async function win(user: string, floors: number, when: string, status: "APPROVED" | "REJECTED" = "APPROVED") {
    await db.towerChallengeAttempt.create({ data: {
      communityId, userId: id(user), definitionId: communityId + "-def", requestKey: "w-" + sequence++,
      title: "Défi", instructions: "Consigne", rewardFloors: floors, status,
      assignedAt: new Date("2027-05-01T10:00:00Z"), expiresAt: new Date("2027-05-03T10:00:00Z"),
      rewardedAt: status === "APPROVED" ? new Date(when) : null,
    } });
  }
  const read = (userId = id("reader")) => recapModule.getTowerWeeklyRecap({ communityId, userId }, current);

  it("ne compte que les 7 derniers jours, les membres actifs et les défis validés, et classe par réussites puis étages", async () => {
    await win("p1", 1, "2027-05-14T10:00:00Z");
    await win("p1", 3, "2027-05-13T10:00:00Z");
    await win("p2", 3, "2027-05-12T10:00:00Z");
    await win("p3", 2, "2027-05-01T10:00:00Z"); // trop ancien
    await win("p2", 3, "2027-05-11T10:00:00Z", "REJECTED"); // refusé
    await win("gone", 3, "2027-05-10T10:00:00Z"); // membre parti
    const result = await read();
    if (result.status !== "RECAP") throw new Error("Récapitulatif attendu");
    expect(result.recap.activePlayers.map(p => [p.displayName, p.wins, p.floors])).toEqual([["p1", 2, 4], ["p2", 1, 3]]);
    expect(result.recap.totalWins).toBe(3);
    expect(result.recap.totalFloors).toBe(7);
  });

  it("refuse un lecteur d'une autre communauté et un identifiant invalide, et ne met en avant que 5 joueurs au plus", async () => {
    expect((await read(id("outsider"))).status).toBe("UNAVAILABLE");
    expect((await recapModule.getTowerWeeklyRecap({ communityId: "" }, current)).status).toBe("INVALID");
    expect(recapModule.TOWER_WEEKLY_RECAP_TOP).toBe(5);
  });

  it("flag éteint : aucune lecture", async () => {
    vi.stubEnv("TOWER_CHALLENGES_ENABLED", "false");
    expect((await read()).status).toBe("DISABLED");
  });
});
