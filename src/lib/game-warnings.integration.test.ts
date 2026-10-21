import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const mocks = vi.hoisted(() => ({ current: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: mocks.current }));
vi.mock("@/lib/prisma", async () => { const { PrismaClient } = await import("@prisma/client"); return { prisma: TEST_DATABASE_URL ? new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) : {} }; });
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw Error(`REDIRECT:${url}`); } }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: () => true }));
if (!TEST_DATABASE_URL) console.warn("[game-warnings] Postgres local absent : persistance et parties SKIPPÉES.");
describe.skipIf(!TEST_DATABASE_URL)("avertissements, persistance et lecture des parties", () => {
  let db: import("@prisma/client").PrismaClient;
  let update: typeof import("@/app/jeux/warning-actions").updateGameWarnings;
  let defaultCommunityId: string;
  beforeAll(async () => { db = (await import("@/lib/prisma")).prisma as typeof db; update = (await import("@/app/jeux/warning-actions")).updateGameWarnings; });
  afterAll(async () => { await db?.$disconnect(); });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  beforeEach(async () => {
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "false"); vi.stubEnv("DISCORD_BOT_INSTANT_SESSION_INVITE_ENABLED", "false");
    vi.stubGlobal("fetch", vi.fn(() => { throw Error("Réseau réel interdit"); }));
    await db.$executeRawUnsafe('TRUNCATE "User", "Game" CASCADE');
    const defaults = await import("@/lib/default-community");
    defaults.resetDefaultCommunityIdCache();
    defaultCommunityId = await defaults.getDefaultCommunityId();
    await db.community.update({ where: { id: defaultCommunityId }, data: { status: "ACTIVE" } });
    await db.user.createMany({ data: [{ id: "owner", discordId: "owner", discordName: "Owner" }, { id: "other", discordId: "other", discordName: "Other" }] });
    await db.membership.createMany({ data: ["owner", "other"].map(userId => ({ communityId: defaultCommunityId, userId, status: "ACTIVE" as const })) });
    await db.game.createMany({ data: [{ id: "g", name: "g", source: "MANUAL", addedById: "owner", isCoop: true, minPlayers: 2, maxPlayers: 4, igdbDetails: { genres: ["Puzzle"] } }, { id: "other-game", name: "Other", source: "MANUAL", addedById: "other" }] });
    await db.userGame.create({ data: { userId: "owner", gameId: "g", owned: true } });
    mocks.current.mockResolvedValue({ id: "owner" });
  });
  function form(gameId = "g") { const f = new FormData(); for (const [k,v] of Object.entries({ gameId, jumpscares: "present", motionSickness: "absent", textLanguages: " français ", audioLanguages: "anglais", userId: "other", minPlayers: "99" })) f.set(k,v); return f; }
  it("conserve les anciens jeux inconnus puis persiste/efface les déclarations sans modifier les autres infos", async () => {
    expect(await db.game.findUnique({ where: { id: "g" } })).toMatchObject({ jumpscares: null, motionSickness: null, textLanguages: null, warningsUpdatedAt: null });
    expect(await update(form())).toEqual({ ok: true });
    expect(await db.game.findUnique({ where: { id: "g" } })).toMatchObject({ jumpscares: true, motionSickness: false, textLanguages: "français", audioLanguages: "anglais", warningsUpdatedAt: expect.any(Date), minPlayers: 2, maxPlayers: 4, isCoop: true, igdbDetails: { genres: ["Puzzle"] } });
    const f = form(); f.set("jumpscares","unknown"); f.set("motionSickness","unknown"); f.set("textLanguages", ""); f.set("audioLanguages", " "); expect((await update(f)).ok).toBe(true);
    expect(await db.game.findUnique({ where: { id: "g" } })).toMatchObject({ jumpscares: null, motionSickness: null, textLanguages: null, audioLanguages: null });
  });
  it("refuse le tiers, le jeu inexistant et la possession retirée sans modifier la fiche", async () => {
    expect(await update(form("other-game"))).toEqual({ ok: false, error: "access" });
    expect(await update(form("missing"))).toEqual({ ok: false, error: "access" });
    await db.userGame.update({ where: { userId_gameId: { userId: "owner", gameId: "g" } }, data: { owned: false } });
    expect(await update(form())).toEqual({ ok: false, error: "access" });
    expect(await db.game.count({ where: { warningsUpdatedAt: { not: null } } })).toBe(0);
  });
  it("rejette toute entrée invalide avant d'appliquer les autres champs", async () => {
    const f = form(); f.set("audioLanguages", "x".repeat(121)); expect(await update(f)).toEqual({ ok: false, error: "invalid" });
    expect((await db.game.findUniqueOrThrow({ where: { id: "g" } })).jumpscares).toBeNull();
  });
  it("relit les avertissements et langues après modification ou changement du jeu d'une partie instantanée", async () => {
    const lib = await import("./instant-sessions");
    const created = await lib.createInstantSession({ creatorId: "owner", gameId: "g", notifiedUserIds: [] });
    if (!created.ok) throw Error("setup failed");
    const id = created.instantSession.id;
    await update(form());
    const view = await lib.getInstantSessionView(id, "other"); expect(view?.game).toMatchObject({ jumpscares: true, motionSickness: false, textLanguages: "français" });
    const dto = lib.toInstantSessionViewDTO(view!); expect(typeof dto.game.warningsUpdatedAt).toBe("string");
    await db.game.update({ where: { id: "other-game" }, data: { jumpscares: false, audioLanguages: "japonais" } });
    await lib.changeInstantSessionGame(id, "owner", "other-game");
    expect((await lib.getInstantSessionView(id, "other"))?.game).toMatchObject({ id: "other-game", jumpscares: false, motionSickness: null, audioLanguages: "japonais" });
  });
});
