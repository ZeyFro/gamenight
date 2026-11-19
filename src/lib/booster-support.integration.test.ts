import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

/**
 * Recette SQL isolée : PostgreSQL jetable (`TEST_DATABASE_URL`), jamais Neon ni Production. Prérequis :
 * `prisma migrate deploy` (migration `20261118131200_booster_support`). Ignorée sans `TEST_DATABASE_URL` :
 * à signaler « skipped », jamais présentée comme passée. Aucun appel Discord (lecture et API simulées).
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

vi.mock("@/lib/prisma", async () => {
  const { PrismaClient: Client } = await import("@prisma/client");
  return { prisma: TEST_DATABASE_URL ? new Client({ datasourceUrl: TEST_DATABASE_URL }) : {} };
});
vi.mock("@/lib/notification-executor-kick", () => ({ kickNotificationExecutor: vi.fn() }));

describe.skipIf(!TEST_DATABASE_URL)("PostgreSQL isolé — soutiens Nitro", () => {
  let db: PrismaClient;
  let support: typeof import("./booster-support");
  let runner: typeof import("./booster-support-runner");
  let dispatch: typeof import("./notification-dispatch");
  const GUILD = "100000000000000001";
  const ROLE = "200000000000000001";
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as unknown as PrismaClient;
    support = await import("./booster-support");
    runner = await import("./booster-support-runner");
    dispatch = await import("./notification-dispatch");
  });
  afterAll(async () => {
    await db?.$disconnect();
  });
  afterEach(() => vi.unstubAllEnvs());

  beforeEach(async () => {
    await db.$executeRawUnsafe(`TRUNCATE "BoosterSupport", "BoosterSupportSpace", "NotificationDelivery", "NotificationEvent", "Membership", "UserProfileVisibility", "User", "Community" CASCADE`);
    ids.community = (await db.community.create({ data: { slug: "tower-test", name: "The Tower", status: "ACTIVE", discordGuildId: GUILD } })).id;
    for (const [key, discordId, name] of [["booster", "100000000000000011", "Sarah"], ["plain", "100000000000000012", "Paul"], ["hidden", "100000000000000013", "Anna"]] as const) {
      ids[key] = (await db.user.create({ data: { discordId, discordName: name } })).id;
      await db.membership.create({ data: { userId: ids[key], communityId: ids.community, status: "ACTIVE", joinedAt: new Date() } });
    }
    vi.stubEnv("DISCORD_BOOSTERS_ENABLED", "true");
    vi.stubEnv("NOTIFICATION_EXECUTOR_ENABLED", "true");
    vi.stubEnv("DISCORD_BOT_TOKEN", "faux-jeton-de-test");
  });

  const api = (calls: string[]) => ({
    listRoles: async () => ({ ok: true as const, data: { roles: [] } }),
    listChannels: async () => ({ ok: true as const, data: [] }),
    createRole: async () => (calls.push("createRole"), { ok: true as const, data: { id: ROLE, name: "Soutien de la Tour" } }),
    createChannel: async (_g: string, name: string) => (calls.push(`channel:${name}`), { ok: true as const, data: { id: `30000000000000${calls.length}` } }),
    addRole: async (_g: string, user: string) => (calls.push(`add:${user}`), { ok: true as const, data: {} }),
    removeRole: async (_g: string, user: string) => (calls.push(`remove:${user}`), { ok: true as const, data: {} }),
  });

  it("le cron enregistre le booster, enfile rôle + espace, et la file se résout vers l'executor", async () => {
    const summary = await support.runBoosterSync({
      readProfile: async (_g, discordId) => ({ ok: true, premiumSince: discordId === "100000000000000011" ? "2026-10-01T10:00:00.000Z" : null }),
    });
    expect(summary).toMatchObject({ checked: 3, started: 1, queued: 2 });
    expect(await db.boosterSupport.count({ where: { boosting: true } })).toBe(1);
    const deliveries = await db.notificationDelivery.findMany({ include: { event: true } });
    expect(deliveries).toHaveLength(2);
    for (const delivery of deliveries) {
      expect(await dispatch.DISPATCH_RESOLVER.resolve({ event: delivery.event, delivery } as never)).toMatchObject({ eligible: true, action: { kind: "sync_booster_support" } });
    }
  });

  it("cycle complet : rôle attribué, puis retiré automatiquement à la fin du boost, espace créé une seule fois", async () => {
    const calls: string[] = [];
    await support.runBoosterSync({ readProfile: async (_g, id) => ({ ok: true, premiumSince: id.endsWith("11") ? "2026-10-01T10:00:00.000Z" : null }) });
    await runner.runBoosterSyncAction({ intent: "member", communityId: ids.community, discordId: "100000000000000011" }, new Date(Date.now() + 20_000), api(calls));
    expect(calls).toEqual(["createRole", "channel:soutiens-de-la-tour", "channel:Soutiens de la Tour", "add:100000000000000011"]);
    expect(await db.boosterSupportSpace.count()).toBe(1);
    expect((await db.boosterSupport.findFirstOrThrow({ where: { userId: ids.booster } })).roleGranted).toBe(true);

    await support.runBoosterSync({ readProfile: async () => ({ ok: true, premiumSince: null }) });
    const row = await db.boosterSupport.findFirstOrThrow({ where: { userId: ids.booster } });
    expect(row).toMatchObject({ boosting: false, roleGranted: true });
    expect(row.endedAt).not.toBeNull();
    const removal: string[] = [];
    await runner.runBoosterSyncAction({ intent: "member", communityId: ids.community, discordId: "100000000000000011" }, new Date(Date.now() + 20_000), api(removal));
    expect(removal).toEqual(["remove:100000000000000011"]);
    expect((await db.boosterSupport.findFirstOrThrow({ where: { userId: ids.booster } })).roleGranted).toBe(false);
    expect(await db.boosterSupportSpace.count()).toBe(1);
  });

  it("le mur exclut les profils masqués et les non-boosters ; isolation par communauté", async () => {
    const since = new Date("2026-10-01T10:00:00.000Z");
    for (const key of ["booster", "hidden", "plain"]) {
      await db.boosterSupport.create({ data: { communityId: ids.community, userId: ids[key], discordId: key, boosting: key !== "plain", since, checkedAt: new Date() } });
    }
    await db.userProfileVisibility.create({ data: { userId: ids.hidden, visibility: "HIDDEN" } });
    expect((await support.loadSupportWall(ids.community)).map((entry) => entry.name)).toEqual(["Sarah"]);
    const other = await db.community.create({ data: { slug: "autre", name: "Autre", status: "ACTIVE" } });
    expect(await support.loadSupportWall(other.id)).toEqual([]);
  });
});
