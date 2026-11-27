import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

/**
 * C057 — confidentialité des preuves, tickets de signalement et journaux de
 * modération. PostgreSQL jetable uniquement (`TEST_DATABASE_URL`), aucun
 * appel Discord : le ticket est résolu vers son salon staff simulé.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

vi.mock("@/lib/prisma", async () => {
  const { PrismaClient: Client } = await import("@prisma/client");
  return { prisma: TEST_DATABASE_URL ? new Client({ datasourceUrl: TEST_DATABASE_URL }) : {} };
});
vi.mock("@/lib/notification-executor-kick", () => ({ kickNotificationExecutor: vi.fn() }));

describe.skipIf(!TEST_DATABASE_URL)("confidentialité des preuves et tickets (PostgreSQL isolé)", () => {
  let db: PrismaClient;
  let tower: typeof import("./tower-challenges");
  let reports: typeof import("./discord-report-command");
  let dispatch: typeof import("./notification-dispatch");
  const GUILD = "100000000000000001";
  const STAFF = "100000000000000066";
  let communityId = "";
  let definitionId = "";
  let attemptId = "";
  let author: { id: string; discordId: string };
  let member: { id: string; discordId: string };
  let admin: { id: string; discordId: string };
  let outsider: { id: string; discordId: string };

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as PrismaClient;
    tower = await import("./tower-challenges");
    reports = await import("./discord-report-command");
    dispatch = await import("./notification-dispatch");
  });
  afterAll(async () => {
    await db?.$disconnect();
  });
  afterEach(() => vi.unstubAllEnvs());

  beforeEach(async () => {
    vi.stubEnv("TOWER_CHALLENGES_ENABLED", "true");
    vi.stubEnv("DISCORD_REPORT_COMMAND_ENABLED", "true");
    vi.stubEnv("DISCORD_REPORT_STAFF_CHANNEL_ID", STAFF);
    await db.$executeRawUnsafe(
      `TRUNCATE "TowerChallengeAttempt", "TowerChallengeDefinition", "ModerationReport", "NotificationDelivery", "NotificationEvent", "Membership", "User", "Community" CASCADE`
    );
    communityId = (await db.community.create({
      data: { slug: "tower-c057", name: "The Tower", status: "ACTIVE", discordGuildId: GUILD, towerChallengesEnabled: true },
    })).id;
    const other = await db.community.create({ data: { slug: "other-c057", name: "Autre", status: "ACTIVE" } });
    author = await db.user.create({ data: { discordId: "100000000000000033", discordName: "Auteur" } });
    member = await db.user.create({ data: { discordId: "100000000000000044", discordName: "Temoin" } });
    admin = await db.user.create({ data: { discordId: "100000000000000055", discordName: "Staff" } });
    outsider = await db.user.create({ data: { discordId: "100000000000000077", discordName: "Externe" } });
    for (const [userId, role] of [[author.id, "MEMBER"], [member.id, "MEMBER"], [admin.id, "ADMIN"]] as const) {
      await db.membership.create({ data: { communityId, userId, status: "ACTIVE", role, joinedAt: new Date() } });
    }
    await db.membership.create({ data: { communityId: other.id, userId: outsider.id, status: "ACTIVE", joinedAt: new Date() } });

    definitionId = (await db.towerChallengeDefinition.create({
      data: { communityId, title: "Preuve secrète", instructions: "Déposer une capture.", rewardFloors: 1, active: true },
    })).id;
    const assignedAt = new Date(Date.now() - 3_600_000);
    const submittedAt = new Date();
    attemptId = (await db.towerChallengeAttempt.create({
      data: {
        communityId,
        userId: author.id,
        definitionId,
        requestKey: "c057-proof",
        title: "Preuve secrète",
        instructions: "Déposer une capture.",
        rewardFloors: 1,
        assignedAt,
        expiresAt: new Date(assignedAt.getTime() + 48 * 3_600_000),
        status: "SUBMITTED",
        submittedAt,
        staffReportedAt: submittedAt,
        proofText: "preuve confidentielle qui ne doit pas fuir",
        proofChannelId: "100000000000000044",
        proofMessageId: "100000000000000099",
        publicationConsent: false,
      },
    })).id;
  });

  it("C057 — la preuve n'est lisible que par son auteur et la file staff", async () => {
    const own = await tower.getTowerChallengeState({ communityId, userId: author.id, attemptId }) as {
      status: string; attempts: { id: string }[];
    };
    expect(own.status).toBe("STATE");
    expect(own.attempts.map((attempt) => attempt.id)).toEqual([attemptId]);

    const peer = await tower.getTowerChallengeState({ communityId, userId: member.id, attemptId }) as {
      status: string; attempts: { id: string }[];
    };
    expect(peer.status).toBe("STATE");
    expect(peer.attempts).toEqual([]);
    expect(await tower.getTowerChallengeStaffQueue({ communityId, userId: member.id })).toEqual({ status: "FORBIDDEN" });

    const queue = await tower.getTowerChallengeStaffQueue({ communityId, userId: admin.id }) as {
      status: string; isStaff: boolean; proofs: { id: string; proofText: string | null }[];
    };
    expect(queue.status).toBe("STAFF_QUEUE");
    expect(queue.isStaff).toBe(true);
    expect(queue.proofs.map((proof) => proof.proofText)).toContain("preuve confidentielle qui ne doit pas fuir");

    const foreign = await tower.getTowerChallengeStaffQueue({ communityId, userId: outsider.id }) as { status: string };
    expect(foreign.status).not.toBe("STAFF_QUEUE");
  });

  it("C057 — le ticket de signalement part uniquement vers la file staff, jamais en public", async () => {
    expect(await reports.submitModerationReport({
      guildId: GUILD,
      reporterDiscordId: member.discordId,
      message: {
        messageId: "100000000000000099",
        channelId: "100000000000000044",
        authorDiscordId: author.discordId,
        authorIsBot: false,
        content: "contenu privé qui ne doit pas fuir",
        attachmentCount: 0,
      },
    })).toBe("recorded");
    const row = await db.moderationReport.findFirstOrThrow();
    vi.stubEnv("NOTIFICATION_EXECUTOR_ENABLED", "true");
    vi.stubEnv("DISCORD_BOT_TOKEN", "faux-jeton-de-test");
    expect(await reports.enqueueReportTicket({ reportId: row.id, communityId, guildId: GUILD, now: new Date() })).toBe(true);

    const delivery = await db.notificationDelivery.findFirstOrThrow({ include: { event: true } });
    expect(delivery.targetSlot).toBe(`${GUILD}:ADMIN:${row.id}:report-ticket`);
    expect(JSON.stringify(delivery.event.payload)).not.toContain("contenu privé");
    const resolution = await dispatch.DISPATCH_RESOLVER.resolve({ event: delivery.event, delivery } as never);
    expect(resolution).toMatchObject({ eligible: true, action: { kind: "send_channel_message", channelId: STAFF } });
  });
});
