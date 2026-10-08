import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * "Jouer maintenant" — la VRAIE server action `createInstantSessionAction`
 * (clic sur « Démarrer 🎮 »), contre Postgres isolé (`TEST_DATABASE_URL`).
 * Seuls `auth()` (OAuth Discord) et `revalidatePath` (runtime Next absent
 * hors requête) sont mockés ; `redirect`, `getCurrentUser`, la validation
 * zod, le rate limit, `createInstantSession` et l'enqueue sont réels.
 * Les données sont postées dans la forme EXACTE du formulaire
 * (`InstantSessionCreateForm` : champ caché `gameId` + une case
 * `notifyUserId` par pote coché, toutes cochées par défaut).
 * Suite SKIPPÉE si `TEST_DATABASE_URL` est absente.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const { authMock, latency } = vi.hoisted(() => ({ authMock: vi.fn(), latency: { ms: 0 } }));
vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  if (!TEST_DATABASE_URL) return { prisma: {} as unknown };
  // Latence réseau simulée PAR requête (y compris dans les transactions
  // interactives) : en prod le client passe par l'adapter Neon (WebSocket
  // distant), pas par un Postgres local à 1 ms.
  const client = new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }).$extends({
    query: {
      $allOperations: async ({ args, query }) => {
        if (latency.ms > 0) await new Promise((r) => setTimeout(r, latency.ms));
        return query(args);
      },
    },
  });
  return { prisma: client };
});

if (!TEST_DATABASE_URL) {
  console.warn("[jouer-maintenant/actions.integration.test] TEST_DATABASE_URL absente — suite SKIPPÉE.");
}

/** `redirect()` de Next lève une erreur dont le digest porte la cible. */
async function runAndGetRedirect(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const digest = (error as { digest?: string }).digest;
    if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) return digest.split(";")[2];
    throw error;
  }
  throw new Error("redirect attendu, aucune redirection levée");
}

describe.skipIf(!TEST_DATABASE_URL)("createInstantSessionAction (vraie server action, Postgres isolé)", () => {
  let db: import("@prisma/client").PrismaClient;
  let actions: typeof import("./actions");

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as unknown as import("@prisma/client").PrismaClient;
    actions = await import("./actions");
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  beforeEach(async () => {
    await db.$executeRawUnsafe(
      `TRUNCATE "NotificationDelivery", "NotificationEvent", "Notification", "InstantSessionPresenceInterval", "InstantSession", "Game", "User" CASCADE`
    );
    vi.stubEnv("DISCORD_BOT_TOKEN", "test-bot-token");
    vi.stubEnv("DISCORD_BOT_GUILD_ID", "guild-1");
    vi.stubEnv("DISCORD_BOT_INSTANT_SESSION_INVITE_ENABLED", "true");
  });

  afterEach(() => {
    latency.ms = 0;
    vi.unstubAllEnvs();
  });

  let counter = 0;
  const uniq = (label: string) => `${label}-${++counter}`;
  const makeUser = () => {
    const id = uniq("user");
    return db.user.create({ data: { discordId: id, discordName: id } });
  };

  /** Forme exacte du `<form>` : `gameId` caché + une entrée `notifyUserId` par case cochée. */
  function formData(gameId: string, notifyUserIds: string[]) {
    const fd = new FormData();
    fd.set("creationKey", crypto.randomUUID());
    fd.set("gameId", gameId);
    for (const id of notifyUserIds) fd.append("notifyUserId", id);
    return fd;
  }

  async function setup(guestCount: number) {
    const creator = await makeUser();
    const guests = [];
    for (let i = 0; i < guestCount; i++) guests.push(await makeUser());
    const game = await db.game.create({ data: { name: uniq("game"), source: "MANUAL", addedById: creator.id } });
    authMock.mockResolvedValue({ user: { discordId: creator.discordId, sessionCreatedAt: Date.now() } });
    return { creator, guests, game };
  }

  it("2 invités cochés : session créée, redirection vers la page de détail, 2 MP en file", async () => {
    const { creator, guests, game } = await setup(2);

    const target = await runAndGetRedirect(
      actions.createInstantSessionAction(formData(game.id, guests.map((g) => g.id)))
    );

    const session = await db.instantSession.findFirstOrThrow({ where: { createdById: creator.id } });
    expect(target).toBe(`/jouer-maintenant/${session.id}`);
    expect(session.notifiedUserIds).toEqual(guests.map((g) => g.id));
    const deliveries = await db.notificationDelivery.findMany({ where: { targetSlot: { contains: session.id } } });
    expect(deliveries.map((d) => d.recipientKey).sort()).toEqual(guests.map((g) => `user:${g.id}`).sort());
  });

  it("tous les potes cochés par défaut (20 invités) : aucune erreur, 20 MP en file", async () => {
    const { creator, guests, game } = await setup(20);

    const target = await runAndGetRedirect(
      actions.createInstantSessionAction(formData(game.id, guests.map((g) => g.id)))
    );

    expect(target).toMatch(/^\/jouer-maintenant\/[^?]+$/);
    const session = await db.instantSession.findFirstOrThrow({ where: { createdById: creator.id } });
    expect(await db.notificationDelivery.count({ where: { targetSlot: { contains: session.id } } })).toBe(20);
  });

  it("tous les potes cochés (20 invités) avec 150 ms de latence par requête (réseau Neon) : la création aboutit", async () => {
    const { creator, guests, game } = await setup(20);
    latency.ms = 150;

    const target = await runAndGetRedirect(
      actions.createInstantSessionAction(formData(game.id, guests.map((g) => g.id)))
    );

    expect(target).toMatch(/^\/jouer-maintenant\/[^?]+$/);
    latency.ms = 0;
    const session = await db.instantSession.findFirstOrThrow({ where: { createdById: creator.id } });
    expect(await db.notificationDelivery.count({ where: { targetSlot: { contains: session.id } } })).toBe(20);
  }, 60_000);

  it("aucun pote coché : session créée sans invitation", async () => {
    const { creator, game } = await setup(0);

    const target = await runAndGetRedirect(actions.createInstantSessionAction(formData(game.id, [])));

    expect(target).toMatch(/^\/jouer-maintenant\/[^?]+$/);
    expect(await db.instantSession.count({ where: { createdById: creator.id } })).toBe(1);
    expect(await db.notificationDelivery.count()).toBe(0);
  });

  describe("pistes d'exception précoce (formes envoyées par le vrai navigateur)", () => {
    it("MODULE : tous les exports d'un fichier \"use server\" doivent être des fonctions (Next le vérifie au chargement du module → 500 avant tout code)", () => {
      // Même règle que `ensureServerEntryExports` (next/dist/build/webpack/
      // loaders/next-flight-loader/action-validate) : toute valeur non-fonction
      // exportée fait lever « A "use server" file can only export async
      // functions » à l'évaluation du module, donc pour TOUTES les actions.
      const nonFunctions = Object.entries(actions)
        .filter(([, value]) => typeof value !== "function")
        .map(([name, value]) => `${name}: ${typeof value}`);
      expect(nonFunctions).toEqual([]);
    });

    it("gameId vide / absent / invalide → redirection d'erreur, jamais une exception", async () => {
      const { guests } = await setup(1);
      const ids = guests.map((g) => g.id);
      const empty = formData("", ids);
      const missing = new FormData();
      missing.set("creationKey", crypto.randomUUID());
      for (const id of ids) missing.append("notifyUserId", id);
      for (const fd of [empty, missing, formData("n-existe-pas", ids)]) {
        expect(await runAndGetRedirect(actions.createInstantSessionAction(fd))).toMatch(/^\/jouer-maintenant\?error=/);
      }
    });

    it("session expirée / absente → redirection vers /, jamais une exception", async () => {
      const { game } = await setup(0);
      authMock.mockResolvedValue(null);
      expect(await runAndGetRedirect(actions.createInstantSessionAction(formData(game.id, [])))).toBe("/");
      authMock.mockResolvedValue({ user: {} });
      expect(await runAndGetRedirect(actions.createInstantSessionAction(formData(game.id, [])))).toBe("/");
    });

    it("forceReloginAt postérieur à la session → redirection vers /", async () => {
      const { creator, game } = await setup(0);
      await db.user.update({ where: { id: creator.id }, data: { forceReloginAt: new Date(Date.now() + 60_000) } });
      expect(await runAndGetRedirect(actions.createInstantSessionAction(formData(game.id, [])))).toBe("/");
    });

    it("créateur déjà dans une session ACTIVE → refus propre (?error=already_in_another_session), jamais une exception", async () => {
      const { creator, game } = await setup(0);
      await runAndGetRedirect(actions.createInstantSessionAction(formData(game.id, [])));

      const again = await runAndGetRedirect(actions.createInstantSessionAction(formData(game.id, [])));

      expect(again).toBe("/jouer-maintenant?error=already_in_another_session");
      expect(await db.instantSession.count({ where: { createdById: creator.id } })).toBe(1);
    });

    it("créateur dont la session précédente est EXPIRÉE mais pas encore réglée par le cron → peut en créer une nouvelle", async () => {
      const { creator, game } = await setup(0);
      await runAndGetRedirect(actions.createInstantSessionAction(formData(game.id, [])));
      const old = await db.instantSession.findFirstOrThrow({ where: { createdById: creator.id } });
      const createdAt = new Date(Date.now() - 4 * 60 * 60 * 1000);
      await db.instantSession.update({
        where: { id: old.id },
        data: { createdAt, expiresAt: new Date(createdAt.getTime() + 3 * 60 * 60 * 1000) },
      });

      const target = await runAndGetRedirect(actions.createInstantSessionAction(formData(game.id, [])));

      expect(target).toMatch(/^\/jouer-maintenant\/[^?]+$/);
      expect(await db.instantSession.count({ where: { createdById: creator.id } })).toBe(2);
    });

    it("notifyUserId non-cuid / inexistant → ignoré proprement, session créée ; valeur vide → refus propre (redirection d'erreur)", async () => {
      const { creator, game } = await setup(0);
      const empty = formData(game.id, [""]);
      expect(await runAndGetRedirect(actions.createInstantSessionAction(empty))).toMatch(/^\/jouer-maintenant\?error=/);
      const fd = formData(game.id, ["pas-un-id", "00000000-0000-0000-0000-000000000000"]);
      expect(await runAndGetRedirect(actions.createInstantSessionAction(fd))).toMatch(/^\/jouer-maintenant\/[^?]+$/);
      expect(await db.instantSession.count({ where: { createdById: creator.id } })).toBe(1);
    });
  });
});
