import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { CREATE_SESSION_XP_WINDOW_MS, DAILY_XP_CAPS, XP_AMOUNTS } from "@/lib/xp";

vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: process.env.TEST_DATABASE_URL ? new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL }) : {} };
});
// Aucune annonce Discord depuis un test : le passage de niveau n'appelle rien d'externe.
vi.mock("@/lib/discord-level-up", () => ({ announceLevelUp: vi.fn(async () => undefined) }));

/**
 * Audit du 23/11/2026 (constats 1.8 et 1.9) : l'XP « soirée créée » et l'XP de présence sont plafonnées par membre sur 24 h
 * glissantes, comptées dans le ledger. Un créateur avec des comptes complices ne peut plus toucher 20 XP par soirée fantôme sans limite.
 */
describe.skipIf(!process.env.TEST_DATABASE_URL)("plafonds quotidiens d'XP (PostgreSQL isolée)", () => {
  let db: PrismaClient;
  let communityId: string;
  beforeAll(async () => {
    expect(new URL(process.env.TEST_DATABASE_URL!).hostname).toBe("127.0.0.1");
    db = (await import("@/lib/prisma")).prisma as unknown as PrismaClient;
  });
  afterAll(async () => { await db?.$disconnect(); });
  beforeEach(async () => {
    await db.$executeRawUnsafe('TRUNCATE "User", "Community" CASCADE');
    (await import("@/lib/default-community")).resetDefaultCommunityIdCache();
    communityId = await (await import("@/lib/default-community")).getDefaultCommunityId();
    for (const id of ["complice", "autre"]) {
      await db.user.create({ data: { id, discordId: id === "complice" ? "111111111111111111" : "222222222222222222", discordName: id } });
      await db.membership.create({ data: { userId: id, communityId, status: "ACTIVE" } });
    }
  });

  const count = (userId: string, reason: "PARTICIPATE" | "CREATE_SESSION") => db.xpEvent.count({ where: { userId, reason } });

  it("5 soirées fantômes en 1 h : 3 crédits de présence, pas 5", async () => {
    const { awardXp } = await import("@/lib/xp-actions");
    const results = [];
    for (let i = 1; i <= 5; i++) results.push(await awardXp("complice", null, "PARTICIPATE", `fantome-${i}`, XP_AMOUNTS.PARTICIPATE));
    expect(results.map((r) => r.awarded)).toEqual([true, true, true, false, false]);
    expect(await count("complice", "PARTICIPATE")).toBe(DAILY_XP_CAPS.PARTICIPATE);
    const stats = await db.communityMemberStats.findFirstOrThrow({ where: { userId: "complice" } });
    expect(stats.xpTotal).toBeLessThanOrEqual(DAILY_XP_CAPS.PARTICIPATE * XP_AMOUNTS.PARTICIPATE * 2);
  });

  it("4 créations de soirée en 24 h : 3 gains (le plafond « créée » est maintenant verrouillé)", async () => {
    const { awardXp } = await import("@/lib/xp-actions");
    for (let i = 1; i <= 4; i++) await awardXp("complice", null, "CREATE_SESSION", `creee-${i}`, XP_AMOUNTS.CREATE_SESSION);
    expect(await count("complice", "CREATE_SESSION")).toBe(DAILY_XP_CAPS.CREATE_SESSION);
  });

  it("le plafond est propre à chaque membre : un autre joueur garde ses 3 gains", async () => {
    const { awardXp } = await import("@/lib/xp-actions");
    for (let i = 1; i <= 4; i++) await awardXp("complice", null, "PARTICIPATE", `s-${i}`, XP_AMOUNTS.PARTICIPATE);
    for (let i = 1; i <= 3; i++) expect((await awardXp("autre", null, "PARTICIPATE", `s-${i}`, XP_AMOUNTS.PARTICIPATE)).awarded).toBe(true);
    expect(await count("autre", "PARTICIPATE")).toBe(3);
  });

  it("fenêtre glissante : les gains de plus de 24 h ne comptent plus", async () => {
    const { awardXp } = await import("@/lib/xp-actions");
    for (let i = 1; i <= 3; i++) await awardXp("complice", null, "PARTICIPATE", `ancien-${i}`, XP_AMOUNTS.PARTICIPATE);
    expect((await awardXp("complice", null, "PARTICIPATE", "bloque", XP_AMOUNTS.PARTICIPATE)).awarded).toBe(false);
    await db.xpEvent.updateMany({ where: { userId: "complice" }, data: { createdAt: new Date(Date.now() - CREATE_SESSION_XP_WINDOW_MS - 60_000) } });
    expect((await awardXp("complice", null, "PARTICIPATE", "apres-24h", XP_AMOUNTS.PARTICIPATE)).awarded).toBe(true);
  });

  it("un même sourceId reste idempotent : rejouer une soirée ne recrédite pas", async () => {
    const { awardXp } = await import("@/lib/xp-actions");
    expect((await awardXp("complice", null, "PARTICIPATE", "meme", XP_AMOUNTS.PARTICIPATE)).awarded).toBe(true);
    expect((await awardXp("complice", null, "PARTICIPATE", "meme", XP_AMOUNTS.PARTICIPATE)).awarded).toBe(false);
    expect(await count("complice", "PARTICIPATE")).toBe(1);
  });
});
