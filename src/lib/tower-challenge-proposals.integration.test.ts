import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

/**
 * Propositions de défis par les Rankers, validées par le staff, sur PostgreSQL réel.
 * Nécessite `TEST_DATABASE_URL` : suite SKIPPÉE sinon.
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
if (!url) console.warn("[tower-challenge-proposals.integration.test] TEST_DATABASE_URL absente : suite SKIPPÉE, propositions NON validées sur SQL réel.");

describe.skipIf(!url)("propositions de défis Tower (PostgreSQL)", () => {
  let db: PrismaClient;
  let lib: typeof import("./tower-challenge-proposals");
  const scope = "prop-" + randomUUID();
  const communityId = scope + "-c";
  const otherId = scope + "-o";
  const id = (name: string) => scope + "-" + name;
  const content = (title: string, rewardFloors = 2) => ({ title, instructions: "Consigne de " + title, rewardFloors });
  const propose = (user: string, title: string, rewardFloors = 2, community = communityId) =>
    lib.proposeTowerChallenge({ communityId: community, userId: id(user), content: content(title, rewardFloors) });

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as PrismaClient;
    lib = await import("./tower-challenge-proposals");
  });
  async function cleanup() {
    await db.community.deleteMany({ where: { id: { in: [communityId, otherId] } } });
    await db.user.deleteMany({ where: { id: { startsWith: scope } } });
  }
  afterAll(async () => {
    if (db) { await cleanup(); await db.$disconnect(); }
    vi.unstubAllEnvs();
  });
  beforeEach(async () => {
    vi.stubEnv("TOWER_CHALLENGES_ENABLED", "true");
    vi.stubEnv("TOWER_CHALLENGE_PROPOSALS_ENABLED", "true");
    await cleanup();
    await db.community.createMany({
      data: [communityId, otherId].map((target, index) => ({
        id: target, name: target, slug: target, status: "ACTIVE" as const, discordGuildId: scope + "-g" + index, towerChallengesEnabled: true,
      })),
    });
    const users: [string, string, "OWNER" | "ADMIN" | "MEMBER", number][] = [
      ["ranker", communityId, "MEMBER", 30], ["high", communityId, "MEMBER", 150], ["regular", communityId, "MEMBER", 29],
      ["staff", communityId, "ADMIN", 0], ["owner", communityId, "OWNER", 0], ["outsider", otherId, "ADMIN", 99],
    ];
    for (const [name, community, role, floors] of users) {
      await db.user.create({ data: { id: id(name), discordId: id(name), discordName: name } });
      await db.membership.create({ data: { userId: id(name), communityId: community, role, status: "ACTIVE" } });
      await db.towerChallengeProgress.create({ data: { communityId: community, userId: id(name), floorsClimbed: BigInt(floors) } });
    }
  });

  it("est inactif sans le drapeau", async () => {
    vi.stubEnv("TOWER_CHALLENGE_PROPOSALS_ENABLED", "false");
    expect((await propose("ranker", "Titre")).status).toBe("DISABLED");
    expect(await db.towerChallengeProposal.count()).toBe(0);
  });

  it("réserve la proposition aux Ranker et High Ranker, membres actifs", async () => {
    expect((await propose("regular", "A")).status).toBe("not_ranker");
    expect((await propose("staff", "B")).status).toBe("not_ranker");
    expect((await propose("outsider", "C")).status).toBe("UNAVAILABLE");
    expect((await propose("ranker", "D")).status).toBe("SUBMITTED");
    expect((await propose("high", "E", 3)).status).toBe("SUBMITTED");
    expect(await db.towerChallengeProposal.count({ where: { status: "PENDING" } })).toBe(2);
  });

  it("n'ajoute rien au catalogue avant la validation du staff", async () => {
    await propose("ranker", "Titre");
    expect(await db.towerChallengeDefinition.count({ where: { communityId } })).toBe(0);
  });

  it("refuse un barème hors 1-3, un titre trop long et un doublon", async () => {
    expect((await propose("ranker", "Zéro", 0)).status).toBe("INVALID");
    expect((await propose("ranker", "Quatre", 4)).status).toBe("INVALID");
    expect((await propose("ranker", "x".repeat(121))).status).toBe("INVALID");
    expect((await propose("ranker", "Unique")).status).toBe("SUBMITTED");
    expect((await propose("high", "unique")).status).toBe("DUPLICATE");
    await db.towerChallengeDefinition.create({ data: { communityId, mode: "SOLO", title: "Au catalogue", instructions: "i", rewardFloors: 1, active: true } });
    expect((await propose("high", "AU CATALOGUE")).status).toBe("DUPLICATE");
  });

  it("limite à 2 propositions par 24 h et par joueur, sans course entre demandes simultanées", async () => {
    const results = await Promise.all(["P1", "P2", "P3", "P4"].map(title => propose("ranker", title)));
    expect(results.filter(item => item.status === "SUBMITTED")).toHaveLength(2);
    expect(results.filter(item => item.status === "daily_limit")).toHaveLength(2);
    expect(await db.towerChallengeProposal.count({ where: { proposerId: id("ranker") } })).toBe(2);
    expect((await propose("high", "Autre joueur")).status).toBe("SUBMITTED");
  });

  it("limite les propositions en attente", async () => {
    const old = new Date(Date.now() - 3 * 24 * 3600000);
    for (let index = 0; index < 5; index++) {
      await db.towerChallengeProposal.create({ data: { communityId, proposerId: id("ranker"), title: "Ancienne " + index, instructions: "i", rewardFloors: 1, createdAt: old } });
    }
    expect((await propose("ranker", "Nouvelle")).status).toBe("pending_limit");
  });

  it("seul le staff voit la file et décide ; l'approbation crée un défi solo actif", async () => {
    await propose("ranker", "À valider", 3);
    const proposal = await db.towerChallengeProposal.findFirstOrThrow({ where: { communityId } });
    const decide = (user: string, approve: boolean, community = communityId) =>
      lib.decideTowerProposal({ communityId: community, userId: id(user), decision: { proposalId: proposal.id, approve } });
    expect((await lib.listPendingTowerProposals({ communityId, userId: id("ranker") })).status).toBe("FORBIDDEN");
    expect((await lib.listPendingTowerProposals({ communityId, userId: id("owner") })).status).toBe("PENDING_LIST");
    expect((await decide("ranker", true)).status).toBe("FORBIDDEN");
    expect((await decide("outsider", true, otherId)).status).toBe("NOT_FOUND");
    expect((await decide("staff", true)).status).toBe("APPROVED");
    const approved = await db.towerChallengeProposal.findUniqueOrThrow({ where: { id: proposal.id } });
    expect(approved).toMatchObject({ status: "APPROVED", decidedById: id("staff") });
    const definition = await db.towerChallengeDefinition.findUniqueOrThrow({ where: { id: approved.definitionId ?? "" } });
    expect(definition).toMatchObject({ communityId, mode: "SOLO", title: "À valider", rewardFloors: 3, active: true, gameId: null });
    expect((await decide("owner", false)).status).toBe("ALREADY_DECIDED");
    expect(await db.towerChallengeDefinition.count({ where: { communityId } })).toBe(1);
  });

  it("un rejet n'ajoute rien et deux approbations simultanées ne créent qu'un défi", async () => {
    await propose("ranker", "Rejetée");
    await propose("high", "Simultanée");
    const [rejected, simultaneous] = [
      await db.towerChallengeProposal.findFirstOrThrow({ where: { title: "Rejetée" } }),
      await db.towerChallengeProposal.findFirstOrThrow({ where: { title: "Simultanée" } }),
    ];
    expect((await lib.decideTowerProposal({ communityId, userId: id("staff"), decision: { proposalId: rejected.id, approve: false, note: "Hors sujet" } })).status).toBe("REJECTED");
    expect(await db.towerChallengeProposal.findUniqueOrThrow({ where: { id: rejected.id } })).toMatchObject({ status: "REJECTED", decisionNote: "Hors sujet", definitionId: null });
    const results = await Promise.all(["staff", "owner"].map(user =>
      lib.decideTowerProposal({ communityId, userId: id(user), decision: { proposalId: simultaneous.id, approve: true } })));
    expect(results.map(item => item.status).sort()).toEqual(["ALREADY_DECIDED", "APPROVED"]);
    expect(await db.towerChallengeDefinition.count({ where: { communityId } })).toBe(1);
  });

  it("l'aperçu du joueur ne montre que ses propositions", async () => {
    await propose("ranker", "Mienne");
    await propose("high", "Autre");
    const overview = await lib.getTowerProposalOverview({ communityId, userId: id("ranker") });
    expect(overview).toMatchObject({ status: "OVERVIEW", eligible: true });
    if (overview.status === "OVERVIEW") expect(overview.mine.map(item => item.title)).toEqual(["Mienne"]);
  });
});
