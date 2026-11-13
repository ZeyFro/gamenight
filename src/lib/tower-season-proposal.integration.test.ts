import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

/**
 * Proposition de palmarès de saison pour les administrateurs, sur PostgreSQL réel : rôles, isolation
 * par communauté, co-lauréats, anciens membres listés à part, saison sans activité (Q2), choix de saison.
 * Nécessite `TEST_DATABASE_URL` (Postgres jetable en boucle locale) : suite SKIPPÉE sinon.
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

if (!url) console.warn("[tower-season-proposal.integration.test] TEST_DATABASE_URL absente : suite SKIPPÉE, proposition de palmarès NON validée sur SQL réel.");

describe.skipIf(!url)("proposition de palmarès de saison (requêtes SQL réelles)", () => {
  let db: PrismaClient;
  let lib: typeof import("./tower-season-proposal");
  const scope = "towerprop-" + randomUUID();
  const communityId = scope + "-community";
  const otherId = scope + "-other";
  const gameId = scope + "-game";
  let sequence = 0;
  const id = (name: string) => scope + "-" + name;
  const iso = (value: string) => new Date(value);
  const now = iso("2027-10-10T12:00:00Z"); // S4 2027 en cours : S1, S2 et Été 2027 sont finies.
  const S2_START = "2027-03-31T22:00:00.000Z";
  const S1_START = "2027-01-03T23:00:00.000Z";

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as PrismaClient;
    lib = await import("./tower-season-proposal");
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
    await db.community.createMany({
      data: [communityId, otherId].map((target, index) => ({
        id: target, name: index ? "Autre serveur" : "The Tower", slug: target, status: "ACTIVE" as const,
        discordGuildId: scope + "-guild-" + index, towerChallengesEnabled: true,
      })),
    });
    await db.towerChallengeDefinition.createMany({
      data: [communityId, otherId].map(target => ({ id: target + "-def", communityId: target, title: "Défi", instructions: "Consigne", rewardFloors: 1 })),
    });
    await player("admin", "ACTIVE", "ADMIN");
    await db.game.create({ data: { id: gameId, name: "Jeu", source: "MANUAL", addedById: id("admin") } });
  });

  async function player(name: string, status: "ACTIVE" | "LEFT" | "REMOVED" | null = "ACTIVE", role: "OWNER" | "ADMIN" | "MEMBER" = "MEMBER", extra: string[] = []) {
    await db.user.create({ data: { id: id(name), discordId: scope + "-d" + sequence++, discordName: name } });
    if (status) await db.membership.create({ data: { communityId, userId: id(name), status, role } });
    for (const target of extra) await db.membership.create({ data: { communityId: target, userId: id(name), status: "ACTIVE", role } });
  }
  function solo(name: string, value: number, when: string, target = communityId) {
    return db.towerChallengeAttempt.create({
      data: {
        communityId: target, userId: id(name), definitionId: target + "-def", requestKey: "k-" + sequence++, title: "Défi",
        instructions: "Consigne", rewardFloors: value, status: "APPROVED",
        assignedAt: iso("2026-01-01T10:00:00Z"), expiresAt: iso("2026-01-03T10:00:00Z"), rewardedAt: iso(when),
      },
    });
  }
  async function team(author: string, value: number, participants: { name: string; rewardedAt: string | null }[]) {
    const row = await db.communityTeam.create({
      data: { communityId, gameId, createdById: id(author), name: "Équipe " + sequence++, description: "Équipe locale", platform: "PC", maxMembers: 4 },
    });
    const attempt = await db.towerChallengeAttempt.create({
      data: {
        communityId, userId: id(author), teamId: row.id, definitionId: communityId + "-def", requestKey: "k-" + sequence++,
        title: "Défi", instructions: "Consigne", rewardFloors: value, status: "APPROVED",
        assignedAt: iso("2026-01-01T10:00:00Z"), expiresAt: iso("2026-01-03T10:00:00Z"), rewardedAt: iso("2027-02-02T10:00:00Z"),
      },
    });
    await db.towerChallengeAttemptParticipant.createMany({
      data: participants.map(item => ({ communityId, attemptId: attempt.id, userId: id(item.name), rewardedAt: item.rewardedAt ? iso(item.rewardedAt) : null })),
    });
  }
  async function read(options: { reader?: string; target?: string; seasonStart?: string; current?: Date } = {}) {
    const result = await lib.getTowerSeasonProposal({
      userId: id(options.reader ?? "admin"), communityId: options.target ?? communityId,
      ...(options.seasonStart ? { seasonStart: options.seasonStart } : {}),
    }, options.current ?? now);
    if (result.status !== "PROPOSAL") throw new Error("Proposition attendue, reçu " + result.status);
    return result;
  }
  const status = async (reader: string, target = communityId) =>
    (await lib.getTowerSeasonProposal({ userId: id(reader), communityId: target }, now)).status;

  describe("accès : administrateurs actifs de la communauté seulement", () => {
    it("ADMIN et OWNER lisent la proposition ; un simple membre est refusé", async () => {
      await player("owner", "ACTIVE", "OWNER");
      await player("member");
      expect(await status("admin")).toBe("PROPOSAL");
      expect(await status("owner")).toBe("PROPOSAL");
      expect(await status("member")).toBe("FORBIDDEN");
    });

    it("un administrateur parti, retiré, ou d'un autre serveur n'a aucun accès, isolation éteinte comprise", async () => {
      await player("gone", "REMOVED", "ADMIN");
      await player("left", "LEFT", "OWNER");
      await player("elsewhere", null, "OWNER", [otherId]);
      vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "false");
      for (const reader of ["gone", "left", "elsewhere"]) expect(await status(reader)).toBe("UNAVAILABLE");
      expect(await status("elsewhere", otherId)).toBe("PROPOSAL");
    });

    it("indisponible si la communauté est suspendue ou si ses défis Tower sont éteints ; DISABLED sans le drapeau ; INVALID sans identifiants", async () => {
      await db.community.update({ where: { id: communityId }, data: { towerChallengesEnabled: false } });
      expect(await status("admin")).toBe("UNAVAILABLE");
      await db.community.update({ where: { id: communityId }, data: { towerChallengesEnabled: true, status: "SUSPENDED" } });
      expect(await status("admin")).toBe("UNAVAILABLE");
      vi.stubEnv("TOWER_CHALLENGES_ENABLED", "false");
      expect(await status("admin")).toBe("DISABLED");
      expect((await lib.getTowerSeasonProposal({ userId: "", communityId })).status).toBe("INVALID");
      expect((await lib.getTowerSeasonProposal({ userId: id("admin"), communityId, seasonStart: "hier" })).status).toBe("INVALID");
    });
  });

  describe("saisons proposées", () => {
    it("sans aucun crédit : seule la dernière saison finie, non terminée au sens Q2, sans candidat", async () => {
      const result = await read();
      expect(result.seasons.map(season => season.name)).toEqual(["Été · 2027"]);
      expect(result).toMatchObject({
        communityName: "The Tower", completed: false, creditedFloors: "0", creditedPlayers: 0, truncated: false,
        candidates: [], formerMembers: [], season: { name: "Été · 2027" }, computedAt: now,
      });
    });

    it("liste les saisons finies depuis le premier crédit et ouvre la plus récente par défaut", async () => {
      await player("a");
      await solo("a", 2, "2027-02-10T10:00:00Z");
      const result = await read();
      expect(result.seasons.map(season => season.name)).toEqual(["Été · 2027", "S2 · 2027", "S1 · 2027"]);
      expect(result.season.name).toBe("Été · 2027");
      expect(result.completed).toBe(false);
    });

    it("ouvre la saison demandée et refuse une saison inconnue ou en cours", async () => {
      await player("a");
      await solo("a", 2, "2027-02-10T10:00:00Z");
      const s1 = await read({ seasonStart: S1_START });
      expect(s1.season.name).toBe("S1 · 2027");
      expect(s1).toMatchObject({ completed: true, creditedFloors: "2", creditedPlayers: 1 });
      expect(s1.candidates.map(entry => [entry.place, entry.displayName, entry.rewardFloors])).toEqual([[1, "a", "2"]]);
      const unknown = await lib.getTowerSeasonProposal({ userId: id("admin"), communityId, seasonStart: "2027-08-31T22:00:00.000Z" }, now);
      expect(unknown.status).toBe("UNKNOWN_SEASON"); // S4 2027, en cours.
      const before = await lib.getTowerSeasonProposal({ userId: id("admin"), communityId, seasonStart: "2026-08-31T22:00:00.000Z" }, now);
      expect(before.status).toBe("UNKNOWN_SEASON"); // S4 2026, avant le premier crédit.
    });
  });

  describe("classement proposé (S2 2027)", () => {
    const s2 = { seasonStart: S2_START };

    it("rattache chaque crédit à la saison de sa date, bornes de Paris à la milliseconde, équipe comprise", async () => {
      for (const name of ["a", "b"]) await player(name);
      await solo("a", 1, "2027-03-31T21:59:59.999Z"); // Intersaison : aucune saison.
      await solo("a", 2, "2027-03-31T22:00:00.000Z"); // Première milliseconde de S2.
      await solo("a", 3, "2027-06-30T21:59:59.999Z"); // Dernière milliseconde de S2.
      await solo("a", 3, "2027-06-30T22:00:00.000Z"); // Été.
      await team("admin", 2, [{ name: "b", rewardedAt: "2027-05-05T10:00:00Z" }, { name: "a", rewardedAt: null }]);
      const result = await read(s2);
      expect(result.candidates.map(entry => [entry.place, entry.displayName, entry.rewardFloors, entry.difficultWins])).toEqual([
        [1, "a", "5", "1"], [2, "b", "2", "0"],
      ]);
      expect(result).toMatchObject({ completed: true, creditedFloors: "7", creditedPlayers: 2 });
      expect(result.candidates[0].reachedAt).toEqual(iso("2027-06-30T21:59:59.999Z"));
    });

    it("co-lauréats à la même place, podium marqué jusqu'à la 3e place sans écarter d'ex æquo", async () => {
      for (const name of ["p1", "p2", "p3", "p4", "p5"]) await player(name);
      await solo("p2", 3, "2027-05-01T10:00:00.000Z");
      await solo("p1", 3, "2027-05-01T10:00:00.000Z");
      await solo("p4", 2, "2027-05-02T10:00:00.000Z");
      await solo("p3", 2, "2027-05-02T10:00:00.000Z");
      await solo("p5", 1, "2027-05-03T10:00:00.000Z");
      const result = await read(s2);
      expect(result.candidates.map(entry => [entry.place, entry.exAequo, entry.onPodium, entry.displayName])).toEqual([
        [1, true, true, "p1"], [1, true, true, "p2"], [3, true, true, "p3"], [3, true, true, "p4"], [5, false, false, "p5"],
      ]);
    });

    it("liste à part les joueurs crédités qui ne sont plus membres actifs, sans les classer ni les oublier", async () => {
      await player("active");
      await player("left", "LEFT");
      await player("removed", "REMOVED");
      await player("ghost", null);
      await solo("left", 3, "2027-05-01T10:00:00Z");
      await solo("ghost", 3, "2027-05-02T10:00:00Z");
      await solo("removed", 2, "2027-05-03T10:00:00Z");
      await solo("active", 1, "2027-05-04T10:00:00Z");
      const result = await read(s2);
      expect(result.candidates.map(entry => [entry.place, entry.displayName])).toEqual([[1, "active"]]);
      expect(result.formerMembers.map(entry => [entry.displayName, entry.rewardFloors, entry.membershipStatus])).toEqual([
        ["left", "3", "LEFT"], ["ghost", "3", null], ["removed", "2", "REMOVED"],
      ]);
      expect(result).toMatchObject({ completed: true, creditedFloors: "9", creditedPlayers: 4 });
    });

    it("une saison dont tous les crédités sont partis reste terminée (Q2) mais sans membre actif classé", async () => {
      await player("left", "LEFT");
      await solo("left", 3, "2027-05-01T10:00:00Z");
      const result = await read(s2);
      expect(result).toMatchObject({ completed: true, candidates: [] });
      expect(result.formerMembers).toHaveLength(1);
    });

    it("ne mélange pas les communautés : un joueur des deux serveurs n'apporte que ses crédits d'ici", async () => {
      await player("dual", "ACTIVE", "MEMBER", [otherId]);
      await player("otheradmin", null, "ADMIN", [otherId]);
      await solo("dual", 1, "2027-05-01T10:00:00Z");
      await solo("dual", 3, "2027-05-02T10:00:00Z", otherId);
      const here = await read(s2);
      expect(here.candidates.map(entry => [entry.displayName, entry.rewardFloors])).toEqual([["dual", "1"]]);
      const there = await read({ reader: "otheradmin", target: otherId, seasonStart: S2_START });
      expect(there.communityName).toBe("Autre serveur");
      expect(there.candidates.map(entry => [entry.displayName, entry.rewardFloors])).toEqual([["dual", "3"]]);
    });

    it("limite la proposition aux dix premières places, ex æquo de la 10e compris", async () => {
      const names = Array.from({ length: 13 }, (_, index) => "n" + String(index + 1).padStart(2, "0"));
      for (const name of names) await player(name);
      // n01 à n09 : totaux distincts ; n10 à n12 strictement égaux ; n13 derrière.
      for (let index = 0; index < 9; index++) {
        for (let repeat = 0; repeat < 10 - index; repeat++) await solo(names[index], 3, `2027-04-${String(2 + repeat).padStart(2, "0")}T10:00:00.000Z`);
      }
      for (const name of ["n12", "n11", "n10"]) await solo(name, 2, "2027-05-20T10:00:00.000Z");
      await solo("n13", 1, "2027-05-21T10:00:00.000Z");
      const result = await read(s2);
      expect(result.candidates.map(entry => entry.displayName)).toEqual(names.slice(0, 12));
      expect(result.candidates.slice(9).map(entry => [entry.place, entry.exAequo, entry.onPodium])).toEqual([[10, true, false], [10, true, false], [10, true, false]]);
      expect(result.creditedPlayers).toBe(13);
    });
  });
});
