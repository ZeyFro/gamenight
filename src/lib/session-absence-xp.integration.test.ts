import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const mocks = vi.hoisted(() => ({ user: { id: "" } }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: vi.fn(async () => mocks.user) }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(() => true) }));
vi.mock("@/lib/revanche", () => ({ checkRevancheAfterSessionResults: vi.fn(async () => undefined) }));
vi.mock("@/lib/debts", () => ({ detectDebts: vi.fn(async () => undefined) }));
vi.mock("@/lib/discord-level-up", () => ({ announceLevelUp: vi.fn() }));
vi.mock("@/lib/discord-badge-unlocked", () => ({ announceBadgeUnlocked: vi.fn() }));
vi.mock("@/lib/community-announce", () => ({ postToCommunity: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  if (TEST_DATABASE_URL && new URL(TEST_DATABASE_URL).hostname !== "127.0.0.1") throw new Error("Postgres local 127.0.0.1 uniquement");
  return { prisma: TEST_DATABASE_URL ? new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) : {} };
});
if (!TEST_DATABASE_URL) console.warn("[session-absence-xp] Postgres local absent : tests SKIPPÉS.");

describe.skipIf(!TEST_DATABASE_URL)("pénalité d'absence et bonus de présence : saisie des résultats, Postgres local", () => {
  let db: import("@prisma/client").PrismaClient;
  let xp: typeof import("./xp-actions");
  let results: typeof import("../app/sessions/actions/results");
  let communityId: string;
  let sessionId: string;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma;
    xp = await import("./xp-actions");
    results = await import("../app/sessions/actions/results");
  });
  afterAll(async () => { await db?.$disconnect(); });
  afterEach(() => vi.unstubAllEnvs());
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "false");
    await db.$executeRawUnsafe('TRUNCATE "SessionAttendance", "SessionResult", "XpEvent", "LevelUpEvent", "Vote", "Proposal", "Session", "CommunityMemberStats", "Membership", "Game", "User", "Community" CASCADE');
    (await import("./default-community")).resetDefaultCommunityIdCache();
    communityId = (await db.community.create({ data: { slug: "default", name: "default", status: "ACTIVE" } })).id;
    for (const name of ["creator", "present", "absent", "brokeAbsent"]) {
      ids[name] = (await db.user.create({ data: { discordId: name, discordName: name } })).id;
      await db.membership.create({ data: { communityId, userId: ids[name], status: "ACTIVE" } });
    }
    mocks.user.id = ids.creator;
    await db.communityMemberStats.createMany({ data: [
      { communityId, userId: ids.present, xpTotal: 100 },
      { communityId, userId: ids.absent, xpTotal: 100 },
      { communityId, userId: ids.brokeAbsent, xpTotal: 1 },
    ] });
    const game = await db.game.create({ data: { name: "Jeu", source: "MANUAL", addedById: ids.creator } });
    const session = await db.session.create({ data: {
      date: new Date("2020-01-01T20:00:00Z"), status: "DONE", decidedGameId: game.id, createdById: ids.creator, communityId,
    } });
    sessionId = session.id;
    const proposal = await db.proposal.create({ data: { sessionId, gameId: game.id, proposedById: ids.creator } });
    for (const name of ["present", "absent", "brokeAbsent"]) await db.vote.create({ data: { proposalId: proposal.id, userId: ids[name] } });
  });

  const setSettings = (data: { attendanceXpEnabled: boolean; attendanceBonusXp?: number; absencePenaltyXp?: number }) =>
    db.community.update({ where: { id: communityId }, data });
  const xpOf = async (name: string) => (await db.communityMemberStats.findUniqueOrThrow({ where: { communityId_userId: { communityId, userId: ids[name] } } })).xpTotal;
  const submit = () => {
    const form = new FormData();
    form.set("sessionId", sessionId);
    form.set(`present-${ids.present}`, "1");
    return results.submitSessionResultsAction(form);
  };

  it("réglage actif : l'absent perd la pénalité (plafonnée à son solde), le présent gagne le bonus, ledger cohérent", async () => {
    await setSettings({ attendanceXpEnabled: true, attendanceBonusXp: 2, absencePenaltyXp: 5 });
    await submit();
    expect(await xpOf("absent")).toBe(95);
    expect(await xpOf("brokeAbsent")).toBe(0);
    expect(await xpOf("present")).toBe(102);
    const events = await db.xpEvent.findMany({ where: { sourceId: sessionId } });
    expect(events.map((e) => [e.userId, e.reason, e.amount])).toEqual(expect.arrayContaining([
      [ids.absent, "SESSION_ABSENCE", -5],
      [ids.brokeAbsent, "SESSION_ABSENCE", -1],
      [ids.present, "SESSION_ATTENDANCE", 2],
    ]));
    expect(await db.sessionAttendance.findMany({ where: { sessionId }, select: { userId: true, present: true } }))
      .toEqual(expect.arrayContaining([{ userId: ids.present, present: true }, { userId: ids.absent, present: false }]));
  });

  it("réglage par défaut (désactivé) : aucune pénalité ni bonus, la présence reste enregistrée", async () => {
    await submit();
    expect(await xpOf("absent")).toBe(100);
    expect(await xpOf("present")).toBe(100);
    expect(await db.xpEvent.count({ where: { reason: { in: ["SESSION_ABSENCE", "SESSION_ATTENDANCE"] } } })).toBe(0);
    expect(await db.sessionAttendance.count({ where: { sessionId } })).toBe(3);
  });

  it("pas d'annulation par resoumission : un second envoi est ignoré, aucune double pénalité", async () => {
    await setSettings({ attendanceXpEnabled: true, attendanceBonusXp: 2, absencePenaltyXp: 5 });
    await submit();
    await submit();
    expect(await xpOf("absent")).toBe(95);
    expect(await db.xpEvent.count({ where: { reason: "SESSION_ABSENCE" } })).toBe(2);
  });

  it("applySessionAbsencePenalty est idempotente pour une même soirée (clé unique du ledger)", async () => {
    await expect(xp.applySessionAbsencePenalty(ids.absent, communityId, sessionId, 5)).resolves.toBe(true);
    await expect(xp.applySessionAbsencePenalty(ids.absent, communityId, sessionId, 5)).resolves.toBe(false);
    expect(await xpOf("absent")).toBe(95);
  });
});
