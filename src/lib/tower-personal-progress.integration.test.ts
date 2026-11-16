import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

/**
 * Progression personnelle Tower sur PostgreSQL réel : étages gagnés (`floorsClimbed`, jamais l'XP),
 * saisons terminées (Q2), rang, isolation par communauté et contrôles d'accès.
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

if (!url) console.warn("[tower-personal-progress.integration.test] TEST_DATABASE_URL absente : suite SKIPPÉE, progression Tower NON validée sur SQL réel.");

describe.skipIf(!url)("progression personnelle Tower (requêtes SQL réelles)", () => {
  let db: PrismaClient;
  let lib: typeof import("./tower-personal-progress");
  const scope = "towerprog-" + randomUUID();
  const communityId = scope + "-community";
  const otherId = scope + "-other";
  const gameId = scope + "-game";
  let sequence = 0;
  const id = (name: string) => scope + "-" + name;
  const iso = (value: string) => new Date(value);
  const now = iso("2027-07-10T12:00:00Z"); // Été 2027 en cours : S1 et S2 2027 sont finies.

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as PrismaClient;
    lib = await import("./tower-personal-progress");
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
        id: target, name: target, slug: target, status: "ACTIVE" as const,
        discordGuildId: scope + "-guild-" + index, towerChallengesEnabled: true,
      })),
    });
    await db.towerChallengeDefinition.createMany({
      data: [communityId, otherId].map(target => ({ id: target + "-def", communityId: target, title: "Défi", instructions: "Consigne", rewardFloors: 1 })),
    });
    await player("viewer");
    await player("member");
    await db.game.create({ data: { id: gameId, name: "Jeu", source: "MANUAL", addedById: id("viewer") } });
  });

  async function player(name: string, status: "ACTIVE" | "LEFT" | "REMOVED" | null = "ACTIVE", extra: string[] = []) {
    await db.user.create({ data: { id: id(name), discordId: scope + "-d" + sequence++, discordName: name, xpTotal: 999999 } });
    if (status) await db.membership.create({ data: { communityId, userId: id(name), status } });
    for (const target of extra) await db.membership.create({ data: { communityId: target, userId: id(name), status: "ACTIVE" } });
  }
  const floors = (name: string, value: number, target = communityId) =>
    db.towerChallengeProgress.create({ data: { communityId: target, userId: id(name), floorsClimbed: BigInt(value) } });
  /** `when` null = tentative REFUSÉE : la base impose APPROVED si et seulement si rewardedAt est renseigné. */
  function solo(name: string, value: number, when: string | null, target = communityId) {
    return db.towerChallengeAttempt.create({
      data: {
        communityId: target, userId: id(name), definitionId: target + "-def", requestKey: "k-" + sequence++, title: "Défi",
        instructions: "Consigne", rewardFloors: value, status: when ? "APPROVED" : "REJECTED",
        assignedAt: iso("2026-01-01T10:00:00Z"), expiresAt: iso("2026-01-03T10:00:00Z"), rewardedAt: when ? iso(when) : null,
      },
    });
  }
  async function team(author: string, value: number, participants: { name: string; rewardedAt: string | null }[], target = communityId) {
    const row = await db.communityTeam.create({
      data: { communityId: target, gameId, createdById: id(author), name: "Équipe " + sequence++, description: "Équipe locale", platform: "PC", maxMembers: 4 },
    });
    const attempt = await db.towerChallengeAttempt.create({
      data: {
        communityId: target, userId: id(author), teamId: row.id, definitionId: target + "-def", requestKey: "k-" + sequence++,
        title: "Défi", instructions: "Consigne", rewardFloors: value, status: "APPROVED",
        assignedAt: iso("2026-01-01T10:00:00Z"), expiresAt: iso("2026-01-03T10:00:00Z"), rewardedAt: iso("2027-02-02T10:00:00Z"),
      },
    });
    await db.towerChallengeAttemptParticipant.createMany({
      data: participants.map(item => ({ communityId: target, attemptId: attempt.id, userId: id(item.name), rewardedAt: item.rewardedAt ? iso(item.rewardedAt) : null })),
    });
  }
  const read = (member = "member", viewer = "viewer", target = communityId, current = now) =>
    lib.getTowerPersonalProgress({ viewerId: id(viewer), memberId: id(member), communityId: target }, current);

  it("un membre sans aucun défi est Irregular à 0 étage, quelle que soit son XP", async () => {
    expect(await read()).toEqual({
      status: "PROGRESS", floorsClimbed: "0", completedSeasons: 0, rank: "Irregular",
      next: { rank: "Ranker", floorsMissing: "30", seasonMissing: false },
    });
  });

  it("le rang suit les étages gagnés (floorsClimbed) : 29 = Irregular, 30 = Ranker", async () => {
    await floors("member", 29);
    expect(await read()).toMatchObject({ floorsClimbed: "29", rank: "Irregular", next: { rank: "Ranker", floorsMissing: "1" } });
    await db.towerChallengeProgress.update({ where: { communityId_userId: { communityId, userId: id("member") } }, data: { floorsClimbed: BigInt(30) } });
    expect(await read()).toMatchObject({ floorsClimbed: "30", rank: "Ranker", next: { rank: "High Ranker", floorsMissing: "70", seasonMissing: true } });
  });

  it("100 étages sans saison terminée reste Ranker ; une saison finie avec un étage crédité donne High Ranker", async () => {
    await floors("member", 100);
    await solo("member", 3, "2027-07-05T10:00:00Z"); // Été en cours : pas terminée.
    expect(await read()).toMatchObject({ completedSeasons: 0, rank: "Ranker", next: { rank: "High Ranker", floorsMissing: "0", seasonMissing: true } });
    await solo("member", 1, "2027-05-05T10:00:00Z"); // S2 2027, finie le 1er juillet.
    expect(await read()).toEqual({ status: "PROGRESS", floorsClimbed: "100", completedSeasons: 1, rank: "High Ranker", next: null });
  });

  it("la même saison d'été devient terminée à sa fin exclusive (1er septembre 00:00 Paris)", async () => {
    await floors("member", 100);
    await solo("member", 3, "2027-07-05T10:00:00Z");
    expect(await read("member", "viewer", communityId, iso("2027-08-31T21:59:59.999Z"))).toMatchObject({ completedSeasons: 0, rank: "Ranker" });
    expect(await read("member", "viewer", communityId, iso("2027-08-31T22:00:00.000Z"))).toMatchObject({ completedSeasons: 1, rank: "High Ranker" });
  });

  it("compte les crédits d'équipe à la date du participant, et seulement s'il a été crédité", async () => {
    await floors("member", 100);
    // Tentative datée de S1, mais le membre n'est crédité qu'en été (saison en cours) : S1 ne compte pas.
    await team("viewer", 2, [{ name: "member", rewardedAt: "2027-07-06T10:00:00Z" }]);
    await team("viewer", 2, [{ name: "member", rewardedAt: null }]);
    expect(await read()).toMatchObject({ completedSeasons: 0 });
    await team("viewer", 2, [{ name: "member", rewardedAt: "2027-02-10T10:00:00Z" }]);
    expect(await read()).toMatchObject({ completedSeasons: 1, rank: "High Ranker" });
  });

  it("ignore les tentatives refusées, les crédits d'intersaison et le crédit d'auteur d'un défi d'équipe", async () => {
    await floors("member", 100);
    await solo("member", 3, null);
    await solo("member", 3, "2027-03-30T10:00:00Z"); // Intersaison du 29 au 31 mars.
    await team("member", 3, [{ name: "viewer", rewardedAt: "2027-02-10T10:00:00Z" }]); // Auteur non participant.
    expect(await read()).toMatchObject({ completedSeasons: 0, rank: "Ranker" });
  });

  it("ne mélange pas les communautés : étages et saisons d'un autre serveur ne comptent pas", async () => {
    await player("dual", "ACTIVE", [otherId]);
    await player("otherviewer", null, [otherId]);
    await floors("dual", 5);
    await floors("dual", 150, otherId);
    await solo("dual", 3, "2027-02-10T10:00:00Z", otherId);
    expect(await read("dual")).toEqual({
      status: "PROGRESS", floorsClimbed: "5", completedSeasons: 0, rank: "Irregular",
      next: { rank: "Ranker", floorsMissing: "25", seasonMissing: false },
    });
    expect(await read("dual", "otherviewer", otherId)).toMatchObject({ floorsClimbed: "150", completedSeasons: 1, rank: "High Ranker" });
  });

  it("refuse un lecteur qui n'est pas membre actif de la communauté, isolation éteinte comprise", async () => {
    await player("stranger", null);
    await player("gone", "REMOVED");
    await player("left", "LEFT");
    await floors("member", 40);
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "false");
    for (const viewer of ["stranger", "gone", "left"]) expect(await read("member", viewer)).toEqual({ status: "UNAVAILABLE" });
  });

  it("ne montre pas la progression d'un membre parti ou d'un membre d'un autre serveur", async () => {
    await player("gone", "REMOVED");
    await player("elsewhere", null, [otherId]);
    await floors("gone", 40);
    await floors("elsewhere", 40, otherId);
    expect(await read("gone")).toEqual({ status: "UNAVAILABLE" });
    expect(await read("elsewhere")).toEqual({ status: "UNAVAILABLE" });
  });

  it("indisponible si la communauté est suspendue ou si ses défis Tower sont éteints ; DISABLED sans le drapeau ; INVALID sans identifiants", async () => {
    await db.community.update({ where: { id: communityId }, data: { towerChallengesEnabled: false } });
    expect(await read()).toEqual({ status: "UNAVAILABLE" });
    await db.community.update({ where: { id: communityId }, data: { towerChallengesEnabled: true, status: "SUSPENDED" } });
    expect(await read()).toEqual({ status: "UNAVAILABLE" });
    vi.stubEnv("TOWER_CHALLENGES_ENABLED", "false");
    expect(await read()).toEqual({ status: "DISABLED" });
    expect(await lib.getTowerPersonalProgress({ viewerId: "", memberId: id("member"), communityId })).toEqual({ status: "INVALID" });
  });

  it("un membre lit sa propre progression", async () => {
    await floors("member", 31);
    expect(await read("member", "member")).toMatchObject({ status: "PROGRESS", floorsClimbed: "31", rank: "Ranker" });
  });
});
