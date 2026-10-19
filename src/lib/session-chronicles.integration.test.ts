import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  if (TEST_DATABASE_URL && new URL(TEST_DATABASE_URL).hostname !== "127.0.0.1") throw new Error("Postgres local uniquement");
  return { prisma: TEST_DATABASE_URL ? new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) : {} };
});
if (!TEST_DATABASE_URL) console.warn("[session-chronicles] Postgres absent : intégrations SKIPPÉES.");

describe.skipIf(!TEST_DATABASE_URL)("chroniques privées : droits, archivage et rétention", () => {
  let db: import("@prisma/client").PrismaClient;
  let api: typeof import("./session-chronicles");
  let defaultCommunityId: string;
  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma;
    api = await import("./session-chronicles");
  });
  afterAll(async () => { await db?.$disconnect(); });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  beforeEach(async () => {
    vi.stubEnv("SESSION_CHRONICLES_ENABLED", "true");
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "true");
    vi.stubEnv("COMMUNITY_PICKER_ENABLED", "true");
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Réseau interdit"); }));
    (await import("./default-community")).resetDefaultCommunityIdCache();
    // Nettoyage limité aux fixtures : TRUNCATE CASCADE réécrit une centaine de tables.
    await db.$transaction(async tx => {
      const users = ["chronicle-alice", "chronicle-guest", "chronicle-stranger", "chronicle-admin", "chronicle-other", "chronicle-both"];
      await tx.session.deleteMany({ where: { createdById: { in: users } } });
      await tx.user.deleteMany({ where: { id: { in: users } } });
      await tx.community.deleteMany({ where: { id: { in: ["chronicle-a", "chronicle-b"] } } });
      await tx.community.createMany({ data: ["chronicle-a", "chronicle-b"].map(id => ({ id, slug: id, name: id, status: "ACTIVE" as const })) });
      defaultCommunityId = (await tx.community.upsert({ where: { slug: "default" }, create: { slug: "default", name: "Default", status: "ACTIVE" }, update: { status: "ACTIVE" } })).id;
      await tx.user.createMany({ data: users.map(id => ({ id, discordId: id, discordName: id, role: id === "chronicle-admin" ? "ADMIN" as const : "USER" as const })) });
      await tx.membership.createMany({ data: [...users.map(id => ({ userId: id, communityId: id === "chronicle-other" ? "chronicle-b" : "chronicle-a" })), { userId: "chronicle-both", communityId: "chronicle-b" }] });
      await tx.user.update({ where: { id: "chronicle-both" }, data: { activeCommunityId: "chronicle-a" } });
    });
  });
  const session = (communityId = "chronicle-a", createdById = "chronicle-alice", chronicle: string | null = null, status: import("@prisma/client").SessionStatus = "DONE") => db.session.create({ data: { communityId, createdById, chronicle, status, date: new Date("2020-01-01"), superlativeVotingClosed: true } });
  const invite = (sessionId: string, userId: string) => db.sessionInvite.create({ data: { sessionId, userId, invitedById: "chronicle-alice" } });

  it("le créateur édite ; un invité ordinaire et un admin global n'ont pas ce droit", async () => {
    const row = await session();
    await invite(row.id, "chronicle-guest");
    expect(await api.saveSessionChronicle("chronicle-alice", row.id, " Le clutch final ")).toBe(true);
    expect(await api.saveSessionChronicle("chronicle-guest", row.id, "Réécriture")).toBe(false);
    expect(await api.saveSessionChronicle("chronicle-admin", row.id, "Réécriture")).toBe(false);
    expect((await api.listSessionChronicles("chronicle-guest", 1))?.items.map(item => item.chronicle)).toEqual(["Le clutch final"]);
    expect((await api.listSessionChronicles("chronicle-stranger", 1))?.items).toEqual([]);
    expect((await api.listSessionChronicles("chronicle-admin", 1))?.items).toEqual([]);
    await db.sessionInvite.update({ where: { sessionId_userId: { sessionId: row.id, userId: "chronicle-guest" } }, data: { status: "REVOKED" } });
    expect((await api.listSessionChronicles("chronicle-guest", 1))?.items).toEqual([]);
  });
  it.each(["ADMIN", "OWNER"] as const)("un %s communautaire invité édite sans donner accès aux autres admins", async role => {
    const row = await session();
    await db.membership.update({ where: { communityId_userId: { communityId: "chronicle-a", userId: "chronicle-admin" } }, data: { role } });
    expect(await api.saveSessionChronicle("chronicle-admin", row.id, "Sans invitation")).toBe(false);
    await invite(row.id, "chronicle-admin");
    expect(await api.saveSessionChronicle("chronicle-admin", row.id, "Souvenir modéré")).toBe(true);
    expect((await db.session.findUniqueOrThrow({ where: { id: row.id } })).chronicle).toBe("Souvenir modéré");
    await db.sessionInvite.update({ where: { sessionId_userId: { sessionId: row.id, userId: "chronicle-admin" } }, data: { status: "REVOKED" } });
    expect(await api.saveSessionChronicle("chronicle-admin", row.id, "Invitation retirée")).toBe(false);
    expect((await db.session.findUniqueOrThrow({ where: { id: row.id } })).chronicle).toBe("Souvenir modéré");
  });
  it.each(["true", "false"])("borne l'archive à son serveur actif même isolation=%s", async isolation => {
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", isolation);
    const a = await session("chronicle-a", "chronicle-both", "Serveur A");
    await session("chronicle-b", "chronicle-both", "Serveur B");
    expect((await api.listSessionChronicles("chronicle-both", 1))?.items.map(item => item.id)).toEqual([a.id]);
    expect((await api.listSessionChronicles("chronicle-other", 1))?.items).toEqual([]);
    expect(await api.saveSessionChronicle("chronicle-other", a.id, "Intrusion")).toBe(false);
    await db.membership.update({ where: { communityId_userId: { communityId: "chronicle-a", userId: "chronicle-both" } }, data: { status: "LEFT" } });
    expect(await api.saveSessionChronicle("chronicle-both", a.id, "Après départ")).toBe(false);
    await db.membership.update({ where: { communityId_userId: { communityId: "chronicle-a", userId: "chronicle-both" } }, data: { status: "ACTIVE" } });
    const oldCommunitySession = await session("chronicle-a", "chronicle-both");
    await db.user.update({ where: { id: "chronicle-both" }, data: { activeCommunityId: "chronicle-b" } });
    expect(await api.saveSessionChronicle("chronicle-both", oldCommunitySession.id, "Depuis un ancien serveur")).toBe(false);
  });
  it("refuse soirées non terminées, saisie trop longue, serveur suspendu et flag OFF", async () => {
    for (const status of ["VOTING", "SCHEDULED", "CANCELLED"] as const) {
      expect(await api.saveSessionChronicle("chronicle-alice", (await session("chronicle-a", "chronicle-alice", null, status)).id, "Texte")).toBe(false);
    }
    const row = await session();
    expect(await api.saveSessionChronicle("chronicle-alice", row.id, "x".repeat(10001))).toBe(false);
    await db.community.update({ where: { id: "chronicle-a" }, data: { status: "SUSPENDED" } });
    expect(await api.saveSessionChronicle("chronicle-alice", row.id, "Texte")).toBe(false);
    expect(await api.listSessionChronicles("chronicle-alice", 1)).toBeNull();
    vi.stubEnv("SESSION_CHRONICLES_ENABLED", "false");
    expect(await api.saveSessionChronicle("chronicle-alice", row.id, "Texte")).toBe(false);
    expect(await api.listSessionChronicles("chronicle-alice", 1)).toBeNull();
  });
  it("préserve l'accès des soirées historiques rattachées au serveur default", async () => {
    await db.membership.create({ data: { communityId: defaultCommunityId, userId: "chronicle-alice" } });
    await db.user.update({ where: { id: "chronicle-alice" }, data: { activeCommunityId: defaultCommunityId } });
    const row = await db.session.create({ data: { communityId: null, createdById: "chronicle-alice", date: new Date(), status: "DONE" } });
    expect(await api.saveSessionChronicle("chronicle-alice", row.id, "Souvenir historique")).toBe(true);
    expect((await api.listSessionChronicles("chronicle-alice", 1))?.items.map(item => item.id)).toEqual([row.id]);
  });
  it("conserve la chronique à la purge même flag OFF, jusqu'à effacement volontaire", async () => {
    const archived = await session("chronicle-a", "chronicle-alice", "Souvenir durable");
    const plain = await session();
    vi.stubEnv("SESSION_CHRONICLES_ENABLED", "false");
    const retention = await import("./retention");
    const dry = await retention.purgeEligibleSessionsBatch({ dryRun: true });
    expect(dry.blockedSessions).toContainEqual({ sessionId: archived.id, reason: "chronicle" });
    const purged = await retention.purgeEligibleSessionsBatch({ dryRun: false });
    expect(purged.purgedSessionIds).toContain(plain.id);
    expect(await db.session.findUnique({ where: { id: archived.id } })).not.toBeNull();
    vi.stubEnv("SESSION_CHRONICLES_ENABLED", "true");
    expect(await api.saveSessionChronicle("chronicle-alice", archived.id, " \n ")).toBe(true);
    await retention.purgeEligibleSessionsBatch({ dryRun: false });
    expect(await db.session.findUnique({ where: { id: archived.id } })).toBeNull();
  });
  it("pagine seulement les chroniques accessibles, pas les soirées privées d'autrui", async () => {
    await db.session.createMany({ data: Array.from({ length: 22 }, (_, i) => ({ communityId: "chronicle-a", createdById: "chronicle-alice", chronicle: `Souvenir ${i}`, status: "DONE" as const, date: new Date("2020-01-01"), superlativeVotingClosed: true })) });
    await session("chronicle-a", "chronicle-stranger", "Privé");
    const first = await api.listSessionChronicles("chronicle-alice", 1);
    const second = await api.listSessionChronicles("chronicle-alice", 2);
    expect(first?.items).toHaveLength(20);
    expect(first?.hasNext).toBe(true);
    expect(second?.items).toHaveLength(2);
    expect(second?.hasNext).toBe(false);
    expect(await api.listSessionChronicles("chronicle-alice", -1)).toBeNull();
  });
  it("relit sous verrou une chronique enregistrée pendant la purge", async () => {
    const row = await session();
    let locked!: () => void;
    const ready = new Promise<void>(resolve => { locked = resolve; });
    let release!: () => void;
    const proceed = new Promise<void>(resolve => { release = resolve; });
    const writing = db.$transaction(async tx => {
      await tx.session.update({ where: { id: row.id }, data: { chronicle: "Écrite pendant le nettoyage" } });
      locked();
      await proceed;
    }, { timeout: 10000 });
    await ready;
    const purging = (await import("./retention")).purgeEligibleSessionsBatch({ dryRun: false });
    try {
      await vi.waitFor(async () => {
        const waiting = await db.$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE '%SELECT s.id%' AND query LIKE '%FROM "Session" s%'`;
        expect(Number(waiting[0].count)).toBeGreaterThan(0);
      }, { timeout: 5000 });
    } finally { release(); await Promise.all([writing, purging]); }
    const result = await purging;
    expect(result.purgedSessionIds).not.toContain(row.id);
    expect(result.blockedSessions).toContainEqual({ sessionId: row.id, reason: "chronicle" });
    expect((await db.session.findUniqueOrThrow({ where: { id: row.id } })).chronicle).toBe("Écrite pendant le nettoyage");
  }, 15000);
});
