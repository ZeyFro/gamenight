import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Code déployé AVANT les migrations vocales : drapeau VOICE_PRESENCE_ENABLED éteint = aucune requête
 * sur les tables vocales. Base requise : LEGACY_SCHEMA_DATABASE_URL, migrée UNIQUEMENT avec les migrations
 * de origin/main (sans les 4 migrations vocales ; voir docs/discord-voice-collector.md, « Ordre de déploiement »).
 * Toute requête vocale échouerait ici (relation inexistante). Suite SKIPPÉE si la variable est absente.
 */
const LEGACY_URL = process.env.LEGACY_SCHEMA_DATABASE_URL;

vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: LEGACY_URL ? new PrismaClient({ datasourceUrl: LEGACY_URL }) : ({} as unknown) };
});
vi.mock("@/lib/current-user", () => ({ getCurrentUser: vi.fn() }));

if (!LEGACY_URL) console.warn("[voice-presence-flag-off] LEGACY_SCHEMA_DATABASE_URL absente : suite IGNOREE (skipped).");

describe.skipIf(!LEGACY_URL)("drapeau vocal éteint sur un schéma sans tables vocales", () => {
  let db: import("@prisma/client").PrismaClient;
  let sessionsLib: typeof import("./sessions");
  let presence: typeof import("./session-voice-presence");
  let retention: typeof import("./retention-runner");
  let n = 0;

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as unknown as typeof db;
    expect(await db.$queryRaw<unknown[]>`SELECT to_regclass('"SessionVoicePresenceControl"')::text AS t`).toEqual([{ t: null }]);
    sessionsLib = await import("./sessions");
    presence = await import("./session-voice-presence");
    retention = await import("./retention-runner");
  });
  afterAll(async () => { await db.$disconnect(); });
  beforeEach(async () => {
    vi.stubEnv("VOICE_PRESENCE_ENABLED", "");
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "false");
    await db.$executeRawUnsafe(`TRUNCATE "NotificationDelivery", "NotificationEvent", "Session", "Game", "User", "GroupSessionStats", "GroupGameStat", "GroupActiveWeek" CASCADE`);
  }, 60_000);

  async function seed(status: "VOTING" | "SCHEDULED") {
    n += 1;
    const user = await db.user.create({ data: { discordId: `legacy-${n}`, discordName: `legacy-${n}` } });
    const { getDefaultCommunityId } = await import("@/lib/default-community");
    const communityId = await getDefaultCommunityId();
    await db.membership.create({ data: { userId: user.id, communityId, status: "ACTIVE" } });
    const session = await db.session.create({
      data: { date: new Date("2026-09-20T20:00:00.000Z"), status, createdById: user.id, communityId },
    });
    return { user, session };
  }

  it("lit la page de soirée sans toucher aux tables vocales (panneau désactivé)", async () => {
    const { user, session } = await seed("SCHEDULED");
    const result = await presence.readSessionVoicePresence(session.id, user.id);
    expect(result).toMatchObject({ enabled: false, consented: false, canConsent: false, entries: [], gapPeriods: [] });
  });

  it("annule une soirée sans erreur", async () => {
    const { session } = await seed("VOTING");
    await sessionsLib.cancelSession(session.id);
    expect((await db.session.findUniqueOrThrow({ where: { id: session.id } })).status).toBe("CANCELLED");
  });

  it("clôture une soirée (markSessionDone) sans erreur", async () => {
    const { session } = await seed("SCHEDULED");
    await sessionsLib.markSessionDone(session.id);
    expect((await db.session.findUniqueOrThrow({ where: { id: session.id } })).status).toBe("DONE");
  });

  it("exécute la rétention (dry-run et réel) sans passer par les tables vocales", async () => {
    for (const dryRun of [true, false]) {
      const report = await retention.runRetentionCleanup({ dryRun });
      expect(report.errors.filter(error => error.startsWith("voicePresence"))).toEqual([]);
      expect(report.voicePresence).toBeNull();
    }
  });
});
