import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID, randomInt } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

// These are counter-tests for #396, not fixes. Never enable remote databases.
const url = process.env.TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (!["postgres:", "postgresql:"].includes(target.protocol) || target.hostname !== "127.0.0.1" || target.searchParams.has("host")) {
    throw new Error("Base PostgreSQL loopback jetable requise");
  }
}
const applicationName = "gamenight-reg396-" + randomUUID();
const clock = vi.hoisted(() => ({ now: 0, jumpAfterCommit: false, inserted: false }));
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  if (!url) return { prisma: {} };
  const connection = new URL(url);
  connection.searchParams.set("application_name", applicationName);
  const prisma = new PrismaClient({ datasourceUrl: connection.href, log: [{ emit: "event", level: "query" }] });
  prisma.$on("query", event => {
    if (clock.jumpAfterCommit && /\bINSERT\s+INTO\s+(?:"public"\.)?"TowerChallengeAttempt"/i.test(event.query)) clock.inserted = true;
    if (clock.jumpAfterCommit && clock.inserted && /^COMMIT\b/i.test(event.query.trim())) {
      clock.jumpAfterCommit = false;
      clock.now += 25_000;
    }
  });
  return { prisma };
});
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

describe.skipIf(!url)("#396 — contre-tests du lot, des reprises et du budget", () => {
  let db: PrismaClient;
  let assign: typeof import("./tower-team-daily").assignDailyTowerTeamChallenges;
  let get: typeof import("@/app/api/cron/tower-team-daily/route").GET;
  const prefix = "daily-reg-" + randomUUID();
  const communityId = prefix + "-community";
  const guildId = "9" + Date.now() + randomInt(1000, 9999);
  const userId = (index: number) => prefix + "-user-" + index.toString().padStart(3, "0");
  const teamId = (index: number) => prefix + "-team-" + index.toString().padStart(3, "0");
  async function cleanup() {
    await db.community.deleteMany({ where: { id: communityId } });
    await db.game.deleteMany({ where: { id: prefix + "-game" } });
    await db.user.deleteMany({ where: { id: { startsWith: prefix + "-user-" } } });
  }
  async function seedTeams(count: number) {
    const indices = Array.from({ length: count }, (_, index) => index);
    await db.user.createMany({ data: indices.map(index => ({ id: userId(index), discordId: prefix + index, discordName: "Membre " + index })) });
    await db.community.create({ data: { id: communityId, slug: communityId, name: "Recette locale #396", discordGuildId: guildId, status: "ACTIVE", communityTeamsEnabled: true, towerChallengesEnabled: true } });
    await db.membership.createMany({ data: indices.map(index => ({ communityId, userId: userId(index), status: "ACTIVE" })) });
    await db.game.create({ data: { id: prefix + "-game", name: "Jeu de recette", source: "MANUAL", addedById: userId(0) } });
    await db.communityTeam.createMany({ data: indices.map(index => ({ id: teamId(index), communityId, gameId: prefix + "-game", createdById: userId(index), name: "Équipe " + index, description: "Données fictives locales", platform: "PC", maxMembers: 2 })) });
    await db.communityTeamMember.createMany({ data: indices.map(index => ({ communityId, teamId: teamId(index), userId: userId(index) })) });
    await db.towerChallengeDefinition.create({ data: { communityId, mode: "TEAM", title: "Défi local", instructions: "Recette sans Discord", rewardFloors: 3, active: true } });
  }
  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as PrismaClient;
    const identity = await db.$queryRaw<{ name: string }[]>`SELECT current_setting('application_name') AS name`;
    expect(identity[0].name, "le suivi des transactions doit être limité à ce client").toBe(applicationName);
    assign = (await import("./tower-team-daily")).assignDailyTowerTeamChallenges;
    get = (await import("@/app/api/cron/tower-team-daily/route")).GET;
  });
  beforeEach(async () => {
    await cleanup();
    clock.jumpAfterCommit = false;
    clock.inserted = false;
    vi.stubEnv("TOWER_CHALLENGES_ENABLED", "true");
    vi.stubEnv("TOWER_TEAM_DAILY_ENABLED", "true");
    vi.stubEnv("TOWER_DISCORD_GUILD_ID", guildId);
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("CRON_SECRET", "regression-local-only");
  });
  afterEach(() => {
    clock.jumpAfterCommit = false;
    clock.inserted = false;
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });
  afterAll(async () => { if (db) { await cleanup(); await db.$disconnect(); } });

  it("signale en HTTP 503 un lot interrompu par le budget avec une équipe encore non attribuée", async () => {
    await seedTeams(2);
    clock.now = Date.now();
    clock.jumpAfterCommit = true;
    vi.spyOn(Date, "now").mockImplementation(() => clock.now);
    const response = await get(new Request("https://example.invalid/api/cron/tower-team-daily", { headers: { authorization: "Bearer regression-local-only" } }));
    expect(clock.jumpAfterCommit, "la première attribution SQL doit être commitée").toBe(false);
    expect(await db.towerChallengeAttempt.count({ where: { communityId, teamId: teamId(0) } })).toBe(1);
    expect(await db.towerChallengeAttempt.count({ where: { communityId, teamId: teamId(1) } })).toBe(0);
    expect(await response.clone().json()).toMatchObject({ checked: 1, failed: 0 });
    expect(response.status).toBe(503);
  });

  it("atteint la 101e équipe lors de reprises identiques, sans doubler les attributions existantes", async () => {
    await seedTeams(101);
    for (let retry = 0; retry < 3; retry++) {
      await assign(new Date(Date.now() + 60_000));
      if (await db.towerChallengeAttempt.count({ where: { communityId } }) === 101) break;
    }
    expect(await db.towerChallengeAttempt.count({ where: { communityId } })).toBe(101);
    const last = await db.towerChallengeAttempt.count({ where: { communityId, teamId: teamId(100) } });
    expect(last).toBe(1);
  }, 30_000);

  it("borne une attribution qui attend un verrou et ne laisse pas d'écriture continuer après le budget", async () => {
    await seedTeams(1);
    let unlock!: () => void;
    let ready!: () => void;
    const released = new Promise<void>(resolve => { unlock = resolve; });
    const locked = new Promise<void>(resolve => { ready = resolve; });
    const blocker = db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Membership" WHERE "communityId" = ${communityId} AND "userId" = ${userId(0)} FOR UPDATE`;
      ready();
      await released;
    }, { timeout: 5_000, maxWait: 1_000 });
    let work: Promise<unknown> | undefined;
    try {
      await Promise.race([locked, blocker.then(() => { throw new Error("Verrou de recette non établi"); })]);
      let settled = false;
      work = assign(new Date(Date.now() + 300)).then(value => { settled = true; return value; }, error => { settled = true; return { error }; });
      await pause(900); // Marge > délai, tout en conservant le verrou de test.
      const settledWithinBudget = settled;
      unlock();
      await blocker;
      await work;
      // Vérifie aussi une éventuelle transaction abandonnée par Promise.race.
      let pending = BigInt(1);
      for (let poll = 0; poll < 100 && pending > BigInt(0); poll++) {
        const rows = await db.$queryRaw<{ count: bigint }[]>`SELECT COUNT(*)::bigint AS count FROM pg_stat_activity WHERE datname = current_database() AND application_name = ${applicationName} AND pid <> pg_backend_pid() AND xact_start IS NOT NULL`;
        pending = rows[0].count;
        if (pending) await pause(20);
      }
      expect(pending, "aucune transaction d'attribution ne doit rester en arrière-plan").toBe(BigInt(0));
      expect.soft(settledWithinBudget, "le délai de 300 ms doit borner l'opération, avec 600 ms de marge de recette").toBe(true);
      expect(await db.towerChallengeAttempt.count({ where: { communityId } })).toBe(0);
    } finally {
      unlock();
      await blocker.catch(() => undefined);
      await work;
    }
  }, 10_000);
});
