import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

/**
 * Relais forum des annonces de joueurs (D3, décisions du 26/11/2026) : preuves D'INTÉGRATION sur PostgreSQL local, Discord entièrement simulé
 * (aucun appel réseau). (a) un profil masqué n'est JAMAIS relayé ; (b) le fil est fermé à coup sûr quand l'annonce est retirée, quel que
 * soit le chemin ; (c) 3 pings par joueur et par jour de PARIS, atomiques. Suite SKIPPÉE sans `TEST_DATABASE_URL`.
 */
const url = process.env.TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (!["postgres:", "postgresql:"].includes(target.protocol) || target.hostname !== "127.0.0.1" || target.searchParams.has("host")) {
    throw new Error("PostgreSQL loopback isolé requis");
  }
}
const discord = vi.hoisted(() => ({
  forums: vi.fn(), roles: vi.fn(), createPost: vi.fn(), archive: vi.fn(),
}));
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: url ? new PrismaClient({ datasourceUrl: url }) : {} };
});
vi.mock("@/lib/discord-rest", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/discord-rest")>()),
  listDiscordForumChannels: discord.forums,
  listGuildRoles: discord.roles,
  createForumPost: discord.createPost,
  archiveThread: discord.archive,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: (task: () => unknown) => { void task(); } }));
const session = vi.hoisted(() => ({ user: vi.fn(), admin: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: session.user }));
vi.mock("@/lib/admin", () => ({ requireAdmin: session.admin }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => { throw new Error("REDIRECT:" + to); },
  notFound: () => { throw new Error("NOT_FOUND"); },
}));
if (!url) console.warn("[player-classified-forum] TEST_DATABASE_URL absente : suite SKIPPÉE.");

describe.skipIf(!url)("relais forum des annonces de joueurs : profil masqué, fermeture, plafond de pings", () => {
  let db: PrismaClient;
  const scope = "pcf-" + randomUUID();
  const id = (name: string) => scope + "-" + name;
  const communityId = id("community");
  const THREAD = "444444444444444444";
  const GUILD = "111111111111111111";
  const FORUM = "222222222222222222";
  const deadline = new Date(Date.now() + 20_000);

  beforeAll(async () => { db = (await import("@/lib/prisma")).prisma as PrismaClient; });
  async function cleanup() {
    await db.notificationDelivery.deleteMany({ where: { event: { sourceId: { startsWith: scope } } } });
    await db.notificationEvent.deleteMany({ where: { sourceId: { startsWith: scope } } });
    await db.playerClassifiedPing.deleteMany({ where: { communityId } });
    await db.community.deleteMany({ where: { id: communityId } });
    await db.game.deleteMany({ where: { id: id("game") } });
    await db.user.deleteMany({ where: { id: { startsWith: scope } } });
  }
  afterAll(async () => {
    if (db) { await cleanup(); await db.$disconnect(); }
    vi.unstubAllEnvs(); vi.unstubAllGlobals();
  });
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubEnv("PLAYER_CLASSIFIED_FORUM_RELAY_ENABLED", "true");
    vi.stubEnv("NOTIFICATION_EXECUTOR_ENABLED", "true");
    vi.stubEnv("DISCORD_BOT_TOKEN", "bot-token-de-test");
    vi.stubEnv("NOTIFICATION_CENTER_ENABLED", "true");
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Réseau interdit en test"); }));
    discord.forums.mockResolvedValue({ ok: true, data: [{ id: FORUM, name: "🔎・recherche-de-joueurs", type: 15 }] });
    discord.roles.mockResolvedValue({ ok: true, data: { roles: [] } });
    discord.createPost.mockResolvedValue({ ok: true, data: { threadId: THREAD } });
    discord.archive.mockResolvedValue({ ok: true, data: {} });
    await cleanup();
    await db.user.createMany({ data: ["author", "other", "admin"].map((name, index) => ({ id: id(name), discordId: scope + index, discordName: name })) });
    await db.community.create({ data: { id: communityId, name: communityId, slug: communityId, status: "ACTIVE", discordGuildId: GUILD, playerClassifiedsEnabled: true } });
    await db.membership.createMany({ data: ["author", "other", "admin"].map((name) => ({ communityId, userId: id(name), status: "ACTIVE" as const })) });
    await db.game.create({ data: { id: id("game"), name: "Hades II", source: "MANUAL", addedById: id("author") } });
  });

  const events = (intent: string) => db.notificationEvent.findMany({ where: { sourceId: { startsWith: scope }, eventType: "PLAYER_CLASSIFIED_FORUM", occurrence: intent } });
  const hide = (user = "author") => db.userProfileVisibility.upsert({ where: { userId: id(user) }, update: { visibility: "HIDDEN" }, create: { userId: id(user), visibility: "HIDDEN" } });
  const optIn = (user: string) => db.gamePingOptIn.create({ data: { userId: id(user), communityId, gameId: id("game") } });
  const pingsRow = () => db.playerClassifiedPing.findMany({ where: { communityId, userId: id("author") } });
  async function listing(over: Record<string, unknown> = {}) {
    return db.playerClassified.create({ data: {
      id: id("l" + Math.random().toString(36).slice(2, 8)), communityId, gameId: id("game"), createdById: id("author"),
      message: "Cherche deux joueurs", createdAt: new Date(), expiresAt: new Date(Date.now() + 3600_000), ...over,
    } });
  }
  async function create(message: string, now = new Date()) {
    const { createPlayerListing } = await import("./player-listings");
    return createPlayerListing({ userId: id("author"), communityId, gameId: id("game"), message, now });
  }

  describe("(a) un profil masqué n'est jamais relayé", () => {
    it("création par un profil masqué : aucun événement, aucun ping consommé, aucun pingedAt", async () => {
      await optIn("other");
      await hide();
      const out = await create("Cherche un duo");
      expect(out.status).toBe("created");
      expect(await events("post")).toHaveLength(0);
      expect(await pingsRow()).toHaveLength(0);
      const row = await db.playerClassified.findFirstOrThrow({ where: { createdById: id("author") } });
      expect(row.pingedAt).toBeNull();
      expect(row.forumThreadId).toBeNull();
    });

    it("profil masqué entre la création et l'exécution : le runner ne crée aucun post et n'écrit aucun état", async () => {
      const row = await listing();
      await hide();
      const { runPlayerClassifiedForumAction } = await import("./player-classified-forum-runner");
      const result = await runPlayerClassifiedForumAction({ intent: "post", listingId: row.id, communityId }, deadline);
      expect(result.ok).toBe(false);
      expect(discord.createPost).not.toHaveBeenCalled();
      expect(discord.forums).not.toHaveBeenCalled();
      const after = await db.playerClassified.findUniqueOrThrow({ where: { id: row.id } });
      expect(after.forumThreadId).toBeNull();
      expect(after.forumRelayedAt).toBeNull();
    });

    it("profil masqué APRÈS la création du post : le balayage met la fermeture en file et le runner archive le fil", async () => {
      const row = await listing({ forumThreadId: THREAD, forumRelayedAt: new Date() });
      await hide();
      const { runPlayerClassifiedForumLifecycle } = await import("./player-classified-forum");
      const sweep = await runPlayerClassifiedForumLifecycle(new Date());
      expect(sweep.closeQueued).toBe(1);
      const [event] = await events("close");
      expect(event.payload).toMatchObject({ intent: "close", threadId: THREAD });
      const { runPlayerClassifiedForumAction } = await import("./player-classified-forum-runner");
      const result = await runPlayerClassifiedForumAction({ intent: "close", listingId: row.id, communityId, threadId: THREAD }, deadline);
      expect(result.ok).toBe(true);
      expect(discord.archive).toHaveBeenCalledWith(expect.objectContaining({ threadId: THREAD }));
      expect((await db.playerClassified.findUniqueOrThrow({ where: { id: row.id } })).forumClosedAt).not.toBeNull();
    });

    it("le résolveur de l'executor refuse aussi une demande « post » d'un profil masqué", async () => {
      const row = await listing();
      const { enqueuePlayerClassifiedForum, playerClassifiedForumResolver } = await import("./player-classified-forum");
      expect(await enqueuePlayerClassifiedForum({ listingId: row.id, communityId, intent: "post" })).toBe("queued");
      await hide();
      const [event] = await events("post");
      const delivery = await db.notificationDelivery.findFirstOrThrow({ where: { eventId: event.id } });
      const resolved = await playerClassifiedForumResolver.resolve({ event, delivery } as never);
      expect(resolved).toMatchObject({ eligible: false });
    });
  });

  describe("(b) le fil est fermé quand l'annonce est retirée", () => {
    it("suppression par l'auteur, relais éteint entre-temps : la fermeture est quand même mise en file avec le fil", async () => {
      const row = await listing({ forumThreadId: THREAD, forumRelayedAt: new Date() });
      vi.stubEnv("PLAYER_CLASSIFIED_FORUM_RELAY_ENABLED", "false");
      const { deletePlayerListing } = await import("./player-listings");
      expect(await deletePlayerListing({ userId: id("author"), communityId, listingId: row.id })).toBe("deleted");
      const [event] = await events("close");
      expect(event?.payload).toMatchObject({ intent: "close", threadId: THREAD });
    });

    it("suppression par un administrateur : même fermeture ; fermer deux fois ne crée qu'un seul événement", async () => {
      const row = await listing({ forumThreadId: THREAD, forumRelayedAt: new Date() });
      const { deletePlayerListing } = await import("./player-listings");
      expect(await deletePlayerListing({ userId: id("admin"), communityId, listingId: row.id, isAdmin: true })).toBe("deleted");
      const { enqueuePlayerClassifiedForum } = await import("./player-classified-forum");
      await enqueuePlayerClassifiedForum({ listingId: row.id, communityId, intent: "close", threadId: THREAD });
      expect(await events("close")).toHaveLength(1);
    });

    it("suppression depuis la page web /joueurs : le fil est fermé (ce chemin ne passait par aucune fermeture)", async () => {
      const row = await listing({ forumThreadId: THREAD, forumRelayedAt: new Date() });
      session.user.mockResolvedValue({ id: id("author") });
      session.admin.mockResolvedValue(null);
      const { deletePlayerClassifiedAction } = await import("@/app/joueurs/actions");
      const form = new FormData();
      form.set("id", row.id);
      await deletePlayerClassifiedAction(form).catch(() => undefined);
      expect(await db.playerClassified.count({ where: { id: row.id } })).toBe(0);
      const [event] = await events("close");
      expect(event?.payload).toMatchObject({ threadId: THREAD });
    });

    it("« Dispo ce soir » (remplacement) ne supprime jamais en silence une annonce dont le fil existe", async () => {
      const relayed = await listing({ message: "🟢 Dispo ce soir — Hades II", forumThreadId: THREAD, forumRelayedAt: new Date() });
      const plain = await listing({ message: "🟢 Dispo ce soir — autre" });
      const { replaceTonightClassifieds } = await import("./tonight-write");
      await replaceTonightClassifieds({ communityId, userId: id("author"), gameIds: [id("game")], message: "🟢 Dispo ce soir — Hades II", createdAt: new Date(), expiresAt: new Date(Date.now() + 3600_000) });
      expect(await db.playerClassified.count({ where: { id: relayed.id } })).toBe(1);
      expect(await db.playerClassified.count({ where: { id: plain.id } })).toBe(0);
    });

    it("suppression du compte : le fil de l'annonce est fermé (événement portant le fil) avant la suppression des lignes", async () => {
      const row = await listing({ forumThreadId: THREAD, forumRelayedAt: new Date() });
      const { deleteAccount } = await import("./account-deletion");
      const blobOps = { listPublicUrls: vi.fn(async () => []), deletePublic: vi.fn(async () => undefined), deletePrivate: vi.fn(async () => undefined) };
      const result = await deleteAccount(id("author"), { blobOps });
      expect(result.status).toBe("deleted");
      expect(await db.playerClassified.count({ where: { id: row.id } })).toBe(0);
      const [event] = await events("close");
      expect(event?.payload).toMatchObject({ intent: "close", threadId: THREAD });
    });

    it("annonce retirée PENDANT la création du post : le fil créé est archivé tout de suite (jamais orphelin)", async () => {
      const row = await listing();
      discord.createPost.mockImplementation(async () => {
        await db.playerClassified.delete({ where: { id: row.id } });
        return { ok: true, data: { threadId: THREAD } };
      });
      const { runPlayerClassifiedForumAction } = await import("./player-classified-forum-runner");
      await runPlayerClassifiedForumAction({ intent: "post", listingId: row.id, communityId }, deadline);
      expect(discord.archive).toHaveBeenCalledWith(expect.objectContaining({ threadId: THREAD }));
    });

    it("expiration : le balayage ferme le fil une seule fois, sans doublon d'événement, même relais éteint", async () => {
      await listing({ forumThreadId: THREAD, forumRelayedAt: new Date(), expiresAt: new Date(Date.now() - 1000) });
      vi.stubEnv("PLAYER_CLASSIFIED_FORUM_RELAY_ENABLED", "false");
      const { runPlayerClassifiedForumLifecycle } = await import("./player-classified-forum");
      await runPlayerClassifiedForumLifecycle(new Date());
      await runPlayerClassifiedForumLifecycle(new Date());
      expect(await events("close")).toHaveLength(1);
    });

    it("fermeture d'une annonce déjà retirée : le runner archive le fil porté par l'événement, et rejouer reste sans effet", async () => {
      const { runPlayerClassifiedForumAction } = await import("./player-classified-forum-runner");
      for (let attempt = 0; attempt < 2; attempt++) {
        const result = await runPlayerClassifiedForumAction({ intent: "close", listingId: id("disparue"), communityId, threadId: THREAD }, deadline);
        expect(result.ok).toBe(true);
      }
      expect(discord.archive).toHaveBeenCalledWith(expect.objectContaining({ threadId: THREAD }));
    });
  });

  describe("(c) 3 pings par joueur et par jour de Paris", () => {
    const input = (now: Date) => ({ communityId, userId: id("author"), now });
    it("frontière de minuit à Paris, hiver (22 h 59 et 23 h 00 UTC) et été (21 h 59 et 22 h 00 UTC) : le jour change à minuit de Paris", async () => {
      const { consumePlayerClassifiedPing } = await import("./player-classified-pings");
      const cases: Array<[string, string]> = [
        ["2027-01-15T22:59:00Z", "2027-01-15"], ["2027-01-15T23:00:00Z", "2027-01-16"],
        ["2027-07-15T21:59:00Z", "2027-07-15"], ["2027-07-15T22:00:00Z", "2027-07-16"],
      ];
      for (const [at] of cases) expect(await consumePlayerClassifiedPing(input(new Date(at)))).toBe(true);
      const days = (await pingsRow()).map((row) => row.day.toISOString().slice(0, 10)).sort();
      expect(days).toEqual(cases.map(([, day]) => day).sort());
    });

    it("le 4e ping du même jour de Paris est refusé, le premier ping du lendemain de Paris passe", async () => {
      const { consumePlayerClassifiedPing } = await import("./player-classified-pings");
      const noon = new Date("2027-01-15T11:00:00Z");
      const results = [];
      for (let i = 0; i < 4; i++) results.push(await consumePlayerClassifiedPing(input(noon)));
      expect(results).toEqual([true, true, true, false]);
      expect(await consumePlayerClassifiedPing(input(new Date("2027-01-15T22:59:00Z")))).toBe(false);
      expect(await consumePlayerClassifiedPing(input(new Date("2027-01-15T23:00:00Z")))).toBe(true);
    });

    it("concurrence : 10 relais simultanés ne dépassent jamais 3 pings", async () => {
      const { consumePlayerClassifiedPing } = await import("./player-classified-pings");
      const noon = new Date("2027-03-10T11:00:00Z");
      const results = await Promise.all(Array.from({ length: 10 }, () => consumePlayerClassifiedPing(input(noon))));
      expect(results.filter(Boolean)).toHaveLength(3);
      expect((await pingsRow())[0].count).toBe(3);
    });

    it("aucun ping consommé quand le relais est éteint, ni quand le jeu n'a aucun abonné (opt-in) ; consommé seulement avec un abonné", async () => {
      vi.stubEnv("PLAYER_CLASSIFIED_FORUM_RELAY_ENABLED", "false");
      await create("Annonce A");
      expect(await pingsRow()).toHaveLength(0);
      vi.stubEnv("PLAYER_CLASSIFIED_FORUM_RELAY_ENABLED", "true");
      await create("Annonce B");
      expect(await pingsRow()).toHaveLength(0);
      await optIn("other");
      await create("Annonce C");
      expect((await pingsRow())[0].count).toBe(1);
      expect((await db.playerClassified.findFirstOrThrow({ where: { message: "Annonce C" } })).pingedAt).not.toBeNull();
    });

    it("le contenu du post ne mentionne ni @everyone ni @here : mentions de rôle seulement via buildGameRolePing", async () => {
      await optIn("other");
      discord.roles.mockResolvedValue({ ok: true, data: { roles: [{ id: "555555555555555555", name: "Hades II", permissions: "0", managed: false, mentionable: true }] } });
      const row = await listing({ pingedAt: new Date() });
      const { runPlayerClassifiedForumAction } = await import("./player-classified-forum-runner");
      await runPlayerClassifiedForumAction({ intent: "post", listingId: row.id, communityId }, deadline);
      const call = discord.createPost.mock.calls[0]?.[0];
      expect(call.content).not.toMatch(/@everyone|@here/);
      expect(call.allowedMentions?.parse ?? []).not.toContain("everyone");
    });
  });
});
