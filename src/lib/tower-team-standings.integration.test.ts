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

describe.skipIf(!url)("classement des équipes (§14.3) : défis d'équipe validés, saison et depuis toujours", () => {
  let db: PrismaClient;
  let standings: typeof import("./tower-team-standings");
  const scope = "teamrank-" + randomUUID();
  const communityId = scope + "-community";
  const otherId = scope + "-other";
  const players = ["reader", "a1", "a2", "b1", "c1", "gone", "outsider"];
  const id = (name: string) => scope + "-" + name;
  // S2 · 2027 : du 1er avril au 1er juillet 2027 (heure de Paris).
  const current = new Date("2027-05-15T12:00:00Z");
  let sequence = 0;

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as PrismaClient;
    standings = await import("./tower-team-standings");
  });
  async function clean() {
    await db.community.deleteMany({ where: { id: { in: [communityId, otherId] } } });
    await db.game.deleteMany({ where: { id: id("game") } });
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
    await db.community.createMany({ data: [communityId, otherId].map((cid, index) => ({ id: cid, name: cid, slug: cid, status: "ACTIVE" as const, discordGuildId: scope + index, towerChallengesEnabled: true, communityTeamsEnabled: true })) });
    await db.membership.createMany({ data: players.map(name => ({ communityId: name === "outsider" ? otherId : communityId, userId: id(name), status: name === "gone" ? "LEFT" as const : "ACTIVE" as const })) });
    await db.game.create({ data: { id: id("game"), name: "Jeu " + scope, source: "MANUAL", addedById: id("reader") } });
    await db.towerChallengeDefinition.create({ data: { id: communityId + "-def", communityId, title: "Défi", instructions: "Consigne", rewardFloors: 2 } });
    const team = async (key: string, name: string, color: string | null, members: string[]) => {
      await db.communityTeam.create({ data: {
        id: id(key), communityId, gameId: id("game"), createdById: id(members[0]), captainId: id(members[0]), name, description: "Équipe de test.", platform: "PC", maxMembers: 4, color, emblem: color ? "🐉" : null,
      } });
      await db.communityTeamMember.createMany({ data: members.map(member => ({ communityId, teamId: id(key), userId: id(member) })) });
    };
    await team("alpha", "Alpha", "#ff0000", ["a1", "a2"]);
    await team("bravo", "Bravo", null, ["b1"]);
    await team("ghost", "Fantômes", null, ["gone"]);
  });
  async function teamWin(teamKey: string, members: string[], floors: number, when: string, status: "APPROVED" | "REJECTED" = "APPROVED") {
    const attempt = await db.towerChallengeAttempt.create({ data: {
      communityId, userId: id(members[0]), teamId: id(teamKey), definitionId: communityId + "-def", requestKey: "team-" + sequence++,
      title: "Défi", instructions: "Consigne", rewardFloors: floors, status,
      assignedAt: new Date("2027-01-01T10:00:00Z"), expiresAt: new Date("2027-01-03T10:00:00Z"),
      rewardedAt: status === "APPROVED" && when ? new Date(when) : null,
    } });
    await db.towerChallengeAttemptParticipant.createMany({ data: members.map((member, index) => ({
      communityId, attemptId: attempt.id, userId: id(member),
      // Chaque participant est crédité : le défi ne compte qu'une fois pour l'équipe.
      rewardedAt: status === "APPROVED" && when ? new Date(new Date(when).getTime() + index * 3600_000) : null,
    })) });
  }
  const read = (userId = id("reader")) => standings.getTowerTeamStandings({ communityId, userId }, current);

  it("compte chaque défi d'équipe validé une fois, sépare la saison du total et ignore refusés et équipes sans membre actif", async () => {
    await teamWin("alpha", ["a1", "a2"], 3, "2027-04-10T10:00:00Z");
    await teamWin("alpha", ["a1", "a2"], 2, "2027-02-10T10:00:00Z");
    await teamWin("bravo", ["b1"], 3, "2027-04-05T10:00:00Z");
    await teamWin("bravo", ["b1"], 3, "2027-04-06T10:00:00Z", "REJECTED");
    await teamWin("ghost", ["gone"], 3, "2027-04-07T10:00:00Z");
    const result = await read();
    if (result.status !== "STANDINGS") throw new Error("Classement attendu");
    expect(result.season.name).toBe("S2 · 2027");
    // Égalité d'étages et de défis : Bravo, arrivée la première à ce total, passe devant.
    expect(result.seasonTeams.map(team => [team.name, team.rank, team.floors, team.wins, team.exAequo])).toEqual([
      ["Bravo", 1, 3, 1, false], ["Alpha", 2, 3, 1, false],
    ]);
    expect(result.allTimeTeams.map(team => team.name)).toEqual(["Alpha", "Bravo"]);
  });

  it("ordre complet depuis toujours, couleur et emblème transmis", async () => {
    await teamWin("alpha", ["a1", "a2"], 3, "2027-04-10T10:00:00Z");
    await teamWin("alpha", ["a1", "a2"], 2, "2027-02-10T10:00:00Z");
    await teamWin("bravo", ["b1"], 3, "2027-04-05T10:00:00Z");
    const result = await read();
    if (result.status !== "STANDINGS") throw new Error("Classement attendu");
    expect(result.allTimeTeams.map(team => [team.name, team.rank, team.floors, team.wins])).toEqual([["Alpha", 1, 5, 2], ["Bravo", 2, 3, 1]]);
    expect(result.allTimeTeams[0]).toMatchObject({ color: "#ff0000", emblem: "🐉" });
  });

  it("refuse un lecteur hors communauté ou parti, et l'interrupteur éteint", async () => {
    await expect(read(id("outsider"))).resolves.toEqual({ status: "UNAVAILABLE" });
    await expect(read(id("gone"))).resolves.toEqual({ status: "UNAVAILABLE" });
    vi.stubEnv("TOWER_CHALLENGES_ENABLED", "false");
    await expect(read()).resolves.toEqual({ status: "DISABLED" });
  });
});
