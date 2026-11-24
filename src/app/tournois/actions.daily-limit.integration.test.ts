import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

/**
 * Plafond de 5 tournois créés par personne et par jour (audit 1.14, décision du propriétaire) — preuve sur un
 * PostgreSQL réel : le compteur partagé (`RateLimitWindow`) fait foi, la limite en mémoire est neutralisée pour
 * simuler plusieurs instances. Le 6ᵉ tournoi du jour est refusé AVANT toute écriture, un rejeu de la même intention
 * ne consomme rien.
 *
 * Nécessite `TEST_DATABASE_URL` (PostgreSQL local isolé) — suite entièrement SKIPPÉE si absente.
 */
const state = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: async () => state.user }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: () => true, RATE_LIMIT_ERROR_KEY: "rate_limited" }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); } }));
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: process.env.TEST_DATABASE_URL ? new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL }) : {} };
});

const NOON = new Date("2026-11-23T12:00:00.000Z");
const REDIRECT_TO_TOURNAMENT = /^REDIRECT:\/tournois\/[^/?]+$/;

describe.skipIf(!process.env.TEST_DATABASE_URL)("plafond de 5 tournois par jour (intégration Postgres isolée)", () => {
  let db: PrismaClient;
  let createTournamentAction: typeof import("./actions").createTournamentAction;
  beforeAll(async () => {
    expect(new URL(process.env.TEST_DATABASE_URL!).hostname).toBe("127.0.0.1");
    db = (await import("@/lib/prisma")).prisma as unknown as PrismaClient;
    ({ createTournamentAction } = await import("./actions"));
  });
  afterAll(async () => { await db?.$disconnect(); });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOON);
    await db.$executeRawUnsafe('TRUNCATE "CreationIntent", "RateLimitWindow", "NotificationDelivery", "NotificationEvent", "Tournament", "User", "Community", "Game" CASCADE');
    (await import("@/lib/default-community")).resetDefaultCommunityIdCache();
    state.user = await db.user.create({ data: { id: "creator", discordId: "111111111111111111", discordName: "Créateur" } });
    await db.user.create({ data: { id: "other", discordId: "222222222222222222", discordName: "Autre" } });
    const defaultCommunityId = await (await import("@/lib/default-community")).getDefaultCommunityId();
    await db.membership.createMany({ data: ["creator", "other"].map(userId => ({ userId, communityId: defaultCommunityId, status: "ACTIVE" as const })) });
    await db.game.create({ data: { id: "game", name: "Jeu", source: "MANUAL", addedById: "creator" } });
    for (const flag of ["COMMUNITY_ISOLATION_ENABLED", "COMMUNITY_PICKER_ENABLED", "COMMUNITY_CHANNELS_ENABLED", "DISCORD_BOT_TOURNAMENT_ANNOUNCE_ENABLED", "DISCORD_DM_TOURNAMENT_ENABLED"]) vi.stubEnv(flag, "false");
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Aucun HTTP réel autorisé"); }));
  });

  function form(key: string = crypto.randomUUID()) {
    const fd = new FormData();
    fd.set("creationKey", key);
    fd.set("name", "Tournoi");
    fd.set("gameId", "game");
    fd.set("maxPlayers", "4");
    return fd;
  }
  const dailyCount = async (userId: string) =>
    (await db.rateLimitWindow.findMany({ where: { key: `dailyCreateTournament:${userId}` } })).map((row) => row.count);

  it("le 6ᵉ tournoi du jour est refusé : message clair, aucun tournoi, aucune notification, compteur inchangé ; une autre personne n'est pas touchée", async () => {
    for (let i = 0; i < 5; i++) {
      await expect(createTournamentAction(form())).rejects.toThrow(REDIRECT_TO_TOURNAMENT);
    }
    expect(await db.tournament.count({ where: { createdById: "creator" } })).toBe(5);
    expect(await dailyCount("creator")).toEqual([5]);
    const before = { tournaments: await db.tournament.count(), events: await db.notificationEvent.count(), intents: await db.creationIntent.count() };

    await expect(createTournamentAction(form())).rejects.toThrow("REDIRECT:/tournois/creer?error=quota_tournois_jour");

    expect({ tournaments: await db.tournament.count(), events: await db.notificationEvent.count(), intents: await db.creationIntent.count() }).toEqual(before);
    expect(await dailyCount("creator")).toEqual([5]);

    state.user = await db.user.findUniqueOrThrow({ where: { id: "other" } });
    await expect(createTournamentAction(form())).rejects.toThrow(REDIRECT_TO_TOURNAMENT);
    expect(await dailyCount("other")).toEqual([1]);

    // Jour UTC suivant : nouvelle fenêtre.
    vi.setSystemTime(new Date("2026-11-24T00:30:00.000Z"));
    state.user = await db.user.findUniqueOrThrow({ where: { id: "creator" } });
    await expect(createTournamentAction(form())).rejects.toThrow(REDIRECT_TO_TOURNAMENT);
    expect(await dailyCount("creator")).toEqual([1]);
  }, 60_000);

  it("un rejeu de la même intention ne consomme pas le plafond", async () => {
    const key = "meme-intention-00000001";
    await expect(createTournamentAction(form(key))).rejects.toThrow(REDIRECT_TO_TOURNAMENT);
    await expect(createTournamentAction(form(key))).rejects.toThrow(REDIRECT_TO_TOURNAMENT);
    expect(await db.tournament.count()).toBe(1);
    expect(await dailyCount("creator")).toEqual([1]);
  }, 30_000);
});
