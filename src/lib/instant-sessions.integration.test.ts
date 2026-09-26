import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * V2 — "Jouer maintenant" : tests d'intégration contre une base Postgres
 * isolée + Discord entièrement simulé (`fetch` mocké), même discipline
 * que `retention.integration.test.ts`/`session-announce.integration.test.ts`.
 * Nécessite `TEST_DATABASE_URL` — suite entièrement SKIPPÉE si absente.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  if (!TEST_DATABASE_URL) return { prisma: {} as unknown };
  return { prisma: new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) };
});

if (!TEST_DATABASE_URL) {
  console.warn("[instant-sessions.integration.test] TEST_DATABASE_URL absente — suite SKIPPÉE.");
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

describe.skipIf(!TEST_DATABASE_URL)("instant-sessions (intégration Postgres isolée + Discord HTTP simulé)", () => {
  let db: import("@prisma/client").PrismaClient;
  let lib: typeof import("./instant-sessions");
  let retention: typeof import("./retention");
  let announceLib: typeof import("./instant-session-announce");
  let executorLib: typeof import("./notification-executor");
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    const prismaModule = await import("@/lib/prisma");
    db = prismaModule.prisma as unknown as import("@prisma/client").PrismaClient;
    lib = await import("./instant-sessions");
    retention = await import("./retention");
    announceLib = await import("./instant-session-announce");
    executorLib = await import("./notification-executor");
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  beforeEach(async () => {
    // `GroupSessionStats`/`GroupGameStat` sont des singletons/compteurs
    // globaux SANS FK vers `User` (voir schema.prisma) — jamais couverts
    // par le `CASCADE` ci-dessus. D'autres suites d'intégration partageant
    // cette même base (ex. `retention.integration.test.ts`, via
    // `markSessionDone`) peuvent y laisser un résidu selon l'ordre
    // d'exécution des fichiers : les truncate explicitement ici aussi pour
    // une isolation propre, indépendante de cet ordre.
    await db.$executeRawUnsafe(
      `TRUNCATE "NotificationDelivery", "NotificationEvent", "Notification", "InstantSessionPresenceInterval", "InstantSession", "Game", "User", "GroupSessionStats", "GroupGameStat", "GroupAchievement", "GroupActiveWeek" CASCADE`
    );
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
  function uniq(label: string): string {
    counter += 1;
    return `${label}-${counter}`;
  }

  async function makeUser(silenceReminders = false) {
    const id = uniq("user");
    return db.user.create({ data: { discordId: id, discordName: id, silenceReminders } });
  }
  async function makeGame(addedById: string) {
    return db.game.create({ data: { name: uniq("game"), source: "MANUAL", addedById } });
  }
  async function openInterval(instantSessionId: string, userId: string, startedAt: Date) {
    return db.instantSessionPresenceInterval.create({ data: { instantSessionId, userId, startedAt } });
  }
  async function closeInterval(id: string, endedAt: Date) {
    return db.instantSessionPresenceInterval.update({ where: { id }, data: { endedAt } });
  }

  describe("Règles métier", () => {
    it("le créateur devient participant DÈS LA CRÉATION, dans la même transaction", async () => {
      const creator = await makeUser();
      const game = await makeGame(creator.id);

      const result = await lib.createInstantSession({ creatorId: creator.id, gameId: game.id, notifiedUserIds: [] });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const open = await db.instantSessionPresenceInterval.findFirst({
        where: { instantSessionId: result.instantSession.id, userId: creator.id, endedAt: null },
      });
      expect(open).not.toBeNull();
    });

    it("expiresAt = createdAt + 3h, JAMAIS repoussé par une jonction ultérieure", async () => {
      const creator = await makeUser();
      const joiner = await makeUser();
      const game = await makeGame(creator.id);
      const created = await lib.createInstantSession({ creatorId: creator.id, gameId: game.id, notifiedUserIds: [] });
      if (!created.ok) throw new Error("setup");
      const expiresAtBefore = created.instantSession.expiresAt.getTime();

      await lib.joinInstantSession(created.instantSession.id, joiner.id);

      const reread = await db.instantSession.findUniqueOrThrow({ where: { id: created.instantSession.id } });
      expect(reread.expiresAt.getTime()).toBe(expiresAtBefore);
      expect(reread.expiresAt.getTime() - reread.createdAt.getTime()).toBe(
        lib.INSTANT_SESSION_MAX_DURATION_MS
      );
    });

    it("expiresAt JAMAIS repoussé par un changement de jeu — conserve aussi participants ET temps déjà comptabilisé", async () => {
      const creator = await makeUser();
      const joiner = await makeUser();
      const game1 = await makeGame(creator.id);
      const game2 = await makeGame(creator.id);
      const created = await lib.createInstantSession({ creatorId: creator.id, gameId: game1.id, notifiedUserIds: [] });
      if (!created.ok) throw new Error("setup");
      const sessionId = created.instantSession.id;
      await lib.joinInstantSession(sessionId, joiner.id);

      const before = await db.instantSessionPresenceInterval.findMany({ where: { instantSessionId: sessionId } });
      const expiresAtBefore = created.instantSession.expiresAt.getTime();

      const changed = await lib.changeInstantSessionGame(sessionId, creator.id, game2.id);
      expect(changed.ok).toBe(true);

      const reread = await db.instantSession.findUniqueOrThrow({ where: { id: sessionId } });
      expect(reread.gameId).toBe(game2.id);
      expect(reread.expiresAt.getTime()).toBe(expiresAtBefore);

      const after = await db.instantSessionPresenceInterval.findMany({ where: { instantSessionId: sessionId } });
      expect(after).toHaveLength(before.length); // aucun intervalle touché
      expect(after.map((i) => i.startedAt.getTime()).sort()).toEqual(
        before.map((i) => i.startedAt.getTime()).sort()
      );
    });

    it("un utilisateur ne peut être membre que d'UNE SEULE session instantanée active à la fois", async () => {
      const user = await makeUser();
      const creatorA = await makeUser();
      const gameA = await makeGame(creatorA.id);
      const gameB = await makeGame(creatorA.id);

      const sessionA = await lib.createInstantSession({ creatorId: user.id, gameId: gameA.id, notifiedUserIds: [] });
      expect(sessionA.ok).toBe(true);

      // Une 2e création par le MÊME user (déjà membre de sessionA) échoue.
      const sessionB = await lib.createInstantSession({ creatorId: user.id, gameId: gameB.id, notifiedUserIds: [] });
      expect(sessionB).toEqual({ ok: false, reason: "already_in_another_session" });

      // Rejoindre une AUTRE session créée par quelqu'un d'autre échoue aussi.
      const otherCreator = await makeUser();
      const otherSession = await lib.createInstantSession({
        creatorId: otherCreator.id,
        gameId: gameA.id,
        notifiedUserIds: [],
      });
      if (!otherSession.ok) throw new Error("setup");
      const joinResult = await lib.joinInstantSession(otherSession.instantSession.id, user.id);
      expect(joinResult).toEqual({ ok: false, reason: "already_in_another_session" });
    });

    it("n'importe quel utilisateur peut rejoindre LIBREMENT — aucune invitation requise", async () => {
      const creator = await makeUser();
      const stranger = await makeUser(); // jamais invité, jamais sélectionné dans notifiedUserIds
      const game = await makeGame(creator.id);
      const created = await lib.createInstantSession({ creatorId: creator.id, gameId: game.id, notifiedUserIds: [] });
      if (!created.ok) throw new Error("setup");

      const result = await lib.joinInstantSession(created.instantSession.id, stranger.id);
      expect(result).toEqual({ ok: true });
    });

    it("le CRÉATEUR ne peut pas `leaveInstantSession` — doit passer par `endInstantSession`", async () => {
      const creator = await makeUser();
      const game = await makeGame(creator.id);
      const created = await lib.createInstantSession({ creatorId: creator.id, gameId: game.id, notifiedUserIds: [] });
      if (!created.ok) throw new Error("setup");

      const result = await lib.leaveInstantSession(created.instantSession.id, creator.id);
      expect(result).toEqual({ ok: false, reason: "creator_cannot_leave" });

      // Son intervalle reste ouvert — jamais fermé par ce refus.
      const open = await db.instantSessionPresenceInterval.findFirst({
        where: { instantSessionId: created.instantSession.id, userId: creator.id, endedAt: null },
      });
      expect(open).not.toBeNull();
    });

    it("un AUTRE participant peut quitter ET revenir tant que la session reste active", async () => {
      const creator = await makeUser();
      const guest = await makeUser();
      const game = await makeGame(creator.id);
      const created = await lib.createInstantSession({ creatorId: creator.id, gameId: game.id, notifiedUserIds: [] });
      if (!created.ok) throw new Error("setup");
      const sessionId = created.instantSession.id;

      await lib.joinInstantSession(sessionId, guest.id);
      const leaveResult = await lib.leaveInstantSession(sessionId, guest.id);
      expect(leaveResult).toEqual({ ok: true });

      const rejoinResult = await lib.joinInstantSession(sessionId, guest.id);
      expect(rejoinResult).toEqual({ ok: true });

      const intervals = await db.instantSessionPresenceInterval.findMany({
        where: { instantSessionId: sessionId, userId: guest.id },
      });
      expect(intervals).toHaveLength(2); // deux passages distincts, jamais réécrits l'un sur l'autre
    });

    it("une session TERMINÉE ne peut plus être rejointe, ni modifiée (changement de jeu refusé)", async () => {
      const creator = await makeUser();
      const stranger = await makeUser();
      const game1 = await makeGame(creator.id);
      const game2 = await makeGame(creator.id);
      const created = await lib.createInstantSession({ creatorId: creator.id, gameId: game1.id, notifiedUserIds: [] });
      if (!created.ok) throw new Error("setup");
      const sessionId = created.instantSession.id;

      await lib.endInstantSession(sessionId, creator.id, "creator_left");

      const joinResult = await lib.joinInstantSession(sessionId, stranger.id);
      expect(joinResult).toEqual({ ok: false, reason: "ended" });

      const changeResult = await lib.changeInstantSessionGame(sessionId, creator.id, game2.id);
      expect(changeResult).toEqual({ ok: false, reason: "ended" });

      const reread = await db.instantSession.findUniqueOrThrow({ where: { id: sessionId } });
      expect(reread.gameId).toBe(game1.id); // inchangé
    });

    it("si le créateur termine, TOUS les intervalles encore ouverts sont fermés au MÊME instant `endedAt`", async () => {
      const creator = await makeUser();
      const guestA = await makeUser();
      const guestB = await makeUser();
      const game = await makeGame(creator.id);
      const created = await lib.createInstantSession({ creatorId: creator.id, gameId: game.id, notifiedUserIds: [] });
      if (!created.ok) throw new Error("setup");
      const sessionId = created.instantSession.id;
      await lib.joinInstantSession(sessionId, guestA.id);
      await lib.joinInstantSession(sessionId, guestB.id);
      await lib.leaveInstantSession(sessionId, guestB.id); // B déjà parti — son intervalle est déjà fermé

      const result = await lib.endInstantSession(sessionId, creator.id, "creator_left");
      expect(result).toEqual({ ok: true });

      const session = await db.instantSession.findUniqueOrThrow({ where: { id: sessionId } });
      expect(session.status).toBe("ENDED");
      expect(session.endedAt).not.toBeNull();
      expect(session.endedReason).toBe("creator_left");

      const stillOpen = await db.instantSessionPresenceInterval.findMany({
        where: { instantSessionId: sessionId, endedAt: null },
      });
      expect(stillOpen).toHaveLength(0); // créateur ET guestA fermés

      const creatorInterval = await db.instantSessionPresenceInterval.findFirstOrThrow({
        where: { instantSessionId: sessionId, userId: creator.id },
      });
      const guestAInterval = await db.instantSessionPresenceInterval.findFirstOrThrow({
        where: { instantSessionId: sessionId, userId: guestA.id },
      });
      expect(creatorInterval.endedAt!.getTime()).toBe(guestAInterval.endedAt!.getTime());
      expect(creatorInterval.endedAt!.getTime()).toBe(session.endedAt!.getTime());
    });

    it("`endInstantSession` réclamé une SEULE fois (updateMany conditionné) — un second appel est un no-op idempotent", async () => {
      const creator = await makeUser();
      const game = await makeGame(creator.id);
      const created = await lib.createInstantSession({ creatorId: creator.id, gameId: game.id, notifiedUserIds: [] });
      if (!created.ok) throw new Error("setup");
      const sessionId = created.instantSession.id;

      const first = await lib.endInstantSession(sessionId, creator.id, "creator_left");
      expect(first).toEqual({ ok: true });
      const firstEndedAt = (await db.instantSession.findUniqueOrThrow({ where: { id: sessionId } })).endedAt;

      const second = await lib.endInstantSession(sessionId, creator.id, "creator_left");
      expect(second).toEqual({ ok: true }); // idempotent, jamais une erreur

      const secondEndedAt = (await db.instantSession.findUniqueOrThrow({ where: { id: sessionId } })).endedAt;
      expect(secondEndedAt!.getTime()).toBe(firstEndedAt!.getTime()); // jamais réécrit
    });
  });

  describe("Présence conjointe et XP (règle des 15 minutes)", () => {
    it("attribution après 15 minutes conjointes — IDEMPOTENTE (appel répété n'attribue jamais deux fois)", async () => {
      const creator = await makeUser();
      const guest = await makeUser();
      const game = await makeGame(creator.id);
      const created = await lib.createInstantSession({ creatorId: creator.id, gameId: game.id, notifiedUserIds: [] });
      if (!created.ok) throw new Error("setup");
      const sessionId = created.instantSession.id;

      // Créateur déjà présent depuis la création — guest rejoint et reste
      // 16 minutes, sous forme d'un intervalle FERMÉ (simule un départ
      // après avoir atteint le seuil). L'intervalle du créateur (ouvert à
      // la création, sur l'horloge réelle) est réaligné sur cette même
      // fenêtre fermée — sinon il resterait ouvert jusqu'à `wallClockNow()`
      // au moment du règlement, sans jamais recouper une fenêtre fixée
      // arbitrairement dans le passé/futur calendaire.
      const start = new Date("2026-09-27T18:00:00.000Z");
      const end = new Date("2026-09-27T18:16:00.000Z");
      await db.instantSessionPresenceInterval.updateMany({
        where: { instantSessionId: sessionId, userId: creator.id },
        data: { startedAt: start, endedAt: end },
      });
      const guestInterval = await openInterval(sessionId, guest.id, start);
      await closeInterval(guestInterval.id, end);

      await lib.settleInstantSessionRewards(sessionId);
      const xpAfterFirst = await db.xpEvent.count({ where: { userId: guest.id, reason: "PARTICIPATE" } });
      expect(xpAfterFirst).toBe(1);

      await lib.settleInstantSessionRewards(sessionId); // rappel — jamais un second XpEvent
      const xpAfterSecond = await db.xpEvent.count({ where: { userId: guest.id, reason: "PARTICIPATE" } });
      expect(xpAfterSecond).toBe(1);

      const xpEvent = await db.xpEvent.findFirstOrThrow({ where: { userId: guest.id, reason: "PARTICIPATE" } });
      expect(xpEvent.sourceId).toBe(sessionId);
    });

    it("sous 15 minutes conjointes — AUCUNE XP attribuée", async () => {
      const creator = await makeUser();
      const guest = await makeUser();
      const game = await makeGame(creator.id);
      const created = await lib.createInstantSession({ creatorId: creator.id, gameId: game.id, notifiedUserIds: [] });
      if (!created.ok) throw new Error("setup");
      const sessionId = created.instantSession.id;

      const start = new Date("2026-09-27T18:00:00.000Z");
      const end = new Date("2026-09-27T18:10:00.000Z"); // 10 min < 15
      await db.instantSessionPresenceInterval.updateMany({
        where: { instantSessionId: sessionId, userId: creator.id },
        data: { startedAt: start, endedAt: end },
      });
      const guestInterval = await openInterval(sessionId, guest.id, start);
      await closeInterval(guestInterval.id, end);

      await lib.settleInstantSessionRewards(sessionId);
      expect(await db.xpEvent.count({ where: { userId: guest.id, reason: "PARTICIPATE" } })).toBe(0);
    });

    it("NE TOUCHE JAMAIS les agrégats de groupe des soirées planifiées (GroupSessionStats/GroupGameStat/GroupActiveWeek), n'appelle jamais checkGroupAchievements", async () => {
      const creator = await makeUser();
      const guest = await makeUser();
      const game = await makeGame(creator.id);
      const created = await lib.createInstantSession({ creatorId: creator.id, gameId: game.id, notifiedUserIds: [] });
      if (!created.ok) throw new Error("setup");
      const sessionId = created.instantSession.id;
      const start = new Date("2026-09-27T18:00:00.000Z");
      const end = new Date("2026-09-27T18:20:00.000Z");
      await db.instantSessionPresenceInterval.updateMany({
        where: { instantSessionId: sessionId, userId: creator.id },
        data: { startedAt: start, endedAt: end },
      });
      const guestInterval = await openInterval(sessionId, guest.id, start);
      await closeInterval(guestInterval.id, end);

      await lib.settleInstantSessionRewards(sessionId);

      expect(await db.groupSessionStats.count()).toBe(0);
      expect(await db.groupGameStat.count()).toBe(0);
      expect(await db.groupActiveWeek.count()).toBe(0);
      expect(await db.groupAchievement.count({ where: { unlockedAt: { not: null } } })).toBe(0);
    });

    it("`checkSessionsParticipatedBadges` se débloque via la MÊME règle que les soirées planifiées (XpEvent PARTICIPATE)", async () => {
      const creator = await makeUser();
      const guest = await makeUser();
      const game = await makeGame(creator.id);
      const badge = await db.badge.create({
        data: {
          name: uniq("badge"),
          icon: "🎮",
          description: "test",
          category: "PARTICIPATION",
          rarity: "COMMON",
          criteria: { type: "SESSIONS_PARTICIPATED", count: 1 },
          modifiedById: creator.id,
        },
      });
      const created = await lib.createInstantSession({ creatorId: creator.id, gameId: game.id, notifiedUserIds: [] });
      if (!created.ok) throw new Error("setup");
      const sessionId = created.instantSession.id;
      const start = new Date("2026-09-27T18:00:00.000Z");
      const end = new Date("2026-09-27T18:20:00.000Z");
      await db.instantSessionPresenceInterval.updateMany({
        where: { instantSessionId: sessionId, userId: creator.id },
        data: { startedAt: start, endedAt: end },
      });
      const guestInterval = await openInterval(sessionId, guest.id, start);
      await closeInterval(guestInterval.id, end);

      await lib.settleInstantSessionRewards(sessionId);

      expect(await db.userBadge.count({ where: { userId: guest.id, badgeId: badge.id } })).toBe(1);
    });

    it("dix minutes à trois : dix minutes PAR personne (via de vrais intervalles Postgres, pas seulement l'unitaire pur)", async () => {
      const creator = await makeUser();
      const a = await makeUser();
      const b = await makeUser();
      const game = await makeGame(creator.id);
      const created = await lib.createInstantSession({ creatorId: creator.id, gameId: game.id, notifiedUserIds: [] });
      if (!created.ok) throw new Error("setup");
      const sessionId = created.instantSession.id;
      // Ferme l'intervalle du créateur (ouvert à la création) pour ne
      // garder QUE a/b dans ce scénario à 3 personnes contrôlé.
      await db.instantSessionPresenceInterval.updateMany({
        where: { instantSessionId: sessionId, userId: creator.id },
        data: { endedAt: new Date("2026-09-27T18:00:00.000Z") },
      });
      const start = new Date("2026-09-27T18:00:00.000Z");
      const end = new Date("2026-09-27T18:16:00.000Z"); // 16 min, au-delà du seuil
      const ca = await openInterval(sessionId, creator.id, start);
      await closeInterval(ca.id, end);
      const aInt = await openInterval(sessionId, a.id, start);
      await closeInterval(aInt.id, end);
      const bInt = await openInterval(sessionId, b.id, start);
      await closeInterval(bInt.id, end);

      await lib.settleInstantSessionRewards(sessionId);

      for (const u of [creator, a, b]) {
        expect(await db.xpEvent.count({ where: { userId: u.id, reason: "PARTICIPATE", sourceId: sessionId } })).toBe(
          1
        );
      }
    });

    it("règlement final à l'EXPIRATION même SANS navigateur ouvert (`settleAllDueInstantSessions`)", async () => {
      const creator = await makeUser();
      const guest = await makeUser();
      const game = await makeGame(creator.id);
      const created = await lib.createInstantSession({ creatorId: creator.id, gameId: game.id, notifiedUserIds: [] });
      if (!created.ok) throw new Error("setup");
      const sessionId = created.instantSession.id;
      // Force une création + une expiration largement dans le passé —
      // relatif à l'horloge RÉELLE du test (jamais une date calendaire
      // codée en dur, qui peut se retrouver dans le futur selon la date
      // d'exécution réelle) — pour simuler une session dont l'expiration
      // (3h) est déjà dépassée.
      const createdAt = new Date(Date.now() - 4 * 60 * 60 * 1000); // 4h avant "maintenant"
      const expiresAt = new Date(createdAt.getTime() + lib.INSTANT_SESSION_MAX_DURATION_MS); // -1h, déjà expirée
      await db.instantSession.update({
        where: { id: sessionId },
        data: { createdAt, expiresAt },
      });
      // Réaligne aussi l'intervalle du créateur (ouvert à la création sur
      // l'horloge réelle) sur cette même fenêtre passée fermée.
      const start = createdAt;
      const end = new Date(createdAt.getTime() + 20 * 60 * 1000);
      await db.instantSessionPresenceInterval.updateMany({
        where: { instantSessionId: sessionId, userId: creator.id },
        data: { startedAt: start, endedAt: end },
      });
      const guestInterval = await openInterval(sessionId, guest.id, start);
      await closeInterval(guestInterval.id, end);

      // AUCUN appel de lecture (pas de `getInstantSessionView`, simule
      // "personne n'a rouvert l'app") — seul le passage batch règle tout.
      const settled = await lib.settleAllDueInstantSessions();
      expect(settled).toEqual([sessionId]);

      const session = await db.instantSession.findUniqueOrThrow({ where: { id: sessionId } });
      expect(session.status).toBe("ENDED");
      expect(session.endedReason).toBe("expired");
      expect(await db.xpEvent.count({ where: { userId: guest.id, reason: "PARTICIPATE" } })).toBe(1);
    });

    it("session créée juste avant MINUIT — expiration à +3h le lendemain calculée correctement, présence traversant minuit comptée sans bug de décalage", async () => {
      const creator = await makeUser();
      const guest = await makeUser();
      const game = await makeGame(creator.id);
      const created = await lib.createInstantSession({ creatorId: creator.id, gameId: game.id, notifiedUserIds: [] });
      if (!created.ok) throw new Error("setup");
      const sessionId = created.instantSession.id;

      // Force createdAt/expiresAt à cheval sur minuit (23h30 -> 02h30).
      const createdAt = new Date("2026-09-27T23:30:00.000Z");
      const expiresAt = new Date(createdAt.getTime() + lib.INSTANT_SESSION_MAX_DURATION_MS);
      await db.instantSession.update({ where: { id: sessionId }, data: { createdAt, expiresAt } });
      expect(expiresAt.toISOString()).toBe("2026-09-28T02:30:00.000Z"); // vérifie le calcul de base

      // Présence conjointe traversant minuit : 23h50 -> 00h10 (20 min).
      // Réaligne aussi l'intervalle du créateur (ouvert à la création sur
      // l'horloge réelle) sur cette même fenêtre — sinon il resterait
      // ouvert jusqu'à `wallClockNow()` (le vrai "maintenant" du test),
      // sans jamais recouper une fenêtre calendaire fixée arbitrairement.
      const start = new Date("2026-09-27T23:50:00.000Z");
      const end = new Date("2026-09-28T00:10:00.000Z");
      await db.instantSessionPresenceInterval.updateMany({
        where: { instantSessionId: sessionId, userId: creator.id },
        data: { startedAt: start, endedAt: end },
      });
      const guestInterval = await openInterval(sessionId, guest.id, start);
      await closeInterval(guestInterval.id, end);

      await lib.settleInstantSessionRewards(sessionId);
      expect(await db.xpEvent.count({ where: { userId: guest.id, reason: "PARTICIPATE" } })).toBe(1);
    });
  });

  describe("Concurrence", () => {
    it("deux CRÉATIONS simultanées par le même user — une seule réussit", async () => {
      const user = await makeUser();
      const gameA = await makeGame(user.id);
      const gameB = await makeGame(user.id);

      const [r1, r2] = await Promise.all([
        lib.createInstantSession({ creatorId: user.id, gameId: gameA.id, notifiedUserIds: [] }),
        lib.createInstantSession({ creatorId: user.id, gameId: gameB.id, notifiedUserIds: [] }),
      ]);
      const results = [r1, r2];
      const succeeded = results.filter((r) => r.ok);
      const failed = results.filter((r) => !r.ok);
      expect(succeeded).toHaveLength(1);
      expect(failed).toHaveLength(1);
      expect(failed[0]).toMatchObject({ ok: false, reason: "already_in_another_session" });

      expect(await db.instantSession.count()).toBe(1);
    });

    it("deux JONCTIONS simultanées par le même user sur deux sessions DIFFÉRENTES — une seule réussit", async () => {
      const user = await makeUser();
      const creatorA = await makeUser();
      const creatorB = await makeUser();
      const gameA = await makeGame(creatorA.id);
      const gameB = await makeGame(creatorB.id);
      const sessionA = await lib.createInstantSession({ creatorId: creatorA.id, gameId: gameA.id, notifiedUserIds: [] });
      const sessionB = await lib.createInstantSession({ creatorId: creatorB.id, gameId: gameB.id, notifiedUserIds: [] });
      if (!sessionA.ok || !sessionB.ok) throw new Error("setup");

      const [r1, r2] = await Promise.all([
        lib.joinInstantSession(sessionA.instantSession.id, user.id),
        lib.joinInstantSession(sessionB.instantSession.id, user.id),
      ]);
      const succeeded = [r1, r2].filter((r) => r.ok);
      expect(succeeded).toHaveLength(1);

      const openCount = await db.instantSessionPresenceInterval.count({ where: { userId: user.id, endedAt: null } });
      expect(openCount).toBe(1); // jamais deux appartenances actives simultanées
    });

    it("jonction APRÈS que le créateur a déjà terminé la session — refusée proprement (`ended`), jamais un état incohérent", async () => {
      const creator = await makeUser();
      const guest = await makeUser();
      const game = await makeGame(creator.id);
      const created = await lib.createInstantSession({ creatorId: creator.id, gameId: game.id, notifiedUserIds: [] });
      if (!created.ok) throw new Error("setup");
      const sessionId = created.instantSession.id;

      await lib.endInstantSession(sessionId, creator.id, "creator_left");
      const joinResult = await lib.joinInstantSession(sessionId, guest.id);
      expect(joinResult).toEqual({ ok: false, reason: "ended" });

      const openForGuest = await db.instantSessionPresenceInterval.findFirst({
        where: { instantSessionId: sessionId, userId: guest.id },
      });
      expect(openForGuest).toBeNull(); // jamais créé
    });

    it("EXPIRATION (paresseuse) vs mutation concurrente — une jonction tentée après expiration échoue même si le statut n'avait pas encore été réglé en base", async () => {
      const creator = await makeUser();
      const guest = await makeUser();
      const game = await makeGame(creator.id);
      const created = await lib.createInstantSession({ creatorId: creator.id, gameId: game.id, notifiedUserIds: [] });
      if (!created.ok) throw new Error("setup");
      const sessionId = created.instantSession.id;

      // Simule le passage du temps SANS jamais appeler settle — le champ
      // `status` reste "ACTIVE" en base, exactement l'état "le cron n'est
      // pas encore passé".
      await db.instantSession.update({
        where: { id: sessionId },
        data: { expiresAt: new Date("2000-01-01T00:00:00.000Z") },
      });
      const stillActiveInDb = await db.instantSession.findUniqueOrThrow({ where: { id: sessionId } });
      expect(stillActiveInDb.status).toBe("ACTIVE"); // pas encore réglé

      const joinResult = await lib.joinInstantSession(sessionId, guest.id);
      expect(joinResult).toEqual({ ok: false, reason: "ended" }); // réglé PAR joinInstantSession lui-même avant d'agir

      const afterSettle = await db.instantSession.findUniqueOrThrow({ where: { id: sessionId } });
      expect(afterSettle.status).toBe("ENDED");
      expect(afterSettle.endedReason).toBe("expired");
    });

    it("changement de jeu PUIS fin — l'EDIT de mise à jour rend l'état COURANT (terminé) quand elle est traitée après coup, jamais l'ancien état figé", async () => {
      vi.stubEnv("DISCORD_BOT_INSTANT_SESSION_INVITE_ENABLED", "true");
      const creator = await makeUser();
      const recipient = await makeUser();
      const gameA = await makeGame(creator.id);
      const gameB = await makeGame(creator.id);
      const created = await lib.createInstantSession({
        creatorId: creator.id,
        gameId: gameA.id,
        notifiedUserIds: [recipient.id],
      });
      if (!created.ok) throw new Error("setup");
      const sessionId = created.instantSession.id;

      // SEND initial traité.
      fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "dm-chan-1" }));
      fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "msg-1", channel_id: "dm-chan-1" }));
      const sendSummary = await executorLib.runExecutorBatch({
        resolver: announceLib.instantSessionInviteResolver,
        owner: "test",
      });
      expect(sendSummary.sent).toBe(1);

      // Changement de jeu — enqueue une EDIT, jamais traitée tout de suite.
      await lib.changeInstantSessionGame(sessionId, creator.id, gameB.id);
      // La session se termine AVANT que cette EDIT ne soit traitée.
      await lib.endInstantSession(sessionId, creator.id, "creator_left");

      // Traitement de l'EDIT en attente — doit refléter l'état COURANT
      // (terminé), jamais "changé pour gameB mais toujours actif".
      fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "msg-1", channel_id: "dm-chan-1" }));
      const editSummary = await executorLib.runExecutorBatch({
        resolver: announceLib.instantSessionInviteResolver,
        owner: "test",
      });
      expect(editSummary.sent).toBe(1);

      const editCall = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
      const body = JSON.parse(String(editCall[1]?.body));
      expect(JSON.stringify(body)).toContain("terminée");
    });

    it("calculs CONCURRENTS de récompenses — deux appels simultanés à `settleInstantSessionRewards` n'attribuent jamais l'XP deux fois", async () => {
      const creator = await makeUser();
      const guest = await makeUser();
      const game = await makeGame(creator.id);
      const created = await lib.createInstantSession({ creatorId: creator.id, gameId: game.id, notifiedUserIds: [] });
      if (!created.ok) throw new Error("setup");
      const sessionId = created.instantSession.id;
      const start = new Date("2026-09-27T18:00:00.000Z");
      const end = new Date("2026-09-27T18:20:00.000Z");
      await db.instantSessionPresenceInterval.updateMany({
        where: { instantSessionId: sessionId, userId: creator.id },
        data: { startedAt: start, endedAt: end },
      });
      const guestInterval = await openInterval(sessionId, guest.id, start);
      await closeInterval(guestInterval.id, end);

      await Promise.all([
        lib.settleInstantSessionRewards(sessionId),
        lib.settleInstantSessionRewards(sessionId),
      ]);

      expect(await db.xpEvent.count({ where: { userId: guest.id, reason: "PARTICIPATE" } })).toBe(1);
    });
  });

  describe("Invitations rapides — MP Discord + notification interne", () => {
    it("enqueueInstantSessionInvites : SEND à occurrence FIXE + notification interne, une seule fois — un second appel identique ne duplique rien", async () => {
      const creator = await makeUser();
      const recipient = await makeUser();
      const game = await makeGame(creator.id);
      const created = await lib.createInstantSession({
        creatorId: creator.id,
        gameId: game.id,
        notifiedUserIds: [recipient.id],
      });
      if (!created.ok) throw new Error("setup");
      const sessionId = created.instantSession.id;

      expect(await db.notificationDelivery.count({ where: { channel: "DISCORD_DM", operation: "SEND" } })).toBe(1);
      expect(await db.notification.count({ where: { userId: recipient.id, type: "INSTANT_SESSION_INVITE" } })).toBe(
        1
      );

      // Ré-invitation explicite du même destinataire — jamais un second SEND.
      await announceLib.enqueueInstantSessionInvites(sessionId, [recipient.id]);
      expect(await db.notificationDelivery.count({ where: { channel: "DISCORD_DM", operation: "SEND" } })).toBe(1);
    });

    it("préférence INSTANT_SESSION désactivée — AUCUNE notification interne écrite, mais le SEND reste enqueue-é (filtré au traitement réel, jamais à l'enqueue)", async () => {
      const creator = await makeUser();
      const recipient = await makeUser();
      await db.userNotificationPreference.create({
        data: { userId: recipient.id, category: "INSTANT_SESSION", enabled: false },
      });
      const game = await makeGame(creator.id);
      await lib.createInstantSession({ creatorId: creator.id, gameId: game.id, notifiedUserIds: [recipient.id] });

      expect(await db.notification.count({ where: { userId: recipient.id } })).toBe(0);
      expect(await db.notificationDelivery.count({ where: { channel: "DISCORD_DM", operation: "SEND" } })).toBe(1);
    });

    it("changement de jeu : modifie le MP existant (EDIT), N'ENVOIE JAMAIS une nouvelle invitation", async () => {
      const creator = await makeUser();
      const recipient = await makeUser();
      const gameA = await makeGame(creator.id);
      const gameB = await makeGame(creator.id);
      const created = await lib.createInstantSession({
        creatorId: creator.id,
        gameId: gameA.id,
        notifiedUserIds: [recipient.id],
      });
      if (!created.ok) throw new Error("setup");

      await lib.changeInstantSessionGame(created.instantSession.id, creator.id, gameB.id);

      expect(await db.notificationDelivery.count({ where: { channel: "DISCORD_DM", operation: "SEND" } })).toBe(1); // toujours un seul SEND
      expect(await db.notificationDelivery.count({ where: { channel: "DISCORD_DM", operation: "EDIT" } })).toBe(1);
    });

    it("fin de session : programme une EDIT (jamais un nouveau SEND) mettant à jour l'invitation existante", async () => {
      const creator = await makeUser();
      const recipient = await makeUser();
      const game = await makeGame(creator.id);
      const created = await lib.createInstantSession({
        creatorId: creator.id,
        gameId: game.id,
        notifiedUserIds: [recipient.id],
      });
      if (!created.ok) throw new Error("setup");

      await lib.endInstantSession(created.instantSession.id, creator.id, "creator_left");

      expect(await db.notificationDelivery.count({ where: { channel: "DISCORD_DM", operation: "SEND" } })).toBe(1);
      expect(await db.notificationDelivery.count({ where: { channel: "DISCORD_DM", operation: "EDIT" } })).toBe(1);
    });

    it("résolveur — refuse `not_configured` quand la catégorie bot n'est pas activée", async () => {
      vi.stubEnv("DISCORD_BOT_INSTANT_SESSION_INVITE_ENABLED", "false");
      const creator = await makeUser();
      const recipient = await makeUser();
      const game = await makeGame(creator.id);
      await lib.createInstantSession({ creatorId: creator.id, gameId: game.id, notifiedUserIds: [recipient.id] });

      const summary = await executorLib.runExecutorBatch({
        resolver: announceLib.instantSessionInviteResolver,
        owner: "test",
      });
      expect(summary.sent).toBe(0);
      expect(fetchMock).not.toHaveBeenCalled();
      const delivery = await db.notificationDelivery.findFirstOrThrow({ where: { channel: "DISCORD_DM" } });
      expect(delivery.status).toBe("FAILED");
      expect(delivery.errorClass).toContain("not_configured");
    });

    it("SEND jamais envoyé pour une session déjà terminée avant même son premier traitement — invitation périmée bloquée", async () => {
      const creator = await makeUser();
      const recipient = await makeUser();
      const game = await makeGame(creator.id);
      const created = await lib.createInstantSession({
        creatorId: creator.id,
        gameId: game.id,
        notifiedUserIds: [recipient.id],
      });
      if (!created.ok) throw new Error("setup");

      // La session se termine AVANT que le SEND initial n'ait jamais été
      // traité par l'exécuteur (aucun appel `runExecutorBatch` encore fait).
      await lib.endInstantSession(created.instantSession.id, creator.id, "creator_left");

      const summary = await executorLib.runExecutorBatch({
        resolver: announceLib.instantSessionInviteResolver,
        owner: "test",
      });
      expect(summary.sent).toBe(0);
      // Le SEND périmé échoue (`expired`) — SEULE l'EDIT de fin part réellement.
      fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "dm-chan-1" }));
      fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "msg-1", channel_id: "dm-chan-1" }));
      // (déjà consommé par le premier passage ci-dessus si le SEND a été
      // réclamé avant l'EDIT — dans tous les cas, aucun MP "rejoins
      // maintenant" n'a jamais été réellement envoyé.)

      const sendDelivery = await db.notificationDelivery.findFirstOrThrow({
        where: { channel: "DISCORD_DM", operation: "SEND" },
      });
      expect(sendDelivery.status).toBe("FAILED");
      expect(sendDelivery.errorClass).toContain("expired");
    });
  });

  describe("Rétention — purge des DÉTAILS 7 jours après la fin effective", () => {
    it("dry-run : aucune mutation, rapporte ce qui SERAIT purgé", async () => {
      const now = new Date("2026-10-10T00:00:00.000Z");
      const creator = await makeUser();
      const game = await makeGame(creator.id);
      const created = await lib.createInstantSession({ creatorId: creator.id, gameId: game.id, notifiedUserIds: [] });
      if (!created.ok) throw new Error("setup");
      await lib.endInstantSession(created.instantSession.id, creator.id, "creator_left");
      await db.instantSession.update({
        where: { id: created.instantSession.id },
        data: { endedAt: new Date("2026-10-01T00:00:00.000Z") }, // > 7 jours avant `now`
      });

      const dryRun = await retention.purgeEligibleInstantSessionsBatch({ dryRun: true, now });
      expect(dryRun.purgedInstantSessionIds).toEqual([created.instantSession.id]);
      expect(await db.instantSession.count()).toBe(1); // AUCUNE mutation
    });

    it("session ACTIVE jamais purgée, quel que soit son âge", async () => {
      const now = new Date("2026-10-10T00:00:00.000Z");
      const creator = await makeUser();
      const game = await makeGame(creator.id);
      const created = await lib.createInstantSession({ creatorId: creator.id, gameId: game.id, notifiedUserIds: [] });
      if (!created.ok) throw new Error("setup");
      await db.instantSession.update({
        where: { id: created.instantSession.id },
        data: { createdAt: new Date("2000-01-01T00:00:00.000Z"), expiresAt: new Date("2000-01-01T03:00:00.000Z") },
      });

      const result = await retention.purgeEligibleInstantSessionsBatch({ dryRun: false, now });
      expect(result.purgedInstantSessionIds).toEqual([]);
      expect(await db.instantSession.count()).toBe(1);
    });

    it("purge RÉELLE une fois la fenêtre de 7 jours dépassée — le journal de présence cascade, l'XP survit (déjà sans FK vers InstantSession)", async () => {
      const now = new Date("2026-10-10T00:00:00.000Z");
      const creator = await makeUser();
      const guest = await makeUser();
      const game = await makeGame(creator.id);
      const created = await lib.createInstantSession({ creatorId: creator.id, gameId: game.id, notifiedUserIds: [] });
      if (!created.ok) throw new Error("setup");
      const sessionId = created.instantSession.id;
      const start = new Date("2026-09-20T18:00:00.000Z");
      const end = new Date("2026-09-20T18:20:00.000Z");
      await db.instantSessionPresenceInterval.updateMany({
        where: { instantSessionId: sessionId, userId: creator.id },
        data: { startedAt: start, endedAt: end },
      });
      const guestInterval = await openInterval(sessionId, guest.id, start);
      await closeInterval(guestInterval.id, end);
      await lib.settleInstantSessionRewards(sessionId); // XP réglé AVANT la purge, comme en production
      expect(await db.xpEvent.count({ where: { userId: guest.id, reason: "PARTICIPATE" } })).toBe(1);

      await lib.endInstantSession(sessionId, creator.id, "creator_left");
      await db.instantSession.update({
        where: { id: sessionId },
        data: { endedAt: new Date("2026-09-20T19:00:00.000Z") }, // > 7 jours avant `now`
      });

      const result = await retention.purgeEligibleInstantSessionsBatch({ dryRun: false, now });
      expect(result.purgedInstantSessionIds).toEqual([sessionId]);
      expect(await db.instantSession.findUnique({ where: { id: sessionId } })).toBeNull();
      expect(await db.instantSessionPresenceInterval.count({ where: { instantSessionId: sessionId } })).toBe(0);

      // XP survit — sourceId reste un id "libre", sans FK vers InstantSession.
      expect(await db.xpEvent.count({ where: { userId: guest.id, reason: "PARTICIPATE" } })).toBe(1);
    });

    it("reprise après interruption — deux passages bornés (limit: 1) purgent chacun leur tour, jamais deux fois la même", async () => {
      const now = new Date("2026-10-10T00:00:00.000Z");
      const creator = await makeUser();
      const game = await makeGame(creator.id);
      const ids: string[] = [];
      for (let i = 0; i < 2; i++) {
        const created = await lib.createInstantSession({ creatorId: creator.id, gameId: game.id, notifiedUserIds: [] });
        if (!created.ok) throw new Error("setup");
        await lib.endInstantSession(created.instantSession.id, creator.id, "creator_left");
        await db.instantSession.update({
          where: { id: created.instantSession.id },
          data: { endedAt: new Date("2026-09-20T19:00:00.000Z") },
        });
        ids.push(created.instantSession.id);
      }

      const first = await retention.purgeEligibleInstantSessionsBatch({ dryRun: false, limit: 1, now });
      expect(first.purgedInstantSessionIds).toHaveLength(1);
      expect(await db.instantSession.count()).toBe(1);

      const second = await retention.purgeEligibleInstantSessionsBatch({ dryRun: false, limit: 1, now });
      expect(second.purgedInstantSessionIds).toHaveLength(1);
      expect(await db.instantSession.count()).toBe(0);

      expect(new Set([...first.purgedInstantSessionIds, ...second.purgedInstantSessionIds])).toEqual(new Set(ids));
    });
  });
});
