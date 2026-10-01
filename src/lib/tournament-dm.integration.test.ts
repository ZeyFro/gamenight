import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * MP des tournois (V2) — l'annonce d'ouverture part en MP à chaque pote
 * sélectionné ET au créateur, leur mention est retirée de l'annonce du
 * salon, mention de secours dans le fil si le MP est fermé. Postgres isolé
 * (`TEST_DATABASE_URL`) + Discord entièrement simulé par un routeur d'URL
 * sur `fetch` : AUCUN appel réseau réel, aucun MP réel. Suite entièrement
 * SKIPPÉE si `TEST_DATABASE_URL` est absente.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  if (!TEST_DATABASE_URL) return { prisma: {} as unknown };
  return { prisma: new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) };
});

if (!TEST_DATABASE_URL) {
  console.warn("[tournament-dm.integration.test] TEST_DATABASE_URL absente — suite SKIPPÉE.");
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

describe.skipIf(!TEST_DATABASE_URL)("MP des tournois (intégration Postgres isolée + Discord HTTP simulé)", () => {
  let db: import("@prisma/client").PrismaClient;
  let announceLib: typeof import("./tournament-announce");
  let executorLib: typeof import("./notification-executor");
  let fetchMock: ReturnType<typeof vi.fn>;
  let closedDms: Set<string>;
  let announcePostFailuresLeft: number;

  beforeAll(async () => {
    const prismaModule = await import("@/lib/prisma");
    db = prismaModule.prisma as unknown as import("@prisma/client").PrismaClient;
    announceLib = await import("./tournament-announce");
    executorLib = await import("./notification-executor");
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  beforeEach(async () => {
    await db.$executeRawUnsafe(
      `TRUNCATE "NotificationDelivery", "NotificationEvent", "TournamentMatch", "TournamentParticipant", "Tournament", "UserNotificationPreference", "Game", "User" CASCADE`
    );
    closedDms = new Set();
    announcePostFailuresLeft = 0;
    fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      const path = String(url).replace("https://discord.com/api/v10", "");
      if (method === "GET" && path === "/channels/chan-tournois") {
        return jsonResponse(200, { id: "chan-tournois", type: 0, guild_id: "guild-1" });
      }
      if (method === "POST" && path === "/channels/chan-tournois/messages") {
        if (announcePostFailuresLeft > 0) {
          announcePostFailuresLeft -= 1;
          return jsonResponse(500, {});
        }
        return jsonResponse(200, { id: "msg-announce", channel_id: "chan-tournois" });
      }
      if (method === "POST" && path === "/channels/chan-tournois/messages/msg-announce/threads") {
        return jsonResponse(200, { id: "thread-t1", parent_id: "chan-tournois" });
      }
      if (method === "POST" && path === "/channels/thread-t1/messages") {
        return jsonResponse(200, { id: "msg-thread", channel_id: "thread-t1" });
      }
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
    vi.stubEnv("DISCORD_BOT_GUILD_ID", "guild-1");
    vi.stubEnv("DISCORD_BOT_TOURNAMENT_CHANNEL_ID", "chan-tournois");
    vi.stubEnv("DISCORD_DM_TOURNAMENT_ENABLED", "true");
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

  /** Tournoi bot en inscriptions, annonce prête à partir, créateur jamais
   * dans sa propre sélection. */
  async function makeTournament(creatorId: string, selectedIds: string[]) {
    const game = await db.game.create({ data: { name: uniq("game"), source: "MANUAL", addedById: creatorId } });
    const tournament = await db.tournament.create({
      data: {
        name: uniq("tournoi"),
        gameId: game.id,
        createdById: creatorId,
        status: "REGISTRATION",
        maxPlayers: 4,
        announceViaBot: true,
        discordGuildId: "guild-1",
        discordChannelId: "chan-tournois",
        notifiedUserIds: selectedIds,
      },
    });
    await announceLib.enqueueTournamentCreationDeliveries(tournament.id);
    return tournament;
  }

  async function drain(now: Date = new Date()) {
    const outcomes = [];
    for (;;) {
      const outcome = await executorLib.processNextDelivery({
        resolver: announceLib.tournamentAnnounceResolver,
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

  function dmRows(tournamentId: string) {
    return db.notificationDelivery.findMany({
      where: { targetSlot: { startsWith: `default-guild:TOURNAMENT:${tournamentId}:dm:` } },
      orderBy: { sequence: "asc" },
    });
  }

  describe("annonce d'ouverture", () => {
    it("un MP par pote sélectionné ET pour le créateur, mention retirée du salon, aucun doublon après un retry", async () => {
      const creator = await makeUser();
      const a = await makeUser();
      const b = await makeUser();
      const tournament = await makeTournament(creator.id, [a.id, b.id]);

      // L'annonce du salon échoue une fois (5xx) puis passe : le résolveur
      // est rappelé, les MP déjà enqueue-és ne doivent pas être doublés.
      announcePostFailuresLeft = 1;
      const t0 = new Date();
      expect((await drain(t0)).map((o) => o.outcome)).toContain("retrying");
      await drain(new Date(t0.getTime() + 10 * 60_000));

      const body = JSON.parse(String(calls("POST", /\/channels\/chan-tournois\/messages$/).at(-1)![1].body));
      expect(body.content).toBeUndefined(); // plus aucune mention dans l'annonce
      expect(body.allowed_mentions).toEqual({ parse: [] });

      const rows = await dmRows(tournament.id);
      expect(rows).toHaveLength(3);
      expect(rows.map((r) => r.recipientKey).sort()).toEqual([`user:${a.id}`, `user:${b.id}`, `user:${creator.id}`].sort());
      expect(rows.every((r) => r.status === "SENT" && r.channel === "DISCORD_DM")).toBe(true);

      const dmPosts = calls("POST", /\/channels\/dm-[^/]+\/messages$/);
      expect(dmPosts).toHaveLength(3);
      const dmBody = JSON.parse(String(dmPosts[0][1].body));
      expect(dmBody.content).toContain("inscriptions ouvertes");
      expect(dmBody.embeds).toHaveLength(1);
      expect(dmBody.allowed_mentions).toEqual({ parse: [] });
    });

    it("interrupteur éteint : comportement historique (mention dans le salon, aucun MP, créateur non prévenu)", async () => {
      vi.stubEnv("DISCORD_DM_TOURNAMENT_ENABLED", "false");
      const creator = await makeUser();
      const a = await makeUser();
      const tournament = await makeTournament(creator.id, [a.id]);

      await drain();

      const body = JSON.parse(String(calls("POST", /\/channels\/chan-tournois\/messages$/).at(-1)![1].body));
      expect(body.content).toBe(`<@${a.discordId}>`);
      expect(await dmRows(tournament.id)).toHaveLength(0);
      expect(calls("POST", /users\/@me\/channels/)).toHaveLength(0);
    });

    it("préférence TOURNAMENT du créateur désactivée : pas de MP pour lui, les invités en reçoivent un", async () => {
      const creator = await makeUser();
      const a = await makeUser();
      const tournament = await makeTournament(creator.id, [a.id]);
      await db.userNotificationPreference.create({
        data: { userId: creator.id, category: "TOURNAMENT", enabled: false },
      });

      await drain();

      const rows = await dmRows(tournament.id);
      expect(rows.map((r) => r.recipientKey)).toEqual([`user:${a.id}`]);
    });

    it("préférence désactivée APRÈS la mise en file : le MP est refusé au traitement, aucun appel Discord", async () => {
      const creator = await makeUser();
      const a = await makeUser();
      const tournament = await makeTournament(creator.id, [a.id]);
      // Annonce seule : on ne traite pas encore les MP.
      await executorLib.processNextDelivery({ resolver: announceLib.tournamentAnnounceResolver, owner: "w1" });
      expect(await dmRows(tournament.id)).toHaveLength(2);

      await db.userNotificationPreference.create({ data: { userId: a.id, category: "TOURNAMENT", enabled: false } });
      const outcomes = await drain();
      expect(outcomes).toContainEqual(expect.objectContaining({ outcome: "failed", errorClass: "resolver:preference_declined" }));
      expect(calls("POST", new RegExp(`/channels/dm-${a.discordId}/messages$`))).toHaveLength(0);
      expect(calls("POST", new RegExp(`/channels/dm-${creator.discordId}/messages$`))).toHaveLength(1);
    });

    it("tournoi lancé avant l'envoi du MP : refusé (expired), aucun appel Discord", async () => {
      const creator = await makeUser();
      const a = await makeUser();
      const tournament = await makeTournament(creator.id, [a.id]);
      await executorLib.processNextDelivery({ resolver: announceLib.tournamentAnnounceResolver, owner: "w1" });
      fetchMock.mockClear();

      await db.tournament.update({ where: { id: tournament.id }, data: { status: "IN_PROGRESS" } });
      const outcomes = await drain();
      expect(outcomes.filter((o) => o.outcome === "failed" && o.errorClass === "resolver:expired").length).toBeGreaterThanOrEqual(2);
      expect(calls("POST", /users\/@me\/channels/)).toHaveLength(0);
    });
  });

  describe("MP fermé (50007)", () => {
    it("échec tracé, mention de secours dans le fil, jamais de nouvelle tentative de MP", async () => {
      const creator = await makeUser();
      const a = await makeUser();
      const b = await makeUser();
      const tournament = await makeTournament(creator.id, [a.id, b.id]);
      closedDms.add(a.discordId);

      const outcomes = await drain();
      expect(outcomes.filter((o) => o.outcome === "failed")).toEqual([
        expect.objectContaining({ errorClass: "discord:dm_unavailable" }),
      ]);

      const failed = (await dmRows(tournament.id)).find((r) => r.recipientKey === `user:${a.id}`)!;
      expect(failed.status).toBe("FAILED");
      expect(failed.errorClass).toBe("discord:dm_unavailable");
      expect(calls("POST", new RegExp(`/channels/dm-${a.discordId}/messages$`))).toHaveLength(1);

      // Mention de secours : postée dans le fil, ne mentionne que ce pote.
      const fallback = JSON.parse(String(calls("POST", /\/channels\/thread-t1\/messages$/).at(-1)![1].body));
      expect(fallback.content).toContain(`<@${a.discordId}>`);
      expect(fallback.content).toContain("MP impossible");
      expect(fallback.content).not.toContain(`<@${b.discordId}>`);
      expect(fallback.allowed_mentions.users).toEqual([a.discordId]);

      // Un nouveau passage ne renvoie AUCUN MP à ce pote.
      const { enqueueDirectMessages } = await import("./discord-dm");
      const result = await enqueueDirectMessages({
        category: "TOURNAMENT",
        sourceId: tournament.id,
        eventType: "TOURNAMENT_DM",
        kind: "announce",
        users: [a, b],
      });
      expect(result.blocked.map((u) => u.id)).toEqual([a.id]);
      await drain();
      expect(calls("POST", new RegExp(`/channels/dm-${a.discordId}/messages$`))).toHaveLength(1);
    });

    it("une autre erreur terminale (permission) ne déclenche pas de mention de secours", async () => {
      const creator = await makeUser();
      const a = await makeUser();
      const tournament = await makeTournament(creator.id, [a.id]);
      const baseRouter = fetchMock.getMockImplementation() as (url: string, init?: RequestInit) => Promise<Response>;
      fetchMock.mockImplementation(async (url: string, init: RequestInit = {}) =>
        String(url).includes("/channels/dm-") ? jsonResponse(403, { code: 50013 }) : baseRouter(url, init)
      );

      const outcomes = await drain();
      expect(outcomes.some((o) => o.outcome === "failed" && o.errorClass === "discord:auth_or_permission")).toBe(true);
      expect(await db.notificationDelivery.count({ where: { targetSlot: { contains: ":dm-fallback:" } } })).toBe(0);
      expect(await dmRows(tournament.id)).toHaveLength(2);
    });
  });
});
