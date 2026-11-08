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

describe.skipIf(!url)("podium saisonnier, crédits réels et accès communautaire", () => {
  let db: PrismaClient;
  let podium: typeof import("./tower-season-podium");
  const scope = "podium-" + randomUUID();
  const communityId = scope + "-community";
  const otherId = scope + "-other";
  const players = ["reader", "first", "second", "third", "fourth", "removed", "outsider"];
  const id = (name: string) => scope + "-" + name;
  const current = new Date("2027-07-01T12:00:00Z");
  let sequence = 0;
  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as PrismaClient;
    podium = await import("./tower-season-podium");
  });
  afterAll(async () => {
    if (db) {
      await db.community.deleteMany({ where: { id: { in: [communityId, otherId] } } });
      await db.game.deleteMany({ where: { id: id("game") } });
      await db.user.deleteMany({ where: { id: { in: players.map(id) } } });
      await db.$disconnect();
    }
    vi.unstubAllEnvs();
  });
  beforeEach(async () => {
    vi.stubEnv("TOWER_CHALLENGES_ENABLED", "true");
    await db.community.deleteMany({ where: { id: { in: [communityId, otherId] } } });
    await db.game.deleteMany({ where: { id: id("game") } });
    await db.user.deleteMany({ where: { id: { in: players.map(id) } } });
    await db.user.createMany({ data: players.map((name, index) => ({ id: id(name), discordId: scope + index, discordName: name })) });
    await db.community.createMany({ data: [communityId, otherId].map((id, index) => ({ id, name: id, slug: id, status: "ACTIVE" as const, discordGuildId: scope + index, towerChallengesEnabled: true })) });
    await db.membership.createMany({ data: players.map(name => ({ communityId: name === "outsider" ? otherId : communityId, userId: id(name), status: name === "removed" ? "REMOVED" as const : "ACTIVE" as const })) });
    await db.towerChallengeDefinition.createMany({ data: [communityId, otherId].map(communityId => ({ id: communityId + "-def", communityId, title: "Défi", instructions: "Consigne", rewardFloors: 1 })) });
  });
  async function credit(name: string, floors: number, when: string, status: "APPROVED" | "REJECTED" = "APPROVED") {
    const target = name === "outsider" ? otherId : communityId;
    return db.towerChallengeAttempt.create({ data: { communityId: target, userId: id(name), definitionId: target + "-def", requestKey: "credit-" + sequence++, title: "Défi", instructions: "Consigne", rewardFloors: floors, status, assignedAt: new Date("2027-04-01T10:00:00Z"), expiresAt: new Date("2027-04-03T10:00:00Z"), rewardedAt: status === "APPROVED" ? new Date(when) : null } });
  }
  const read = () => podium.getTowerSeasonPodium({ communityId, userId: id("reader") }, current);

  it("départage les crédits solo et équipe, limite à trois et ne compte pas une participation non créditée", async () => {
    await credit("first", 3, "2027-04-02T10:00:00Z");
    await credit("second", 3, "2027-04-02T10:00:00Z");
    await credit("third", 3, "2027-04-01T10:00:00Z");
    await credit("third", 2, "2027-04-01T11:00:00Z");
    await credit("third", 1, "2027-04-01T12:00:00Z");
    await credit("fourth", 3, "2027-04-01T10:00:00Z");
    await credit("fourth", 2, "2027-04-01T10:00:00Z");
    await db.game.create({ data: { id: id("game"), name: "Jeu", source: "MANUAL", addedById: id("reader") } });
    const team = await db.communityTeam.create({ data: { communityId, gameId: id("game"), createdById: id("reader"), name: "Équipe", description: "Équipe locale", platform: "PC", maxMembers: 4 } });
    const attempt = await credit("reader", 3, "2027-04-03T10:00:00Z");
    await db.towerChallengeAttempt.update({ where: { id: attempt.id }, data: { teamId: team.id } });
    await db.towerChallengeAttemptParticipant.createMany({ data: [
      { communityId, attemptId: attempt.id, userId: id("first"), rewardedAt: new Date("2027-04-04T10:00:00Z") },
      { communityId, attemptId: attempt.id, userId: id("second"), rewardedAt: new Date("2027-04-05T10:00:00Z") },
      { communityId, attemptId: attempt.id, userId: id("reader"), rewardedAt: null },
    ] });
    const result = await read();
    expect(result.status).toBe("PODIUM");
    if (result.status !== "PODIUM") throw new Error("Podium attendu");
    expect(result.entries.map(row => [row.displayName, row.rewardFloors, row.difficultWins])).toEqual([["first", "6", "2"], ["second", "6", "2"], ["third", "6", "1"]]);
  });
  it("respecte les bornes Paris et exclut refus, membres retirés et autre communauté", async () => {
    await credit("first", 3, "2027-03-31T22:00:00Z"); // Début S2 inclus.
    await credit("second", 3, "2027-03-31T21:59:59.999Z");
    await credit("second", 3, "2027-06-30T22:00:00Z"); // Fin S2 exclue.
    await credit("second", 3, "2027-04-02T10:00:00Z", "REJECTED");
    await credit("removed", 3, "2027-04-02T10:00:00Z");
    await credit("outsider", 3, "2027-04-02T10:00:00Z");
    const result = await read();
    expect(result.status).toBe("PODIUM");
    if (result.status !== "PODIUM") throw new Error("Podium attendu");
    expect(result.entries.map(row => row.displayName)).toEqual(["first"]);
    await db.towerChallengeDefinition.update({ where: { id: communityId + "-def" }, data: { rewardFloors: 1 } });
    expect((await read())).toEqual(result);
  });
  it("ne présente aucun faux gagnant pour une saison sans crédit", async () => {
    expect(await read()).toMatchObject({ status: "PODIUM", entries: [] });
  });
  it("ne crédite pas l'auteur d'un défi équipe avant sa récompense personnelle, ni deux fois ensuite", async () => {
    await db.game.create({ data: { id: id("game"), name: "Jeu", source: "MANUAL", addedById: id("reader") } });
    const team = await db.communityTeam.create({ data: { communityId, gameId: id("game"), createdById: id("reader"), name: "Équipe", description: "Équipe locale", platform: "PC", maxMembers: 4 } });
    const attempt = await credit("reader", 3, "2027-04-03T10:00:00Z");
    await db.towerChallengeAttempt.update({ where: { id: attempt.id }, data: { teamId: team.id } });
    await db.towerChallengeAttemptParticipant.create({ data: { communityId, attemptId: attempt.id, userId: id("reader") } });
    expect(await read()).toMatchObject({ status: "PODIUM", entries: [] });
    await db.towerChallengeAttemptParticipant.update({ where: { attemptId_userId: { attemptId: attempt.id, userId: id("reader") } }, data: { rewardedAt: new Date("2027-04-04T10:00:00Z") } });
    expect(await read()).toMatchObject({ status: "PODIUM", entries: [{ displayName: "reader", rewardFloors: "3" }] });
  });
  it("refuse aussi le lecteur retiré ou une communauté suspendue", async () => {
    await db.membership.update({ where: { communityId_userId: { communityId, userId: id("reader") } }, data: { status: "REMOVED" } });
    expect(await read()).toEqual({ status: "UNAVAILABLE" });
    await db.membership.update({ where: { communityId_userId: { communityId, userId: id("reader") } }, data: { status: "ACTIVE" } });
    await db.community.update({ where: { id: communityId }, data: { status: "SUSPENDED" } });
    expect(await read()).toEqual({ status: "UNAVAILABLE" });
  });
  it("refuse un non-membre même isolation OFF et vérifie les drapeaux", async () => {
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "false");
    expect(await podium.getTowerSeasonPodium({ communityId, userId: id("outsider") }, current)).toEqual({ status: "UNAVAILABLE" });
    await db.community.update({ where: { id: communityId }, data: { towerChallengesEnabled: false } });
    expect(await read()).toEqual({ status: "UNAVAILABLE" });
    vi.stubEnv("TOWER_CHALLENGES_ENABLED", "false");
    expect(await read()).toEqual({ status: "DISABLED" });
  });
});
