import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: TEST_DATABASE_URL ? new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) : {} };
});
vi.mock("@/lib/current-user", () => ({ getCurrentUser: vi.fn() }));

if (!TEST_DATABASE_URL) console.warn("[calendar.integration] TEST_DATABASE_URL absente — isolation du calendrier SKIPPÉE.");

describe.skipIf(!TEST_DATABASE_URL)("calendrier : isolation et invitations (Postgres locale)", () => {
  let db: import("@prisma/client").PrismaClient;
  let calendar: typeof import("./calendar");
  const start = new Date("2026-10-08T00:00:00Z");
  const end = new Date("2026-10-09T00:00:00Z");
  const evening = new Date("2026-10-08T20:00:00Z");

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as typeof db;
    calendar = await import("./calendar");
  });
  afterAll(async () => { await db.$disconnect(); vi.unstubAllEnvs(); });
  beforeEach(async () => {
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "true");
    vi.stubEnv("COMMUNITY_PICKER_ENABLED", "true");
    await db.$executeRawUnsafe('TRUNCATE "Community", "User" CASCADE');
    await db.community.createMany({ data: [
      { id: "a", slug: "default", name: "Serveur A", status: "ACTIVE" },
      { id: "b", slug: "b", name: "Serveur B", status: "ACTIVE" },
    ] });
    await db.user.createMany({ data: [
      { id: "viewer", discordId: "1", discordName: "Lecteur", activeCommunityId: "a" },
      { id: "friend-a", discordId: "2", discordName: "A" },
      { id: "friend-b", discordId: "3", discordName: "B" },
    ] });
    await db.membership.createMany({ data: [
      { userId: "viewer", communityId: "a", status: "ACTIVE" },
      { userId: "viewer", communityId: "b", status: "ACTIVE" },
      { userId: "friend-a", communityId: "a", status: "ACTIVE" },
      { userId: "friend-b", communityId: "b", status: "ACTIVE" },
    ] });
    await db.session.createMany({ data: [
      { id: "visible-a", communityId: "a", createdById: "viewer", date: evening },
      { id: "visible-b", communityId: "b", createdById: "viewer", date: evening },
      { id: "private-a", communityId: "a", createdById: "friend-a", date: evening },
    ] });
    await db.weeklyAvailability.createMany({ data: [
      { userId: "friend-a", dayOfWeek: 4, startTime: "19:00", endTime: "23:00" },
      { userId: "friend-b", dayOfWeek: 4, startTime: "19:00", endTime: "23:00" },
    ] });
  });

  it("ne lit que le serveur sélectionné, même si le lecteur est créateur dans A et B", async () => {
    const data = await calendar.getCalendarData(start, end, "viewer");
    expect(data.users.map((user) => user.id).sort()).toEqual(["friend-a", "viewer"]);
    expect(data.days[0].sessions.map((session) => session.id)).toEqual(["visible-a"]);
    expect(data.days[0].hours[20].availableUserIds).toEqual(["friend-a"]);
    await db.user.update({ where: { id: "viewer" }, data: { activeCommunityId: "b" } });
    const switched = await calendar.getCalendarData(start, end, "viewer");
    expect(switched.users.map((user) => user.id).sort()).toEqual(["friend-b", "viewer"]);
    expect(switched.days[0].sessions.map((session) => session.id)).toEqual(["visible-b"]);
  });

  it("une invitation révoquée masque immédiatement une soirée privée", async () => {
    const invite = await db.sessionInvite.create({ data: { sessionId: "private-a", userId: "viewer", invitedById: "friend-a", status: "ACTIVE" } });
    expect((await calendar.getCalendarData(start, end, "viewer")).days[0].sessions).toHaveLength(2);
    await db.sessionInvite.update({ where: { id: invite.id }, data: { status: "REVOKED" } });
    expect((await calendar.getCalendarData(start, end, "viewer")).days[0].sessions.map((session) => session.id)).toEqual(["visible-a"]);
  });

  it("ne révèle que les roulettes créées ou invitées du serveur actif", async () => {
    await db.roulette.createMany({ data: [
      { id: "own", communityId: "a", createdById: "viewer", scheduledAt: evening, deadline: start },
      { id: "invited", communityId: "a", createdById: "friend-a", scheduledAt: evening, deadline: start, notifiedUserIds: ["viewer"] },
      { id: "private", communityId: "a", createdById: "friend-a", scheduledAt: evening, deadline: start, notifiedUserIds: [] },
      { id: "other-server", communityId: "b", createdById: "viewer", scheduledAt: evening, deadline: start },
    ] });
    expect((await calendar.getCalendarData(start, end, "viewer")).days[0].roulettes?.map((roulette) => roulette.id).sort()).toEqual(["invited", "own"]);
  });

  it("affiche les dates du serveur actif et seulement les anniversaires de membres actifs", async () => {
    await db.communityDate.createMany({ data: [
      { id: "important-a", communityId: "a", createdById: "viewer", kind: "IMPORTANT", title: "Lancement", date: start, repeatsAnnually: false },
      { id: "important-b", communityId: "b", createdById: "viewer", kind: "IMPORTANT", title: "Privé", date: start, repeatsAnnually: false },
      { id: "birthday-a", communityId: "a", createdById: "friend-a", memberId: "friend-a", kind: "BIRTHDAY", date: new Date("2000-10-08T00:00:00Z"), repeatsAnnually: true },
      { id: "birthday-left", communityId: "a", createdById: "friend-b", memberId: "friend-b", kind: "BIRTHDAY", date: new Date("2000-10-08T00:00:00Z"), repeatsAnnually: true },
    ] });
    await db.membership.create({ data: { userId: "friend-b", communityId: "a", status: "REMOVED" } });
    const events = (await calendar.getCalendarData(start, end, "viewer")).days[0].communityDates;
    expect(events.map((event) => event.title).sort()).toEqual(["Anniversaire · A", "Lancement"]);
  });

  it("les filtres de disponibilité ne retirent pas les choix du panneau de potes", async () => {
    const data = await calendar.getCalendarData(start, end, "viewer", ["viewer", "friend-b"]);
    expect(data.users.map((user) => user.id).sort()).toEqual(["friend-a", "viewer"]);
    expect(data.days[0].hours[20].availableUserIds).toEqual([]);
  });

  it("sans appartenance active, aucune donnée collective n'est retournée", async () => {
    await db.membership.updateMany({ where: { userId: "viewer" }, data: { status: "REMOVED" } });
    const data = await calendar.getCalendarData(start, end, "viewer");
    expect(data.users).toEqual([]);
    expect(data.days[0].sessions).toEqual([]);
    expect(data.days[0].roulettes).toEqual([]);
    expect(data.ownWeeklySlots).toEqual([]);
    expect(data.ownOverrides).toEqual([]);
  });

  it("réutilise seulement les disponibilités du lecteur pour l'édition, même si le filtre l'exclut", async () => {
    await db.weeklyAvailability.create({ data: { userId: "viewer", dayOfWeek: 4, startTime: "20:00", endTime: "22:00" } });
    await db.availabilityOverride.createMany({ data: [
      { userId: "viewer", date: start, available: false },
      { userId: "friend-a", date: start, available: true, startTime: "19:00", endTime: "23:00" },
    ] });
    const data = await calendar.getCalendarData(start, end, "viewer", ["friend-a"]);
    expect(data.ownWeeklySlots).toEqual([{ dayOfWeek: 4, startTime: "20:00", endTime: "22:00" }]);
    expect(data.ownOverrides).toEqual([{ date: start, available: false, startTime: null, endTime: null }]);
    expect(data.days[0].hours[20].availableUserIds).toEqual(["friend-a"]);
  });
});
