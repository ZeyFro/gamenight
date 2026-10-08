import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * "Jouer maintenant" — parcours de bout en bout (2 invités : créer, rejoindre,
 * quitter, changer de jeu, terminer, durée max 3 h, XP de présence, MP selon
 * les règles #116). Postgres isolé (`TEST_DATABASE_URL`) + Discord simulé
 * (`fetch` mocké) : aucun appel réseau réel. Suite SKIPPÉE si la variable
 * est absente. Complète `instant-sessions.integration.test.ts` (règles
 * unitaires/concurrence) sans le dupliquer.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  if (!TEST_DATABASE_URL) return { prisma: {} as unknown };
  return { prisma: new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) };
});

if (!TEST_DATABASE_URL) {
  console.warn("[instant-sessions.e2e.integration.test] TEST_DATABASE_URL absente — suite SKIPPÉE.");
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

const MIN = 60 * 1000;

describe.skipIf(!TEST_DATABASE_URL)("jouer maintenant — bout en bout (Postgres isolé + Discord simulé)", () => {
  let db: import("@prisma/client").PrismaClient;
  let lib: typeof import("./instant-sessions");
  let announceLib: typeof import("./instant-session-announce");
  let executorLib: typeof import("./notification-executor");
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as unknown as import("@prisma/client").PrismaClient;
    lib = await import("./instant-sessions");
    announceLib = await import("./instant-session-announce");
    executorLib = await import("./notification-executor");
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  beforeEach(async () => {
    await db.$executeRawUnsafe(
      `TRUNCATE "Community", "NotificationDelivery", "NotificationEvent", "Notification", "InstantSessionPresenceInterval", "InstantSession", "Game", "User", "GroupSessionStats", "GroupGameStat", "GroupAchievement", "GroupActiveWeek" CASCADE`
    );
    // Le statut default d'une suite précédente ne fait pas partie du scénario.
    (await import("@/lib/default-community")).resetDefaultCommunityIdCache();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("DISCORD_BOT_TOKEN", "test-bot-token");
    vi.stubEnv("DISCORD_BOT_GUILD_ID", "guild-1");
    vi.stubEnv("DISCORD_BOT_INSTANT_SESSION_INVITE_ENABLED", "true");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  let counter = 0;
  const uniq = (label: string) => `${label}-${++counter}`;
  const makeUser = () => {
    const id = uniq("user");
    return db.user.create({ data: { discordId: id, discordName: id } });
  };
  const makeGame = (addedById: string) =>
    db.game.create({ data: { name: uniq("game"), source: "MANUAL", addedById } });

  /** Traite toute la file DM d'invitation avec un Discord qui accepte tout. */
  async function drainQueue() {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/users/@me/channels")) return jsonResponse(200, { id: `dm-${uniq("c")}` });
      return jsonResponse(200, { id: uniq("msg"), channel_id: "dm", method: init?.method });
    });
    return executorLib.runExecutorBatch({ resolver: announceLib.instantSessionInviteResolver, owner: uniq("w") });
  }

  const deliveries = (sessionId: string) =>
    db.notificationDelivery.findMany({
      where: { targetSlot: { contains: sessionId } },
      select: { operation: true, recipientKey: true, status: true },
    });

  /** Recale une session et ses intervalles dans le passé (horloge réelle). */
  async function shiftSessionBack(sessionId: string, ageMs: number) {
    const createdAt = new Date(Date.now() - ageMs);
    await db.instantSession.update({
      where: { id: sessionId },
      data: { createdAt, expiresAt: new Date(createdAt.getTime() + lib.INSTANT_SESSION_MAX_DURATION_MS) },
    });
    await db.instantSessionPresenceInterval.updateMany({
      where: { instantSessionId: sessionId },
      data: { startedAt: createdAt },
    });
    return createdAt;
  }

  it("parcours complet : 2 invités, rejoindre/quitter sans ping, changement de jeu = MP édité, fin = MP édité, XP de présence", async () => {
    const creator = await makeUser();
    const guestA = await makeUser();
    const guestB = await makeUser();
    const gameA = await makeGame(creator.id);
    const gameB = await makeGame(creator.id);

    const created = await lib.createInstantSession({
      creatorId: creator.id,
      gameId: gameA.id,
      notifiedUserIds: [guestA.id, guestB.id],
    });
    if (!created.ok) throw new Error("setup");
    const id = created.instantSession.id;

    // Création : un MP par invité, jamais pour le créateur.
    expect((await drainQueue()).sent).toBe(2);
    let rows = await deliveries(id);
    expect(rows.filter((r) => r.operation === "SEND").map((r) => r.recipientKey).sort()).toEqual(
      [`user:${guestA.id}`, `user:${guestB.id}`].sort()
    );

    // Arrivée / départ : aucun ping, aucun MP, aucune nouvelle livraison.
    const before = (await deliveries(id)).length;
    await lib.joinInstantSession(id, guestA.id);
    await lib.joinInstantSession(id, guestB.id);
    await lib.leaveInstantSession(id, guestB.id);
    await lib.joinInstantSession(id, guestB.id);
    expect((await deliveries(id)).length).toBe(before);
    fetchMock.mockClear();
    expect((await drainQueue()).sent).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();

    // Changement de jeu : les MP existants sont ÉDITÉS (jamais un nouvel envoi).
    expect(await lib.changeInstantSessionGame(id, creator.id, gameB.id)).toEqual({ ok: true });
    expect((await drainQueue()).sent).toBe(2);
    expect(fetchMock.mock.calls.every(([, init]) => (init as RequestInit).method === "PATCH")).toBe(true);
    rows = await deliveries(id);
    expect(rows.filter((r) => r.operation === "SEND")).toHaveLength(2);
    expect(rows.filter((r) => r.operation === "EDIT")).toHaveLength(2);

    // 20 minutes de présence conjointe écoulées, puis fin par le créateur.
    await shiftSessionBack(id, 20 * MIN);
    fetchMock.mockClear();
    expect(await lib.endInstantSession(id, creator.id, "creator_left")).toEqual({ ok: true });
    expect((await drainQueue()).sent).toBe(2); // 2 EDIT « terminée »
    expect(fetchMock.mock.calls.every(([, init]) => (init as RequestInit).method === "PATCH")).toBe(true);
    rows = await deliveries(id);
    expect(rows.filter((r) => r.operation === "SEND")).toHaveLength(2); // jamais de nouveau MP

    // XP de présence : une fois par personne (créateur + 2 invités), idempotent.
    for (const u of [creator, guestA, guestB]) {
      expect(await db.xpEvent.count({ where: { userId: u.id, reason: "PARTICIPATE", sourceId: id } })).toBe(1);
    }
    await lib.settleInstantSessionRewards(id);
    expect(await db.xpEvent.count({ where: { reason: "PARTICIPATE", sourceId: id } })).toBe(3);
  });

  it("le créateur n'est jamais invité par MP, même s'il figure dans la sélection (ping : créateur sans mention)", async () => {
    const creator = await makeUser();
    const guest = await makeUser();
    const game = await makeGame(creator.id);

    const created = await lib.createInstantSession({
      creatorId: creator.id,
      gameId: game.id,
      notifiedUserIds: [creator.id, guest.id, guest.id],
    });
    if (!created.ok) throw new Error("setup");

    const rows = await deliveries(created.instantSession.id);
    expect(rows.map((r) => r.recipientKey)).toEqual([`user:${guest.id}`]);
    expect(await db.notification.count({ where: { userId: creator.id, type: "INSTANT_SESSION_INVITE" } })).toBe(0);
    expect(await db.notification.count({ where: { userId: guest.id, type: "INSTANT_SESSION_INVITE" } })).toBe(1);
  });

  it("durée max 3 h : une session expirée sans cron est close À L'ÉCHÉANCE (endedAt = expiresAt), jamais à l'heure tardive du règlement", async () => {
    const creator = await makeUser();
    const guest = await makeUser();
    const game = await makeGame(creator.id);
    const created = await lib.createInstantSession({ creatorId: creator.id, gameId: game.id, notifiedUserIds: [] });
    if (!created.ok) throw new Error("setup");
    const id = created.instantSession.id;
    await lib.joinInstantSession(id, guest.id);
    await shiftSessionBack(id, 5 * 60 * MIN); // créée il y a 5 h → expirée depuis 2 h

    expect(await lib.settleAllDueInstantSessions()).toEqual([id]);

    const session = await db.instantSession.findUniqueOrThrow({ where: { id } });
    expect(session.status).toBe("ENDED");
    expect(session.endedReason).toBe("expired");
    expect(session.endedAt!.getTime()).toBe(session.expiresAt.getTime());
    const intervals = await db.instantSessionPresenceInterval.findMany({ where: { instantSessionId: id } });
    for (const interval of intervals) {
      expect(interval.endedAt!.getTime()).toBeLessThanOrEqual(session.expiresAt.getTime());
    }
    // Les deux ont bien été présents 3 h : XP attribuée, une fois chacun.
    expect(await db.xpEvent.count({ where: { reason: "PARTICIPATE", sourceId: id } })).toBe(2);
  });

  it("quitter APRÈS l'échéance (sans cron) : la session est réglée d'abord, la présence ne dépasse jamais 3 h", async () => {
    const creator = await makeUser();
    const guest = await makeUser();
    const game = await makeGame(creator.id);
    const created = await lib.createInstantSession({ creatorId: creator.id, gameId: game.id, notifiedUserIds: [] });
    if (!created.ok) throw new Error("setup");
    const id = created.instantSession.id;
    await lib.joinInstantSession(id, guest.id);
    await shiftSessionBack(id, 4 * 60 * MIN); // expirée depuis 1 h, statut encore ACTIVE

    expect(await lib.leaveInstantSession(id, guest.id)).toEqual({ ok: true });

    const session = await db.instantSession.findUniqueOrThrow({ where: { id } });
    expect(session.status).toBe("ENDED");
    const guestInterval = await db.instantSessionPresenceInterval.findFirstOrThrow({
      where: { instantSessionId: id, userId: guest.id },
    });
    expect(guestInterval.endedAt!.getTime()).toBeLessThanOrEqual(session.expiresAt.getTime());
  });
});
