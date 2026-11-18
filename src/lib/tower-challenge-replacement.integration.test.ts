import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

/**
 * Remplacement de défi solo sur PostgreSQL réel. Nécessite `TEST_DATABASE_URL` : suite SKIPPÉE sinon.
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
if (!url) console.warn("[tower-challenge-replacement.integration.test] TEST_DATABASE_URL absente : suite SKIPPÉE, remplacement NON validé sur SQL réel.");

describe.skipIf(!url)("remplacement de défi Tower (PostgreSQL)", () => {
  let db: PrismaClient;
  let lib: typeof import("./tower-challenge-replacement");
  const scope = "repl-" + randomUUID();
  const communityId = scope + "-c";
  const otherId = scope + "-o";
  const id = (name: string) => scope + "-" + name;
  const future = () => new Date(Date.now() + 40 * 3600000);
  const lastClaim = new Date("2026-12-01T10:00:00Z");

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as PrismaClient;
    lib = await import("./tower-challenge-replacement");
  });
  async function cleanup() {
    await db.community.deleteMany({ where: { id: { in: [communityId, otherId] } } });
    await db.game.deleteMany({ where: { id: { startsWith: scope } } });
    await db.user.deleteMany({ where: { id: { startsWith: scope } } });
  }
  afterAll(async () => {
    if (db) { await cleanup(); await db.$disconnect(); }
    vi.unstubAllEnvs();
  });
  async function def(name: string, rewardFloors: number, gameId: string | null, community = communityId, active = true) {
    return db.towerChallengeDefinition.create({
      data: { id: id(name), communityId: community, mode: "SOLO", title: "Défi " + name, instructions: "Consigne " + name, rewardFloors, gameId, active },
    });
  }
  async function attempt(definitionId: string, extra: Record<string, unknown> = {}) {
    const definition = await db.towerChallengeDefinition.findUniqueOrThrow({ where: { id: definitionId } });
    return db.towerChallengeAttempt.create({
      data: { id: id("attempt"), communityId, userId: id("player"), requestKey: "req-" + randomUUID(), definitionId, title: definition.title,
        instructions: definition.instructions, rewardFloors: definition.rewardFloors, assignedAt: new Date(Date.now() - 3600000), expiresAt: future(), ...extra },
    });
  }
  const replace = (attemptId = id("attempt"), community = communityId, user = id("player")) =>
    lib.replaceTowerChallenge({ communityId: community, userId: user, attemptId });

  beforeEach(async () => {
    vi.stubEnv("TOWER_CHALLENGES_ENABLED", "true");
    vi.stubEnv("TOWER_CHALLENGE_REPLACEMENT_ENABLED", "true");
    await cleanup();
    await db.community.createMany({
      data: [communityId, otherId].map((target, index) => ({
        id: target, name: target, slug: target, status: "ACTIVE" as const, discordGuildId: scope + "-g" + index, towerChallengesEnabled: true,
      })),
    });
    for (const name of ["player", "stranger"]) await db.user.create({ data: { id: id(name), discordId: id(name), discordName: name } });
    await db.membership.create({ data: { userId: id("player"), communityId, role: "MEMBER", status: "ACTIVE" } });
    await db.membership.create({ data: { userId: id("stranger"), communityId: otherId, role: "MEMBER", status: "ACTIVE" } });
    for (const name of ["missing", "owned"]) await db.game.create({ data: { id: id(name), name, source: "MANUAL", addedById: id("player") } });
    await db.userGame.create({ data: { userId: id("player"), gameId: id("owned"), owned: true } });
    await db.towerChallengeProgress.create({ data: { communityId, userId: id("player"), lastSoloClaimAt: lastClaim } });
  });

  it("est inactif sans le drapeau", async () => {
    vi.stubEnv("TOWER_CHALLENGE_REPLACEMENT_ENABLED", "false");
    await def("needs", 2, id("missing"));
    await attempt(id("needs"));
    expect((await replace()).status).toBe("DISABLED");
    expect((await lib.getTowerReplacementOffer({ communityId, userId: id("player") })).status).toBe("DISABLED");
  });

  it("remplace par un défi équivalent sans toucher au quota ni à l'échéance, et journalise", async () => {
    await def("needs", 2, id("missing"));
    await def("same", 2, null);
    await def("other-floors", 3, null);
    await def("same-unowned", 2, id("missing"));
    const before = await attempt(id("needs"));
    expect((await lib.getTowerReplacementOffer({ communityId, userId: id("player") })).status).toBe("OFFER");
    const result = await replace();
    expect(result).toMatchObject({ status: "REPLACED", title: "Défi same" });
    const after = await db.towerChallengeAttempt.findUniqueOrThrow({ where: { id: id("attempt") } });
    expect(after).toMatchObject({ definitionId: id("same"), title: "Défi same", rewardFloors: 2, status: "ASSIGNED" });
    expect(after.expiresAt.getTime()).toBe(before.expiresAt.getTime());
    expect(after.assignedAt.getTime()).toBe(before.assignedAt.getTime());
    expect((await db.towerChallengeProgress.findUniqueOrThrow({ where: { communityId_userId: { communityId, userId: id("player") } } })).lastSoloClaimAt?.getTime()).toBe(lastClaim.getTime());
    const log = await db.towerChallengeReplacement.findMany({ where: { communityId } });
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ fromDefinitionId: id("needs"), toDefinitionId: id("same"), requiredGameId: id("missing") });
  });

  it("une seule fois par attribution", async () => {
    await def("needs", 2, id("missing"));
    await def("same", 2, null);
    await def("same-b", 2, null);
    await attempt(id("needs"));
    expect((await replace()).status).toBe("REPLACED");
    expect(await replace()).toMatchObject({ status: "BLOCKED", block: "already_replaced" });
    expect((await lib.getTowerReplacementOffer({ communityId, userId: id("player") })).status).toBe("NONE");
    expect(await db.towerChallengeReplacement.count()).toBe(1);
  });

  it("deux demandes simultanées ne produisent qu'un remplacement", async () => {
    await def("needs", 2, id("missing"));
    await def("same", 2, null);
    await def("same-b", 2, null);
    await attempt(id("needs"));
    const results = await Promise.all([replace(), replace()]);
    expect(results.filter(item => item.status === "REPLACED")).toHaveLength(1);
    expect(await db.towerChallengeReplacement.count()).toBe(1);
  });

  it("refuse si le jeu est possédé, si aucun jeu n'est exigé, après dépôt de preuve ou après expiration", async () => {
    await def("owned-game", 2, id("owned"));
    await def("free-game", 2, null);
    await def("alt", 2, null);
    await attempt(id("owned-game"));
    expect(await replace()).toMatchObject({ status: "BLOCKED", block: "game_owned" });
    await db.towerChallengeAttempt.update({ where: { id: id("attempt") }, data: { definitionId: id("free-game") } });
    expect(await replace()).toMatchObject({ status: "BLOCKED", block: "no_game_required" });
    await db.towerChallengeAttempt.delete({ where: { id: id("attempt") } });
    await def("needs", 2, id("missing"));
    await attempt(id("needs"), { status: "SUBMITTED" });
    expect(await replace()).toMatchObject({ status: "BLOCKED", block: "not_assigned" });
    await db.towerChallengeAttempt.update({ where: { id: id("attempt") }, data: { status: "ASSIGNED", expiresAt: new Date(Date.now() - 1000) } });
    expect(await replace()).toMatchObject({ status: "BLOCKED", block: "expired" });
    expect(await db.towerChallengeReplacement.count()).toBe(0);
  });

  it("ne propose rien sans équivalent actif et ne modifie alors rien", async () => {
    await def("needs", 2, id("missing"));
    await def("inactive", 2, null, communityId, false);
    await def("hard", 3, null);
    await attempt(id("needs"));
    expect((await replace()).status).toBe("NO_EQUIVALENT");
    expect((await db.towerChallengeAttempt.findUniqueOrThrow({ where: { id: id("attempt") } })).definitionId).toBe(id("needs"));
    expect(await db.towerChallengeReplacement.count()).toBe(0);
  });

  it("n'utilise que le catalogue de la communauté et refuse un joueur d'une autre communauté", async () => {
    await def("needs", 2, id("missing"));
    await def("elsewhere", 2, null, otherId);
    await attempt(id("needs"));
    expect((await replace()).status).toBe("NO_EQUIVALENT");
    expect((await replace(id("attempt"), communityId, id("stranger"))).status).toBe("UNAVAILABLE");
    expect((await replace(id("attempt"), otherId, id("stranger"))).status).toBe("NOT_FOUND");
  });
});
