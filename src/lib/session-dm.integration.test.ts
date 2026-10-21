import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * MP des soirées (V2) — règles de ping : création = mention dans le fil ET MP
 * d'invitation (double ping, créateur : MP sans mention) ; modification/fin =
 * annonce ET MP d'invitation ÉDITÉS (aucun nouveau MP) ; changement de date =
 * message avec mention dans le fil + nouveau MP « Date modifiée » ; vote
 * validé et rappel = message avec mention dans le fil ET MP à chaque invité et
 * au créateur (MP oui, mention non) ; secours (mention) si le MP du créateur est fermé. Postgres isolé (`TEST_DATABASE_URL`) + Discord entièrement simulé
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
      if (method === "PATCH" && /^\/channels\/dm-.+\/messages\/dm-msg$/.test(path)) {
        return jsonResponse(200, { id: "dm-msg", channel_id: path.split("/")[2] });
      }
      if (method === "GET" && path === "/channels/thread-1")return jsonResponse(200, { id: "thread-1", type: 12 });
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
    const user = await db.user.create({ data: { discordId: id, discordName: id } });
    await db.membership.create({ data: {
      userId: user.id,
      communityId: await (await import("@/lib/default-community")).getDefaultCommunityId(),
      status: "ACTIVE",
    } });
    return user;
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
    it("un MP par invité ET pour le créateur, invités mentionnés dans le fil (double ping), créateur non mentionné, aucun doublon après un retry", async () => {
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
      expect(body.content).toContain(`<@${a.discordId}>`);
      expect(body.content).toContain(`<@${b.discordId}>`);
      expect(body.content).not.toContain(`<@${creator.discordId}>`);
      expect([...body.allowed_mentions.users].sort()).toEqual([a.discordId, b.discordId].sort());

      const rows = await dmRows(session.id);
      expect(rows).toHaveLength(3); // a, b + le créateur
      expect(rows.every((r) => r.status === "SENT" && r.channel === "DISCORD_DM")).toBe(true);
      const dmPosts = calls("POST", /\/channels\/dm-[^/]+\/messages$/);
      expect(dmPosts).toHaveLength(3);
      const dmBody = JSON.parse(String(dmPosts[0][1].body));
      expect(dmBody.content).toContain("📣 Nouvelle soirée");
      expect(dmBody.content).toContain("Nouvelle soirée créée pour");
      expect(dmBody.content).not.toMatch(/\{[a-z_]+\}/);
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

      // Annonce seule : on ne traite pas encore les MP.
      await executorLib.processNextDelivery({
        resolver: announceLib.sessionAnnounceResolver,
        owner: "w1",
      });
      expect(await dmRows(session.id)).toHaveLength(2); // a + le créateur

      await db.userNotificationPreference.create({ data: { userId: a.id, category: "SESSION", enabled: false } });
      await drain();
      const rows = await dmRows(session.id);
      expect(rows.find((r) => r.recipientKey === `user:${a.id}`)).toMatchObject({
        status: "FAILED",
        errorClass: "resolver:preference_declined",
      });
      expect(calls("POST", new RegExp(`/channels/dm-${a.discordId}/messages$`))).toHaveLength(0);
      expect(rows.find((r) => r.recipientKey === `user:${creator.id}`)!.status).toBe("SENT");
    });
  });

  describe("le créateur reçoit aussi les MP", () => {
    it("création : MP au créateur, jamais mentionné dans le fil ; un pote non sélectionné n'en reçoit pas", async () => {
      const creator = await makeUser();
      const a = await makeUser();
      const session = await makeReadySession(creator.id, [a.id]);
      // Le créateur n'est ni invité ni dans `notifiedUserIds` : il ne dépend
      // que de sa propre préférence.
      await db.session.update({ where: { id: session.id }, data: { notifiedUserIds: [a.id] } });

      await drain();

      const rows = await dmRows(session.id);
      expect(rows.map((r) => r.recipientKey).sort()).toEqual([`user:${a.id}`, `user:${creator.id}`].sort());
      expect(rows.every((r) => r.status === "SENT")).toBe(true);
      expect(calls("POST", new RegExp(`/channels/dm-${creator.discordId}/messages$`))).toHaveLength(1);
      const threadBody = JSON.parse(String(calls("POST", /\/channels\/thread-1\/messages$/).at(-1)![1].body));
      expect(threadBody.content).toContain(`<@${a.discordId}>`);
      expect(threadBody.content).not.toContain(`<@${creator.discordId}>`);
    });

    it("préférence SESSION du créateur désactivée : aucun MP pour lui, l'invité en reçoit un", async () => {
      const creator = await makeUser();
      const a = await makeUser();
      const session = await makeReadySession(creator.id, [a.id]);
      await db.userNotificationPreference.create({
        data: { userId: creator.id, category: "SESSION", enabled: false },
      });

      await drain();

      const rows = await dmRows(session.id);
      expect(rows.map((r) => r.recipientKey)).toEqual([`user:${a.id}`]);
      expect(calls("POST", new RegExp(`/channels/dm-${creator.discordId}/messages$`))).toHaveLength(0);
    });

    it("préférence désactivée APRÈS la mise en file : le MP du créateur est refusé au traitement", async () => {
      const creator = await makeUser();
      const a = await makeUser();
      const session = await makeReadySession(creator.id, [a.id]);
      await executorLib.processNextDelivery({ resolver: announceLib.sessionAnnounceResolver, owner: "w1" });
      await db.userNotificationPreference.create({
        data: { userId: creator.id, category: "SESSION", enabled: false },
      });

      await drain();

      const row = (await dmRows(session.id)).find((r) => r.recipientKey === `user:${creator.id}`)!;
      expect(row).toMatchObject({ status: "FAILED", errorClass: "resolver:preference_declined" });
      expect(calls("POST", new RegExp(`/channels/dm-${creator.discordId}/messages$`))).toHaveLength(0);
    });

    it("modification : le MP d'invitation du créateur est ÉDITÉ (aucun nouveau MP) ; rappel : fil avec mention + MP, créateur reçoit le MP sans mention", async () => {
      const creator = await makeUser();
      const a = await makeUser();
      const session = await makeReadySession(creator.id, [a.id]);
      await drain(); // annonce + MP d'invitation

      await announceLib.enqueueSessionAnnounceUpdate(session.id);
      await announceLib.enqueueSessionReminderDelivery(session.id, 60);
      await drain();

      // Invitation (1) + rappel (1) : jamais de MP de mise à jour.
      const creatorDms = calls("POST", new RegExp(`/channels/dm-${creator.discordId}/messages$`)).map(
        ([, init]) => JSON.parse(String(init.body)).content
      );
      expect(creatorDms).toHaveLength(2);
      expect(creatorDms.some((c: string) => c.includes("⏰ Rappel"))).toBe(true);
      const edits = calls("PATCH", new RegExp(`/channels/dm-${creator.discordId}/messages/dm-msg$`));
      expect(edits).toHaveLength(1);
      expect(JSON.parse(String(edits[0][1].body)).content).toBe("📣 Soirée mise à jour");
      const reminderThreadBody = JSON.parse(String(calls("POST", /\/channels\/thread-1\/messages$/).at(-1)![1].body));
      expect(reminderThreadBody.content).toContain("⏰ Rappel");
      expect(reminderThreadBody.content).toContain(`<@${a.discordId}>`);
      expect(reminderThreadBody.content).not.toContain(`<@${creator.discordId}>`);
    });

    it("MP du créateur fermé : échec tracé, mention de secours dans le fil, aucun nouveau MP", async () => {
      const creator = await makeUser();
      const a = await makeUser();
      const session = await makeReadySession(creator.id, [a.id]);
      closedDms.add(creator.discordId);

      await drain();

      const failed = (await dmRows(session.id)).find((r) => r.recipientKey === `user:${creator.id}`)!;
      expect(failed).toMatchObject({ status: "FAILED", errorClass: "discord:dm_unavailable" });
      const fallback = calls("POST", /\/channels\/thread-1\/messages$/)
        .map(([, init]) => JSON.parse(String(init.body)))
        .find((body) => typeof body.content === "string" && body.content.includes("MP impossible"));
      expect(fallback.content).toContain(`<@${creator.discordId}>`);
      expect(fallback.allowed_mentions.users).toEqual([creator.discordId]);

      // Modification suivante : jamais de nouveau MP au créateur (et pas
      // d'édition : son invitation n'a jamais été envoyée).
      await announceLib.enqueueSessionAnnounceUpdate(session.id);
      await drain();
      expect(calls("POST", new RegExp(`/channels/dm-${creator.discordId}/messages$`))).toHaveLength(1);
      expect(calls("PATCH", new RegExp(`/channels/dm-${creator.discordId}/`))).toHaveLength(0);
    });

    it("interrupteur éteint : le créateur ne reçoit aucun MP", async () => {
      vi.stubEnv("DISCORD_DM_SESSION_ENABLED", "false");
      const creator = await makeUser();
      const a = await makeUser();
      const session = await makeReadySession(creator.id, [a.id]);

      await drain();

      expect(await dmRows(session.id)).toHaveLength(0);
      expect(calls("POST", /users\/@me\/channels/)).toHaveLength(0);
    });
  });

  describe("MP fermé (50007)", () => {
    it("invité : échec tracé, déjà mentionné dans le fil (pas de message de secours en plus), jamais de nouvelle tentative de MP", async () => {
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

      // Pas de message de secours pour un invité : il est déjà mentionné dans
      // le fil, avec les autres (double ping).
      expect(await db.notificationDelivery.count({ where: { targetSlot: { contains: ":dm-fallback:" } } })).toBe(0);
      const announceBody = JSON.parse(String(calls("POST", /\/channels\/thread-1\/messages$/)[0][1].body));
      expect(announceBody.content).toContain(`<@${a.discordId}>`);
      expect(announceBody.content).toContain(`<@${b.discordId}>`);

      // Une modification n'envoie aucun nouveau MP : le MP de `b` est édité,
      // celui de `a` (jamais envoyé) est ignoré.
      await announceLib.enqueueSessionAnnounceUpdate(session.id);
      await drain();
      expect(calls("POST", new RegExp(`/channels/dm-${a.discordId}/messages$`))).toHaveLength(1);
      expect(calls("POST", new RegExp(`/channels/dm-${b.discordId}/messages$`))).toHaveLength(1);
      expect(calls("PATCH", new RegExp(`/channels/dm-${b.discordId}/messages/dm-msg$`))).toHaveLength(1);
      expect(calls("PATCH", new RegExp(`/channels/dm-${a.discordId}/`))).toHaveLength(0);
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
      expect(await dmRows(session.id)).toHaveLength(2); // a + le créateur
    });
  });

  describe("modification, date, validation, rappel, fin", () => {
    it("modification : MP d'invitation ÉDITÉ pour les potes déjà prévenus, aucun nouveau MP, rien pour un pote jamais prévenu", async () => {
      const creator = await makeUser();
      const a = await makeUser();
      const session = await makeReadySession(creator.id, [a.id]);
      await drain(); // annonce + MP d'invitation à `a`

      const late = await makeUser();
      await invite(session.id, late.id, creator.id);
      await announceLib.enqueueSessionAnnounceUpdate(session.id);
      await drain();

      const rows = await dmRows(session.id);
      expect(rows.filter((r) => r.recipientKey === `user:${a.id}`).map((r) => r.operation).sort()).toEqual([
        "EDIT",
        "SEND",
      ]);
      expect(rows.filter((r) => r.recipientKey === `user:${late.id}`)).toHaveLength(0);
      expect(calls("POST", new RegExp(`/channels/dm-${a.discordId}/messages$`))).toHaveLength(1);
      const edit = calls("PATCH", new RegExp(`/channels/dm-${a.discordId}/messages/dm-msg$`));
      expect(edit).toHaveLength(1);
      expect(JSON.parse(String(edit[0][1].body)).content).toBe("📣 Soirée mise à jour");
      expect(calls("POST", new RegExp(`/channels/dm-${late.discordId}/`))).toHaveLength(0);
    });

    it("modification : interrupteur éteint → aucune édition de MP en file", async () => {
      const creator = await makeUser();
      const a = await makeUser();
      const session = await makeReadySession(creator.id, [a.id]);
      await drain();
      vi.stubEnv("DISCORD_DM_SESSION_ENABLED", "false");

      await announceLib.enqueueSessionAnnounceUpdate(session.id);
      await drain();

      expect(calls("PATCH", /\/channels\/dm-/)).toHaveLength(0);
      expect((await dmRows(session.id)).every((r) => r.operation === "SEND")).toBe(true);
    });

    it("rappel : dans le fil avec mention des invités ET en MP à chaque invité et au créateur, sans doublon", async () => {
      const creator = await makeUser();
      const a = await makeUser();
      const session = await makeReadySession(creator.id, [a.id]);
      await drain(); // annonce
      fetchMock.mockClear();

      await announceLib.enqueueSessionReminderDelivery(session.id, 60);
      await drain();

      const threadBody = JSON.parse(String(calls("POST", /\/channels\/thread-1\/messages$/).at(-1)![1].body));
      expect(threadBody.content).toContain("⏰ Rappel");
      expect(threadBody.content).toContain(`<@${a.discordId}>`);
      expect(threadBody.content).not.toContain(`<@${creator.discordId}>`);
      const dms = calls("POST", /\/channels\/dm-[^/]+\/messages$/);
      expect(dms).toHaveLength(2); // a + créateur
      expect(dms.every(([, init]) => JSON.parse(String(init.body)).content.includes("⏰ Rappel"))).toBe(true);
      expect(await db.notificationDelivery.count({ where: { targetSlot: { contains: ":dm:reminder:60:" } } })).toBe(2);

      // Rappel rejoué : même palier, aucun MP en double.
      await announceLib.enqueueSessionReminderDelivery(session.id, 60);
      await drain();
      expect(calls("POST", /\/channels\/dm-[^/]+\/messages$/)).toHaveLength(2);
    });

    it("nouvelle date : même palier renvoyé en fil et MP une seule fois pour la nouvelle génération", async () => {
      const creator = await makeUser();
      const guest = await makeUser();
      const session = await makeReadySession(creator.id, [guest.id]);
      await drain(); fetchMock.mockClear();
      await announceLib.enqueueSessionReminderDelivery(session.id, 60);
      await drain();
      expect(calls("POST", /\/channels\/dm-[^/]+\/messages$/)).toHaveLength(2);
      const { updateSessionSchedule } = await import("./sessions");
      await updateSessionSchedule(session.id, { date: new Date(session.date.getTime() + 24 * 3600_000), votingDeadline: null }, false);
      await announceLib.enqueueSessionReminderDelivery(session.id, 60);
      await announceLib.enqueueSessionReminderDelivery(session.id, 60);
      await drain();
      expect(calls("POST", /\/channels\/dm-[^/]+\/messages$/)).toHaveLength(4);
      expect(calls("POST", /\/channels\/thread-1\/messages$/)).toHaveLength(2);
      expect(await db.notificationEvent.count({ where: { sourceId: session.id, eventType: "SESSION_DM", occurrence: { startsWith: "reminder:" } } })).toBe(2);
    });

    it("le secours du créateur encore en file expire après replanification, sans appel Discord", async () => {
      const creator = await makeUser();
      const session = await makeReadySession(creator.id, []);
      await drain();
      closedDms.add(creator.discordId);
      await announceLib.enqueueSessionReminderDelivery(session.id, 60);
      const processOne = () => executorLib.processNextDelivery({ resolver: announceLib.sessionAnnounceResolver, owner: uniq("worker") });
      expect((await processOne())?.outcome).toBe("sent"); // rappel dans le fil
      expect((await processOne())?.outcome).toBe("failed"); // MP fermé, secours mis en file
      const fallback = await db.notificationDelivery.findFirstOrThrow({
        where: { targetSlot: { contains: ":dm-fallback:reminder:" }, status: "PENDING" },
      });
      const { updateSessionSchedule } = await import("./sessions");
      await updateSessionSchedule(session.id, { date: new Date(session.date.getTime() + 24 * 3600_000), votingDeadline: null }, false);
      fetchMock.mockClear();
      expect(await drain()).toMatchObject([{ outcome: "failed", errorClass: "resolver:expired" }]);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(await db.notificationDelivery.findUniqueOrThrow({ where: { id: fallback.id } })).toMatchObject({ status: "FAILED", errorClass: "resolver:expired" });
    });

    it("une nouvelle génération mentionne une seule fois le créateur au MP déjà fermé, sans retenter son MP", async () => {
      const creator = await makeUser();
      const session = await makeReadySession(creator.id, []);
      await drain();
      closedDms.add(creator.discordId);
      fetchMock.mockClear();
      await announceLib.enqueueSessionReminderDelivery(session.id, 60);
      await drain();
      const dmAttempts = calls("POST", /\/channels\/dm-[^/]+\/messages$/).length;
      expect(dmAttempts).toBe(1);
      const { updateSessionSchedule } = await import("./sessions");
      await updateSessionSchedule(session.id, { date: new Date(session.date.getTime() + 24 * 3600_000), votingDeadline: null }, false);
      await announceLib.enqueueSessionReminderDelivery(session.id, 60);
      await announceLib.enqueueSessionReminderDelivery(session.id, 60);
      await drain();
      await announceLib.enqueueSessionReminderDelivery(session.id, 60);
      await drain();
      const fallbacks = calls("POST", /\/channels\/thread-1\/messages$/)
        .map(([, init]) => JSON.parse(String(init.body)))
        .filter(body => body.content.includes("MP impossible"));
      expect(fallbacks).toHaveLength(1);
      expect(fallbacks.every(body => body.allowed_mentions.users.length === 1 && body.allowed_mentions.users[0] === creator.discordId)).toBe(true);
      expect(await db.notificationDelivery.count({ where: { targetSlot: { contains: ":dm-fallback:reminder:" }, status: "SENT" } })).toBe(1);
      const reminders = calls("POST", /\/channels\/thread-1\/messages$/)
        .map(([, init]) => JSON.parse(String(init.body)))
        .filter(body => body.content.includes("⏰ Rappel") && !body.content.includes("MP impossible"));
      expect(reminders).toHaveLength(2);
      expect(reminders[0].allowed_mentions.users ?? []).not.toContain(creator.discordId);
      expect(reminders[1].allowed_mentions.users).toEqual([creator.discordId]);
      expect(calls("POST", /\/channels\/dm-[^/]+\/messages$/)).toHaveLength(dmAttempts);
    });

    it("les MP de rappel encore en file expirent si la date change après le message dans le fil", async () => {
      const creator = await makeUser();
      const guest = await makeUser();
      const session = await makeReadySession(creator.id, [guest.id]);
      await drain();
      await announceLib.enqueueSessionReminderDelivery(session.id, 60);
      const thread = await executorLib.processNextDelivery({ resolver: announceLib.sessionAnnounceResolver, owner: uniq("worker") });
      expect(thread?.outcome).toBe("sent");
      expect(await db.notificationDelivery.count({ where: { targetSlot: { contains: ":dm:reminder:60:" }, status: "PENDING" } })).toBe(2);
      const { updateSessionSchedule } = await import("./sessions");
      await updateSessionSchedule(session.id, { date: new Date(session.date.getTime() + 24 * 3600_000), votingDeadline: null }, false);
      fetchMock.mockClear();
      const outcomes = await drain();
      expect(outcomes).toHaveLength(2);
      expect(outcomes.every(o => o.outcome === "failed")).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("rappel : le créateur n'est pas mentionné dans le fil même sans préférence ; préférence SESSION coupée → pas de MP pour lui", async () => {
      const creator = await makeUser();
      const a = await makeUser();
      const session = await makeReadySession(creator.id, [a.id]);
      await db.userNotificationPreference.create({
        data: { userId: creator.id, category: "SESSION", enabled: false },
      });
      await drain();
      fetchMock.mockClear();

      await announceLib.enqueueSessionReminderDelivery(session.id, 60);
      await drain();

      expect(calls("POST", new RegExp(`/channels/dm-${creator.discordId}/`))).toHaveLength(0);
      expect(calls("POST", new RegExp(`/channels/dm-${a.discordId}/`))).toHaveLength(1);
    });

    it("anciens MP de mise à jour déjà en file : abandonnés (expired), jamais envoyés", async () => {
      const creator = await makeUser();
      const a = await makeUser();
      const session = await makeReadySession(creator.id, [a.id]);
      await drain();
      fetchMock.mockClear();
      for (const kind of ["update:old"]) {
        const event = await db.notificationEvent.create({
          data: { category: "SESSION", eventType: "SESSION_DM", sourceId: session.id, occurrence: kind },
        });
        await db.notificationDelivery.create({
          data: {
            eventId: event.id,
            channel: "DISCORD_DM",
            transport: "BOT",
            operation: "SEND",
            recipientKey: `user:${a.id}`,
            targetSlot: `default-guild:SESSION:${session.id}:dm:${kind}:${a.id}`,
          },
        });
      }

      const outcomes = await drain();
      expect(outcomes.every((o) => o.outcome === "failed" && o.errorClass === "resolver:expired")).toBe(true);
      expect(calls("POST", /\/channels\/dm-/)).toHaveLength(0);
    });

    it("changement de date : annonce et MP d'invitation édités + message avec mention dans le fil + NOUVEAU MP « Date modifiée »", async () => {
      const creator = await makeUser();
      const a = await makeUser();
      const session = await makeReadySession(creator.id, [a.id]);
      await drain(); // annonce + MP d'invitation (a + créateur)
      fetchMock.mockClear();

      await db.session.update({ where: { id: session.id }, data: { date: new Date(Date.now() + 5 * 3_600_000) } });
      await announceLib.enqueueSessionAnnounceUpdate(session.id);
      await announceLib.enqueueSessionDateChange(session.id);
      await drain();

      // Annonce du fil éditée (PATCH) + message de date posté (POST) avec mention.
      expect(calls("PATCH", /\/channels\/thread-1\/messages\/msg-t$/)).toHaveLength(1);
      const dateBody = JSON.parse(String(calls("POST", /\/channels\/thread-1\/messages$/).at(-1)![1].body));
      expect(dateBody.content).toContain("📅 Date modifiée");
      expect(dateBody.content).toContain(`<@${a.discordId}>`);
      expect(dateBody.content).not.toContain(`<@${creator.discordId}>`);
      // MP d'invitation édités (a + créateur) ET un nouveau MP « Date modifiée » chacun.
      expect(calls("PATCH", /\/channels\/dm-[^/]+\/messages\/dm-msg$/)).toHaveLength(2);
      const newDms = calls("POST", /\/channels\/dm-[^/]+\/messages$/).map(([, init]) => JSON.parse(String(init.body)).content);
      expect(newDms).toHaveLength(2);
      for (const message of newDms) {
        expect(message).toContain("📅 Date modifiée");
        expect(message).toContain("nouveau créneau");
        expect(message).not.toMatch(/\{[a-z_]+\}/);
      }
    });

    it("changement de date : aucun nouveau MP pour un pote jamais prévenu par MP, mais il est mentionné dans le fil", async () => {
      const creator = await makeUser();
      const a = await makeUser();
      const session = await makeReadySession(creator.id, [a.id]);
      await drain();
      const late = await makeUser();
      await invite(session.id, late.id, creator.id);
      fetchMock.mockClear();

      await announceLib.enqueueSessionDateChange(session.id);
      await drain();

      const dateBody = JSON.parse(String(calls("POST", /\/channels\/thread-1\/messages$/).at(-1)![1].body));
      expect(dateBody.content).toContain(`<@${late.discordId}>`);
      expect(calls("POST", new RegExp(`/channels/dm-${late.discordId}/`))).toHaveLength(0);
    });

    it("vote validé : message « Soirée validée : {jeu} » avec mention dans le fil ET MP aux joueurs et au créateur (sans mention)", async () => {
      const creator = await makeUser();
      const a = await makeUser();
      const b = await makeUser();
      const session = await makeReadySession(creator.id, [a.id, b.id]);
      const game = await db.game.create({ data: { name: "Jeu Test", source: "MANUAL", addedById: creator.id } });
      const proposal = await db.proposal.create({
        data: { sessionId: session.id, gameId: game.id, proposedById: creator.id },
      });
      await db.vote.create({ data: { proposalId: proposal.id, userId: a.id } });
      await drain();
      fetchMock.mockClear();

      await db.session.update({
        where: { id: session.id },
        data: { status: "SCHEDULED", decidedGameId: game.id, decidedTime: session.date },
      });
      await announceLib.enqueueSessionValidated(session.id);
      await drain();

      const body = JSON.parse(String(calls("POST", /\/channels\/thread-1\/messages$/).at(-1)![1].body));
      expect(body.content).toContain("🎮 Soirée validée : Jeu Test");
      expect(body.content).toContain(`<@${a.discordId}>`);
      expect(body.content).not.toContain(`<@${b.discordId}>`);
      expect(body.content).not.toContain(`<@${creator.discordId}>`);
      // MP : le joueur du jeu retenu (a) et le créateur ; pas b (n'a pas voté pour ce jeu).
      const dms = calls("POST", /\/channels\/dm-[^/]+\/messages$/);
      expect(dms).toHaveLength(2);
      for (const [, init] of dms) {
        expect(JSON.parse(String(init.body)).content).toBe("🎮 Soirée validée : Jeu Test");
      }
      expect(calls("POST", new RegExp(`/channels/dm-${a.discordId}/`))).toHaveLength(1);
      expect(calls("POST", new RegExp(`/channels/dm-${creator.discordId}/`))).toHaveLength(1);
      expect(calls("POST", new RegExp(`/channels/dm-${b.discordId}/`))).toHaveLength(0);
    });

    it("fin de session : MP d'invitation édité (annulée / terminée), aucun nouveau MP ni message", async () => {
      const creator = await makeUser();
      const a = await makeUser();
      const session = await makeReadySession(creator.id, [a.id]);
      await drain();
      fetchMock.mockClear();

      await db.session.update({ where: { id: session.id }, data: { status: "CANCELLED" } });
      await announceLib.enqueueSessionAnnounceUpdate(session.id);
      await drain();

      const edit = calls("PATCH", new RegExp(`/channels/dm-${a.discordId}/messages/dm-msg$`));
      expect(edit).toHaveLength(1);
      expect(JSON.parse(String(edit[0][1].body)).content).toBe("❌ Soirée annulée");
      expect(calls("POST", /\/channels\/dm-/)).toHaveLength(0);
      expect(calls("POST", /\/channels\/thread-1\/messages$/)).toHaveLength(0);

      await db.session.update({ where: { id: session.id }, data: { status: "DONE" } });
      await announceLib.enqueueSessionAnnounceUpdate(session.id);
      await drain();
      const doneEdit = calls("PATCH", new RegExp(`/channels/dm-${a.discordId}/messages/dm-msg$`)).at(-1)!;
      expect(JSON.parse(String(doneEdit[1].body)).content).toBe("✅ Soirée terminée");
    });

    it("arrivée / départ d'un invité : aucun message, aucune mention, aucun MP", async () => {
      const creator = await makeUser();
      const a = await makeUser();
      const session = await makeReadySession(creator.id, [a.id]);
      await drain();
      fetchMock.mockClear();

      const late = await makeUser();
      const invitation = await invite(session.id, late.id, creator.id);
      await announceLib.enqueueSessionInviteSync(invitation.id);
      await db.sessionInvite.update({ where: { id: invitation.id }, data: { status: "REVOKED" } });
      await announceLib.enqueueSessionInviteSync(invitation.id);
      await drain();

      expect(calls("POST", /\/channels\/dm-/)).toHaveLength(0);
      expect(calls("POST", /\/channels\/thread-1\/messages$/)).toHaveLength(0);
    });

    it("soirée annulée avant l'envoi du MP : refusé (expired), aucun appel Discord", async () => {
      const creator = await makeUser();
      const a = await makeUser();
      const session = await makeReadySession(creator.id, [a.id]);
      await executorLib.processNextDelivery({ resolver: announceLib.sessionAnnounceResolver, owner: "w1" });
      expect(await dmRows(session.id)).toHaveLength(2); // a + le créateur

      await db.session.update({ where: { id: session.id }, data: { status: "CANCELLED" } });
      const outcomes = await drain();
      expect(outcomes).toHaveLength(2);
      expect(outcomes.every((o) => o.outcome === "failed" && o.errorClass === "resolver:expired")).toBe(true);
      expect(calls("POST", /users\/@me\/channels/)).toHaveLength(0);
    });
  });
});
