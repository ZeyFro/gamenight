import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Roulette asynchrone : filtre « nombre de joueurs » (ROULETTE_PLAYER_FILTER_ENABLED) et veto avec relance
 * (VOTE_VETO_ENABLED), sur une vraie base Postgres. Suite SKIPPÉE sans `TEST_DATABASE_URL`.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: TEST_DATABASE_URL ? new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) : ({} as unknown) };
});
// Jamais de vraie notification Discord depuis un test.
vi.mock("@/lib/discord-roulette", () => ({
  announceRouletteCancelled: vi.fn(async () => undefined),
  announceRouletteReminder: vi.fn(async () => undefined),
  announceRouletteResult: vi.fn(async () => undefined),
  announceRouletteCreated: vi.fn(async () => undefined),
}));

if (!TEST_DATABASE_URL) {
  console.warn("[roulette.integration.test] TEST_DATABASE_URL absente - suite SKIPPÉE : filtre et veto de roulette NON validés sur Postgres.");
}

describe.skipIf(!TEST_DATABASE_URL)("roulette async (intégration Postgres)", { timeout: 15_000 }, () => {
  let db: import("@prisma/client").PrismaClient;
  let roulette: typeof import("./roulette");
  let vetoLib: typeof import("./roulette-veto-db");
  let n = 0;
  const uniq = (label: string) => `${label}-${++n}`;

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as unknown as typeof db;
    roulette = await import("./roulette");
    vetoLib = await import("./roulette-veto-db");
  });
  afterAll(async () => {
    await db?.$disconnect();
  });
  afterEach(() => vi.unstubAllEnvs());

  let communityId: string;
  beforeEach(async ({ signal }) => {
    vi.unstubAllEnvs();
    // Un hook Vitest expiré ne stoppe pas ses requêtes SQL. Le nettoyage et
    // l'initialisation commitent ensemble ; la transaction expire avant le hook,
    // et le signal d'annulation est vérifié avant d'initialiser la communauté.
    const community = await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `TRUNCATE "RouletteVeto", "RouletteEntry", "Roulette", "SessionVeto", "Vote", "Proposal", "Session", "Game", "User", "Community" CASCADE`
      );
      signal.throwIfAborted();
      return tx.community.create({ data: { slug: "default", name: "default", status: "ACTIVE" } });
    }, { timeout: 20_000, maxWait: 5_000 });
    communityId = community.id;
    (await import("./default-community")).resetDefaultCommunityIdCache();
  }, 30_000);

  const makeUser = () => {
    const id = uniq("user");
    return db.user.create({ data: { discordId: id, discordName: id } });
  };
  const makeGame = (userId: string, minPlayers: number | null, maxPlayers: number | null) =>
    db.game.create({ data: { name: uniq("jeu"), source: "MANUAL", minPlayers, maxPlayers, addedById: userId } });

  /** Roulette OPEN dans le futur ; chaque participant propose les 2 jeux donnés. */
  async function makeRoulette(proposals: { userId: string; gameIds: string[] }[]) {
    const r = await db.roulette.create({
      data: {
        createdById: proposals[0].userId,
        scheduledAt: new Date("2099-06-06T20:00:00Z"),
        deadline: new Date("2099-06-06T18:00:00Z"),
        notifiedUserIds: proposals.map((p) => p.userId),
      },
    });
    for (const p of proposals) {
      for (const gameId of p.gameIds) await db.rouletteEntry.create({ data: { rouletteId: r.id, userId: p.userId, gameId } });
    }
    return r;
  }

  async function resultGameOf(rouletteId: string) {
    return (await db.roulette.findUniqueOrThrow({ where: { id: rouletteId } })).resultGameId;
  }

  describe("filtre nombre de joueurs", () => {
    /** 3 participants ; seul `any` (sans min/max) accepte 3 joueurs. */
    async function scenario() {
      const [u1, u2, u3] = [await makeUser(), await makeUser(), await makeUser()];
      const duo = await makeGame(u1.id, 2, 2);
      const big = await makeGame(u1.id, 4, 6);
      const any = await makeGame(u1.id, null, null);
      const r = await makeRoulette([
        { userId: u1.id, gameIds: [duo.id, big.id] },
        { userId: u2.id, gameIds: [duo.id, big.id] },
        { userId: u3.id, gameIds: [duo.id, any.id] },
      ]);
      return { r, duo, big, any };
    }

    it("flag allumé : une seule entrée compatible est toujours tirée (aléa extrême)", async () => {
      vi.stubEnv("ROULETTE_PLAYER_FILTER_ENABLED", "true");
      for (const rng of [0, 0.999]) {
        const { r, any } = await scenario();
        const out = await roulette.spinRoulette(r.id, () => rng);
        expect(await resultGameOf(r.id)).toBe(any.id);
        expect(out).toEqual({ playerFilterFallback: false });
      }
    });

    it("flag allumé, aucune entrée compatible : repli sur toutes, signalé", async () => {
      vi.stubEnv("ROULETTE_PLAYER_FILTER_ENABLED", "true");
      const [u1, u2, u3] = [await makeUser(), await makeUser(), await makeUser()];
      const duo = await makeGame(u1.id, 2, 2);
      const big = await makeGame(u1.id, 4, 6);
      const r = await makeRoulette([
        { userId: u1.id, gameIds: [duo.id, big.id] },
        { userId: u2.id, gameIds: [duo.id, big.id] },
        { userId: u3.id, gameIds: [duo.id, big.id] },
      ]);
      const out = await roulette.spinRoulette(r.id, () => 0);
      expect([duo.id, big.id]).toContain(await resultGameOf(r.id));
      expect(out).toEqual({ playerFilterFallback: true });
    });

    it("flag éteint : comportement inchangé (jeux incompatibles tirables, aucun repli signalé)", async () => {
      const [u1, u2] = [await makeUser(), await makeUser()];
      const big = await makeGame(u1.id, 5, 6);
      const huge = await makeGame(u1.id, 7, 8);
      const r = await makeRoulette([
        { userId: u1.id, gameIds: [big.id, huge.id] },
        { userId: u2.id, gameIds: [big.id, huge.id] },
      ]);
      const out = await roulette.spinRoulette(r.id);
      expect([big.id, huge.id]).toContain(await resultGameOf(r.id));
      expect(out).toEqual({ playerFilterFallback: false });
    });
  });

  describe("veto du jeu tiré (VOTE_VETO_ENABLED)", () => {
    /** 3 participants ; x et y sans borne, z accepte 2 joueurs seulement. Tirage initial déterministe (rng 0). */
    async function drawn(opts: { filter?: boolean; announceViaBot?: boolean } = {}) {
      vi.stubEnv("VOTE_VETO_ENABLED", "true");
      if (opts.filter) vi.stubEnv("ROULETTE_PLAYER_FILTER_ENABLED", "true");
      const users = [await makeUser(), await makeUser(), await makeUser()];
      const x = await makeGame(users[0].id, null, null);
      const y = await makeGame(users[0].id, null, null);
      const z = await makeGame(users[0].id, 2, 2);
      const r = await makeRoulette([
        { userId: users[0].id, gameIds: [x.id, y.id] },
        { userId: users[1].id, gameIds: [x.id, z.id] },
        { userId: users[2].id, gameIds: [y.id, z.id] },
      ]);
      await roulette.spinRoulette(r.id, () => 0);
      const done = await db.roulette.findUniqueOrThrow({ where: { id: r.id } });
      await db.session.update({ where: { id: done.resultSessionId! }, data: { announceViaBot: opts.announceViaBot ?? true } });
      return { r, users, games: { x, y, z }, first: done.resultGameId!, sessionId: done.resultSessionId! };
    }
    const sessionOf = (id: string) => db.session.findUniqueOrThrow({ where: { id }, include: { proposals: { include: { votes: true } } } });
    const veto = (rouletteId: string, userId: string, rng: () => number = () => 0) => vetoLib.vetoRouletteGame({ rouletteId, userId, rng });

    it.each([false, true])("refuse un invité retiré de la soirée, même encore membre du serveur (isolation %s)", async (isolation) => {
      const s = await drawn();
      const guest = s.users[1];
      await db.membership.createMany({ data: s.users.map((u) => ({ userId: u.id, communityId, status: "ACTIVE" as const, role: "MEMBER" as const })) });
      await db.roulette.update({ where: { id: s.r.id }, data: { communityId } });
      await db.session.update({ where: { id: s.sessionId }, data: { communityId } });
      await db.sessionInvite.update({ where: { sessionId_userId: { sessionId: s.sessionId, userId: guest.id } }, data: { status: "REVOKED" } });
      vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", isolation ? "true" : "false");
      const before = await sessionOf(s.sessionId);
      const deliveriesBefore = await db.notificationDelivery.count();

      expect(await veto(s.r.id, guest.id)).toEqual({ ok: false, error: "forbidden" });
      expect(await db.rouletteVeto.count()).toBe(0);
      expect(await resultGameOf(s.r.id)).toBe(s.first);
      expect(await sessionOf(s.sessionId)).toEqual(before);
      expect(await db.notificationDelivery.count()).toBe(deliveriesBefore);
    });

    it("conserve le veto d'un invité ACTIVE", async () => {
      const s = await drawn();
      expect(await db.sessionInvite.findUnique({ where: { sessionId_userId: { sessionId: s.sessionId, userId: s.users[1].id } } })).toMatchObject({ status: "ACTIVE" });
      expect(await veto(s.r.id, s.users[1].id)).toMatchObject({ ok: true });
    });

    it("conserve le veto du créateur sans invitation", async () => {
      const s = await drawn();
      expect(await db.sessionInvite.count({ where: { sessionId: s.sessionId, userId: s.users[0].id } })).toBe(0);
      expect(await veto(s.r.id, s.users[0].id)).toMatchObject({ ok: true });
    });

    it("relit l'accès après une révocation committée pendant l'attente du verrou de soirée", async () => {
      const s = await drawn();
      let pending!: ReturnType<typeof veto>;
      await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Session" WHERE id = ${s.sessionId} FOR UPDATE`;
        pending = veto(s.r.id, s.users[1].id);
        let waiting = false;
        for (let attempt = 0; attempt < 150; attempt++) {
          const rows = await db.$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`;
          if (Number(rows[0].count) > 0) { waiting = true; break; }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(waiting).toBe(true);
        await tx.sessionInvite.update({ where: { sessionId_userId: { sessionId: s.sessionId, userId: s.users[1].id } }, data: { status: "REVOKED" } });
      });
      expect(await pending).toEqual({ ok: false, error: "forbidden" });
      expect(await db.rouletteVeto.count()).toBe(0);
      expect(await resultGameOf(s.r.id)).toBe(s.first);
    });

    it.each(["CANCELLED", "DONE"] as const)("refuse après un passage concurrent de la soirée à %s", async (status) => {
      const s = await drawn();
      let pending!: ReturnType<typeof veto>;
      await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Session" WHERE id = ${s.sessionId} FOR UPDATE`;
        pending = veto(s.r.id, s.users[0].id);
        let waiting = false;
        for (let attempt = 0; attempt < 150; attempt++) {
          const rows = await db.$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`;
          if (Number(rows[0].count) > 0) { waiting = true; break; }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(waiting).toBe(true);
        await tx.session.update({ where: { id: s.sessionId }, data: { status } });
      });
      expect(await pending).toEqual({ ok: false, error: "closed" });
      expect(await db.rouletteVeto.count()).toBe(0);
      expect((await sessionOf(s.sessionId)).decidedGameId).toBe(s.first);
    });

    it("sérialise les vetos simultanés d'un même participant", async () => {
      const s = await drawn();
      const results = await Promise.all([veto(s.r.id, s.users[0].id), veto(s.r.id, s.users[0].id)]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(results).toContainEqual({ ok: false, error: "already_vetoed" });
      expect(await db.rouletteVeto.count()).toBe(1);
    });

    it("sérialise deux participants et exclut chacun des jeux rejetés", async () => {
      const s = await drawn();
      const results = await Promise.all([veto(s.r.id, s.users[0].id), veto(s.r.id, s.users[1].id)]);
      expect(results.every((r) => r.ok)).toBe(true);
      const rejected = await db.rouletteVeto.findMany();
      expect(new Set(rejected.map((r) => r.gameId)).size).toBe(2);
      expect(rejected.map((r) => r.gameId)).not.toContain((await sessionOf(s.sessionId)).decidedGameId);
    });

    it("refuse un participant devenu membre d'une autre communauté seulement", async () => {
      const s = await drawn();
      const foreign = await db.community.create({ data: { slug: "foreign", name: "foreign", status: "ACTIVE" } });
      await db.membership.create({ data: { userId: s.users[0].id, communityId: foreign.id, status: "ACTIVE", role: "MEMBER" } });
      await db.roulette.update({ where: { id: s.r.id }, data: { communityId } });
      await db.session.update({ where: { id: s.sessionId }, data: { communityId } });
      vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "true");
      expect(await veto(s.r.id, s.users[0].id)).toEqual({ ok: false, error: "forbidden" });
      expect(await db.rouletteVeto.count()).toBe(0);
      expect((await sessionOf(s.sessionId)).decidedGameId).toBe(s.first);
    });

    it("flag éteint : refus, rien ne change", async () => {
      const s = await drawn();
      vi.stubEnv("VOTE_VETO_ENABLED", "");
      expect(await veto(s.r.id, s.users[0].id)).toEqual({ ok: false, error: "disabled" });
      expect((await sessionOf(s.sessionId)).decidedGameId).toBe(s.first);
      expect(await db.rouletteVeto.count()).toBe(0);
    });

    it("un participant vetoe : relance sur un autre jeu, soirée et roulette mises à jour, veto enregistré", async () => {
      const s = await drawn();
      expect(await veto(s.r.id, s.users[0].id)).toMatchObject({ ok: true });
      const session = await sessionOf(s.sessionId);
      expect(session.decidedGameId).not.toBe(s.first);
      expect((await db.roulette.findUniqueOrThrow({ where: { id: s.r.id } })).resultGameId).toBe(session.decidedGameId);
      // Même invariant que la création : une seule proposition (le jeu décidé) avec un vote par participant.
      expect(session.proposals.map((p) => p.gameId)).toEqual([session.decidedGameId]);
      expect(session.proposals[0].votes.map((v) => v.userId).sort()).toEqual(s.users.map((u) => u.id).sort());
      const row = await db.rouletteVeto.findFirstOrThrow();
      expect(row).toMatchObject({ rouletteId: s.r.id, userId: s.users[0].id, gameId: s.first, communityId });
    });

    it("double veto de la même personne refusé ; la soirée ne bouge plus", async () => {
      const s = await drawn();
      await veto(s.r.id, s.users[0].id);
      const decided = (await sessionOf(s.sessionId)).decidedGameId;
      expect(await veto(s.r.id, s.users[0].id)).toEqual({ ok: false, error: "already_vetoed" });
      expect((await sessionOf(s.sessionId)).decidedGameId).toBe(decided);
      expect(await db.rouletteVeto.count()).toBe(1);
    });

    it("exclut TOUS les jeux déjà vetoés ; plus aucun candidat : veto refusé, soirée inchangée", async () => {
      const s = await drawn();
      expect((await veto(s.r.id, s.users[0].id)).ok).toBe(true);
      expect((await veto(s.r.id, s.users[1].id)).ok).toBe(true);
      const vetoed = (await db.rouletteVeto.findMany()).map((v) => v.gameId);
      const decided = (await sessionOf(s.sessionId)).decidedGameId!;
      expect(vetoed).not.toContain(decided);
      expect(new Set([...vetoed, decided]).size).toBe(3);
      expect(await veto(s.r.id, s.users[2].id)).toEqual({ ok: false, error: "no_candidate" });
      expect((await sessionOf(s.sessionId)).decidedGameId).toBe(decided);
      expect(await db.rouletteVeto.count()).toBe(2);
    });

    it("annonce Discord non modifiable (announceViaBot faux) : veto refusé, soirée et roulette inchangées", async () => {
      const s = await drawn({ announceViaBot: false });
      expect(await veto(s.r.id, s.users[0].id)).toEqual({ ok: false, error: "announce_not_editable" });
      expect((await sessionOf(s.sessionId)).decidedGameId).toBe(s.first);
      expect((await db.roulette.findUniqueOrThrow({ where: { id: s.r.id } })).resultGameId).toBe(s.first);
      expect(await db.rouletteVeto.count()).toBe(0);
    });

    it("non-participant (sans entrée) refusé", async () => {
      const s = await drawn();
      const outsider = await makeUser();
      expect(await veto(s.r.id, outsider.id)).toEqual({ ok: false, error: "forbidden" });
      await db.sessionInvite.create({ data: { sessionId: s.sessionId, userId: outsider.id, invitedById: s.users[0].id, status: "ACTIVE" } });
      expect(await veto(s.r.id, outsider.id)).toEqual({ ok: false, error: "not_participant" });
      expect(await db.rouletteVeto.count()).toBe(0);
    });

    it("roulette introuvable : forbidden", async () => {
      const u = await makeUser();
      vi.stubEnv("VOTE_VETO_ENABLED", "true");
      expect(await veto("nope", u.id)).toEqual({ ok: false, error: "forbidden" });
    });

    it("soirée passée ou annulée : refusée", async () => {
      const s = await drawn();
      await db.session.update({ where: { id: s.sessionId }, data: { date: new Date("2020-01-01T20:00:00Z") } });
      expect(await veto(s.r.id, s.users[0].id)).toEqual({ ok: false, error: "closed" });
      await db.session.update({ where: { id: s.sessionId }, data: { date: new Date("2099-06-06T20:00:00Z"), status: "CANCELLED" } });
      expect(await veto(s.r.id, s.users[0].id)).toEqual({ ok: false, error: "closed" });
      expect((await sessionOf(s.sessionId)).decidedGameId).toBe(s.first);
    });

    it("applique le filtre joueurs à la relance (jeu 2-2 jamais retenu à 3 joueurs)", async () => {
      const s = await drawn({ filter: true });
      expect(s.first).not.toBe(s.games.z.id);
      expect(await veto(s.r.id, s.users[0].id, () => 0.999)).toMatchObject({ ok: true });
      const other = s.first === s.games.x.id ? s.games.y.id : s.games.x.id;
      expect((await sessionOf(s.sessionId)).decidedGameId).toBe(other);
    });

    it("chemin bot : l'annonce est ÉDITÉE (SESSION_MODIFIED), pas de nouveau message de validation", async () => {
      const s = await drawn({ announceViaBot: true });
      await veto(s.r.id, s.users[0].id);
      const events = await db.notificationEvent.findMany({ where: { sourceId: s.sessionId } });
      expect(events.map((e) => e.eventType)).toContain("SESSION_MODIFIED");
      expect(events.map((e) => e.eventType)).not.toContain("SESSION_VALIDATED");
      const modified = events.filter((e) => e.eventType === "SESSION_MODIFIED").map((e) => e.id);
      const deliveries = await db.notificationDelivery.findMany({ where: { eventId: { in: modified } } });
      expect(deliveries.length).toBeGreaterThan(0);
      expect(deliveries.every((d) => d.operation === "EDIT")).toBe(true);
    });

    it("isolation : un veto n'est visible que dans sa communauté", async () => {
      const s = await drawn();
      await veto(s.r.id, s.users[0].id);
      vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "true");
      const other = await db.community.create({ data: { slug: "autre", name: "autre", status: "ACTIVE" } });
      const { scopedPrismaForCommunityId } = await import("./community-scoped-client");
      expect(await (await scopedPrismaForCommunityId(other.id)).rouletteVeto.count()).toBe(0);
      expect(await (await scopedPrismaForCommunityId(communityId)).rouletteVeto.count()).toBe(1);
    });
  });
});
