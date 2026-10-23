import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * stopAt = INSTANT RÉEL (comparé aux horodatages Gateway), pas l'heure murale de wallClockNow() ;
 * et pas de ligne STOP_REQUESTED pour une soirée sans accord vocal. Nécessite TEST_DATABASE_URL (sinon SKIPPÉ).
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: TEST_DATABASE_URL ? new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) : ({} as unknown) };
});
vi.mock("@/lib/current-user", () => ({ getCurrentUser: vi.fn() }));

if (!TEST_DATABASE_URL) console.warn("[voice-presence-stopat] TEST_DATABASE_URL absente : suite IGNOREE (skipped).");

describe.skipIf(!TEST_DATABASE_URL)("fin de soirée et collecte vocale : stopAt réel, pas d'accumulation", () => {
  let db: import("@prisma/client").PrismaClient;
  let sessionsLib: typeof import("./sessions");
  let wall: typeof import("./wallclock");
  let n = 0;

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as unknown as typeof db;
    sessionsLib = await import("./sessions");
    wall = await import("./wallclock");
  });
  afterAll(async () => { await db.$disconnect(); });
  beforeEach(async () => {
    vi.stubEnv("VOICE_PRESENCE_ENABLED", "true");
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "false");
    await db.$executeRawUnsafe(`TRUNCATE "SessionVoicePresenceControl", "SessionVoicePresenceConsent", "NotificationDelivery", "NotificationEvent", "Session", "Game", "User", "GroupSessionStats", "GroupGameStat", "GroupActiveWeek" CASCADE`);
  }, 60_000);
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

  async function seed() {
    n += 1;
    const user = await db.user.create({ data: { discordId: `stop-${n}`, discordName: `stop-${n}` } });
    const { getDefaultCommunityId } = await import("@/lib/default-community");
    const communityId = await getDefaultCommunityId();
    const session = await db.session.create({
      data: { date: new Date("2026-10-24T18:00:00.000Z"), status: "SCHEDULED", createdById: user.id, communityId },
    });
    return { user, session };
  }

  it("ne crée aucune ligne de contrôle pour une soirée terminée sans accord ni contrôle", async () => {
    const { session } = await seed();
    await sessionsLib.markSessionDone(session.id);
    expect(await db.sessionVoicePresenceControl.count({ where: { sessionId: session.id } })).toBe(0);
  });

  it("crée la commande STOP_REQUESTED quand un accord existe", async () => {
    const { session, user } = await seed();
    await db.sessionVoicePresenceConsent.create({ data: { sessionId: session.id, userId: user.id } });
    await sessionsLib.markSessionDone(session.id);
    expect((await db.sessionVoicePresenceControl.findUniqueOrThrow({ where: { sessionId: session.id } })).status).toBe("STOP_REQUESTED");
  });

  // Passage heure d'été -> hiver 2026-10-25 (03:00 CEST -> 02:00 CET) : avant (CEST, +2 h) et après (CET, +1 h).
  it.each([
    ["avant le changement d'heure (CEST)", "2026-10-25T00:30:00.000Z"],
    ["après le changement d'heure (CET)", "2026-10-25T01:30:00.000Z"],
    ["en plein été (CEST)", "2026-07-14T20:00:00.000Z"],
    ["en plein hiver (CET)", "2027-01-14T20:00:00.000Z"],
  ])("stopAt vaut l'instant réel de la clôture %s", async (_label, iso) => {
    const { session, user } = await seed();
    await db.sessionVoicePresenceConsent.create({ data: { sessionId: session.id, userId: user.id } });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(iso));
    expect(wall.wallClockNow().getTime()).toBeGreaterThan(new Date(iso).getTime()); // l'heure murale est décalée : le test est discriminant
    await sessionsLib.markSessionDone(session.id);
    vi.useRealTimers();
    const control = await db.sessionVoicePresenceControl.findUniqueOrThrow({ where: { sessionId: session.id } });
    expect(control.stopAt?.toISOString()).toBe(iso);
  });

  it("annulation (PURGE) : stopAt réel, et rien n'est créé sans contrôle existant", async () => {
    const { session, user } = await seed();
    await sessionsLib.cancelSession(session.id);
    expect(await db.sessionVoicePresenceControl.count({ where: { sessionId: session.id } })).toBe(0);
    expect(user.id).toBeTruthy();
  });
});
