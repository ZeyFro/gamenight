import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

const url = process.env.TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (!["postgres:", "postgresql:"].includes(target.protocol) || target.hostname !== "127.0.0.1"
    || !/^\/gamenight_[a-zA-Z0-9_]+$/.test(target.pathname) || target.search || target.hash) {
    throw new Error("PostgreSQL jetable local uniquement pour la recette 18 h");
  }
}
const clock = vi.hoisted(() => ({ current: 0 }));
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: url ? new PrismaClient({ datasourceUrl: url }) : {} };
});
vi.mock("@/lib/notification-executor-kick", () => ({ kickNotificationExecutor: vi.fn() }));

const boundaries = [
  ["hiver", "2027-01-15T17:00:00.000Z"],
  ["été", "2027-07-15T16:00:00.000Z"],
  ["passage à l'heure d'été", "2027-03-28T16:00:00.000Z"],
  ["retour à l'heure d'hiver", "2027-10-31T17:00:00.000Z"],
] as const;

describe.skipIf(!url)("défi d'équipe : aucun chemin ne crée avant 18 h Paris", () => {
  let db: PrismaClient;
  let api: typeof import("./tower-challenges");
  let get: typeof import("@/app/api/cron/tower-team-daily/route").GET;
  const prefix = "team-18h-" + randomUUID();
  const communityId = prefix + "-community", userId = prefix + "-user", teamId = prefix + "-team";
  const gameId = prefix + "-game", definitionId = prefix + "-definition";
  const actor = { communityId, userId, teamId };
  const guildId = "987654321098765431";
  const request = () => new Request("https://example.invalid/api/cron/tower-team-daily", {
    headers: { authorization: "Bearer synthetic-18h-test-only" },
  });
  async function cleanup() {
    await db.community.deleteMany({ where: { id: communityId } });
    await db.game.deleteMany({ where: { id: gameId } });
    await db.user.deleteMany({ where: { id: userId } });
  }
  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as PrismaClient;
    api = await import("./tower-challenges");
    get = (await import("@/app/api/cron/tower-team-daily/route")).GET;
  });
  beforeEach(async () => {
    await cleanup();
    vi.stubEnv("TOWER_CHALLENGES_ENABLED", "true");
    vi.stubEnv("TOWER_TEAM_DAILY_ENABLED", "true");
    vi.stubEnv("TOWER_DISCORD_GUILD_ID", guildId);
    vi.stubEnv("TOWER_DISCORD_ANNOUNCE_ENABLED", "false");
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "false");
    vi.stubEnv("CRON_SECRET", "synthetic-18h-test-only");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.spyOn(Date, "now").mockImplementation(() => clock.current);
    await db.user.create({ data: { id: userId, discordId: prefix, discordName: "Recette locale 18 h" } });
    await db.community.create({ data: {
      id: communityId, slug: communityId, name: "Recette locale", discordGuildId: guildId,
      status: "ACTIVE", communityTeamsEnabled: true, towerChallengesEnabled: true,
    } });
    await db.membership.create({ data: { communityId, userId, status: "ACTIVE" } });
    await db.game.create({ data: { id: gameId, name: "Jeu fictif", source: "MANUAL", addedById: userId } });
    await db.communityTeam.create({ data: { id: teamId, communityId, gameId, createdById: userId, name: "Équipe fictive", description: "Données synthétiques locales", platform: "PC", maxMembers: 2 } });
    await db.communityTeamMember.create({ data: { communityId, teamId, userId } });
    await db.towerChallengeDefinition.create({ data: { id: definitionId, communityId, mode: "TEAM", title: "Défi fictif", instructions: "Aucun appel Discord", rewardFloors: 2, active: true } });
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
  afterAll(async () => { if (db) { await cleanup(); await db.$disconnect(); } });

  it.each(boundaries)("service utilisé par Discord — %s : attend 18 h puis rejoue la même attribution", async (_label, instant) => {
    clock.current = Date.parse(instant) - 1;
    const before = await api.getTeamDailyTowerChallenge(actor);
    expect(await db.towerChallengeAttempt.count({ where: { communityId } })).toBe(0);
    expect(before.status).toBe("NOT_DUE");
    clock.current += 1;
    const first = await api.getTeamDailyTowerChallenge(actor);
    expect(first.status).toBe("TEAM_CHALLENGE");
    clock.current += 1000;
    const again = await api.getTeamDailyTowerChallenge(actor);
    if (first.status !== "TEAM_CHALLENGE" || again.status !== "TEAM_CHALLENGE") throw new Error("Attribution attendue après 18 h");
    expect(again.attempt.id).toBe(first.attempt.id);
    expect(await db.towerChallengeAttempt.count({ where: { communityId } })).toBe(1);
  });

  it.each(boundaries)("route cron réelle — %s : aucun ajout précoce puis une seule attribution", async (_label, instant) => {
    clock.current = Date.parse(instant) - 1;
    const before = await get(request());
    expect(await db.towerChallengeAttempt.count({ where: { communityId } })).toBe(0);
    expect(before.status).toBe(200);
    expect(await before.json()).toMatchObject({ enabled: true, checked: 0, failed: 0, complete: true });
    clock.current += 1;
    const first = await get(request());
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ checked: 1, failed: 0, complete: true });
    expect(await db.towerChallengeAttempt.count({ where: { communityId } })).toBe(1);
    const replay = await get(request());
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ checked: 0, failed: 0, complete: true });
    expect(await db.towerChallengeAttempt.count({ where: { communityId } })).toBe(1);
  });

  it("laisse lire un défi du jour déjà existant avant 18 h, sans le remplacer", async () => {
    clock.current = Date.parse("2027-01-15T16:59:59.999Z");
    const existing = await db.towerChallengeAttempt.create({ data: {
      communityId, userId, teamId, definitionId, requestKey: "team-2027-01-15", title: "Défi préexistant",
      instructions: "Donnée synthétique héritée", rewardFloors: 2, assignedAt: new Date("2027-01-15T16:00:00Z"),
      expiresAt: new Date("2027-01-17T16:00:00Z"),
    } });
    const state = await api.getTeamDailyTowerChallenge(actor);
    expect(state.status).toBe("TEAM_CHALLENGE");
    if (state.status !== "TEAM_CHALLENGE") throw new Error("Lecture attendue");
    expect(state.attempt.id).toBe(existing.id);
    expect(state.attempt.assignedAt).toEqual(existing.assignedAt);
    expect(await db.towerChallengeAttempt.count({ where: { communityId } })).toBe(1);
  });
});
