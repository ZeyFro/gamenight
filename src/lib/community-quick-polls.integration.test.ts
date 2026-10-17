import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const clock = vi.hoisted(() => ({ now: new Date("2026-10-17T10:00:00Z") }));
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  if (TEST_DATABASE_URL && new URL(TEST_DATABASE_URL).hostname !== "127.0.0.1") throw new Error("Postgres local uniquement");
  return { prisma: TEST_DATABASE_URL ? new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) : {} };
});
vi.mock("@/lib/wallclock", async () => ({ ...await vi.importActual<typeof import("./wallclock")>("./wallclock"), wallClockNow: () => new Date(clock.now) }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
if (!TEST_DATABASE_URL) console.warn("[community-quick-polls] Postgres absent : intégrations ignorées.");

describe.skipIf(!TEST_DATABASE_URL)("sondages éclair : droits, résultats et échéance Postgres", () => {
  let db: import("@prisma/client").PrismaClient;
  let api: typeof import("./community-quick-polls");
  const input = { question: "On joue ?", options: ["Oui", "Non"], durationMinutes: 60 };
  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as unknown as typeof db;
    api = await import("./community-quick-polls");
  });
  afterAll(async () => { await db?.$disconnect(); vi.unstubAllEnvs(); });
  beforeEach(async () => {
    clock.now = new Date("2026-10-17T10:00:00Z");
    vi.stubEnv("COMMUNITY_QUICK_POLLS_ENABLED", "true");
    vi.stubEnv("COMMUNITY_PICKER_ENABLED", "true");
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "false");
    await db.$transaction([
      db.$executeRawUnsafe('TRUNCATE "CommunityQuickPollVote", "CommunityQuickPoll", "CreationIntent", "Membership", "Community", "User" CASCADE'),
      db.community.createMany({ data: ["quick-a", "quick-b"].map(id => ({ id, slug: id, name: id, status: "ACTIVE" })) }),
      db.user.createMany({ data: ["author", "member", "outsider"].map(id => ({ id, discordId: id, discordName: id, activeCommunityId: id === "outsider" ? "quick-b" : "quick-a" })) }),
      db.membership.createMany({ data: ["author", "member", "outsider"].map(userId => ({ userId, communityId: userId === "outsider" ? "quick-b" : "quick-a", status: "ACTIVE" })) }),
    ]);
  });
  async function create() {
    expect(await api.createCommunityQuickPoll("author", input)).toBe("saved");
    return db.communityQuickPoll.findFirstOrThrow();
  }

  it("crée une seule fois, remplace le vote et présente seulement les résultats agrégés", async () => {
    const key = "quick-poll-double-submit";
    expect(await Promise.all([api.createCommunityQuickPoll("author", input, undefined, key), api.createCommunityQuickPoll("author", input, undefined, key)])).toEqual(["saved", "saved"]);
    expect(await db.communityQuickPoll.count()).toBe(1);
    expect(await api.createCommunityQuickPoll("author", { ...input, question: "Réécrit ?", options: ["Autre", "Encore"] }, undefined, key)).toBe("saved");
    const poll = await db.communityQuickPoll.findFirstOrThrow();
    expect(poll.question).toBe(input.question); expect(poll.options).toEqual(input.options);
    expect(poll.endsAt.toISOString()).toBe("2026-10-17T11:00:00.000Z");
    expect(await api.voteCommunityQuickPoll("author", poll.id, "0")).toBe("saved");
    expect(await api.voteCommunityQuickPoll("member", poll.id, "1")).toBe("saved");
    expect(await api.voteCommunityQuickPoll("member", poll.id, "0")).toBe("saved");
    expect(await db.communityQuickPollVote.count()).toBe(2);
    const page = await api.listCommunityQuickPolls("member");
    expect(page?.polls[0]).toMatchObject({ results: [{ label: "Oui", count: 2 }, { label: "Non", count: 0 }], selectedOption: 0, closed: false });
    expect(JSON.stringify(page)).not.toMatch(/userId|createdById|discordName/);
  });
  it.each(["false", "true"])("isole lecture et vote même isolation=%s", async isolation => {
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", isolation);
    const poll = await create();
    expect((await api.listCommunityQuickPolls("outsider"))?.polls).toEqual([]);
    expect(await api.voteCommunityQuickPoll("outsider", poll.id, "0")).toBe("unavailable");
    expect(await db.communityQuickPollVote.count()).toBe(0);
  });
  it("refuse l’option inexistante et ferme à l’instant exact sans cron", async () => {
    const poll = await create();
    expect(await api.voteCommunityQuickPoll("author", poll.id, "5")).toBe("invalid");
    clock.now = new Date(poll.endsAt);
    expect(await api.voteCommunityQuickPoll("author", poll.id, "0")).toBe("closed");
    expect((await api.listCommunityQuickPolls("author"))?.polls[0].closed).toBe(true);
    expect(await db.communityQuickPollVote.count()).toBe(0);
  });
  it("deux votes concurrents du même membre ne créent qu’un choix", async () => {
    const poll = await create();
    expect(await Promise.all([api.voteCommunityQuickPoll("member", poll.id, "0"), api.voteCommunityQuickPoll("member", poll.id, "1")])).toEqual(["saved", "saved"]);
    expect(await db.communityQuickPollVote.count()).toBe(1);
    expect((await api.listCommunityQuickPolls("author"))?.polls[0].results.reduce((sum, row) => sum + row.count, 0)).toBe(1);
  });
  it("refuse un ancien onglet après choix d’un autre serveur", async () => {
    const poll = await create();
    await db.membership.create({ data: { communityId: "quick-b", userId: "author", status: "ACTIVE" } });
    await db.user.update({ where: { id: "author" }, data: { activeCommunityId: "quick-b" } });
    expect(await api.createCommunityQuickPoll("author", input, "quick-a")).toBe("unavailable");
    expect(await api.voteCommunityQuickPoll("author", poll.id, "0", "quick-a")).toBe("unavailable");
  });
  it("refuse un membre retiré, une communauté suspendue et le drapeau OFF", async () => {
    const poll = await create();
    await db.membership.update({ where: { communityId_userId: { communityId: "quick-a", userId: "member" } }, data: { status: "LEFT" } });
    expect(await api.listCommunityQuickPolls("member")).toBeNull();
    expect(await api.voteCommunityQuickPoll("member", poll.id, "0")).toBe("unavailable");
    await db.community.update({ where: { id: "quick-a" }, data: { status: "SUSPENDED" } });
    expect(await api.createCommunityQuickPoll("author", input)).toBe("unavailable");
    vi.stubEnv("COMMUNITY_QUICK_POLLS_ENABLED", "false");
    expect(await api.createCommunityQuickPoll("outsider", input)).toBe("unavailable");
    expect(await api.listCommunityQuickPolls("outsider")).toBeNull();
  });
  it("contrôle l’échéance après avoir attendu le verrou du sondage", async () => {
    const poll = await create();
    let release!: () => void; let locked!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const ready = new Promise<void>(resolve => { locked = resolve; });
    const blocker = db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "CommunityQuickPoll" WHERE id = ${poll.id} FOR UPDATE`;
      locked(); await gate;
    }, { timeout: 15000 });
    await ready;
    const voting = api.voteCommunityQuickPoll("member", poll.id, "0");
    try {
      await vi.waitFor(async () => {
        const waiting = await db.$queryRaw<{ pid: number }[]>`SELECT pid FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE '%FOR UPDATE%'`;
        expect(waiting.length).toBeGreaterThan(0);
      }, { timeout: 4000 });
      clock.now = new Date(poll.endsAt);
    } finally { release(); await blocker; }
    expect(await voting).toBe("closed");
    expect(await db.communityQuickPollVote.count()).toBe(0);
  }, 15000);
  it("la contrainte refuse un vote rattaché au mauvais serveur", async () => {
    const poll = await create();
    await expect(db.communityQuickPollVote.create({ data: { communityId: "quick-b", pollId: poll.id, userId: "outsider", optionIndex: 0 } })).rejects.toThrow();
  });
});
