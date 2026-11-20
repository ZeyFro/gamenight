import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

/**
 * Recette SQL isolée : PostgreSQL jetable (`TEST_DATABASE_URL`), jamais Neon ni Production. Prérequis :
 * `prisma migrate deploy` (migration `20261118130500_discord_role_requests`). Ignorée sans
 * `TEST_DATABASE_URL` : à signaler « skipped », jamais présentée comme passée. Aucun appel Discord.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

vi.mock("@/lib/prisma", async () => {
  const { PrismaClient: Client } = await import("@prisma/client");
  return { prisma: TEST_DATABASE_URL ? new Client({ datasourceUrl: TEST_DATABASE_URL }) : {} };
});
vi.mock("@/lib/notification-executor-kick", () => ({ kickNotificationExecutor: vi.fn() }));

describe.skipIf(!TEST_DATABASE_URL)("PostgreSQL isolé — demandes de rôle Discord", () => {
  let db: PrismaClient;
  let autocreate: typeof import("./discord-role-autocreate");
  let dispatch: typeof import("./notification-dispatch");
  const GUILD = "100000000000000001";
  const PLAYER = "100000000000000022";
  const OTHER = "100000000000000033";
  let communityId = "";

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as unknown as PrismaClient;
    autocreate = await import("./discord-role-autocreate");
    dispatch = await import("./notification-dispatch");
  });
  afterAll(async () => {
    await db?.$disconnect();
  });
  afterEach(() => vi.unstubAllEnvs());

  beforeEach(async () => {
    await db.$executeRawUnsafe(`TRUNCATE "DiscordRoleRequest", "NotificationDelivery", "NotificationEvent", "CronLock", "Community" CASCADE`);
    communityId = (await db.community.create({ data: { slug: "tower-test", name: "The Tower", status: "ACTIVE", discordGuildId: GUILD } })).id;
    vi.stubEnv("DISCORD_ROLE_AUTOCREATE_ENABLED", "true");
    vi.stubEnv("NOTIFICATION_EXECUTOR_ENABLED", "true");
    vi.stubEnv("DISCORD_BOT_TOKEN", "faux-jeton-de-test");
  });

  const request = (name: string, discordId = PLAYER, now = new Date()) =>
    autocreate.requestRoleCreation({ communityId, guildId: GUILD, discordId, name, roleCount: 40, now });

  it("enregistre la demande, enfile événement + livraison BOT et la résout vers l'action de l'executor", async () => {
    const result = await request("Deep Rock Galactic");
    expect(result.status).toBe("queued");
    const row = await db.discordRoleRequest.findFirstOrThrow();
    expect(row).toMatchObject({ nameKey: "deep rock galactic", status: "PENDING", requesterDiscordId: PLAYER });
    const delivery = await db.notificationDelivery.findFirstOrThrow({ include: { event: true } });
    expect(delivery).toMatchObject({ transport: "BOT", operation: "SEND", targetSlot: `${GUILD}:ADMIN:${row.id}:role-create` });
    const resolution = await dispatch.DISPATCH_RESOLVER.resolve({ event: delivery.event, delivery } as never);
    expect(resolution).toEqual({ eligible: true, action: { kind: "create_game_role", requestId: row.id, communityId } });
  });

  it("un joueur ne crée qu'un rôle par semaine, même sous deux demandes simultanées", async () => {
    const results = await Promise.all([request("Valheim"), request("Halo Infinite")]);
    expect(results.filter((result) => result.status === "queued")).toHaveLength(1);
    expect(await db.discordRoleRequest.count({ where: { status: "PENDING" } })).toBe(1);
    const later = await request("Hades II", PLAYER, new Date(Date.now() + 8 * 24 * 60 * 60_000));
    expect(later.status).toBe("queued");
  });

  it("deux joueurs demandant le même nom normalisé : une seule demande", async () => {
    expect((await request("Deep Rock Galactic")).status).toBe("queued");
    expect((await request("deep  ROCK galactic", OTHER)).status).toBe("already_pending");
    expect(await db.discordRoleRequest.count()).toBe(1);
  });

  it("le runner marque CREATED (double Discord), est rejouable et libère le nom", async () => {
    await request("Deep Rock Galactic");
    const row = await db.discordRoleRequest.findFirstOrThrow();
    const calls: string[] = [];
    const api = {
      listRoles: async () => ({ ok: true as const, data: { roles: [] } }),
      createRole: async (_guild: string, name: string) => {
        calls.push(`create:${name}`);
        return { ok: true as const, data: { id: "200000000000000001", name } };
      },
      addMemberRole: async (_guild: string, user: string, roleId: string) => {
        calls.push(`add:${user}:${roleId}`);
        return { ok: true as const, data: { added: true as const } };
      },
    };
    await autocreate.runRoleCreationAction({ requestId: row.id, communityId }, new Date(Date.now() + 20_000), api);
    await autocreate.runRoleCreationAction({ requestId: row.id, communityId }, new Date(Date.now() + 20_000), api);
    expect(calls.filter((call) => call.startsWith("create:"))).toHaveLength(1);
    expect(await db.discordRoleRequest.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ status: "CREATED", roleId: "200000000000000001" });
  });

  it("refuse au plafond et enregistre une alerte ADMIN sans livraison", async () => {
    vi.stubEnv("DISCORD_ROLE_MAX_GUILD_ROLES", "250");
    const result = await autocreate.requestRoleCreation({ communityId, guildId: GUILD, discordId: PLAYER, name: "Valheim", roleCount: 250 });
    expect(result).toEqual({ status: "guild_full" });
    expect(await db.discordRoleRequest.count()).toBe(0);
    expect(await db.notificationEvent.findMany({ where: { eventType: "ROLE_CAPACITY_ALERT" } })).toHaveLength(1);
    expect(await db.notificationDelivery.count()).toBe(0);
  });
});
