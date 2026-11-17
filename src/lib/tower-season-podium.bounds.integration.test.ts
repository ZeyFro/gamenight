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

// Complète tower-season-podium.integration.test.ts : bornes de saison à 00:00 Europe/Paris
// (changements d'heure, fin exclusive à la milliseconde, été), isolation par communauté,
// membres non ACTIVE et chaîne de départage complète.
describe.skipIf(!url)("podium saisonnier : bornes, isolation et départage (requête SQL réelle)", () => {
  let db: PrismaClient;
  let podium: typeof import("./tower-season-podium");
  const scope = "podgap-" + randomUUID();
  const communityId = scope + "-community";
  const otherId = scope + "-other";
  const gameId = scope + "-game";
  let sequence = 0;
  let discordSequence = 0;
  const created: string[] = [];
  const id = (name: string) => scope + "-" + name;
  const iso = (value: string) => new Date(value);

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as PrismaClient;
    podium = await import("./tower-season-podium");
  });
  async function cleanup() {
    await db.community.deleteMany({ where: { id: { in: [communityId, otherId] } } });
    await db.game.deleteMany({ where: { id: gameId } });
    await db.user.deleteMany({ where: { id: { startsWith: scope } } });
  }
  afterAll(async () => {
    if (db) {
      await cleanup();
      await db.$disconnect();
    }
    vi.unstubAllEnvs();
  });
  beforeEach(async () => {
    vi.stubEnv("TOWER_CHALLENGES_ENABLED", "true");
    await cleanup();
    created.length = 0;
    await db.community.createMany({
      data: [communityId, otherId].map((communityId, index) => ({
        id: communityId, name: communityId, slug: communityId, status: "ACTIVE" as const,
        discordGuildId: scope + "-guild-" + index, towerChallengesEnabled: true,
      })),
    });
    await db.towerChallengeDefinition.createMany({
      data: [communityId, otherId].map(target => ({ id: target + "-def", communityId: target, title: "Défi", instructions: "Consigne", rewardFloors: 1 })),
    });
    await db.game.create({ data: { id: gameId, name: "Jeu", source: "MANUAL", addedById: await player("reader") } });
  });

  /** Crée (une fois) un joueur ; `status` null = aucune adhésion dans communityId. */
  async function player(name: string, status: "ACTIVE" | "LEFT" | "REMOVED" | null = "ACTIVE", extraCommunityIds: string[] = []) {
    const userId = id(name);
    if (!created.includes(name)) {
      created.push(name);
      await db.user.create({ data: { id: userId, discordId: scope + "-d" + discordSequence++, discordName: name } });
      if (status) await db.membership.create({ data: { communityId, userId, status } });
      for (const target of extraCommunityIds) await db.membership.create({ data: { communityId: target, userId, status: "ACTIVE" } });
    }
    return userId;
  }
  async function solo(name: string, floors: number, when: string, target = communityId) {
    return db.towerChallengeAttempt.create({
      data: {
        communityId: target, userId: id(name), definitionId: target + "-def", requestKey: "k-" + sequence++, title: "Défi",
        instructions: "Consigne", rewardFloors: floors, status: "APPROVED",
        assignedAt: iso("2026-01-01T10:00:00Z"), expiresAt: iso("2026-01-03T10:00:00Z"), rewardedAt: iso(when),
      },
    });
  }
  /** Défi d'équipe approuvé : l'auteur n'est crédité que si un participant porte son nom. */
  async function team(target: string, author: string, floors: number, participants: { name: string; rewardedAt: string | null }[]) {
    const teamRow = await db.communityTeam.create({
      data: { communityId: target, gameId, createdById: id(author), name: "Équipe " + sequence++, description: "Équipe locale", platform: "PC", maxMembers: 4 },
    });
    const attempt = await db.towerChallengeAttempt.create({
      data: {
        communityId: target, userId: id(author), teamId: teamRow.id, definitionId: target + "-def", requestKey: "k-" + sequence++,
        title: "Défi", instructions: "Consigne", rewardFloors: floors, status: "APPROVED",
        assignedAt: iso("2026-01-01T10:00:00Z"), expiresAt: iso("2026-01-03T10:00:00Z"), rewardedAt: iso("2026-01-02T10:00:00Z"),
      },
    });
    await db.towerChallengeAttemptParticipant.createMany({
      data: participants.map(item => ({ communityId: target, attemptId: attempt.id, userId: id(item.name), rewardedAt: item.rewardedAt ? iso(item.rewardedAt) : null })),
    });
    return attempt;
  }
  async function read(current: string, reader = "reader", target = communityId) {
    const result = await podium.getTowerSeasonPodium({ communityId: target, userId: id(reader) }, iso(current));
    if (result.status !== "PODIUM") throw new Error("Podium attendu, reçu " + result.status);
    return result;
  }
  const names = (result: Awaited<ReturnType<typeof read>>) => result.entries.map(entry => entry.displayName);

  describe("bornes à 00:00 Europe/Paris, fin exclusive à la milliseconde", () => {
    it.each([
      { label: "S4 2026 (septembre–décembre, début en heure d'été, fin au 1er janvier)", current: "2027-02-01T12:00:00Z", season: "S4 · 2026",
        included: ["2026-08-31T22:00:00.000Z", "2026-12-31T22:59:59.999Z"],
        excluded: ["2026-08-31T21:59:59.999Z", "2026-12-31T23:00:00.000Z", "2027-01-02T12:00:00.000Z"] },
      { label: "S4 2026 vu pendant l'intersaison du 1er au 3 janvier", current: "2027-01-02T12:00:00Z", season: "S4 · 2026",
        included: ["2026-12-31T22:59:59.999Z"], excluded: ["2026-12-31T23:00:00.000Z", "2027-01-02T11:00:00.000Z"] },
      { label: "S1 2026 : le 29 mars 2026 est le jour du changement d'heure", current: "2026-05-01T12:00:00Z", season: "S1 · 2026",
        included: ["2026-01-03T23:00:00.000Z", "2026-03-28T22:59:59.999Z"],
        excluded: ["2026-01-03T22:59:59.999Z", "2026-03-28T23:00:00.000Z", "2026-03-30T12:00:00.000Z"] },
      { label: "S1 2027 : le changement d'heure du 28 mars précède la fin exclusive", current: "2027-04-10T12:00:00Z", season: "S1 · 2027",
        included: ["2027-01-03T23:00:00.000Z", "2027-03-28T21:59:59.999Z"],
        excluded: ["2027-01-03T22:59:59.999Z", "2027-03-28T22:00:00.000Z", "2027-03-28T22:30:00.000Z", "2027-03-30T12:00:00.000Z"] },
      { label: "S1 2027 vu pile à sa fin exclusive (la date de lecture elle-même est hors saison)", current: "2027-03-28T22:00:00Z", season: "S1 · 2027",
        included: ["2027-03-28T21:59:59.999Z"], excluded: ["2027-03-28T22:00:00.000Z"] },
      { label: "S2 2027 (avril–juin)", current: "2027-07-05T12:00:00Z", season: "S2 · 2027",
        included: ["2027-03-31T22:00:00.000Z", "2027-06-30T21:59:59.999Z"],
        excluded: ["2027-03-31T21:59:59.999Z", "2027-06-30T22:00:00.000Z"] },
      { label: "Été 2027 (juillet–août) est une saison à part entière", current: "2027-09-15T12:00:00Z", season: "Été · 2027",
        included: ["2027-06-30T22:00:00.000Z", "2027-08-31T21:59:59.999Z"],
        excluded: ["2027-06-30T21:59:59.999Z", "2027-08-31T22:00:00.000Z", "2027-09-10T12:00:00.000Z"] },
    ])("$label", async ({ current, season, included, excluded }) => {
      const expected: string[] = [];
      for (const [index, when] of included.entries()) {
        const name = "in" + index;
        await player(name);
        await solo(name, 1, when);
        expected.push(name);
      }
      for (const [index, when] of excluded.entries()) {
        const name = "out" + index;
        await player(name);
        await solo(name, 3, when); // 3 étages : s'il passait, il serait premier
      }
      await player("reader");
      const result = await read(current);
      expect(result.season.name).toBe(season);
      expect(result.season.active).toBe(false);
      // Mêmes étages, aucun défi à trois étages : l'ordre est celui de l'arrivée.
      expect(names(result)).toEqual(expected);
    });

    it("ne présente jamais la saison en cours : S1 est encore en cours une milliseconde avant sa fin", async () => {
      await player("reader");
      await player("old");
      await player("live");
      await solo("old", 1, "2026-12-31T22:59:59.999Z");
      await solo("live", 3, "2027-03-10T12:00:00.000Z");
      const result = await read("2027-03-28T21:59:59.999Z");
      expect(result.season.name).toBe("S4 · 2026");
      expect(names(result)).toEqual(["old"]);
    });

    it("le crédit d'une participation d'équipe obéit aux mêmes bornes (rewardedAt du participant, pas celui de la tentative)", async () => {
      await player("reader");
      await player("early");
      await player("late");
      await player("inside");
      // rewardedAt de la tentative (2026-01-02) est hors saison ; seul celui du participant compte.
      await team(communityId, "reader", 2, [
        { name: "early", rewardedAt: "2027-03-31T21:59:59.999Z" },
        { name: "inside", rewardedAt: "2027-03-31T22:00:00.000Z" },
        { name: "late", rewardedAt: "2027-06-30T22:00:00.000Z" },
      ]);
      const result = await read("2027-07-05T12:00:00Z");
      expect(result.season.name).toBe("S2 · 2027");
      expect(result.entries.map(entry => [entry.displayName, entry.rewardFloors])).toEqual([["inside", "2"]]);
    });
  });

  describe("membres non ACTIVE et isolation par communauté", () => {
    const current = "2027-07-05T12:00:00Z";
    const when = "2027-05-10T10:00:00.000Z";

    it("exclut les membres LEFT et REMOVED, en solo comme en équipe, et ne les compte pas dans les rangs", async () => {
      await player("reader");
      await player("active");
      await player("left", "LEFT");
      await player("removed", "REMOVED");
      await player("never", null);
      await solo("left", 3, when);
      await solo("removed", 3, when);
      await solo("never", 3, when);
      await team(communityId, "reader", 3, [
        { name: "left", rewardedAt: when }, { name: "removed", rewardedAt: when },
        { name: "never", rewardedAt: when }, { name: "active", rewardedAt: when },
      ]);
      const result = await read(current);
      expect(result.entries.map(entry => [entry.rank, entry.displayName, entry.rewardFloors])).toEqual([[1, "active", "3"]]);
    });

    it("un membre qui revient (LEFT -> ACTIVE) retrouve ses crédits de la saison, lus à la volée", async () => {
      await player("reader");
      await player("back", "LEFT");
      await solo("back", 2, when);
      expect(names(await read(current))).toEqual([]);
      await db.membership.update({ where: { communityId_userId: { communityId, userId: id("back") } }, data: { status: "ACTIVE" } });
      expect(names(await read(current))).toEqual(["back"]);
    });

    it("ne mélange pas les communautés pour un joueur membre des deux, solo et équipe", async () => {
      await player("reader");
      await player("dual", "ACTIVE", [otherId]);
      await player("onlyHere");
      await solo("dual", 1, when);
      await solo("dual", 3, when, otherId);
      await team(otherId, "dual", 3, [{ name: "dual", rewardedAt: when }]);
      // Un membre de communityId seulement, crédité dans l'autre communauté, n'y figure pas
      // faute d'adhésion et ne gonfle pas son total ici.
      await solo("onlyHere", 3, when, otherId);
      const here = await read(current);
      expect(here.entries.map(entry => [entry.displayName, entry.rewardFloors, entry.difficultWins])).toEqual([["dual", "1", "0"]]);
      const there = await read(current, "dual", otherId);
      expect(there.entries.map(entry => [entry.displayName, entry.rewardFloors, entry.difficultWins])).toEqual([["dual", "6", "2"]]);
    });

    it("refuse de lire le podium d'une autre communauté dont on n'est pas membre actif", async () => {
      await player("reader");
      await player("dual", "ACTIVE", [otherId]);
      await solo("dual", 3, when, otherId);
      expect(await podium.getTowerSeasonPodium({ communityId: otherId, userId: id("reader") }, iso(current))).toEqual({ status: "UNAVAILABLE" });
    });
  });

  describe("accès à la proposition de palmarès", () => {
    it("signale un administrateur ou un propriétaire de la communauté, jamais un simple membre ni un rôle tenu ailleurs", async () => {
      await player("reader");
      await player("boss");
      await player("chief");
      await player("elsewhere", "ACTIVE", [otherId]);
      await db.membership.update({ where: { communityId_userId: { communityId, userId: id("boss") } }, data: { role: "OWNER" } });
      await db.membership.update({ where: { communityId_userId: { communityId, userId: id("chief") } }, data: { role: "ADMIN" } });
      await db.membership.update({ where: { communityId_userId: { communityId: otherId, userId: id("elsewhere") } }, data: { role: "OWNER" } });
      const current = "2027-07-05T12:00:00Z";
      expect((await read(current, "reader")).canReview).toBe(false);
      expect((await read(current, "boss")).canReview).toBe(true);
      expect((await read(current, "chief")).canReview).toBe(true);
      expect((await read(current, "elsewhere")).canReview).toBe(false);
      expect((await read(current, "elsewhere", otherId)).canReview).toBe(true);
    });
  });

  describe("départage : étages, puis défis à 3 étages, puis arrivée au total final ; égalité stricte = co-lauréats (Q7)", () => {
    const current = "2027-07-05T12:00:00Z";

    it("égalité exacte : tous co-lauréats à la même place, aucun écarté, affichage stable quel que soit l'ordre d'insertion", async () => {
      await player("reader");
      // Création et crédit dans l'ordre inverse de l'ordre alphabétique des identifiants.
      for (const name of ["d", "c", "b", "a"]) await player(name);
      for (const name of ["d", "c", "b", "a"]) await solo(name, 3, "2027-05-10T10:00:00.000Z");
      const result = await read(current);
      expect(result.entries.map(entry => [entry.rank, entry.exAequo, entry.displayName, entry.rewardFloors, entry.difficultWins])).toEqual([
        [1, true, "a", "3", "1"], [1, true, "b", "3", "1"], [1, true, "c", "3", "1"], [1, true, "d", "3", "1"],
      ]);
    });

    it("deux premiers ex æquo : le suivant prend la 3e place et le podium s'arrête là", async () => {
      await player("reader");
      for (const name of ["a", "b", "c", "d"]) await player(name);
      await solo("b", 3, "2027-05-10T10:00:00.000Z");
      await solo("a", 3, "2027-05-10T10:00:00.000Z");
      await solo("c", 2, "2027-05-11T10:00:00.000Z");
      await solo("d", 1, "2027-05-12T10:00:00.000Z");
      const result = await read(current);
      expect(result.entries.map(entry => [entry.rank, entry.exAequo, entry.displayName])).toEqual([
        [1, true, "a"], [1, true, "b"], [3, false, "c"],
      ]);
    });

    it("égalité stricte entre la 3e et la 4e place : les deux restent au podium, le suivant n'y entre pas", async () => {
      await player("reader");
      for (const name of ["p1", "p2", "p3", "p4", "p5"]) await player(name);
      await solo("p1", 3, "2027-05-01T10:00:00.000Z");
      await solo("p1", 2, "2027-05-02T10:00:00.000Z");
      await solo("p2", 3, "2027-05-03T10:00:00.000Z");
      await solo("p2", 1, "2027-05-04T10:00:00.000Z");
      await solo("p4", 3, "2027-05-05T10:00:00.000Z");
      await solo("p3", 3, "2027-05-05T10:00:00.000Z");
      await solo("p5", 2, "2027-05-06T10:00:00.000Z");
      const result = await read(current);
      expect(result.entries.map(entry => [entry.rank, entry.exAequo, entry.displayName, entry.rewardFloors])).toEqual([
        [1, false, "p1", "5"], [2, false, "p2", "4"], [3, true, "p3", "3"], [3, true, "p4", "3"],
      ]);
    });

    it("à étages égaux, un défi à 3 étages passe avant un joueur arrivé plus tôt avec des défis faciles", async () => {
      await player("reader");
      await player("steady"); // 1+1+1 = 3, arrivé tôt, aucun défi difficile
      await player("hard"); // 3 d'un coup, arrivé tard
      await solo("steady", 1, "2027-04-02T10:00:00.000Z");
      await solo("steady", 1, "2027-04-03T10:00:00.000Z");
      await solo("steady", 1, "2027-04-04T10:00:00.000Z");
      await solo("hard", 3, "2027-06-20T10:00:00.000Z");
      const result = await read(current);
      expect(result.entries.map(entry => [entry.displayName, entry.rewardFloors, entry.difficultWins])).toEqual([["hard", "3", "1"], ["steady", "3", "0"]]);
    });

    it("les étages priment sur les défis à 3 étages ; un défi à 2 étages n'est pas « difficile »", async () => {
      await player("reader");
      await player("many"); // 2+2+1 = 5, aucun défi à 3 étages
      await player("peak"); // 3 + 1 = 4 avec un défi à 3 étages
      await solo("many", 2, "2027-06-01T10:00:00.000Z");
      await solo("many", 2, "2027-06-02T10:00:00.000Z");
      await solo("many", 1, "2027-06-03T10:00:00.000Z");
      await solo("peak", 3, "2027-04-02T10:00:00.000Z");
      await solo("peak", 1, "2027-04-03T10:00:00.000Z");
      const result = await read(current);
      expect(result.entries.map(entry => [entry.displayName, entry.rewardFloors, entry.difficultWins])).toEqual([["many", "5", "0"], ["peak", "4", "1"]]);
    });

    it("l'arrivée est l'heure du dernier crédit du total final (pas du premier), équipe comprise", async () => {
      await player("reader");
      await player("r"); // identifiant le plus petit, premier crédit le plus tôt, total final atteint tard
      await player("s");
      await player("t");
      await solo("r", 1, "2027-04-02T10:00:00.000Z");
      await solo("r", 1, "2027-06-10T10:00:00.000Z"); // total de 2 atteint le 10 juin
      await solo("s", 2, "2027-05-05T10:00:00.000Z"); // total de 2 atteint le 5 mai
      await solo("t", 1, "2027-04-01T10:00:00.000Z");
      await team(communityId, "reader", 1, [{ name: "t", rewardedAt: "2027-06-25T10:00:00.000Z" }]); // 2 atteint le 25 juin
      const result = await read(current);
      expect(result.entries.map(entry => [entry.displayName, entry.rewardFloors])).toEqual([["s", "2"], ["r", "2"], ["t", "2"]]);
      expect(result.entries[0]?.reachedAt).toEqual(iso("2027-05-05T10:00:00.000Z"));
      expect(result.entries[1]?.reachedAt).toEqual(iso("2027-06-10T10:00:00.000Z"));
    });

    it("arrivée à la milliseconde : deux crédits espacés d'1 ms se départagent, identiques à la ms ils sont ex æquo", async () => {
      await player("reader");
      for (const name of ["x", "y", "z"]) await player(name);
      await solo("z", 1, "2027-05-10T10:00:00.000Z");
      await solo("y", 1, "2027-05-10T10:00:00.001Z");
      await solo("x", 1, "2027-05-10T10:00:00.001Z");
      const result = await read(current);
      expect(names(result)).toEqual(["z", "x", "y"]);
      expect(result.entries.map(entry => [entry.rank, entry.exAequo])).toEqual([[1, false], [2, true], [2, true]]);
    });
  });
});
