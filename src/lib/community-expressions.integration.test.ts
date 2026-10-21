import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
vi.mock("@/lib/current-user", () => ({ getCurrentUser: vi.fn() }));
vi.mock("next/navigation", () => ({ notFound: vi.fn(), redirect: vi.fn() }));
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: TEST_DATABASE_URL ? new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) : {} };
});

if (!TEST_DATABASE_URL) console.warn("[community-expressions] Postgres absent : tests de droits/isolation ignorés.");

describe.skipIf(!TEST_DATABASE_URL)("expressions : droits et isolation Postgres", () => {
  let db: import("@prisma/client").PrismaClient;
  let expressions: typeof import("./community-expressions");

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as unknown as typeof db;
    expressions = await import("./community-expressions");
  });
  afterAll(async () => { await db.$disconnect(); vi.unstubAllEnvs(); });
  beforeEach(async () => {
    vi.stubEnv("COMMUNITY_EXPRESSIONS_ENABLED", "true");
    vi.stubEnv("COMMUNITY_PICKER_ENABLED", "true");
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "false");
    const members = [
      ["expression-author", "expressions-a", "ADMIN"], ["expression-member", "expressions-a", "MEMBER"],
      ["expression-admin", "expressions-a", "ADMIN"], ["expression-owner", "expressions-a", "OWNER"],
      ["expression-outsider", "expressions-b", "OWNER"],
    ] as const;
    await db.$transaction([
      db.communityExpression.deleteMany({ where: { communityId: { in: ["expressions-a", "expressions-b"] } } }),
      db.membership.deleteMany({ where: { OR: [{ userId: { in: members.map(([id]) => id) } }, { communityId: { in: ["expressions-a", "expressions-b"] } }] } }),
      db.community.deleteMany({ where: { id: { in: ["expressions-a", "expressions-b"] } } }),
      db.user.deleteMany({ where: { id: { in: members.map(([id]) => id) } } }),
      db.community.createMany({ data: [
        { id: "expressions-a", slug: "expressions-a", name: "Serveur A", status: "ACTIVE" },
        { id: "expressions-b", slug: "expressions-b", name: "Serveur B", status: "ACTIVE" },
      ] }),
      db.user.createMany({ data: members.map(([id, communityId]) => ({ id, discordId: id, discordName: id, activeCommunityId: communityId })) }),
      db.membership.createMany({ data: members.map(([userId, communityId, role]) => ({ userId, communityId, status: "ACTIVE", role })) }),
    ]);
  });

  const input = { title: "Encore une !", meaning: "La dernière partie dure longtemps." };

  it("crée dans la communauté active et nettoie le texte", async () => {
    expect(await expressions.saveCommunityExpression("expression-author", null, " Encore une ! ", input.meaning)).toBe("saved");
    expect(await db.communityExpression.findFirstOrThrow()).toMatchObject({ communityId: "expressions-a", createdById: "expression-author", ...input });
  });

  it.each(["false", "true"])("isolation %s : aucune lecture/modification/suppression interserveur", async (isolation) => {
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", isolation);
    await expressions.saveCommunityExpression("expression-author", null, input.title, input.meaning);
    const row = await db.communityExpression.findFirstOrThrow();
    expect((await expressions.listCommunityExpressions("expression-outsider"))?.entries).toEqual([]);
    expect(await expressions.saveCommunityExpression("expression-outsider", row.id, "volé", "non")).toBe("unavailable");
    expect(await expressions.deleteCommunityExpression("expression-outsider", row.id)).toBe("unavailable");
    expect(await db.communityExpression.findUnique({ where: { id: row.id } })).toMatchObject(input);
  });

  it("réserve les mutations aux administrateurs, même pour un ancien auteur", async () => {
    await expressions.saveCommunityExpression("expression-author", null, input.title, input.meaning);
    const row = await db.communityExpression.findFirstOrThrow();
    expect(await expressions.saveCommunityExpression("expression-member", null, "non", "non")).toBe("unavailable");
    expect(await expressions.saveCommunityExpression("expression-member", row.id, "non", "non")).toBe("unavailable");
    expect(await expressions.deleteCommunityExpression("expression-member", row.id)).toBe("unavailable");
    await db.membership.update({ where: { communityId_userId: { communityId: "expressions-a", userId: "expression-author" } }, data: { role: "MEMBER" } });
    expect((await expressions.listCommunityExpressions("expression-author"))?.entries).toHaveLength(1);
    expect(await expressions.saveCommunityExpression("expression-author", row.id, "non", "non")).toBe("unavailable");
    expect(await expressions.deleteCommunityExpression("expression-author", row.id)).toBe("unavailable");
    for (const userId of ["expression-admin", "expression-owner"]) {
      expect(await expressions.saveCommunityExpression(userId, row.id, userId, "sens")).toBe("saved");
    }
    expect(await expressions.deleteCommunityExpression("expression-admin", row.id)).toBe("deleted");
    expect(await db.communityExpression.count()).toBe(0);
  });

  it("retient uniquement le serveur choisi pour un membre de plusieurs communautés", async () => {
    await expressions.saveCommunityExpression("expression-author", null, input.title, input.meaning);
    const row = await db.communityExpression.findFirstOrThrow();
    await db.membership.create({ data: { userId: "expression-author", communityId: "expressions-b", status: "ACTIVE", role: "OWNER" } });
    await db.user.update({ where: { id: "expression-author" }, data: { activeCommunityId: "expressions-b" } });
    expect(await expressions.listCommunityExpressions("expression-author")).toMatchObject({ community: { id: "expressions-b", name: "Serveur B" }, entries: [] });
    expect(await expressions.saveCommunityExpression("expression-author", row.id, "non", "non")).toBe("unavailable");
    expect(await expressions.deleteCommunityExpression("expression-author", row.id)).toBe("unavailable");
    expect(await expressions.saveCommunityExpression("expression-author", null, "Ancien onglet", "Sens", "expressions-a")).toBe("unavailable");
  });

  it.each(["Membership", "Community"])("revalide %s verrouillé lors d’un retrait concurrent", async (table) => {
    let release!: () => void;
    let locked!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const ready = new Promise<void>(resolve => { locked = resolve; });
    const blocker = db.$transaction(async tx => {
      if (table === "Membership") await tx.membership.update({ where: { communityId_userId: { communityId: "expressions-a", userId: "expression-author" } }, data: { status: "REMOVED" } });
      else await tx.community.update({ where: { id: "expressions-a" }, data: { status: "SUSPENDED" } });
      locked();
      await gate;
    }, { timeout: 15000 });
    await ready;
    const save = expressions.saveCommunityExpression("expression-author", null, input.title, input.meaning);
    try {
      await vi.waitFor(async () => {
        const waiting = await db.$queryRaw<{ pid: number }[]>`SELECT pid FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE '%FOR SHARE%'`;
        expect(waiting.length).toBeGreaterThan(0);
      }, { timeout: 4000 });
    } finally { release(); await blocker; }
    expect(await save).toBe("unavailable");
    expect(await db.communityExpression.count()).toBe(0);
  }, 15000);

  it("refuse toute action sans appartenance active, même isolation désactivée", async () => {
    await expressions.saveCommunityExpression("expression-author", null, input.title, input.meaning);
    const row = await db.communityExpression.findFirstOrThrow();
    await db.membership.update({ where: { communityId_userId: { communityId: "expressions-a", userId: "expression-author" } }, data: { status: "LEFT" } });
    expect(await expressions.listCommunityExpressions("expression-author")).toBeNull();
    expect(await expressions.saveCommunityExpression("expression-author", null, input.title, input.meaning)).toBe("unavailable");
    expect(await expressions.deleteCommunityExpression("expression-author", row.id)).toBe("unavailable");
  });

  it("refuse un choix de communauté devenu étranger et une communauté suspendue", async () => {
    await db.user.update({ where: { id: "expression-author" }, data: { activeCommunityId: "expressions-b" } });
    // Avec un seul membership, le sélecteur retient le seul serveur autorisé.
    expect((await expressions.listCommunityExpressions("expression-author"))?.community.id).toBe("expressions-a");
    await db.community.update({ where: { id: "expressions-a" }, data: { status: "SUSPENDED" } });
    expect(await expressions.listCommunityExpressions("expression-author")).toBeNull();
    expect(await expressions.saveCommunityExpression("expression-author", null, input.title, input.meaning)).toBe("unavailable");
  });

  it("valide côté serveur et ne fait rien lorsque le drapeau est éteint", async () => {
    expect(await expressions.saveCommunityExpression("expression-author", null, "x".repeat(121), "sens")).toBe("invalid");
    expect(await expressions.saveCommunityExpression("expression-author", new File([], "id"), "titre", "sens")).toBe("invalid");
    vi.stubEnv("COMMUNITY_EXPRESSIONS_ENABLED", "false");
    expect(await expressions.listCommunityExpressions("expression-author")).toBeNull();
    expect(await expressions.saveCommunityExpression("expression-author", null, input.title, input.meaning)).toBe("unavailable");
    expect(await db.communityExpression.count()).toBe(0);
  });
});
