import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return {
    prisma: TEST_DATABASE_URL
      ? new PrismaClient({ datasourceUrl: TEST_DATABASE_URL })
      : ({} as unknown),
  };
});

if (!TEST_DATABASE_URL) {
  console.warn(
    "[notification-preferences.integration.test] TEST_DATABASE_URL absente — " +
      "tests de persistance PostgreSQL isolée SKIPPÉS."
  );
}

describe.skipIf(!TEST_DATABASE_URL)("notification-preferences (PostgreSQL isolé)", () => {
  let db: import("@prisma/client").PrismaClient;
  let preferences: typeof import("./notification-preferences");

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as import("@prisma/client").PrismaClient;
    preferences = await import("./notification-preferences");
  });

  afterAll(async () => db.$disconnect());

  beforeEach(async () => {
    await db.userNotificationPreference.deleteMany();
    await db.user.deleteMany({ where: { discordId: { startsWith: "notification-pref-test-" } } });
  });

  async function createUser(suffix: string, silenceReminders = false) {
    return db.user.create({
      data: {
        discordId: `notification-pref-test-${suffix}`,
        discordName: suffix,
        silenceReminders,
      },
    });
  }

  it("applique le repli legacy en absence de ligne puis persiste chaque catégorie", async () => {
    const user = await createUser("persistence", true);
    expect(preferences.isPersonalNotificationEnabled(user, "SESSION")).toBe(false);
    expect(preferences.isPersonalNotificationEnabled(user, "ROULETTE")).toBe(false);

    await preferences.setOwnNotificationPreference(user.id, "SESSION", true);
    await preferences.setOwnNotificationPreference(user.id, "ROULETTE", false);

    const stored = await db.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { notificationPreferences: true },
    });
    expect(stored.silenceReminders).toBe(false);
    expect(preferences.isPersonalNotificationEnabled(stored, "SESSION")).toBe(true);
    expect(preferences.isPersonalNotificationEnabled(stored, "ROULETTE")).toBe(false);
  });

  it("la clé composée interdit deux réglages concurrents pour une catégorie", async () => {
    const user = await createUser("unique");
    await preferences.setOwnNotificationPreference(user.id, "SESSION", false);
    await preferences.setOwnNotificationPreference(user.id, "SESSION", true);
    expect(await db.userNotificationPreference.count({ where: { userId: user.id } })).toBe(1);
  });

  it("modifier SESSION et son champ legacy ne réécrit pas la préférence ROULETTE", async () => {
    const user = await createUser("independent");
    await preferences.setOwnNotificationPreference(user.id, "ROULETTE", true);
    await preferences.setOwnNotificationPreference(user.id, "SESSION", false);

    const stored = await db.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { notificationPreferences: true },
    });
    expect(stored.silenceReminders).toBe(true);
    expect(preferences.isPersonalNotificationEnabled(stored, "SESSION")).toBe(false);
    expect(preferences.isPersonalNotificationEnabled(stored, "ROULETTE")).toBe(true);
  });
});
