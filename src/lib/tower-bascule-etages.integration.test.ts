import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { inspectEtageRoles, isLegacyEtageRole } from "../../scripts/tower-etage-role-rules.mjs";
import { levelForXp, rankForLevel, titleForLevel } from "@/lib/xp";

/**
 * C075 (cahier 22.2) : « Test : bascule depuis les anciens étages ». Décision du 17-18/11/2026 : niveau d'XP, rang d'XP et badges sont
 * CONSERVÉS ; les étages The Tower repartent de zéro et ne dépendent jamais de l'XP ; les anciens rôles Discord « Étage N » ne sont
 * ni supprimés ni modifiés. Ce test rejoue la bascule sur du code réel : un joueur historique (XP, historique de gains, badge) voit
 * l'Ascension s'ouvrir sans rien perdre, puis gagne des étages sans que son XP bouge.
 * Postgres local 127.0.0.1 uniquement ; la partie rôles Discord est pure (aucun appel réseau).
 */
const url = process.env.TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (!["postgres:", "postgresql:"].includes(target.protocol) || target.hostname !== "127.0.0.1" || target.searchParams.has("host")) {
    throw new Error("PostgreSQL loopback isolé requis");
  }
}
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: url ? new PrismaClient({ datasourceUrl: url }) : {} };
});
if (!url) console.warn("[tower-bascule-etages] TEST_DATABASE_URL absente : partie base SKIPPÉE, bascule NON validée sur SQL réel.");

describe("anciens rôles Discord « Étage N » : inventaire en lecture seule, jamais supprimés", () => {
  it("tous les rôles historiques sont conservés (safeToDelete toujours faux), même sans permission ni salon dépendant", () => {
    const rows = inspectEtageRoles(
      [{ id: "1", name: "Étage 1", permissions: "0", managed: false }, { id: "2", name: "🗼 Etage 250", permissions: "8", managed: false }, { id: "3", name: "Admin", permissions: "8", managed: false }],
      [{ id: "c", name: "salon", permission_overwrites: [{ id: "2", type: 0 }] }],
    );
    expect(rows.map((row: { name: string }) => row.name)).toEqual(["Étage 1", "🗼 Etage 250"]);
    expect(rows.every((row: { safeToDelete: boolean }) => row.safeToDelete === false)).toBe(true);
    expect(rows[1]).toMatchObject({ hasGuildPermissions: true, dependentChannels: [{ id: "c", name: "salon" }] });
    expect(isLegacyEtageRole("Ranker")).toBe(false); // un grade The Tower n'est pas un ancien étage
  });

  it("le script d'inventaire ne fait que des GET : aucune suppression ni modification de rôle ou de salon", () => {
    const script = readFileSync("scripts/audit-tower-etage-roles.mjs", "utf8");
    expect(script).toContain('method: "GET"');
    expect(script).not.toMatch(/method:\s*["'](?:DELETE|PUT|PATCH|POST)["']/);
    expect(readFileSync("scripts/tower-etage-role-rules.mjs", "utf8")).not.toMatch(/fetch\(|DELETE/);
  });
});

describe.skipIf(!url)("bascule vers les étages The Tower (Postgres)", () => {
  let db: PrismaClient;
  let progress: typeof import("./tower-personal-progress");
  const scope = "bascule-" + randomUUID().slice(0, 8);
  const communityId = scope + "-c";
  const veteran = scope + "-veteran";
  const viewer = scope + "-viewer";
  const badgeId = scope + "-badge";
  const now = new Date("2026-12-10T12:00:00Z");

  async function cleanup() {
    await db.community.deleteMany({ where: { id: communityId } });
    await db.badge.deleteMany({ where: { id: badgeId } });
    await db.user.deleteMany({ where: { id: { in: [veteran, viewer] } } });
  }
  /** Tout ce que l'ancien système avait : doit être identique avant et après la bascule. */
  async function legacySnapshot() {
    const stats = await db.communityMemberStats.findUniqueOrThrow({ where: { communityId_userId: { communityId, userId: veteran } } });
    const events = await db.xpEvent.findMany({ where: { communityId, userId: veteran }, orderBy: { sourceId: "asc" } });
    const badges = await db.userBadge.findMany({ where: { communityId, userId: veteran } });
    const level = levelForXp(stats.xpTotal);
    return { stats, events, badges, level, rank: rankForLevel(level).name, title: titleForLevel(level), membership: await db.membership.findFirstOrThrow({ where: { communityId, userId: veteran } }) };
  }

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as PrismaClient;
    progress = await import("./tower-personal-progress");
  });
  afterAll(async () => { if (db) { await cleanup(); await db.$disconnect(); } vi.unstubAllEnvs(); });
  beforeEach(async () => {
    vi.unstubAllEnvs();
    await cleanup();
    // Avant la bascule : Ascension éteinte (drapeau d'environnement ET de communauté).
    await db.community.create({ data: { id: communityId, slug: communityId, name: "The Tower", status: "ACTIVE", discordGuildId: scope + "-g", towerChallengesEnabled: false } });
    await db.user.createMany({ data: [veteran, viewer].map((id) => ({ id, discordId: id, discordName: id })) });
    await db.membership.createMany({ data: [veteran, viewer].map((userId) => ({ userId, communityId, status: "ACTIVE" as const })) });
    await db.communityMemberStats.create({ data: { communityId, userId: veteran, xpTotal: 12_345, xpBalance: 4_000, streakCount: 7, bestStreakCount: 12 } });
    await db.xpEvent.createMany({ data: [
      { communityId, userId: veteran, reason: "PARTICIPATE", sourceId: scope + "-a", amount: 20 },
      { communityId, userId: veteran, reason: "CREATE_SESSION", sourceId: scope + "-b", amount: 30 },
      { communityId, userId: veteran, reason: "VOTE", sourceId: scope + "-c", amount: 5 },
    ] });
    await db.badge.create({ data: { id: badgeId, name: badgeId, icon: "🏅", description: "Historique", category: "PARTICIPATION", rarity: "COMMON", criteria: {}, modifiedById: viewer } });
    await db.userBadge.create({ data: { communityId, userId: veteran, badgeId } });
  });

  async function read() {
    return progress.getTowerPersonalProgress({ viewerId: viewer, memberId: veteran, communityId }, now);
  }

  it("avant l'ouverture : l'Ascension est indisponible, et l'XP historique est intacte", async () => {
    vi.stubEnv("TOWER_CHALLENGES_ENABLED", "false");
    expect(await read()).toEqual({ status: "DISABLED" });
    const before = await legacySnapshot();
    expect(before.stats.xpTotal).toBe(12_345);
    expect(before.events).toHaveLength(3);
    expect(before.badges).toHaveLength(1);
  });

  it("à l'ouverture : étages à zéro, rang Régulars, et strictement rien d'écrit ni de perdu côté XP, historique, badges, adhésion", async () => {
    const before = await legacySnapshot();
    vi.stubEnv("TOWER_CHALLENGES_ENABLED", "true");
    await db.community.update({ where: { id: communityId }, data: { towerChallengesEnabled: true } });

    expect(await read()).toEqual({
      status: "PROGRESS", floorsClimbed: "0", completedSeasons: 0, seasonChallenges: 0, rank: "Régulars",
      next: { rank: "Ranker", floorsMissing: "30", challengesMissing: 0 },
    });
    // La lecture n'écrit rien : aucune ligne d'étages créée pour le joueur historique.
    expect(await db.towerChallengeProgress.count({ where: { communityId, userId: veteran } })).toBe(0);
    expect(await legacySnapshot()).toEqual(before);
    // Niveau d'XP, titre et rang d'XP conservés (indépendants des étages).
    const after = await legacySnapshot();
    expect([after.level, after.rank, after.title]).toEqual([before.level, before.rank, before.title]);
  });

  it("les étages gagnés ensuite ne touchent jamais l'XP : Ranker à 30 étages, niveau d'XP, solde et historique inchangés", async () => {
    vi.stubEnv("TOWER_CHALLENGES_ENABLED", "true");
    await db.community.update({ where: { id: communityId }, data: { towerChallengesEnabled: true } });
    const before = await legacySnapshot();
    await db.towerChallengeProgress.create({ data: { communityId, userId: veteran, floorsClimbed: BigInt(30) } });
    expect(await read()).toMatchObject({ status: "PROGRESS", floorsClimbed: "30", rank: "Ranker" });
    expect(await legacySnapshot()).toEqual(before);
  });
});
