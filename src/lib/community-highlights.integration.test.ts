import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  if (TEST_DATABASE_URL && new URL(TEST_DATABASE_URL).hostname !== "127.0.0.1") throw new Error("Postgres local uniquement");
  return { prisma: TEST_DATABASE_URL ? new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) : {} };
});
if (!TEST_DATABASE_URL) console.warn("[community-highlights] Postgres absent : intégrations SKIPPÉES.");

describe.skipIf(!TEST_DATABASE_URL)("musée communautaire : droits et isolation", () => {
  let db: import("@prisma/client").PrismaClient;
  let api: typeof import("./community-highlights");
  const input = { kind: "SHAME", title: "Le saut raté", description: "On avait pourtant un parachute.", mediaUrl: "https://example.org/clip" };
  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma;
    api = await import("./community-highlights");
  });
  afterAll(async () => { await db?.$disconnect(); });
  afterEach(() => vi.unstubAllEnvs());
  beforeEach(async () => {
    vi.stubEnv("COMMUNITY_HIGHLIGHTS_ENABLED", "true");
    vi.stubEnv("COMMUNITY_PICKER_ENABLED", "false");
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "true");
    const people = ["alice", "bob", "admin", "other"];
    await db.$transaction([
      db.creationIntent.deleteMany({ where: { actorId: { in: people }, kind: "community-highlight" } }),
      db.user.deleteMany({ where: { id: { in: people } } }),
      db.community.deleteMany({ where: { id: { in: ["a", "b"] } } }),
      db.community.createMany({ data: ["a", "b"].map(id => ({ id, slug: id, name: id, status: "ACTIVE" })) }),
      db.user.createMany({ data: people.map(id => ({ id, discordId: id, discordName: id })) }),
      db.membership.createMany({ data: people.map(id => ({ userId: id, communityId: id === "other" ? "b" : "a", role: id === "admin" ? "ADMIN" : "MEMBER" })) }),
    ]);
  });

  it("crée, lit, édite puis supprime un souvenir de son serveur", async () => {
    expect(await api.saveCommunityHighlight("alice", null, input)).toBe(true);
    const page = await api.listCommunityHighlights("alice", 1);
    expect(page?.communityName).toBe("a");
    expect(page?.items).toHaveLength(1);
    const id = page!.items[0].id;
    expect(await api.saveCommunityHighlight("alice", id, { ...input, kind: "FAME", title: "Sauvetage" })).toBe(true);
    expect((await api.listCommunityHighlights("alice", 1))?.items[0].title).toBe("Sauvetage");
    expect(await api.deleteCommunityHighlight("alice", id)).toBe(true);
    expect((await api.listCommunityHighlights("alice", 1))?.items).toHaveLength(0);
  });

  it("ne publie qu'une fois une double soumission du même formulaire", async () => {
    const key = "highlight-double-submit";
    expect(await Promise.all([
      api.saveCommunityHighlight("alice", null, input, { creationKey: key }),
      api.saveCommunityHighlight("alice", null, input, { creationKey: key }),
    ])).toEqual([true, true]);
    expect(await db.communityHighlight.count()).toBe(1);
  });

  it("refuse un formulaire ouvert sur un autre serveur", async () => {
    expect(await api.saveCommunityHighlight("alice", null, input, { communityId: "b" })).toBe(false);
    expect(await db.communityHighlight.count()).toBe(0);
  });

  it.each(["true", "false"])("isole lecture et mutations même isolation=%s", async (isolation) => {
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", isolation);
    await api.saveCommunityHighlight("alice", null, input);
    const id = (await api.listCommunityHighlights("alice", 1))!.items[0].id;
    expect((await api.listCommunityHighlights("other", 1))?.items).toHaveLength(0);
    expect(await api.saveCommunityHighlight("other", id, input)).toBe(false);
    expect(await api.deleteCommunityHighlight("other", id)).toBe(false);
    expect(await api.deleteCommunityHighlight("bob", id)).toBe(false);
    expect(await api.saveCommunityHighlight("bob", id, input)).toBe(false);
    expect(await api.saveCommunityHighlight("admin", id, { ...input, title: "Modéré" })).toBe(true);
    expect(await api.deleteCommunityHighlight("admin", id)).toBe(true);
  });

  it("refuse membre retiré, communauté suspendue, saisie invalide et flag OFF", async () => {
    expect(await api.saveCommunityHighlight("alice", null, { ...input, mediaUrl: "javascript:alert(1)" })).toBe(false);
    await db.membership.update({ where: { communityId_userId: { communityId: "a", userId: "alice" } }, data: { status: "REMOVED" } });
    expect(await api.saveCommunityHighlight("alice", null, input)).toBe(false);
    expect(await api.listCommunityHighlights("alice", 1)).toBeNull();
    await db.community.update({ where: { id: "a" }, data: { status: "SUSPENDED" } });
    expect(await api.saveCommunityHighlight("bob", null, input)).toBe(false);
    vi.stubEnv("COMMUNITY_HIGHLIGHTS_ENABLED", "false");
    expect(await api.listCommunityHighlights("other", 1)).toBeNull();
    expect(await db.communityHighlight.count()).toBe(0);
  });
});
