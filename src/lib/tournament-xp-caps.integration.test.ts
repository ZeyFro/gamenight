import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { TOURNAMENT_XP_MIN_ESTABLISHED_PARTICIPANTS, TOURNAMENT_XP_WEEKLY_CAP, TOURNAMENT_XP_WINDOW_MS, XP_AMOUNTS } from "@/lib/xp";
import { TOURNAMENT_XP_MIN_TENURE_MS } from "@/lib/tournament-xp-eligibility";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: process.env.TEST_DATABASE_URL ? new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL }) : {} };
});
// Aucune notification Discord ni aucun badge depuis un test : seul le ledger XP (`awardXp` réel) est observé.
vi.mock("@/lib/discord-level-up", () => ({ announceLevelUp: vi.fn(async () => undefined) }));
vi.mock("@/lib/community-announce", () => ({ postToCommunity: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/badges", () => ({ checkTournamentBadges: vi.fn() }));
vi.mock("@/lib/thread-close-on-end", () => ({ closeThreadOnEndSafely: vi.fn() }));
if (!TEST_DATABASE_URL) console.warn("[tournament-xp-caps] TEST_DATABASE_URL absente : tests PostgreSQL SKIPPÉS, plafonds d'XP de tournoi NON validés sur SQL réel.");

/**
 * Audit du 23/11/2026, constat 1.11 : 4 comptes complices suffisaient à farmer l'XP de tournoi. Deux gardes :
 * (a) au plus TOURNAMENT_XP_WEEKLY_CAP gains par joueur sur 7 jours glissants (ledger) ;
 * (b) aucun XP si moins de TOURNAMENT_XP_MIN_ESTABLISHED_PARTICIPANTS participants ont au moins 3 jours d'ancienneté.
 */
describe.skipIf(!TEST_DATABASE_URL)("plafonds d'XP de tournoi (PostgreSQL isolée)", () => {
  const DAY = 24 * 60 * 60 * 1000;
  let db: PrismaClient;
  let lib: typeof import("./tournaments");
  let communityId: string;

  beforeAll(async () => {
    expect(new URL(TEST_DATABASE_URL!).hostname).toBe("127.0.0.1");
    db = (await import("@/lib/prisma")).prisma as unknown as PrismaClient;
    lib = await import("./tournaments");
  });
  afterAll(async () => { await db?.$disconnect(); });
  beforeEach(async () => {
    await db.$executeRawUnsafe('TRUNCATE "NotificationDelivery", "NotificationEvent", "Tournament", "Game", "User", "Community" CASCADE');
    (await import("@/lib/default-community")).resetDefaultCommunityIdCache();
    communityId = await (await import("@/lib/default-community")).getDefaultCommunityId();
  });

  const tournamentGains = (userId?: string) => db.xpEvent.count({ where: { reason: "TOURNAMENT_RESULT", ...(userId ? { userId } : {}) } });

  async function makeUsers(names: string[], ageMs: number) {
    const users = [];
    for (const name of names) {
      const user = await db.user.create({ data: { discordId: `xpcap-${name}`, discordName: name } });
      await db.membership.create({ data: { userId: user.id, communityId, status: "ACTIVE", joinedAt: new Date(Date.now() - ageMs) } });
      users.push(user);
    }
    return users;
  }

  /** Tournoi individuel à 4 joueurs joué jusqu'à la finale ; `preferredWinner` gagne tous ses matchs, sinon player1. */
  async function playTournament(users: { id: string }[], preferredWinner: string | null = null) {
    const game = await db.game.create({ data: { name: "g", source: "MANUAL", addedById: users[0].id } });
    const tournament = await db.tournament.create({
      data: { name: "t", gameId: game.id, createdById: users[0].id, status: "REGISTRATION", maxPlayers: 4, announceViaBot: false },
    });
    for (const user of users) await db.tournamentParticipant.create({ data: { tournamentId: tournament.id, userId: user.id } });
    await db.$transaction((tx) => lib.buildBracketInTransaction(tx, tournament.id));
    for (const round of [1, 2]) {
      const matches = await db.tournamentMatch.findMany({ where: { tournamentId: tournament.id, round }, orderBy: { position: "asc" } });
      for (const match of matches) {
        const winner = match.player1Id === preferredWinner || match.player2Id === preferredWinner ? preferredWinner! : match.player1Id!;
        expect((await lib.declareWinner(match.id, winner, users[0].id)).ok).toBe(true);
      }
    }
    expect((await db.tournament.findUniqueOrThrow({ where: { id: tournament.id } })).status).toBe("DONE");
    return tournament;
  }

  it("4 comptes de moins de 3 jours : le tournoi se joue, mais aucun XP n'est versé", async () => {
    const users = await makeUsers(["a", "b", "c", "d"], TOURNAMENT_XP_MIN_TENURE_MS - 60_000);
    await playTournament(users);
    expect(await tournamentGains()).toBe(0);
  });

  it("seulement 2 participants établis sur 4 : aucun XP (seuil de 3)", async () => {
    expect(TOURNAMENT_XP_MIN_ESTABLISHED_PARTICIPANTS).toBe(3);
    const [a, b] = await makeUsers(["a", "b"], 30 * DAY);
    const [c, d] = await makeUsers(["c", "d"], DAY);
    await playTournament([a, b, c, d]);
    expect(await tournamentGains()).toBe(0);
  });

  it("3 participants établis sur 4 : l'XP du podium est versée (1er, 2e, 2 demi-finalistes)", async () => {
    const [a, b, c] = await makeUsers(["a", "b", "c"], 30 * DAY);
    const [d] = await makeUsers(["d"], 0);
    await playTournament([a, b, c, d]);
    expect(await tournamentGains()).toBe(4);
  });

  it("un tournoi normal d'amis établis ne perd rien : 4 gains, 200 XP au champion", async () => {
    const users = await makeUsers(["a", "b", "c", "d"], 60 * DAY);
    await playTournament(users, users[0].id);
    expect(await tournamentGains()).toBe(4);
    const champion = await db.xpEvent.findFirstOrThrow({ where: { reason: "TOURNAMENT_RESULT", userId: users[0].id } });
    expect(champion.sourceId.endsWith(":1st")).toBe(true);
    expect(champion.amount).toBeGreaterThanOrEqual(XP_AMOUNTS.TOURNAMENT_1ST);
  });

  it("6ᵉ gain de la semaine refusé : le champion déjà à 5 gains ne reçoit rien, les autres joueurs sont récompensés", async () => {
    const users = await makeUsers(["a", "b", "c", "d"], 60 * DAY);
    for (let i = 1; i <= TOURNAMENT_XP_WEEKLY_CAP; i++) {
      await db.xpEvent.create({ data: { communityId, userId: users[0].id, reason: "TOURNAMENT_RESULT", sourceId: `ancien-${i}:1st`, amount: XP_AMOUNTS.TOURNAMENT_1ST, createdAt: new Date(Date.now() - 2 * DAY) } });
    }
    await playTournament(users, users[0].id);
    expect(await tournamentGains(users[0].id)).toBe(TOURNAMENT_XP_WEEKLY_CAP);
    expect(await tournamentGains()).toBe(TOURNAMENT_XP_WEEKLY_CAP + 3);
  });

  describe("plafond glissant dans awardXp", () => {
    const seed = (userId: string, count: number, ageMs: number) => db.xpEvent.createMany({
      data: Array.from({ length: count }, (_, i) => ({ communityId, userId, reason: "TOURNAMENT_RESULT" as const, sourceId: `seed-${ageMs}-${i}:1st`, amount: 10, createdAt: new Date(Date.now() - ageMs) })),
    });

    it("6 gains d'affilée : les 5 premiers passent, le 6ᵉ est refusé", async () => {
      const [joueur] = await makeUsers(["joueur"], 60 * DAY);
      const { awardXp } = await import("@/lib/xp-actions");
      const results = [];
      for (let i = 1; i <= TOURNAMENT_XP_WEEKLY_CAP + 1; i++) results.push((await awardXp(joueur.id, null, "TOURNAMENT_RESULT", `t${i}:1st`, XP_AMOUNTS.TOURNAMENT_1ST)).awarded);
      expect(results).toEqual([true, true, true, true, true, false]);
      expect(await tournamentGains(joueur.id)).toBe(TOURNAMENT_XP_WEEKLY_CAP);
    });

    it("des gains vieux de 6 jours comptent encore, ceux de plus de 7 jours non", async () => {
      const [recent, ancien] = await makeUsers(["recent", "ancien"], 60 * DAY);
      await seed(recent.id, TOURNAMENT_XP_WEEKLY_CAP, TOURNAMENT_XP_WINDOW_MS - DAY);
      await seed(ancien.id, TOURNAMENT_XP_WEEKLY_CAP, TOURNAMENT_XP_WINDOW_MS + 60_000);
      const { awardXp } = await import("@/lib/xp-actions");
      expect((await awardXp(recent.id, null, "TOURNAMENT_RESULT", "nouveau:1st", XP_AMOUNTS.TOURNAMENT_1ST)).awarded).toBe(false);
      expect((await awardXp(ancien.id, null, "TOURNAMENT_RESULT", "nouveau:1st", XP_AMOUNTS.TOURNAMENT_1ST)).awarded).toBe(true);
    });

    it("le plafond est propre au joueur et au motif : un autre joueur et un autre gain restent possibles", async () => {
      const [plafonne, autre] = await makeUsers(["plafonne", "autre"], 60 * DAY);
      await seed(plafonne.id, TOURNAMENT_XP_WEEKLY_CAP, DAY);
      const { awardXp } = await import("@/lib/xp-actions");
      expect((await awardXp(autre.id, null, "TOURNAMENT_RESULT", "x:1st", XP_AMOUNTS.TOURNAMENT_1ST)).awarded).toBe(true);
      expect((await awardXp(plafonne.id, null, "VOTE", "un-vote", XP_AMOUNTS.VOTE)).awarded).toBe(true);
      expect((await awardXp(plafonne.id, null, "TOURNAMENT_RESULT", "x:1st", XP_AMOUNTS.TOURNAMENT_1ST)).awarded).toBe(false);
    });
  });
});
