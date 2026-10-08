import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: TEST_DATABASE_URL ? new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) : {} };
});
if (!TEST_DATABASE_URL) console.warn("[session-slot-data.integration] TEST_DATABASE_URL absente — tests Postgres SKIPPÉS.");

describe.skipIf(!TEST_DATABASE_URL)("suggestions : roster revalidé en Postgres isolé", () => {
  let db: import("@prisma/client").PrismaClient;
  let load: typeof import("./session-slot-data").loadSessionSlotSuggestions;
  const now = new Date("2026-10-08T12:00:00Z");
  beforeAll(async () => { db = (await import("@/lib/prisma")).prisma as typeof db; load = (await import("./session-slot-data")).loadSessionSlotSuggestions; });
  afterAll(async () => { await db.$disconnect(); vi.unstubAllEnvs(); });
  beforeEach(async () => {
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "true"); vi.stubEnv("COMMUNITY_PICKER_ENABLED", "true");
    await db.$executeRawUnsafe('TRUNCATE "Community", "User" CASCADE');
    await db.community.createMany({ data: [{ id: "a", slug: "default", name: "A", status: "ACTIVE" }, { id: "b", slug: "b", name: "B", status: "ACTIVE" }] });
    await db.user.createMany({ data: [{ id: "host", discordId: "host", discordName: "Host", activeCommunityId: "a" }, { id: "friend-a", discordId: "a", discordName: "A" }, { id: "friend-b", discordId: "b", discordName: "B" }] });
    await db.membership.createMany({ data: [{ userId: "host", communityId: "a", status: "ACTIVE" }, { userId: "host", communityId: "b", status: "ACTIVE" }, { userId: "friend-a", communityId: "a", status: "ACTIVE" }, { userId: "friend-b", communityId: "b", status: "ACTIVE" }] });
    await db.weeklyAvailability.createMany({ data: ["host", "friend-a", "friend-b"].map((userId) => ({ userId, dayOfWeek: 4, startTime: "20:00", endTime: "23:00" })) });
  });
  it("ne retourne que les personnes du serveur choisi et refuse l'ajout d'un membre de B", async () => {
    expect(await load("host", ["friend-b"], 120, now)).toEqual({ ok: false, error: "participants_changed" });
    const allowed = await load("host", ["friend-a"], 120, now);
    expect(allowed.ok && allowed.suggestions[0]).toMatchObject({ availableCount: 2, totalParticipants: 2 });
    await db.user.update({ where: { id: "host" }, data: { activeCommunityId: "b" } });
    expect(await load("host", ["friend-a"], 120, now)).toEqual({ ok: false, error: "participants_changed" });
    expect((await load("host", ["friend-b"], 120, now)).ok).toBe(true);
  });
  it("revalide un invité retiré et un organisateur sans appartenance active", async () => {
    await db.membership.updateMany({ where: { userId: "friend-a" }, data: { status: "REMOVED" } });
    expect(await load("host", ["friend-a"], 120, now)).toEqual({ ok: false, error: "participants_changed" });
    await db.membership.updateMany({ where: { userId: "host" }, data: { status: "REMOVED" } });
    expect(await load("host", [], 120, now)).toEqual({ ok: false, error: "participants_changed" });
  });
  it("une communauté suspendue ne donne plus de suggestions pour son ancien roster", async () => {
    await db.community.update({ where: { id: "a" }, data: { status: "SUSPENDED" } });
    expect(await load("host", ["friend-a"], 120, now)).toEqual({ ok: false, error: "participants_changed" });
  });
  it("une exception d'indisponibilité bloque la proposition et aucun horaire brut n'est renvoyé", async () => {
    await db.availabilityOverride.create({ data: { userId: "friend-a", date: new Date("2026-10-08T00:00:00Z"), available: false } });
    expect(await load("host", ["friend-a"], 120, now)).toEqual({ ok: true, suggestions: [] });
    await db.availabilityOverride.deleteMany({});
    const result = JSON.stringify(await load("host", ["friend-a"], 120, now));
    expect(result).not.toContain("weekly"); expect(result).not.toContain("overrides"); expect(result).not.toContain("friend-a");
  });
  it("flags OFF : conserve le roster historique et déduplique l'organisateur", async () => {
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "false");
    const result = await load("host", ["host", "friend-b", "friend-b"], 120, now);
    expect(result.ok && result.suggestions[0]).toMatchObject({ availableCount: 2, totalParticipants: 2 });
  });
});
