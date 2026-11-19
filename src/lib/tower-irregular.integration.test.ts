import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

/**
 * Irregular manuel sur PostgreSQL réel : droits du staff, révocation, journal, isolation par communauté et
 * lecture dans la progression personnelle. Nécessite `TEST_DATABASE_URL` : suite SKIPPÉE sinon.
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
if (!url) console.warn("[tower-irregular.integration.test] TEST_DATABASE_URL absente : suite SKIPPÉE, Irregular manuel NON validé sur SQL réel.");

describe.skipIf(!url)("Irregular manuel (PostgreSQL)", () => {
  let db: PrismaClient;
  let lib: typeof import("./tower-irregular");
  let progress: typeof import("./tower-personal-progress");
  const scope = "irreg-" + randomUUID();
  const communityId = scope + "-c1";
  const otherId = scope + "-c2";
  const id = (name: string) => scope + "-" + name;

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as PrismaClient;
    lib = await import("./tower-irregular");
    progress = await import("./tower-personal-progress");
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
    vi.stubEnv("TOWER_IRREGULAR_GRANTS_ENABLED", "true");
    await cleanup();
    await db.community.createMany({
      data: [communityId, otherId].map((target, index) => ({
        id: target, name: target, slug: target, status: "ACTIVE" as const, discordGuildId: scope + "-g" + index, towerChallengesEnabled: true,
      })),
    });
    for (const name of ["owner", "admin", "member", "target", "outsider", "left"]) {
      await db.user.create({ data: { id: id(name), discordId: id(name), discordName: name } });
    }
    const rows: [string, string, "OWNER" | "ADMIN" | "MEMBER", "ACTIVE" | "LEFT"][] = [
      ["owner", communityId, "OWNER", "ACTIVE"], ["admin", communityId, "ADMIN", "ACTIVE"], ["member", communityId, "MEMBER", "ACTIVE"],
      ["target", communityId, "MEMBER", "ACTIVE"], ["left", communityId, "MEMBER", "LEFT"], ["outsider", otherId, "ADMIN", "ACTIVE"],
    ];
    for (const [name, community, role, status] of rows) {
      await db.membership.create({ data: { userId: id(name), communityId: community, role, status } });
    }
  });

  it("est inactif sans le drapeau", async () => {
    vi.stubEnv("TOWER_IRREGULAR_GRANTS_ENABLED", "false");
    expect(await lib.grantTowerIrregular(id("owner"), communityId, { userId: id("target") })).toBe("unavailable");
    expect(await db.towerIrregularGrant.count()).toBe(0);
  });

  it("OWNER et ADMIN attribuent, un simple membre ou un admin d'une autre communauté non", async () => {
    expect(await lib.grantTowerIrregular(id("member"), communityId, { userId: id("target") })).toBe("forbidden");
    expect(await lib.grantTowerIrregular(id("outsider"), communityId, { userId: id("target") })).toBe("unavailable");
    expect(await lib.grantTowerIrregular(id("admin"), communityId, { userId: id("target") })).toBe("granted");
    expect(await lib.grantTowerIrregular(id("owner"), communityId, { userId: id("target") })).toBe("already");
    expect(await db.towerIrregularGrant.count()).toBe(1);
  });

  it("refuse un joueur qui n'est pas membre actif", async () => {
    expect(await lib.grantTowerIrregular(id("owner"), communityId, { userId: id("left") })).toBe("not_member");
    expect(await lib.grantTowerIrregular(id("owner"), communityId, { userId: id("outsider") })).toBe("not_member");
    expect(await lib.grantTowerIrregular(id("owner"), communityId, { userId: "" })).toBe("invalid");
  });

  it("révoque, journalise chaque mouvement et permet une nouvelle attribution", async () => {
    expect(await lib.revokeTowerIrregular(id("owner"), communityId, { userId: id("target") })).toBe("not_granted");
    await lib.grantTowerIrregular(id("owner"), communityId, { userId: id("target") });
    expect(await lib.revokeTowerIrregular(id("admin"), communityId, { userId: id("target") })).toBe("revoked");
    expect(await lib.grantTowerIrregular(id("owner"), communityId, { userId: id("target") })).toBe("granted");
    const log = await db.towerIrregularLog.findMany({ where: { communityId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    expect(log.map(entry => entry.action).sort()).toEqual(["GRANTED", "GRANTED", "REVOKED"]);
    const grant = await db.towerIrregularGrant.findUniqueOrThrow({ where: { communityId_userId: { communityId, userId: id("target") } } });
    expect(grant.revokedAt).toBeNull();
    expect(grant.grantedById).toBe(id("owner"));
  });

  it("la liste du staff est refusée à un simple membre", async () => {
    expect((await lib.listTowerIrregularForStaff(id("member"), communityId)).status).toBe("FORBIDDEN");
    const listed = await lib.listTowerIrregularForStaff(id("owner"), communityId);
    expect(listed.status).toBe("LISTED");
  });

  it("alimente le rang personnel : Irregular à 0 étage, Régulars après retrait, grade gagné prioritaire", async () => {
    const read = () => progress.getTowerPersonalProgress({ viewerId: id("owner"), memberId: id("target"), communityId });
    expect(await read()).toMatchObject({ status: "PROGRESS", rank: "Régulars" });
    await lib.grantTowerIrregular(id("owner"), communityId, { userId: id("target") });
    expect(await read()).toMatchObject({ rank: "Irregular" });
    await db.towerChallengeProgress.create({ data: { communityId, userId: id("target"), floorsClimbed: BigInt(30) } });
    expect(await read()).toMatchObject({ rank: "Ranker" });
    await db.towerChallengeProgress.delete({ where: { communityId_userId: { communityId, userId: id("target") } } });
    await lib.revokeTowerIrregular(id("owner"), communityId, { userId: id("target") });
    expect(await read()).toMatchObject({ rank: "Régulars" });
  });

  it("n'expose pas l'Irregular d'une autre communauté", async () => {
    await db.membership.create({ data: { userId: id("target"), communityId: otherId, role: "MEMBER", status: "ACTIVE" } });
    await lib.grantTowerIrregular(id("owner"), communityId, { userId: id("target") });
    const result = await progress.getTowerPersonalProgress({ viewerId: id("outsider"), memberId: id("target"), communityId: otherId });
    expect(result).toMatchObject({ status: "PROGRESS", rank: "Régulars" });
  });
});
