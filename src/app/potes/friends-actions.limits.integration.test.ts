import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

/**
 * Audit du 23/11/2026, constat 1.15 : les limites de demandes d'ami (10 par minute en mémoire, 20 par jour partagées en base)
 * n'étaient pas verrouillées par un test. Postgres local 127.0.0.1 uniquement ; session et redirections simulées.
 */
const url = process.env.TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (!["postgres:", "postgresql:"].includes(target.protocol) || target.hostname !== "127.0.0.1" || target.searchParams.has("host")) {
    throw new Error("PostgreSQL loopback isolé requis");
  }
}

const state = vi.hoisted(() => ({ user: null as { id: string } | null, perMinute: true }));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: async () => state.user }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`REDIRECT:${to}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: url ? new PrismaClient({ datasourceUrl: url }) : {} };
});
// La limite par minute est testée avec le vrai compteur ; les autres tests la neutralisent pour atteindre la limite du jour.
vi.mock("@/lib/rate-limit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rate-limit")>("@/lib/rate-limit");
  return { ...actual, checkRateLimit: (...args: Parameters<typeof actual.checkRateLimit>) => (state.perMinute ? true : actual.checkRateLimit(...args)) };
});
if (!url) console.warn("[friends-limits] TEST_DATABASE_URL absente : tests PostgreSQL SKIPPÉS.");

describe.skipIf(!url)("demandes d'ami : limites par minute et par jour (Postgres)", () => {
  let db: PrismaClient;
  let actions: typeof import("./friends-actions");
  const scope = "lim-" + randomUUID().slice(0, 8);
  const community = scope + "-c";
  const sender = (n: number) => `${scope}-s${n}`;
  const targets = Array.from({ length: 22 }, (_, i) => `${scope}-t${i}`);
  const everyone = () => [sender(1), sender(2), ...targets];

  async function clean() {
    await db.friendship.deleteMany({ where: { OR: [{ requesterId: { in: everyone() } }, { addresseeId: { in: everyone() } }] } });
    await db.rateLimitWindow.deleteMany({ where: { key: { contains: scope } } });
    await db.membership.deleteMany({ where: { userId: { in: everyone() } } });
    await db.user.deleteMany({ where: { id: { in: everyone() } } });
    await db.community.deleteMany({ where: { id: community } });
  }
  async function request(senderId: string, targetId: string) {
    state.user = { id: senderId };
    const data = new FormData();
    data.set("targetId", targetId);
    await expect(actions.sendFriendRequestAction(data)).rejects.toThrow(/^REDIRECT:/);
  }
  const rows = (senderId: string) => db.friendship.count({ where: { requesterId: senderId } });

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as PrismaClient;
    actions = await import("./friends-actions");
  });
  afterAll(async () => { if (db) { await clean(); await db.$disconnect(); } vi.unstubAllEnvs(); });
  beforeEach(async () => {
    vi.stubEnv("POTES_FRIENDS_ENABLED", "true");
    state.perMinute = true;
    await clean();
    await db.community.create({ data: { id: community, slug: community, name: "Serveur", status: "ACTIVE" } });
    await db.user.createMany({ data: everyone().map((id) => ({ id, discordId: id, discordName: id })) });
    await db.membership.createMany({ data: everyone().map((userId) => ({ userId, communityId: community, status: "ACTIVE" as const })) });
  });

  it("la 21e demande du jour ne crée aucune ligne (20 par jour et par personne)", async () => {
    for (let i = 0; i < 20; i++) await request(sender(1), targets[i]);
    expect(await rows(sender(1))).toBe(20);
    await request(sender(1), targets[20]);
    expect(await rows(sender(1))).toBe(20);
    await request(sender(1), targets[21]);
    expect(await rows(sender(1))).toBe(20);
  });

  it("la limite du jour est propre à chaque personne", async () => {
    for (let i = 0; i < 20; i++) await request(sender(1), targets[i]);
    await request(sender(2), targets[0]);
    expect(await rows(sender(2))).toBe(1);
  });

  it("la 11e demande de la minute ne crée aucune ligne (10 par minute, compteur en mémoire)", async () => {
    state.perMinute = false;
    for (let i = 0; i < 10; i++) await request(sender(2), targets[i]);
    expect(await rows(sender(2))).toBe(10);
    await request(sender(2), targets[10]);
    expect(await rows(sender(2))).toBe(10);
  });

  it("flag éteint : aucune ligne créée", async () => {
    vi.stubEnv("POTES_FRIENDS_ENABLED", "false");
    await request(sender(1), targets[0]);
    expect(await rows(sender(1))).toBe(0);
  });
});
