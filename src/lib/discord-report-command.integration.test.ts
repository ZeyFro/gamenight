import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

/**
 * Recette SQL isolée : PostgreSQL jetable (`TEST_DATABASE_URL`), jamais Neon ni Production. Prérequis :
 * `prisma migrate deploy` (migration `20261118131100_moderation_reports`). Ignorée sans `TEST_DATABASE_URL` :
 * à signaler « skipped », jamais présentée comme passée. Aucun appel Discord.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

vi.mock("@/lib/prisma", async () => {
  const { PrismaClient: Client } = await import("@prisma/client");
  return { prisma: TEST_DATABASE_URL ? new Client({ datasourceUrl: TEST_DATABASE_URL }) : {} };
});
vi.mock("@/lib/notification-executor-kick", () => ({ kickNotificationExecutor: vi.fn() }));

describe.skipIf(!TEST_DATABASE_URL)("PostgreSQL isolé — signalements de messages", () => {
  let db: PrismaClient;
  let reports: typeof import("./discord-report-command");
  let dispatch: typeof import("./notification-dispatch");
  const GUILD = "100000000000000001";
  const REPORTER = "100000000000000022";
  const AUTHOR = "100000000000000033";
  const STAFF = "100000000000000066";
  let communityId = "";

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as unknown as PrismaClient;
    reports = await import("./discord-report-command");
    dispatch = await import("./notification-dispatch");
  });
  afterAll(async () => {
    await db?.$disconnect();
  });
  afterEach(() => vi.unstubAllEnvs());

  beforeEach(async () => {
    await db.$executeRawUnsafe(`TRUNCATE "ModerationReport", "NotificationDelivery", "NotificationEvent", "Membership", "User", "Community" CASCADE`);
    communityId = (await db.community.create({ data: { slug: "tower-test", name: "The Tower", status: "ACTIVE", discordGuildId: GUILD } })).id;
    const user = await db.user.create({ data: { discordId: REPORTER, discordName: "Sarah" } });
    await db.membership.create({ data: { userId: user.id, communityId, status: "ACTIVE", joinedAt: new Date() } });
    vi.stubEnv("DISCORD_REPORT_COMMAND_ENABLED", "true");
    vi.stubEnv("NOTIFICATION_EXECUTOR_ENABLED", "true");
    vi.stubEnv("DISCORD_BOT_TOKEN", "faux-jeton-de-test");
    vi.stubEnv("DISCORD_REPORT_STAFF_CHANNEL_ID", STAFF);
  });

  const message = (id: string) => ({
    messageId: id,
    channelId: "100000000000000044",
    authorDiscordId: AUTHOR,
    authorIsBot: false,
    content: "Message à examiner",
    attachmentCount: 1,
  });
  const submit = (id: string) => reports.submitModerationReport({ guildId: GUILD, reporterDiscordId: REPORTER, message: message(id) });

  it("enregistre le signalement, enfile le ticket et le résout vers un message staff sans mention", async () => {
    expect(await submit("100000000000000055")).toBe("recorded");
    const row = await db.moderationReport.findFirstOrThrow();
    expect(row).toMatchObject({ communityId, reporterDiscordId: REPORTER, closedAt: null });
    expect(row.ticketQueuedAt).not.toBeNull();
    const delivery = await db.notificationDelivery.findFirstOrThrow({ include: { event: true } });
    const resolution = await dispatch.DISPATCH_RESOLVER.resolve({ event: delivery.event, delivery } as never);
    expect(resolution).toMatchObject({ eligible: true, action: { kind: "send_channel_message", channelId: STAFF } });
  });

  it("un même message n'est signalé qu'une fois par membre, même en double clic", async () => {
    const results = await Promise.all([submit("100000000000000055"), submit("100000000000000055")]);
    expect(results.filter((result) => result === "recorded")).toHaveLength(1);
    expect(results.filter((result) => result === "duplicate")).toHaveLength(1);
    expect(await db.moderationReport.count()).toBe(1);
    expect(await db.notificationDelivery.count()).toBe(1);
  });

  it("limite à 5 signalements par heure", async () => {
    for (let index = 0; index < 5; index += 1) expect(await submit(`10000000000000010${index}`)).toBe("recorded");
    expect(await submit("100000000000000199")).toBe("rate_limited");
    expect(await db.moderationReport.count()).toBe(5);
  });

  it("n'applique aucune sanction : la table ne porte aucune colonne d'action", async () => {
    const columns = await db.$queryRawUnsafe<Array<{ column_name: string }>>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'ModerationReport'`
    );
    expect(columns.map((column) => column.column_name).filter((name) => /sanction|ban|mute|kick/i.test(name))).toEqual([]);
  });
});
