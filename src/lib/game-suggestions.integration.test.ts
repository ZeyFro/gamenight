import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const mocks = vi.hoisted(() => ({ current: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: mocks.current }));
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: TEST_DATABASE_URL ? new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) : {} };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw Error(`REDIRECT:${url}`); } }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: () => true }));
if (!TEST_DATABASE_URL) console.warn("[game-suggestions] Postgres local absent : suggestions et persistance SKIPPÉES.");

describe.skipIf(!TEST_DATABASE_URL)("préférences et suggestions en Postgres isolé", () => {
  let db: import("@prisma/client").PrismaClient;
  let data: typeof import("./game-suggestions");
  let actions: typeof import("@/app/profil/game-preference-actions");
  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as typeof db;
    data = await import("./game-suggestions"); actions = await import("@/app/profil/game-preference-actions");
  });
  afterAll(async () => { await db?.$disconnect(); });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  beforeEach(async () => {
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "true"); vi.stubEnv("COMMUNITY_PICKER_ENABLED", "true");
    vi.stubGlobal("fetch", vi.fn(() => { throw Error("Appel réseau interdit dans ce test"); }));
    await db.$executeRawUnsafe('TRUNCATE "Community", "User", "Game" CASCADE');
    await db.community.createMany({ data: [{ id: "a", slug: "default", name: "A", status: "ACTIVE" }, { id: "b", slug: "b", name: "B", status: "ACTIVE" }] });
    await db.user.createMany({ data: [
      { id: "host", discordId: "host", discordName: "Host", activeCommunityId: "a", steamId64: "76561198000000000" },
      { id: "friend", discordId: "friend", discordName: "Friend" }, { id: "both", discordId: "both", discordName: "Both" },
      { id: "foreign", discordId: "foreign", discordName: "SecretB" }, { id: "removed", discordId: "removed", discordName: "Removed" },
    ] });
    await db.membership.createMany({ data: [
      { userId: "host", communityId: "a", status: "ACTIVE" }, { userId: "host", communityId: "b", status: "ACTIVE" },
      { userId: "friend", communityId: "a", status: "ACTIVE" }, { userId: "both", communityId: "a", status: "ACTIVE" },
      { userId: "both", communityId: "b", status: "ACTIVE" }, { userId: "foreign", communityId: "b", status: "ACTIVE" },
      { userId: "removed", communityId: "a", status: "REMOVED" },
    ] });
    for (const id of ["shared", "explicit", "horror", "unknown", "foreign-game", "unowned", "only-one"]) {
      await db.game.create({ data: { id, name: id, source: "MANUAL", addedById: "host", minPlayers: 1, maxPlayers: 4,
        igdbDetails: { genres: ["Puzzle"], ...(id === "unknown" ? {} : { themes: id === "horror" ? ["Horror"] : [] }) },
      } });
      const owners = id === "foreign-game" ? ["foreign"] : id === "only-one" ? ["friend"] : ["host", "friend", "both"];
      await db.userGame.createMany({ data: owners.map(userId => ({ gameId: id, userId, owned: !(id === "unowned" && userId === "host") })) });
    }
    mocks.current.mockResolvedValue({ id: "host" });
  });
  function refusal(gameId: string, mode = "refuse") { const form = new FormData(); form.set("gameId", gameId); form.set("mode", mode); form.set("userId", "foreign"); return form; }

  it("exige tous les possesseurs et applique les deux types de refus, sans exposer les listes individuelles", async () => {
    await db.user.update({ where: { id: "friend" }, data: { refusedGameCategories: ["HORROR"] } });
    await db.userGameRefusal.create({ data: { userId: "friend", gameId: "explicit" } });
    const result = await data.loadGameSuggestions("host", ["host", "friend", "friend"]);
    expect(result.error).toBeNull(); expect(result.suggestions.map(g => g.id)).toEqual(["shared"]); expect(result.unknownMetadataCount).toBe(1);
    const json = JSON.stringify(result);
    for (const secret of ["SecretB", "preferredGameCategories", "refusedGameCategories", "userRefusals"]) expect(json).not.toContain(secret);
    await db.user.update({ where: { id: "host" }, data: { refusedGameCategories: ["PUZZLE"] } });
    expect((await data.loadGameSuggestions("host", ["host", "friend"])).suggestions).toEqual([]);
  });
  it("utilise réellement les préférences pour classer les jeux", async () => {
    await db.game.update({ where: { id: "shared" }, data: { igdbDetails: { genres: ["Shooter"], themes: [] } } });
    await db.user.updateMany({ where: { id: { in: ["host", "friend"] } }, data: { preferredGameCategories: ["PUZZLE"] } });
    const result = await data.loadGameSuggestions("host", ["host", "friend"]);
    expect(result.suggestions.find(g => g.id === "explicit")?.preferredByCount).toBe(2);
    expect(result.suggestions.find(g => g.id === "shared")?.preferredByCount).toBe(0);
    expect(result.suggestions.findIndex(g => g.id === "explicit")).toBeLessThan(result.suggestions.findIndex(g => g.id === "shared"));
  });
  it.each(["foreign", "removed", "missing"])("refuse le roster entier avec une personne inaccessible (%s)", async id => {
    const result = await data.loadGameSuggestions("host", ["host", id]);
    expect(result.error).toBe("participants_changed"); expect(result.suggestions).toEqual([]);
    expect(result.members.map(member => member.id)).not.toContain("foreign");
  });
  it("revalide changement de serveur, révocation et suspension à la requête suivante", async () => {
    expect((await data.loadGameSuggestions("host", ["host", "friend"])).error).toBeNull();
    await db.user.update({ where: { id: "host" }, data: { activeCommunityId: "b" } });
    expect((await data.loadGameSuggestions("host", ["host", "friend"])).error).toBe("participants_changed");
    await db.user.update({ where: { id: "host" }, data: { activeCommunityId: "a" } });
    await db.membership.update({ where: { communityId_userId: { communityId: "a", userId: "friend" } }, data: { status: "REMOVED" } });
    expect((await data.loadGameSuggestions("host", ["host", "friend"])).error).toBe("participants_changed");
    await db.community.update({ where: { id: "a" }, data: { status: "SUSPENDED" } });
    expect((await data.loadGameSuggestions("host", ["both", "friend"])).suggestions).toEqual([]);
  });
  it("OFF garde la sélection explicite et les refus dans le périmètre global", async () => {
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "false");
    await db.userGame.create({ data: { gameId: "shared", userId: "foreign", owned: true } });
    expect((await data.loadGameSuggestions("host", ["host", "foreign"])).suggestions.map(g => g.id)).toEqual(["shared"]);
    await db.userGameRefusal.create({ data: { userId: "foreign", gameId: "shared" } });
    expect((await data.loadGameSuggestions("host", ["host", "foreign"])).suggestions).toEqual([]);
  });
  it("sélection vide ou trop longue : aucun élargissement implicite", async () => {
    expect((await data.loadGameSuggestions("host", [])).suggestions).toEqual([]);
    expect((await data.loadGameSuggestions("host", Array(101).fill("host"))).error).toBe("invalid_participants");
  });
  it("ajout concurrent idempotent, écriture personnelle et suppression sans toucher le tiers", async () => {
    const results = await Promise.allSettled([actions.setGameRefusalAction(refusal("shared")), actions.setGameRefusalAction(refusal("shared"))]);
    expect(results.every(result => result.status === "rejected" && String(result.reason).includes("gouts=ok"))).toBe(true);
    expect(await db.userGameRefusal.count()).toBe(1);
    await db.userGameRefusal.create({ data: { userId: "friend", gameId: "shared" } });
    await expect(actions.setGameRefusalAction(refusal("shared", "remove"))).rejects.toThrow("gouts=ok");
    expect(await db.userGameRefusal.findMany()).toMatchObject([{ userId: "friend", gameId: "shared" }]);
  });
  it("le serveur refuse un jeu étranger mais permet de retirer son ancien refus", async () => {
    await expect(actions.setGameRefusalAction(refusal("foreign-game"))).rejects.toThrow("gouts=inaccessible");
    expect(await db.userGameRefusal.count()).toBe(0);
    await db.userGameRefusal.create({ data: { userId: "host", gameId: "foreign-game" } });
    await expect(actions.setGameRefusalAction(refusal("foreign-game", "remove"))).rejects.toThrow("gouts=ok");
    expect(await db.userGameRefusal.count()).toBe(0);
  });
  it("persiste puis efface les préférences, sans mutation du tiers ni de Steam", async () => {
    const form = new FormData(); form.set("userId", "foreign"); form.append("preferredGameCategories", "COOP"); form.append("refusedGameCategories", "HORROR");
    await expect(actions.updateGamePreferencesAction(form)).rejects.toThrow("gouts=ok");
    expect(await db.user.findUniqueOrThrow({ where: { id: "host" } })).toMatchObject({ preferredGameCategories: ["COOP"], refusedGameCategories: ["HORROR"], steamId64: "76561198000000000" });
    expect((await db.user.findUniqueOrThrow({ where: { id: "foreign" } })).refusedGameCategories).toEqual([]);
    await expect(actions.updateGamePreferencesAction(new FormData())).rejects.toThrow("gouts=ok");
    expect((await db.user.findUniqueOrThrow({ where: { id: "host" } })).refusedGameCategories).toEqual([]);
  });
});
