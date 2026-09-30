import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * MP des soirées (V2) — annonce, mise à jour, rappel envoyés en MP à chaque
 * pote concerné, mention retirée du fil, mention de secours si le MP est
 * fermé. Postgres isolé (`TEST_DATABASE_URL`) + Discord entièrement simulé
 * par un routeur d'URL sur `fetch` : AUCUN appel réseau réel, aucun MP réel.
 * Suite entièrement SKIPPÉE si `TEST_DATABASE_URL` est absente.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  if (!TEST_DATABASE_URL) return { prisma: {} as unknown };
  return { prisma: new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) };
});

if (!TEST_DATABASE_URL) {
  console.warn("[session-dm.integration.test] TEST_DATABASE_URL absente — suite SKIPPÉE.");
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

describe.skipIf(!TEST_DATABASE_URL)("MP des soirées (intégration Postgres isolée + Discord HTTP simulé)", () => {
  let db: import("@prisma/client").PrismaClient;
  let announceLib: typeof import("./session-announce");
  let executorLib: typeof import("./notification-executor");
  let fetchMock: ReturnType<typeof vi.fn>;
  /** Discord ids dont le MP est fermé (50007). */
  let closedDms: Set<string>;
  let threadPostFailuresLeft: number;
  let discordRouter: (url: string, init?: RequestInit) => Promise<Response>;

  beforeAll(async () => {
    const prismaModule = await import("@/lib/prisma");
    db = prismaModule.prisma as unknown as import("@prisma/client").PrismaClient;
    announceLib = await import("./session-announce");
    executorLib = await import("./notification-executor");
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  beforeEach(async () => {
    await db.$executeRawUnsafe(
      `TRUNCATE "NotificationDelivery", "NotificationEvent", "SessionInvite", "Vote", "Proposal", "Session", "UserNotificationPreference", "Game", "User" CASCADE`
    );
    closedDms = new Set();
    threadPostFailuresLeft = 0;
    discordRouter = async (url: string, init: RequestInit = {}) => {
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
      if (method === "GET" && path === "/channels/thread-1") return jsonResponse(200, { id: "thread-1", type: 12 });
      if (method === "POST" && path === "/channels/thread-1/messages") {
        if (threadPostFailuresLeft > 0) {
          threadPostFailuresLeft -= 1;
          return jsonResponse(500, {});
        }
        return jsonResponse(200, { id: "msg-t", channel_id: "thread-1" });
      }
      if (method === "PATCH" && path === "/channels/thread-1/messages/msg-t") {
        return jsonResponse(200, { id: "msg-t", channel_id: "thread-1" });
      }
      throw new Error(`Appel Discord inattendu : ${method} ${path}`);
    };
    fetchMock = vi.fn(discordRouter);
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("DISCORD_BOT_TOKEN", "test-bot-token");
    vi.stubEnv("DISCORD_BOT_GUILD_ID", "guild-1");
    vi.stubEnv("DISCORD_BOT_SESSION_CHANNEL_ID", "chan-sessions");
    vi.stubEnv("DISCORD_DM_SESSION_ENABLED", "true");
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

  /** Soirée VOTING dans 3 h (relatif à l'heure réelle : les rappels
   * comparent à `wallClockNow`), fil déjà créé, annonce prête à partir. */
  async function makeReadySession(creatorId: string, guestIds: string[]) {
    const session = await db.session.create({
      data: {
        date: new Date(Date.now() + 3 * 3_600_000),
        votingDeadline: new Date(Date.now() + 2 * 3_600_000),
        status: "VOTING",
        createdById: creatorId,
        announceViaBot: true,
      },
    });
    for (const guestId of guestIds) await invite(session.id, guestId, creatorId);
    await announceLib.enqueueSessionCreationDeliveries(session.id);
    await db.notificationDelivery.deleteMany({ where: { targetSlot: { endsWith: ":creator-member" } } });
    await db.notificationDelivery.updateMany({
      where: { targetSlot: `default-guild:SESSION:${session.id}:thread` },
      data: { status: "SENT", sentAt: new Date(), discordThreadId: "thread-1" },
    });
    return session;
  }

  function invite(sessionId: string, userId: string, invitedById: string) {
    return db.sessionInvite.create({ data: { sessionId, userId, invitedById, status: "ACTIVE" } });
  }

  async function drain(now: Date = new Date()) {
    const outcomes = [];
    for (;;) {
      const outcome = await executorLib.processNextDelivery({
        resolver: announceLib.sessionAnnounceResolver,
        owner: uniq("worker"),
        now,
      });
      if (!outcome) return outcomes;
      outcomes.push(outcome);
    }
  }

  function calls(method: string, pathRegex: RegExp) {
    return fetchMock.mock.calls.filter(
      ([url, init]) => (init?.method ?? "GET") === method && pathRegex.test(String(url))
    );
  }

  function dmRows(sessionId: string) {
    return db.notificationDelivery.findMany({
      where: { targetSlot: { startsWith: `default-guild:SESSION:${sessionId}:dm:` } },
      orderBy: { sequence: "asc" },
    });
  }

  describe("annonce", () => {
    it("un MP par invité, mention retirée du fil, aucun doublon après un retry", async () => {
      const creator = await makeUser();
      const a = await makeUser();
      const b = await makeUser();
      const session = await makeReadySession(creator.id, [a.id, b.id]);

      // Le POST dans le fil échoue une fois (5xx) puis passe : le résolveur
      // est rappelé, les MP déjà enqueue-és ne doivent pas être doublés.
      threadPostFailuresLeft = 1;
      const t0 = new Date();
      expect((await drain(t0)).map((o) => o.outcome)).toContain("retrying");
      await drain(new Date(t0.getTime() + 10 * 60_000));

      const threadPost = calls("POST", /\/channels\/thread-1\/messages$/).at(-1)!;
      const body = JSON.parse(String(threadPost[1].body));
      expect(body.content).toBeUndefined(); // plus aucune mention dans le fil
      expect(body.allowed_mentions.users).toBeUndefined();

      const rows = await dmRows(session.id);
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.status === "SENT" && r.channel === "DISCORD_DM")).toBe(true);
      const dmPosts = calls("POST", /\/channels\/dm-[^/]+\/messages$/);
      expect(dmPosts).toHaveLength(2);
      const dmBody = JSON.parse(String(dmPosts[0][1].body));
      expect(dmBody.content).toBe("📣 Nouvelle soirée");
      expect(dmBody.embeds).toHaveLength(1);
      expect(dmBody.allowed_mentions).toEqual({ parse: [] });
    });

    it("interrupteur éteint : comportement historique (mention dans le fil, aucun MP)", async () => {
      vi.stubEnv("DISCORD_DM_SESSION_ENABLED", "false");
      const creator = await makeUser();
      const a = await makeUser();
      const session = await makeReadySession(creator.id, [a.id]);

      await drain();

      const body = JSON.parse(String(calls("POST", /\/channels\/thread-1\/messages$/).at(-1)![1].body));
      expect(body.content).toContain(`<@${a.discordId}>`);
      expect(await dmRows(session.id)).toHaveLength(0);
      expect(calls("POST", /users\/@me\/channels/)).toHaveLength(0);
    });

    it("préférence désactivée après la mise en file : aucun MP envoyé, échec traçable", async () => {
      const creator = await makeUser();
      const a = await makeUser();
      const session = await makeReadySession(creator.id, [a.id]);

      // Annonce seule : on ne traite pas encore le MP.
      await executorLib.processNextDelivery({
        resolver: announceLib.sessionAnnounceResolver,
        owner: "w1",
      });
      expect(await dmRows(session.id)).toHaveLength(1);

      await db.userNotificationPreference.create({ data: { userId: a.id, category: "SESSION", enabled: false } });
      const outcome = await executorLib.processNextDelivery({
        resolver: announceLib.sessionAnnounceResolver,
        owner: "w2",
      });
      expect(outcome).toMatchObject({ outcome: "failed", errorClass: "resolver:preference_declined" });
      expect(calls("POST", /users\/@me\/channels/)).toHaveLength(0);
    });
  });

  describe("MP fermé (50007)", () => {
    it("échec tracé, mention de secours dans le fil, jamais de nouvelle tentative de MP", async () => {
      const creator = await makeUser();
      const a = await makeUser();
      const b = await makeUser();
      const session = await makeReadySession(creator.id, [a.id, b.id]);
      closedDms.add(a.discordId);

      const outcomes = await drain();
      expect(outcomes.filter((o) => o.outcome === "failed")).toEqual([
        expect.objectContaining({ errorClass: "discord:dm_unavailable" }),
      ]);

      // Échec identifiable en base, jamais retenté.
      const failed = (await dmRows(session.id)).find((r) => r.recipientKey === `user:${a.id}`)!;
      expect(failed.status).toBe("FAILED");
      expect(failed.errorClass).toBe("discord:dm_unavailable");
      expect(calls("POST", new RegExp(`/channels/dm-${a.discordId}/messages$`))).toHaveLength(1);

      // Mention de secours : postée dans le fil, ne mentionne que ce pote.
      const fallback = calls("POST", /\/channels\/thread-1\/messages$/)
        .map(([, init]) => JSON.parse(String(init.body)))
        .find((body) => typeof body.content === "string");
      expect(fallback.content).toContain(`<@${a.discordId}>`);
      expect(fallback.content).toContain("MP impossible");
      expect(fallback.content).not.toContain(`<@${b.discordId}>`);
      expect(fallback.allowed_mentions.users).toEqual([a.discordId]);

      // Une mise à jour ne renvoie AUCUN MP à ce pote (toujours mentionné
      // dans le fil), mais reste envoyée à l'autre.
      await announceLib.enqueueSessionAnnounceUpdate(session.id);
      await drain();
      expect(calls("POST", new RegExp(`/channels/dm-${a.discordId}/messages$`))).toHaveLength(1);
      expect(calls("POST", new RegExp(`/channels/dm-${b.discordId}/messages$`))).toHaveLength(2);
    });

    it("une autre erreur terminale (ex. permission) ne déclenche pas de mention de secours", async () => {
      const creator = await makeUser();
      const a = await makeUser();
      const session = await makeReadySession(creator.id, [a.id]);
      fetchMock.mockImplementation(async (url: string, init: RequestInit = {}) =>
        String(url).includes("/channels/dm-") ? jsonResponse(403, { code: 50013 }) : discordRouter(url, init)
      );

      const outcomes = await drain();
      expect(outcomes.some((o) => o.outcome === "failed" && o.errorClass === "discord:auth_or_permission")).toBe(true);
      expect(
        await db.notificationDelivery.count({ where: { targetSlot: { contains: ":dm-fallback:" } } })
      ).toBe(0);
      expect(await dmRows(session.id)).toHaveLength(1);
    });
  });

  describe("mise à jour et rappel", () => {
    it("mise à jour : MP uniquement aux potes déjà prévenus par MP", async () => {
      const creator = await makeUser();
      const a = await makeUser();
      const session = await makeReadySession(creator.id, [a.id]);
      await drain(); // annonce + MP d'annonce à `a`

      const late = await makeUser();
      await invite(session.id, late.id, creator.id);
      await announceLib.enqueueSessionAnnounceUpdate(session.id);
      await drain();

      const rows = await dmRows(session.id);
      expect(rows.filter((r) => r.recipientKey === `user:${a.id}`)).toHaveLength(2); // annonce + mise à jour
      expect(rows.filter((r) => r.recipientKey === `user:${late.id}`)).toHaveLength(0);
      const updateDm = calls("POST", new RegExp(`/channels/dm-${a.discordId}/messages$`)).at(-1)!;
      expect(JSON.parse(String(updateDm[1].body)).content).toBe("🔄 Soirée mise à jour");
    });

    it("rappel : MP à chaque invité, plus aucune mention dans le message du fil", async () => {
      const creator = await makeUser();
      const a = await makeUser();
      const session = await makeReadySession(creator.id, [a.id]);
      await drain(); // annonce
      fetchMock.mockClear();

      await announceLib.enqueueSessionReminderDelivery(session.id, 60);
      await drain();

      const threadBody = JSON.parse(String(calls("POST", /\/channels\/thread-1\/messages$/).at(-1)![1].body));
      expect(threadBody.content).toContain("⏰ Rappel");
      expect(threadBody.content).not.toContain("<@");
      const reminderDm = await db.notificationDelivery.findFirstOrThrow({
        where: { targetSlot: `default-guild:SESSION:${session.id}:dm:reminder:60:${a.id}` },
      });
      expect(reminderDm.status).toBe("SENT");
      const dmBody = JSON.parse(String(calls("POST", /\/channels\/dm-[^/]+\/messages$/).at(-1)![1].body));
      expect(dmBody.content).toContain("⏰ Rappel");
    });

    it("soirée annulée avant l'envoi du MP : refusé (expired), aucun appel Discord", async () => {
      const creator = await makeUser();
      const a = await makeUser();
      const session = await makeReadySession(creator.id, [a.id]);
      await executorLib.processNextDelivery({ resolver: announceLib.sessionAnnounceResolver, owner: "w1" });
      expect(await dmRows(session.id)).toHaveLength(1);

      await db.session.update({ where: { id: session.id }, data: { status: "CANCELLED" } });
      const outcome = await executorLib.processNextDelivery({
        resolver: announceLib.sessionAnnounceResolver,
        owner: "w2",
      });
      expect(outcome).toMatchObject({ outcome: "failed", errorClass: "resolver:expired" });
      expect(calls("POST", /users\/@me\/channels/)).toHaveLength(0);
    });
  });
});
