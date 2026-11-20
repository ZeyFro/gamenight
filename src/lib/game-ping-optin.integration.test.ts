import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const suite = TEST_DATABASE_URL ? describe : describe.skip;
if (!TEST_DATABASE_URL) console.warn("[game-ping-optin] TEST_DATABASE_URL absente : intégration ignorée.");
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  if (TEST_DATABASE_URL && new URL(TEST_DATABASE_URL).hostname !== "127.0.0.1") {
    throw new Error("Postgres local 127.0.0.1 uniquement");
  }
  return { prisma: TEST_DATABASE_URL ? new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) : {} };
});

suite("opt-in aux pings de jeu (intégration)", () => {
  let db: typeof import("@/lib/prisma").prisma;
  let mod: typeof import("./game-ping-optin");

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as typeof db;
    mod = await import("./game-ping-optin");
  });

  afterEach(() => vi.unstubAllEnvs());

  beforeEach(async () => {
    vi.stubEnv("NOTIFICATION_CENTER_ENABLED", "true");
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "false");
    vi.stubEnv("COMMUNITY_PICKER_ENABLED", "false");
    await db.$executeRawUnsafe('TRUNCATE "Community", "User", "Game" CASCADE');
    await db.community.create({ data: { id: "default", slug: "default", name: "Serveur A", status: "ACTIVE" } });
    await db.user.createMany({ data: [
      { id: "a", discordId: "1", discordName: "A" },
      { id: "b", discordId: "2", discordName: "B" },
      { id: "out", discordId: "3", discordName: "Hors serveur" },
    ] });
    await db.membership.createMany({ data: [
      { userId: "a", communityId: "default", status: "ACTIVE" },
      { userId: "b", communityId: "default", status: "ACTIVE" },
    ] });
    await db.game.create({ data: { id: "g1", name: "Deadlock", source: "MANUAL", addedById: "a" } });
  });

  it("opt-in idempotent, révocable, réservé aux membres actifs", async () => {
    expect(await mod.setOwnGamePingOptIn("a", "g1", true)).toBe("ok");
    expect(await mod.setOwnGamePingOptIn("a", "g1", true)).toBe("ok");
    expect(await mod.countGamePingOptIns("default", "g1")).toBe(1);
    expect(await mod.setOwnGamePingOptIn("out", "g1", true)).toBe("no_community");
    expect(await mod.setOwnGamePingOptIn("a", "inconnu", true)).toBe("unknown_game");
    expect(await mod.setOwnGamePingOptIn("a", "g1", false)).toBe("ok");
    expect(await mod.countGamePingOptIns("default", "g1")).toBe(0);
  });

  it("notifie les abonnés dans l'app, jamais l'auteur ni un non-abonné", async () => {
    await mod.setOwnGamePingOptIn("a", "g1", true);
    await mod.setOwnGamePingOptIn("b", "g1", true);
    const sent = await mod.notifyGamePingOptIns({ communityId: "default", gameId: "g1", title: "Deadlock", message: "Ça joue", excludeUserId: "a" });
    expect(sent).toBe(1);
    const rows = await db.notification.findMany();
    expect(rows.map((row) => row.userId)).toEqual(["b"]);
  });
});
