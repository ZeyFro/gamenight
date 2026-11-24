import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { PrismaClient } from "@prisma/client";

/**
 * Production du 24/11/2026 : /admin/tower-propositions et /admin/tower-irregular répondaient 404 interrupteurs d'environnement allumés,
 * parce que `Community.towerChallengesEnabled` n'avait AUCUN écrivain (ni carte « Communautés », ni action) : le réglage « The Tower
 * (défis) » est maintenant visible et activable. PostgreSQL local seulement ; suite SKIPPÉE sans `TEST_DATABASE_URL`.
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
if (!url) console.warn("[community-tower-challenges-setting] TEST_DATABASE_URL absente : suite SKIPPÉE.");

describe.skipIf(!url)("réglage « The Tower (défis) » et écrans staff", () => {
  let db: PrismaClient;
  const scope = "towerflag-" + randomUUID();
  const communityId = scope + "-c1";
  const pendingId = scope + "-c2";
  const id = (name: string) => scope + "-" + name;

  beforeAll(async () => { db = (await import("@/lib/prisma")).prisma as PrismaClient; });
  async function cleanup() {
    await db.community.deleteMany({ where: { id: { in: [communityId, pendingId] } } });
    await db.user.deleteMany({ where: { id: { startsWith: scope } } });
  }
  afterAll(async () => {
    if (db) { await cleanup(); await db.$disconnect(); }
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  beforeEach(async () => {
    vi.stubEnv("TOWER_CHALLENGES_ENABLED", "true");
    vi.stubEnv("TOWER_CHALLENGE_PROPOSALS_ENABLED", "true");
    vi.stubEnv("TOWER_IRREGULAR_GRANTS_ENABLED", "true");
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Réseau interdit en test"); }));
    await cleanup();
    await db.user.createMany({ data: ["owner", "admin", "member"].map((name, index) => ({ id: id(name), discordId: scope + index, discordName: name })) });
    await db.community.create({ data: { id: communityId, name: communityId, slug: communityId, status: "ACTIVE", discordGuildId: scope + "-g1" } });
    await db.community.create({ data: { id: pendingId, name: pendingId, slug: pendingId, status: "PENDING", discordGuildId: scope + "-g2" } });
    await db.membership.createMany({ data: [
      { communityId, userId: id("owner"), status: "ACTIVE", role: "OWNER" },
      { communityId, userId: id("admin"), status: "ACTIVE", role: "ADMIN" },
      { communityId, userId: id("member"), status: "ACTIVE", role: "MEMBER" },
    ] });
  });

  async function row(target = communityId) {
    const { listAdminCommunities } = await import("./community-admin");
    return (await listAdminCommunities()).find((community) => community.id === target);
  }

  it("le réglage est lu par la carte, absent par défaut, puis activable et désactivable", async () => {
    const { setCommunityTowerChallenges } = await import("./community-admin");
    expect((await row())?.towerChallengesEnabled).toBe(false);
    expect(await setCommunityTowerChallenges({ communityId, enabled: true })).toBe("saved");
    expect((await row())?.towerChallengesEnabled).toBe(true);
    expect(await setCommunityTowerChallenges({ communityId, enabled: false })).toBe("saved");
    expect((await row())?.towerChallengesEnabled).toBe(false);
  });

  it("refuse une demande invalide et l'activation d'une communauté qui n'est pas ACTIVE", async () => {
    const { setCommunityTowerChallenges } = await import("./community-admin");
    expect(await setCommunityTowerChallenges({ communityId, enabled: "true" })).toBe("invalid");
    expect(await setCommunityTowerChallenges({ communityId: "", enabled: true })).toBe("invalid");
    expect(await setCommunityTowerChallenges({ communityId: pendingId, enabled: true })).toBe("unavailable");
    expect((await row(pendingId))?.towerChallengesEnabled).toBe(false);
    expect(await setCommunityTowerChallenges({ communityId: scope + "-inconnue", enabled: true })).toBe("unavailable");
  });

  it("files des propositions et d'Irregular : refusées tant que le réglage est éteint, ouvertes au propriétaire et à l'admin du serveur une fois activé, jamais à un simple membre", async () => {
    const proposals = await import("./tower-challenge-proposals");
    const irregular = await import("./tower-irregular");
    const { setCommunityTowerChallenges } = await import("./community-admin");

    for (const user of ["owner", "admin"]) {
      expect((await proposals.listPendingTowerProposals({ communityId, userId: id(user) })).status).toBe("UNAVAILABLE");
      expect((await irregular.listTowerIrregularForStaff(id(user), communityId)).status).not.toBe("LISTED");
    }

    expect(await setCommunityTowerChallenges({ communityId, enabled: true })).toBe("saved");

    for (const user of ["owner", "admin"]) {
      expect((await proposals.listPendingTowerProposals({ communityId, userId: id(user) })).status).toBe("PENDING_LIST");
      expect((await irregular.listTowerIrregularForStaff(id(user), communityId)).status).toBe("LISTED");
    }
    expect((await proposals.listPendingTowerProposals({ communityId, userId: id("member") })).status).toBe("FORBIDDEN");
    expect((await irregular.listTowerIrregularForStaff(id("member"), communityId)).status).not.toBe("LISTED");
  });

  it("la carte « Communautés » porte le formulaire, l'action est journalisée et réservée à requireAdmin", () => {
    const card = readFileSync("src/components/admin/CommunitiesTab.tsx", "utf8");
    expect(card).toContain("setCommunityTowerChallengesAction");
    expect(card).toContain("The Tower (défis)");
    const actions = readFileSync("src/app/admin/communautes/actions.ts", "utf8");
    const fn = actions.slice(actions.indexOf("export async function setCommunityTowerChallengesAction"));
    expect(fn.slice(0, fn.indexOf("\nexport async function setCommunityTowerLevelsPerFloorAction"))).toMatch(/requireAdmin\(\)[\s\S]*recordSensitiveOperation|requireAdmin\(\)[\s\S]*logged\(admin\.id, "community\.tower_challenges"/);
  });
});
