import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Sécurité — preuve de bout en bout de la reconnexion forcée : après que
 * l'admin a posé `User.forceReloginAt`, l'ANCIENNE session (JWT émis avant)
 * est refusée sur chaque surface protégée : routes Steam link, Steam
 * callback, IGDB search, `getCurrentUser` (pages), `requireAdmin` et une
 * server action réelle. Contrairement aux tests unitaires des routes (qui
 * mockent `getValidSession`), seul `auth()` (Auth.js/Discord) est mocké ici :
 * garde, Prisma et Postgres sont réels.
 *
 * Nécessite `TEST_DATABASE_URL` (Postgres local isolé, jamais Neon) — suite
 * entièrement SKIPPÉE si absente, avec avertissement.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const { authMock, igdbMock, steamVerifyMock, steamImportMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  igdbMock: vi.fn(),
  steamVerifyMock: vi.fn(),
  steamImportMock: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/igdb", () => ({ searchIgdbGames: igdbMock }));
vi.mock("@/lib/steam", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/steam")>()),
  verifySteamOpenId: steamVerifyMock,
  importSteamLibrary: steamImportMock,
}));

vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  if (!TEST_DATABASE_URL) {
    return { prisma: {} as unknown };
  }
  return { prisma: new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) };
});

if (!TEST_DATABASE_URL) {
  console.warn(
    "[force-relogin.surfaces.integration.test] TEST_DATABASE_URL absente — suite SKIPPÉE. " +
      "Le refus de l'ancienne session sur les routes/actions N'EST PAS validé par cette exécution."
  );
}

describe.skipIf(!TEST_DATABASE_URL)(
  "reconnexion forcée — l'ancienne session est refusée partout (Postgres isolée)",
  () => {
    let db: import("@prisma/client").PrismaClient;
    let linkGET: typeof import("@/app/api/steam/link/route").GET;
    let callbackGET: typeof import("@/app/api/steam/callback/route").GET;
    let igdbGET: typeof import("@/app/api/igdb/search/route").GET;
    let getCurrentUser: typeof import("@/lib/current-user").getCurrentUser;
    let requireAdmin: typeof import("@/lib/admin").requireAdmin;
    let markAllRead: typeof import("@/app/notifications-actions").markAllNotificationsReadAction;

    beforeAll(async () => {
      db = (await import("@/lib/prisma")).prisma as unknown as typeof db;
      linkGET = (await import("@/app/api/steam/link/route")).GET;
      callbackGET = (await import("@/app/api/steam/callback/route")).GET;
      igdbGET = (await import("@/app/api/igdb/search/route")).GET;
      getCurrentUser = (await import("@/lib/current-user")).getCurrentUser;
      requireAdmin = (await import("@/lib/admin")).requireAdmin;
      markAllRead = (await import("@/app/notifications-actions")).markAllNotificationsReadAction;
    });

    afterAll(async () => {
      await db.$disconnect();
    });

    beforeEach(async () => {
      vi.clearAllMocks();
      await db.$executeRawUnsafe(`TRUNCATE "User" CASCADE`);
    });

    let counter = 0;
    /** Utilisateur ADMIN avec une session ouverte, puis reconnexion forcée. */
    async function makeUserWithForcedRelogin() {
      counter += 1;
      const id = `force-relogin-${counter}`;
      const sessionCreatedAt = Date.now() - 60_000;
      const user = await db.user.create({
        data: { discordId: id, discordName: id, role: "ADMIN" },
      });
      const oldSession = { user: { discordId: id, sessionCreatedAt } };
      // L'admin clique « forcer la reconnexion » APRÈS l'émission du JWT.
      await db.user.update({ where: { id: user.id }, data: { forceReloginAt: new Date() } });
      return { user, oldSession };
    }

    function req(path: string) {
      return new NextRequest(`http://localhost:3000${path}`);
    }

    it("sanity : la même session, sans reconnexion forcée, est acceptée", async () => {
      counter += 1;
      const id = `sane-${counter}`;
      await db.user.create({ data: { discordId: id, discordName: id } });
      authMock.mockResolvedValue({ user: { discordId: id, sessionCreatedAt: Date.now() - 1000 } });
      igdbMock.mockResolvedValue([]);

      const res = await igdbGET(req("/api/igdb/search?q=zelda"));
      expect(res.status).toBe(200);
      expect(igdbMock).toHaveBeenCalledOnce();
    });

    it("GET /api/igdb/search → 401, IGDB jamais appelé", async () => {
      const { oldSession } = await makeUserWithForcedRelogin();
      authMock.mockResolvedValue(oldSession);

      const res = await igdbGET(req("/api/igdb/search?q=zelda"));
      expect(res.status).toBe(401);
      expect(igdbMock).not.toHaveBeenCalled();
    });

    it("GET /api/steam/link → redirection /, pas vers Steam", async () => {
      const { oldSession } = await makeUserWithForcedRelogin();
      authMock.mockResolvedValue(oldSession);

      const res = await linkGET(req("/api/steam/link"));
      expect(res.status).toBe(307);
      expect(new URL(res.headers.get("location")!).pathname).toBe("/");
      expect(res.headers.get("location")).not.toContain("steamcommunity");
    });

    it("GET /api/steam/callback → redirection /, Steam non appelé, steamId64 non écrit", async () => {
      const { user, oldSession } = await makeUserWithForcedRelogin();
      authMock.mockResolvedValue(oldSession);
      steamVerifyMock.mockResolvedValue("76561198000000000");

      const res = await callbackGET(req("/api/steam/callback?openid.mode=id_res"));
      expect(res.status).toBe(307);
      expect(new URL(res.headers.get("location")!).pathname).toBe("/");
      expect(steamVerifyMock).not.toHaveBeenCalled();
      expect(steamImportMock).not.toHaveBeenCalled();
      const after = await db.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(after.steamId64).toBeNull();
    });

    it("getCurrentUser (pages) et requireAdmin → null", async () => {
      const { oldSession } = await makeUserWithForcedRelogin();
      authMock.mockResolvedValue(oldSession);
      process.env.ADMIN_DISCORD_IDS = oldSession.user.discordId;

      expect(await getCurrentUser()).toBeNull();
      expect(await requireAdmin()).toBeNull();
    });

    it("server action (markAllNotificationsReadAction) → sans effet en base", async () => {
      const { user, oldSession } = await makeUserWithForcedRelogin();
      authMock.mockResolvedValue(oldSession);
      await db.notification.create({
        data: { userId: user.id, type: "LEVEL_UP", title: "t", message: "m" },
      });

      await markAllRead();

      const notif = await db.notification.findFirstOrThrow({ where: { userId: user.id } });
      expect(notif.read).toBe(false);
    });

    it("contre-épreuve : après reconnexion OAuth (nouvelle session), la même server action agit", async () => {
      const { user, oldSession } = await makeUserWithForcedRelogin();
      authMock.mockResolvedValue({
        user: { discordId: oldSession.user.discordId, sessionCreatedAt: Date.now() + 1000 },
      });
      await db.notification.create({
        data: { userId: user.id, type: "LEVEL_UP", title: "t", message: "m" },
      });

      await markAllRead();

      const notif = await db.notification.findFirstOrThrow({ where: { userId: user.id } });
      expect(notif.read).toBe(true);
    });
  }
);
