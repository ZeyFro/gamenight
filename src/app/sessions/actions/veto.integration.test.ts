import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Veto au vote de jeu (VOTE_VETO_ENABLED) : preuves sur une vraie base Postgres.
 * Actions (pose, remplacement, retrait, refus), exclusion à la clôture et au tirage,
 * isolation par communauté. Suite SKIPPÉE sans `TEST_DATABASE_URL`.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const { currentUser } = vi.hoisted(() => ({ currentUser: vi.fn() }));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((location: string) => {
    throw new Error(`REDIRECT:${location}`);
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: currentUser }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: () => true, RATE_LIMIT_ERROR_KEY: "rate_limited" }));
// Jamais de vraie notification Discord depuis un test.
vi.mock("@/lib/discord-announce", () => ({ announceSessionResult: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: TEST_DATABASE_URL ? new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) : ({} as unknown) };
});

if (!TEST_DATABASE_URL) {
  console.warn("[veto.integration.test] TEST_DATABASE_URL absente - suite SKIPPÉE : le veto n'est PAS validé sur Postgres.");
}

describe.skipIf(!TEST_DATABASE_URL)("veto au vote de jeu (intégration Postgres)", () => {
  let db: import("@prisma/client").PrismaClient;
  let veto: typeof import("./veto");
  let sessionsLib: typeof import("@/lib/sessions");
  let n = 0;
  const uniq = (label: string) => `${label}-${++n}`;

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as unknown as import("@prisma/client").PrismaClient;
    veto = await import("./veto");
    sessionsLib = await import("@/lib/sessions");
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  let communityId: string;
  beforeEach(async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("VOTE_VETO_ENABLED", "true");
    await db.$executeRawUnsafe(
      `TRUNCATE "SessionVeto", "Vote", "Proposal", "Session", "UserGame", "Game", "User", "Community" CASCADE`
    );
    (await import("@/lib/default-community")).resetDefaultCommunityIdCache();
    communityId = (await db.community.create({ data: { slug: "default", name: "default", status: "ACTIVE" } })).id;
  });

  const makeUser = () => {
    const id = uniq("user");
    return db.user.create({ data: { discordId: id, discordName: id } });
  };

  /** Jeu possédé par `ownerId` (dispo tous les jours) : jouable seul (min 1). */
  async function makeGame(ownerId: string) {
    const game = await db.game.create({
      data: { name: uniq("jeu"), source: "MANUAL", minPlayers: 1, maxPlayers: null, addedById: ownerId },
    });
    await db.userGame.create({ data: { userId: ownerId, gameId: game.id } });
    return game;
  }

  async function makeSession(
    creatorId: string,
    opts: { community?: string | null; status?: "VOTING" | "SCHEDULED" } = {}
  ) {
    return db.session.create({
      data: {
        date: new Date("2027-06-06T20:00:00Z"),
        createdById: creatorId,
        status: opts.status ?? "VOTING",
        communityId: opts.community === undefined ? communityId : opts.community,
      },
    });
  }

  /** Propositions dans l'ordre (createdAt croissant) avec `votes[i]` votes chacune. */
  async function propose(sessionId: string, creatorId: string, games: { id: string }[], votes: number[] = []) {
    const out = [];
    for (const [i, game] of games.entries()) {
      const p = await db.proposal.create({
        data: { sessionId, gameId: game.id, proposedById: creatorId, createdAt: new Date(Date.UTC(2026, 9, 1, 12, i)) },
      });
      for (let v = 0; v < (votes[i] ?? 0); v++) {
        const voter = await makeUser();
        await db.vote.create({ data: { proposalId: p.id, userId: voter.id } });
      }
      out.push(p);
    }
    return out;
  }

  const fd = (proposalId: string) => {
    const f = new FormData();
    f.set("proposalId", proposalId);
    return f;
  };

  async function scenario(opts: { games?: number } = {}) {
    const creator = await makeUser();
    for (let d = 0; d < 7; d++) {
      await db.weeklyAvailability.create({
        data: { userId: creator.id, dayOfWeek: d, startTime: "00:00", endTime: "23:59" },
      });
    }
    const games = [];
    for (let i = 0; i < (opts.games ?? 3); i++) games.push(await makeGame(creator.id));
    const session = await makeSession(creator.id);
    return { creator, games, session };
  }

  const addVeto = (sessionId: string, userId: string, proposalId: string) =>
    db.sessionVeto.create({ data: { sessionId, userId, proposalId, communityId } });

  /** Attend une vraie requête bloquée sur le verrou, sans supposer un ordre temporel. */
  async function waitForLock() {
    for (let attempt = 0; attempt < 150; attempt++) {
      const rows = await db.$queryRaw<{ count: bigint }[]>`
        SELECT count(*) FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'
      `;
      if (Number(rows[0].count) > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("Aucune requête concurrente en attente du verrou Session");
  }

  describe("actions", () => {
    it.each(["setVeto", "clearVeto"] as const)("%s revalide le vote après une clôture concurrente", async (action) => {
      const { creator, games, session } = await scenario();
      const [a] = await propose(session.id, creator.id, games);
      if (action === "clearVeto") await addVeto(session.id, creator.id, a.id);
      currentUser.mockResolvedValue(creator);
      let pending!: Promise<import("./veto").VetoResult>;
      await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Session" WHERE id = ${session.id} FOR UPDATE`;
        pending = veto[action](fd(a.id));
        await waitForLock();
        await tx.session.update({ where: { id: session.id }, data: { status: "SCHEDULED" } });
      });
      expect(await pending).toMatchObject({ ok: false, error: "closed" });
      expect(await db.sessionVeto.count()).toBe(action === "clearVeto" ? 1 : 0);
    });
    it("flag éteint : refus, aucune ligne", async () => {
      vi.stubEnv("VOTE_VETO_ENABLED", "");
      const { creator, games, session } = await scenario();
      const [p] = await propose(session.id, creator.id, games);
      currentUser.mockResolvedValue(creator);
      expect(await veto.setVeto(fd(p.id))).toMatchObject({ ok: false, error: "disabled" });
      expect(await db.sessionVeto.count()).toBe(0);
    });

    it("pose un veto avec la communauté de la soirée ; le 2e veto REMPLACE le premier", async () => {
      const { creator, games, session } = await scenario();
      const [a, b] = await propose(session.id, creator.id, games);
      currentUser.mockResolvedValue(creator);
      expect((await veto.setVeto(fd(a.id))).ok).toBe(true);
      expect((await veto.setVeto(fd(b.id))).ok).toBe(true);
      const rows = await db.sessionVeto.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ proposalId: b.id, userId: creator.id, communityId, sessionId: session.id });
    });

    it("idempotent : re-vetoer la même proposition ne crée pas de doublon", async () => {
      const { creator, games, session } = await scenario();
      const [a] = await propose(session.id, creator.id, games);
      currentUser.mockResolvedValue(creator);
      await veto.setVeto(fd(a.id));
      expect((await veto.setVeto(fd(a.id))).ok).toBe(true);
      expect(await db.sessionVeto.count()).toBe(1);
    });

    it("retrait de son veto ; retirer sans veto est sans effet", async () => {
      const { creator, games, session } = await scenario();
      const [a] = await propose(session.id, creator.id, games);
      currentUser.mockResolvedValue(creator);
      await veto.setVeto(fd(a.id));
      expect((await veto.clearVeto(fd(a.id))).ok).toBe(true);
      expect(await db.sessionVeto.count()).toBe(0);
      expect((await veto.clearVeto(fd(a.id))).ok).toBe(true);
    });

    it("refuse le veto qui ne laisserait aucun jeu candidat (autres jouables déjà vetoés)", async () => {
      const { creator, games, session } = await scenario({ games: 2 });
      const [a, b] = await propose(session.id, creator.id, games);
      const other = await makeUser();
      await db.sessionInvite.create({ data: { sessionId: session.id, userId: other.id, invitedById: creator.id } });
      currentUser.mockResolvedValue(creator);
      expect((await veto.setVeto(fd(a.id))).ok).toBe(true);
      currentUser.mockResolvedValue(other);
      expect(await veto.setVeto(fd(b.id))).toMatchObject({ ok: false, error: "last_candidate" });
      expect(await db.sessionVeto.count()).toBe(1);
    });

    it("concurrence : deux vetos simultanés sur les deux derniers jeux, un seul passe", async () => {
      for (let round = 0; round < 8; round++) {
        await db.$executeRawUnsafe(`TRUNCATE "SessionVeto"`);
        const { creator, games, session } = await scenario({ games: 2 });
        const [a, b] = await propose(session.id, creator.id, games);
        const other = await makeUser();
        await db.sessionInvite.create({ data: { sessionId: session.id, userId: other.id, invitedById: creator.id } });
        currentUser.mockResolvedValueOnce(creator).mockResolvedValueOnce(other);
        const results = await Promise.all([veto.setVeto(fd(a.id)), veto.setVeto(fd(b.id))]);
        expect(results.filter((r) => r.ok)).toHaveLength(1);
        expect(results.filter((r) => r.error === "last_candidate")).toHaveLength(1);
        expect(await db.sessionVeto.count()).toBe(1);
      }
    });

    it("le seul jeu jouable ne peut pas être vetoé", async () => {
      const { creator, games, session } = await scenario({ games: 1 });
      const [a] = await propose(session.id, creator.id, games);
      currentUser.mockResolvedValue(creator);
      expect(await veto.setVeto(fd(a.id))).toMatchObject({ ok: false, error: "last_candidate" });
    });

    it("hors période de vote : refus", async () => {
      const { creator, games } = await scenario();
      const closed = await makeSession(creator.id, { status: "SCHEDULED" });
      const [p] = await propose(closed.id, creator.id, games);
      currentUser.mockResolvedValue(creator);
      expect(await veto.setVeto(fd(p.id))).toMatchObject({ ok: false, error: "closed" });
      expect(await db.sessionVeto.count()).toBe(0);
    });

    it("pote non invité : refus", async () => {
      const { creator, games, session } = await scenario();
      const [a] = await propose(session.id, creator.id, games);
      currentUser.mockResolvedValue(await makeUser());
      expect((await veto.setVeto(fd(a.id))).ok).toBe(false);
      expect(await db.sessionVeto.count()).toBe(0);
    });

    it("isolation allumée : soirée d'une autre communauté refusée", async () => {
      vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "true");
      const other = await db.community.create({ data: { slug: "autre", name: "autre", status: "ACTIVE" } });
      const { creator, games } = await scenario();
      await db.membership.create({ data: { userId: creator.id, communityId, status: "ACTIVE", role: "MEMBER" } });
      const foreign = await makeSession(creator.id, { community: other.id });
      const [p] = await propose(foreign.id, creator.id, games);
      currentUser.mockResolvedValue(creator);
      expect((await veto.setVeto(fd(p.id))).ok).toBe(false);
      expect(await db.sessionVeto.count()).toBe(0);
    });

    it("isolation allumée, membre : veto créé avec la communauté de la soirée", async () => {
      vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "true");
      const { creator, games, session } = await scenario();
      await db.membership.create({ data: { userId: creator.id, communityId, status: "ACTIVE", role: "MEMBER" } });
      const [a] = await propose(session.id, creator.id, games);
      currentUser.mockResolvedValue(creator);
      expect((await veto.setVeto(fd(a.id))).ok).toBe(true);
      expect((await db.sessionVeto.findFirstOrThrow()).communityId).toBe(communityId);
    });

    it("soirée historique sans communauté : communauté par défaut", async () => {
      const { creator, games } = await scenario();
      const legacy = await makeSession(creator.id, { community: null });
      const [a] = await propose(legacy.id, creator.id, games);
      currentUser.mockResolvedValue(creator);
      expect((await veto.setVeto(fd(a.id))).ok).toBe(true);
      expect((await db.sessionVeto.findFirstOrThrow()).communityId).toBe(communityId);
    });
  });

  describe("affichage", () => {
    it("loadSessionVetoes n'expose aucun nom (vetos anonymes : seulement le compte)", async () => {
      const { creator, games, session } = await scenario();
      const [a] = await propose(session.id, creator.id, games);
      await addVeto(session.id, creator.id, a.id);
      const rows = await (await import("@/lib/session-veto-db")).loadSessionVetoes(session.id, communityId);
      expect(rows).toEqual([{ proposalId: a.id, userId: creator.id }]);
    });
  });

  describe("closeSession", () => {
    it.each(["close", "draw"])("%s exclut le veto arrivé pendant l'attente de son verrou", async (mode) => {
      const { creator, games, session } = await scenario({ games: 2 });
      const [a, b] = await propose(session.id, creator.id, games, [3, 1]);
      const random = vi.spyOn(Math, "random").mockReturnValue(0);
      let pending!: Promise<unknown>;
      try {
        await db.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM "Session" WHERE id = ${session.id} FOR UPDATE`;
          pending = mode === "close" ? sessionsLib.closeSession(session.id) : sessionsLib.drawSessionGame(session.id, creator.id);
          await waitForLock();
          await tx.sessionVeto.create({ data: { sessionId: session.id, userId: creator.id, proposalId: a.id, communityId } });
        });
        await pending;
        expect((await db.session.findUniqueOrThrow({ where: { id: session.id } })).decidedGameId).toBe(b.gameId);
      } finally { random.mockRestore(); }
    });
    it("le jeu vetoé le plus voté n'est pas retenu : le suivant gagne", async () => {
      const { creator, games, session } = await scenario();
      const [a, b] = await propose(session.id, creator.id, games, [3, 1, 0]);
      await addVeto(session.id, creator.id, a.id);
      await sessionsLib.closeSession(session.id);
      expect(await db.session.findUniqueOrThrow({ where: { id: session.id } })).toMatchObject({
        status: "SCHEDULED",
        decidedGameId: b.gameId,
      });
    });

    it("flag éteint : les vetos sont ignorés (comportement inchangé)", async () => {
      vi.stubEnv("VOTE_VETO_ENABLED", "");
      const { creator, games, session } = await scenario();
      const [a] = await propose(session.id, creator.id, games, [3, 1, 0]);
      await addVeto(session.id, creator.id, a.id);
      await sessionsLib.closeSession(session.id);
      expect((await db.session.findUniqueOrThrow({ where: { id: session.id } })).decidedGameId).toBe(a.gameId);
    });

    it("égalité : la plus ancienne proposition NON vetoée gagne", async () => {
      const { creator, games, session } = await scenario();
      const [a, b] = await propose(session.id, creator.id, games, [2, 2, 2]);
      await addVeto(session.id, creator.id, a.id);
      await sessionsLib.closeSession(session.id);
      expect((await db.session.findUniqueOrThrow({ where: { id: session.id } })).decidedGameId).toBe(b.gameId);
    });

    it("tous les jouables vetoés (cas dégradé) : annulation comme « aucun jouable »", async () => {
      const { creator, games, session } = await scenario({ games: 1 });
      const [a] = await propose(session.id, creator.id, games, [2]);
      await addVeto(session.id, creator.id, a.id);
      await sessionsLib.closeSession(session.id);
      expect((await db.session.findUniqueOrThrow({ where: { id: session.id } })).status).toBe("CANCELLED");
    });
  });

  describe("drawSessionGame", () => {
    it("ne tire jamais un jeu vetoé", async () => {
      const { creator, games, session } = await scenario();
      const [a, b, c] = await propose(session.id, creator.id, games);
      const other = await makeUser();
      await addVeto(session.id, creator.id, a.id);
      await addVeto(session.id, other.id, b.id);
      const outcome = await sessionsLib.drawSessionGame(session.id, creator.id);
      expect(outcome).toMatchObject({ kind: "drawn", winnerGameId: c.gameId, candidateGameIds: [c.gameId] });
    });
  });
});
