import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * MP de la roulette (V2) — invitation, rappel et résultat envoyés en MP à
 * chaque participant ET au créateur ; préférence `ROULETTE` relue à l'envoi ;
 * un MP fermé est seulement tracé (une roulette n'a ni fil ni annonce
 * publique, donc aucune mention de secours). Postgres isolé
 * (`TEST_DATABASE_URL`) + Discord simulé : AUCUN appel réseau réel, aucun MP
 * réel. Suite entièrement SKIPPÉE si `TEST_DATABASE_URL` est absente.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  if (!TEST_DATABASE_URL) return { prisma: {} as unknown };
  return { prisma: new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) };
});

if (!TEST_DATABASE_URL) {
  console.warn("[roulette-dm.integration.test] TEST_DATABASE_URL absente — suite SKIPPÉE.");
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

describe.skipIf(!TEST_DATABASE_URL)("MP de la roulette (intégration Postgres isolée + Discord HTTP simulé)", () => {
  let db: import("@prisma/client").PrismaClient;
  let rouletteLib: typeof import("./discord-roulette");
  let rouletteDm: typeof import("./roulette-dm");
  let executorLib: typeof import("./notification-executor");
  let fetchMock: ReturnType<typeof vi.fn>;
  let closedDms: Set<string>;

  beforeAll(async () => {
    const prismaModule = await import("@/lib/prisma");
    db = prismaModule.prisma as unknown as import("@prisma/client").PrismaClient;
    rouletteLib = await import("./discord-roulette");
    rouletteDm = await import("./roulette-dm");
    executorLib = await import("./notification-executor");
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  beforeEach(async () => {
    await db.$executeRawUnsafe(
      `TRUNCATE "NotificationDelivery", "NotificationEvent", "Notification", "SessionInvite", "RouletteEntry", "Roulette", "Session", "UserNotificationPreference", "Game", "User" CASCADE`
    );
    closedDms = new Set();
    fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      const path = String(url).replace("https://discord.com/api/v10", "");
      if (method === "POST" && path === "/users/@me/channels") {
        const { recipient_id } = JSON.parse(String(init.body));
        return jsonResponse(200, { id: `dm-${recipient_id}` });
      }
      const dmMatch = path.match(/^\/channels\/dm-(.+)\/messages$/);
      if (method === "POST" && dmMatch) {
        if (closedDms.has(dmMatch[1])) {
          return jsonResponse(403, { message: "Cannot send messages to this user", code: 50007 });
        }
        return jsonResponse(200, { id: "dm-msg", channel_id: `dm-${dmMatch[1]}` });
      }
      throw new Error(`Appel Discord inattendu : ${method} ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("DISCORD_BOT_TOKEN", "test-bot-token");
    vi.stubEnv("DISCORD_DM_ROULETTE_ENABLED", "true");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  let counter = 0;
  function uniq(label: string): string {
    counter += 1;
    return `${label}-${counter}`;
  }

  async function makeUser() {
    const id = uniq("user");
    return db.user.create({ data: { discordId: id, discordName: id } });
  }

  /** Roulette ouverte (deadline dans 6 h, relative à l'heure réelle : le
   * rappel compare à `wallClockNow`), créateur parmi les participants comme
   * dans `createRouletteAction`. */
  async function makeRoulette(creatorId: string, participantIds: string[]) {
    return db.roulette.create({
      data: {
        createdById: creatorId,
        scheduledAt: new Date(Date.now() + 24 * 3_600_000),
        deadline: new Date(Date.now() + 6 * 3_600_000),
        notifiedUserIds: [creatorId, ...participantIds],
      },
    });
  }

  async function drain(now: Date = new Date()) {
    const outcomes = [];
    for (;;) {
      const outcome = await executorLib.processNextDelivery({
        resolver: rouletteDm.rouletteDmResolver,
        owner: uniq("worker"),
        now,
      });
      if (!outcome) return outcomes;
      outcomes.push(outcome);
    }
  }

  function dmRows(rouletteId: string, kind?: string) {
    return db.notificationDelivery.findMany({
      where: { targetSlot: { startsWith: `default-guild:ROULETTE:${rouletteId}:dm:${kind ? `${kind}:` : ""}` } },
      orderBy: { sequence: "asc" },
    });
  }

  function dmPosts(discordId?: string) {
    return fetchMock.mock.calls.filter(
      ([url, init]) =>
        (init?.method ?? "GET") === "POST" &&
        new RegExp(`/channels/dm-${discordId ?? "[^/]+"}/messages$`).test(String(url))
    );
  }

  describe("invitation", () => {
    it("un MP par participant ET pour le créateur, aucun doublon si l'annonce est rejouée", async () => {
      const creator = await makeUser();
      const a = await makeUser();
      const b = await makeUser();
      const roulette = await makeRoulette(creator.id, [a.id, b.id]);

      await rouletteLib.announceRouletteCreated(roulette, creator);
      await rouletteLib.announceRouletteCreated(roulette, creator); // rejouée : même intention

      const rows = await dmRows(roulette.id, "created");
      expect(rows).toHaveLength(3);
      expect(rows.every((r) => r.channel === "DISCORD_DM" && r.transport === "BOT")).toBe(true);

      await drain();
      expect(dmPosts()).toHaveLength(3);
      const body = JSON.parse(String(dmPosts(creator.discordId)[0][1].body));
      expect(body.content).toBe("🎰 Roulette du gambling");
      expect(body.embeds[0].description).toContain("Propose tes 2 jeux");
      expect(body.allowed_mentions).toEqual({ parse: [] });
    });

    it("interrupteur éteint : aucun MP", async () => {
      vi.stubEnv("DISCORD_DM_ROULETTE_ENABLED", "false");
      const creator = await makeUser();
      const a = await makeUser();
      const roulette = await makeRoulette(creator.id, [a.id]);

      await rouletteLib.announceRouletteCreated(roulette, creator);

      expect(await dmRows(roulette.id)).toHaveLength(0);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("préférence ROULETTE désactivée : pas de MP pour ce pote (ni pour le créateur s'il l'a coupée)", async () => {
      const creator = await makeUser();
      const a = await makeUser();
      const b = await makeUser();
      const roulette = await makeRoulette(creator.id, [a.id, b.id]);
      await db.userNotificationPreference.createMany({
        data: [
          { userId: a.id, category: "ROULETTE", enabled: false },
          { userId: creator.id, category: "ROULETTE", enabled: false },
        ],
      });

      await rouletteLib.announceRouletteCreated(roulette, creator);

      expect((await dmRows(roulette.id)).map((r) => r.recipientKey)).toEqual([`user:${b.id}`]);
    });

    it("préférence désactivée APRÈS la mise en file : refusé au traitement, aucun appel Discord", async () => {
      const creator = await makeUser();
      const a = await makeUser();
      const roulette = await makeRoulette(creator.id, [a.id]);
      await rouletteLib.announceRouletteCreated(roulette, creator);

      await db.userNotificationPreference.create({ data: { userId: a.id, category: "ROULETTE", enabled: false } });
      const outcomes = await drain();

      expect(outcomes).toContainEqual(
        expect.objectContaining({ outcome: "failed", errorClass: "resolver:preference_declined" })
      );
      expect(dmPosts(a.discordId)).toHaveLength(0);
      expect(dmPosts(creator.discordId)).toHaveLength(1);
    });

    it("roulette déjà tirée avant l'envoi : refusé (expired), aucun appel Discord", async () => {
      const creator = await makeUser();
      const a = await makeUser();
      const roulette = await makeRoulette(creator.id, [a.id]);
      await rouletteLib.announceRouletteCreated(roulette, creator);

      await db.roulette.update({ where: { id: roulette.id }, data: { status: "DONE" } });
      const outcomes = await drain();

      expect(outcomes.every((o) => o.outcome === "failed" && o.errorClass === "resolver:expired")).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("rappel", () => {
    it("MP seulement à ceux qui n'ont pas proposé leurs jeux, créateur inclus s'il en fait partie", async () => {
      const creator = await makeUser();
      const a = await makeUser();
      const b = await makeUser();
      const roulette = await makeRoulette(creator.id, [a.id, b.id]);

      await rouletteLib.announceRouletteReminder(roulette, [creator.id, a.id]);

      expect((await dmRows(roulette.id, "reminder")).map((r) => r.recipientKey).sort()).toEqual(
        [`user:${creator.id}`, `user:${a.id}`].sort()
      );
      await drain();
      expect(dmPosts(b.discordId)).toHaveLength(0);
      const body = JSON.parse(String(dmPosts(a.discordId)[0][1].body));
      expect(body.content).toContain("dernier rappel");
    });

    it("deadline dépassée avant l'envoi : refusé (expired)", async () => {
      const creator = await makeUser();
      const roulette = await makeRoulette(creator.id, []);
      await rouletteLib.announceRouletteReminder(roulette, [creator.id]);

      await db.roulette.update({ where: { id: roulette.id }, data: { deadline: new Date(Date.now() - 3_600_000) } });
      const outcomes = await drain();

      expect(outcomes).toEqual([expect.objectContaining({ outcome: "failed", errorClass: "resolver:expired" })]);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("résultat (soirée hors chemin bot)", () => {
    it("MP aux participants invités à la soirée ET au créateur, avec le jeu gagnant", async () => {
      const creator = await makeUser();
      const a = await makeUser();
      const b = await makeUser();
      const game = await db.game.create({ data: { name: "Mario Kart", source: "MANUAL", addedById: creator.id } });
      const roulette = await makeRoulette(creator.id, [a.id, b.id]);
      const session = await db.session.create({
        data: {
          date: roulette.scheduledAt,
          status: "SCHEDULED",
          createdById: creator.id,
          decidedGameId: game.id,
          createdViaRoulette: true,
          announceViaBot: false,
        },
      });
      // `b` n'est plus invité à la soirée issue du tirage : pas de MP.
      await db.sessionInvite.create({ data: { sessionId: session.id, userId: a.id, invitedById: creator.id, status: "ACTIVE" } });
      await db.roulette.update({
        where: { id: roulette.id },
        data: { status: "DONE", resultGameId: game.id, resultSessionId: session.id },
      });

      await rouletteLib.announceRouletteResult(roulette, "Mario Kart", null, [creator.id, a.id, b.id], session.id);
      await drain();

      expect(dmPosts(a.discordId)).toHaveLength(1);
      expect(dmPosts(creator.discordId)).toHaveLength(1);
      expect(dmPosts(b.discordId)).toHaveLength(0);
      expect(JSON.parse(String(dmPosts(a.discordId)[0][1].body)).content).toBe("🎰 La roue a choisi : Mario Kart");
    });
  });

  describe("MP fermé (50007)", () => {
    it("échec tracé, AUCUNE mention de secours (pas de fil), aucune nouvelle tentative de MP", async () => {
      const creator = await makeUser();
      const a = await makeUser();
      const roulette = await makeRoulette(creator.id, [a.id]);
      closedDms.add(a.discordId);

      await rouletteLib.announceRouletteCreated(roulette, creator);
      const outcomes = await drain();

      expect(outcomes.filter((o) => o.outcome === "failed")).toEqual([
        expect.objectContaining({ errorClass: "discord:dm_unavailable" }),
      ]);
      const failed = (await dmRows(roulette.id, "created")).find((r) => r.recipientKey === `user:${a.id}`)!;
      expect(failed.status).toBe("FAILED");
      expect(failed.errorClass).toBe("discord:dm_unavailable");
      expect(await db.notificationDelivery.count({ where: { targetSlot: { contains: "dm-fallback" } } })).toBe(0);

      // Le rappel suivant ne renvoie AUCUN MP à ce pote, mais reste envoyé au créateur.
      await rouletteLib.announceRouletteReminder(roulette, [a.id, creator.id]);
      await drain();
      expect(dmPosts(a.discordId)).toHaveLength(1);
      expect(dmPosts(creator.discordId)).toHaveLength(2); // invitation + rappel
      expect(await dmRows(roulette.id, "reminder")).toHaveLength(1);
    });
  });
});
