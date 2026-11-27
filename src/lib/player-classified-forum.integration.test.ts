import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

/**
 * Relais forum des annonces de joueurs (D3, décisions du 26/11/2026) : preuves D'INTÉGRATION sur PostgreSQL local, Discord entièrement simulé
 * (aucun appel réseau). Couvre : profil masqué jamais relayé ; fil SUPPRIMÉ (retrait, compte, profil masqué) et archivé à l'expiration ;
 * échecs permanents/réessayables ; au plus un post ; ping consommé seulement si le rôle est mentionnable, jour de PARIS sur l'instant réel,
 * 3 par joueur toutes communautés confondues ; garde du relais sur la création. Suite SKIPPÉE sans `TEST_DATABASE_URL`.
 */
const url = process.env.TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (!["postgres:", "postgresql:"].includes(target.protocol) || target.hostname !== "127.0.0.1" || target.searchParams.has("host")) {
    throw new Error("PostgreSQL loopback isolé requis");
  }
}
const discord = vi.hoisted(() => ({
  forums: vi.fn(), roles: vi.fn(), createPost: vi.fn(), archive: vi.fn(), deleteThread: vi.fn(),
}));
const faults = vi.hoisted(() => ({ hiddenCheck: false, eventCreation: false }));
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
  deleteThreadPermanently: discord.deleteThread,
}));
vi.mock("@/lib/player-classified-forum", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/player-classified-forum")>();
  return {
    ...actual,
    isForumAuthorHidden: (userId: string) => (faults.hiddenCheck ? Promise.reject(new Error("panne simulée")) : actual.isForumAuthorHidden(userId)),
  };
});
vi.mock("@/lib/notification-delivery", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/notification-delivery")>();
  return {
    ...actual,
    createNotificationEvent: (...args: Parameters<typeof actual.createNotificationEvent>) =>
      (faults.eventCreation ? Promise.reject(new Error("base indisponible (simulé)")) : actual.createNotificationEvent(...args)),
  };
});
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: () => true }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// `after()` ne fait rien : l'exécuteur n'est jamais lancé en arrière-plan, le test pilote lui-même chaque exécution.
vi.mock("next/server", () => ({ after: () => undefined }));
const session = vi.hoisted(() => ({ user: vi.fn(), admin: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: session.user }));
vi.mock("@/lib/admin", () => ({ requireAdmin: session.admin }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => { throw new Error("REDIRECT:" + to); },
  notFound: () => { throw new Error("NOT_FOUND"); },
}));
if (!url) console.warn("[player-classified-forum] TEST_DATABASE_URL absente : suite SKIPPÉE.");

describe.skipIf(!url)("relais forum des annonces de joueurs", () => {
  let db: PrismaClient;
  const scope = "pcf-" + randomUUID();
  const id = (name: string) => scope + "-" + name;
  const communityId = id("community");
  const otherCommunityId = id("other-community");
  const bareCommunityId = id("bare-community");
  const THREAD = "444444444444444444";
  const THREAD_2 = "444444444444444455";
  const GUILD = "111111111111111111";
  const FORUM = "222222222222222222";
  const ROLE = { id: "555555555555555555", name: "Hades II", position: 5, permissions: "0", managed: false };
  const deadline = new Date(Date.now() + 20_000);

  beforeAll(async () => { db = (await import("@/lib/prisma")).prisma as PrismaClient; });
  async function cleanup() {
    const mine = { communityId: { in: [communityId, otherCommunityId, bareCommunityId] }, eventType: "PLAYER_CLASSIFIED_FORUM" };
    await db.notificationDelivery.deleteMany({ where: { event: mine } });
    await db.notificationEvent.deleteMany({ where: mine });
    await db.playerClassifiedPing.deleteMany({ where: { userId: { startsWith: scope } } });
    await db.community.deleteMany({ where: { id: { in: [communityId, otherCommunityId, bareCommunityId] } } });
    await db.game.deleteMany({ where: { id: id("game") } });
    await db.user.deleteMany({ where: { id: { startsWith: scope } } });
  }
  afterAll(async () => {
    if (db) { await cleanup(); await db.$disconnect(); }
    vi.unstubAllEnvs(); vi.unstubAllGlobals();
  });
  afterEach(() => { vi.useRealTimers(); faults.hiddenCheck = false; faults.eventCreation = false; });
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubEnv("PLAYER_CLASSIFIED_FORUM_RELAY_ENABLED", "true");
    vi.stubEnv("NOTIFICATION_EXECUTOR_ENABLED", "true");
    vi.stubEnv("DISCORD_BOT_TOKEN", "bot-token-de-test");
    vi.stubEnv("NOTIFICATION_CENTER_ENABLED", "true");
    vi.stubEnv("PROFILE_VISIBILITY_ENABLED", "true");
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Réseau interdit en test"); }));
    discord.forums.mockResolvedValue({ ok: true, data: [{ id: FORUM, name: "🔎・recherche-de-joueurs", type: 15 }] });
    discord.roles.mockResolvedValue({ ok: true, data: { roles: [] } });
    discord.createPost.mockResolvedValue({ ok: true, data: { threadId: THREAD } });
    discord.archive.mockResolvedValue({ ok: true, data: {} });
    discord.deleteThread.mockResolvedValue({ ok: true, data: { threadId: THREAD } });
    session.admin.mockResolvedValue(null);
    await cleanup();
    await db.user.createMany({ data: ["author", "other", "admin"].map((name, index) => ({ id: id(name), discordId: scope + index, discordName: name })) });
    await db.community.create({ data: { id: communityId, name: communityId, slug: communityId, status: "ACTIVE", discordGuildId: GUILD, playerClassifiedsEnabled: true } });
    await db.community.create({ data: { id: otherCommunityId, name: otherCommunityId, slug: otherCommunityId, status: "ACTIVE", discordGuildId: "999999999999999999", playerClassifiedsEnabled: true } });
    // Communauté SANS serveur Discord relié : toute mise en file y est un échec PERMANENT.
    await db.community.create({ data: { id: bareCommunityId, name: bareCommunityId, slug: bareCommunityId, status: "ACTIVE", playerClassifiedsEnabled: true } });
    await db.membership.createMany({ data: [
      // Le serveur relié est le plus ancien : c'est le serveur « actif » de l'auteur pour les chemins web.
      ...["author", "other", "admin"].map((name) => ({ communityId, userId: id(name), status: "ACTIVE" as const, joinedAt: new Date("2026-01-01T00:00:00Z") })),
      { communityId: otherCommunityId, userId: id("author"), status: "ACTIVE" as const, joinedAt: new Date("2026-02-01T00:00:00Z") },
      { communityId: bareCommunityId, userId: id("author"), status: "ACTIVE" as const, joinedAt: new Date("2026-03-01T00:00:00Z") },
    ] });
    await db.game.create({ data: { id: id("game"), name: "Hades II", source: "MANUAL", addedById: id("author") } });
    session.user.mockResolvedValue({ id: id("author") });
  });

  const events = (prefix: string) => db.notificationEvent.findMany({ where: { communityId: { in: [communityId, otherCommunityId, bareCommunityId] }, eventType: "PLAYER_CLASSIFIED_FORUM", occurrence: { startsWith: prefix } } });
  const hideInDb = (user = "author") => db.userProfileVisibility.upsert({ where: { userId: id(user) }, update: { visibility: "HIDDEN" }, create: { userId: id(user), visibility: "HIDDEN" } });
  const optIn = (user: string, community = communityId) => db.gamePingOptIn.create({ data: { userId: id(user), communityId: community, gameId: id("game") } });
  const pingRows = () => db.playerClassifiedPing.findMany({ where: { userId: id("author") }, orderBy: { day: "asc" } });
  const mentionable = () => discord.roles.mockResolvedValue({ ok: true, data: { roles: [ROLE] } });
  async function listing(over: Record<string, unknown> = {}) {
    return db.playerClassified.create({ data: {
      id: id("l" + Math.random().toString(36).slice(2, 8)), communityId, gameId: id("game"), createdById: id("author"),
      message: "Cherche deux joueurs", createdAt: new Date(), expiresAt: new Date(Date.now() + 3600_000), ...over,
    } });
  }
  const relayed = (over: Record<string, unknown> = {}) => listing({ forumThreadId: THREAD, forumRelayedAt: new Date(), forumPostingAt: new Date(), ...over });
  async function run(intent: "post" | "close" | "remove", listingId: string, threadId?: string, community = communityId) {
    const { runPlayerClassifiedForumAction } = await import("./player-classified-forum-runner");
    return runPlayerClassifiedForumAction({ intent, listingId, communityId: community, ...(threadId ? { threadId } : {}) }, deadline);
  }
  async function create(message: string, over: { now?: Date; community?: string } = {}) {
    const { createPlayerListing } = await import("./player-listings");
    return createPlayerListing({ userId: id("author"), communityId: over.community ?? communityId, gameId: id("game"), message, ...(over.now ? { now: over.now } : {}) });
  }
  async function createViaWeb(message: string) {
    const { createPlayerClassifiedAction } = await import("@/app/joueurs/actions");
    const form = new FormData();
    form.set("gameId", id("game"));
    form.set("message", message);
    form.set("durationMinutes", "");
    return createPlayerClassifiedAction(form).then(() => "no-redirect", (error: Error) => error.message);
  }

  describe("profil masqué : jamais relayé", () => {
    it("création par un profil masqué : aucun événement, aucun ping, aucun fil", async () => {
      await optIn("other"); mentionable();
      await hideInDb();
      expect((await create("Cherche un duo")).status).toBe("created");
      expect(await events("post")).toHaveLength(0);
      expect(await pingRows()).toHaveLength(0);
    });

    it("profil masqué entre la création et l'exécution : le runner ne crée aucun post et n'écrit aucun état", async () => {
      const row = await listing();
      await hideInDb();
      expect((await run("post", row.id)).ok).toBe(false);
      expect(discord.createPost).not.toHaveBeenCalled();
      const after = await db.playerClassified.findUniqueOrThrow({ where: { id: row.id } });
      expect([after.forumThreadId, after.forumRelayedAt, after.forumPostingAt, after.pingedAt]).toEqual([null, null, null, null]);
    });

    it("le résolveur de l'executor refuse une demande « post » d'un profil masqué", async () => {
      const row = await listing();
      const { enqueuePlayerClassifiedForum, playerClassifiedForumResolver } = await import("./player-classified-forum");
      expect(await enqueuePlayerClassifiedForum({ listingId: row.id, communityId, intent: "post" })).toBe("queued");
      await hideInDb();
      const [event] = await events("post");
      const delivery = await db.notificationDelivery.findFirstOrThrow({ where: { eventId: event.id } });
      expect(await playerClassifiedForumResolver.resolve({ event, delivery } as never)).toMatchObject({ eligible: false });
    });

    it("masquer son profil met IMMÉDIATEMENT en file la SUPPRESSION du fil (sans attendre le cron), puis l'exécuteur le supprime", async () => {
      const row = await relayed();
      const { setProfileVisibility } = await import("./profile-visibility");
      expect(await setProfileVisibility(id("author"), "HIDDEN")).toBe("saved");
      const [event] = await events("remove");
      expect(event?.occurrence).toBe("remove:" + THREAD);
      expect(event?.payload).toMatchObject({ intent: "remove", threadId: THREAD });
      expect((await run("remove", row.id, THREAD)).ok).toBe(true);
      expect(discord.deleteThread).toHaveBeenCalledWith(expect.objectContaining({ threadId: THREAD }));
      expect(discord.archive).not.toHaveBeenCalled();
      const after = await db.playerClassified.findUniqueOrThrow({ where: { id: row.id } });
      expect(after.forumRemovedAt).not.toBeNull();
    });

    it("le balayage rattrape un profil masqué hors application (même fil déjà archivé) : suppression, pas archivage", async () => {
      await relayed({ forumClosedAt: new Date() });
      await hideInDb();
      const { runPlayerClassifiedForumLifecycle } = await import("./player-classified-forum");
      expect((await runPlayerClassifiedForumLifecycle(new Date())).closeQueued).toBe(1);
      expect(await events("remove")).toHaveLength(1);
      expect(await events("close")).toHaveLength(0);
    });
  });

  describe("fil retiré quand l'annonce est retirée", () => {
    it("retrait par l'auteur, relais éteint entre-temps : la SUPPRESSION du fil est mise en file avec le fil", async () => {
      const row = await relayed();
      vi.stubEnv("PLAYER_CLASSIFIED_FORUM_RELAY_ENABLED", "false");
      const { deletePlayerListing } = await import("./player-listings");
      expect(await deletePlayerListing({ userId: id("author"), communityId, listingId: row.id })).toBe("deleted");
      const [event] = await events("remove");
      expect(event?.payload).toMatchObject({ intent: "remove", threadId: THREAD });
    });

    it("retrait par un administrateur : même suppression ; la rejouer ne crée qu'un seul événement", async () => {
      const row = await relayed();
      const { deletePlayerListing } = await import("./player-listings");
      expect(await deletePlayerListing({ userId: id("admin"), communityId, listingId: row.id, isAdmin: true })).toBe("deleted");
      const { enqueuePlayerClassifiedForum } = await import("./player-classified-forum");
      await enqueuePlayerClassifiedForum({ listingId: row.id, communityId, intent: "remove", threadId: THREAD });
      expect(await events("remove")).toHaveLength(1);
    });

    it("retrait depuis la page web /joueurs : le fil est supprimé (événement) et la ligne retirée", async () => {
      const row = await relayed();
      const { deletePlayerClassifiedAction } = await import("@/app/joueurs/actions");
      const form = new FormData();
      form.set("id", row.id);
      await deletePlayerClassifiedAction(form).catch(() => undefined);
      expect(await db.playerClassified.count({ where: { id: row.id } })).toBe(0);
      expect((await events("remove"))[0]?.payload).toMatchObject({ threadId: THREAD });
    });

    it("échec PERMANENT (communauté sans serveur Discord relié) : le retrait n'est jamais bloqué, l'échec est journalisé", async () => {
      const row = await relayed({ communityId: bareCommunityId });
      const { logger } = await import("@/lib/logger");
      const warn = vi.spyOn(logger, "warn");
      const { deletePlayerListing } = await import("./player-listings");
      expect(await deletePlayerListing({ userId: id("author"), communityId: bareCommunityId, listingId: row.id })).toBe("deleted");
      expect(warn).toHaveBeenCalledWith("player-classified-forum", expect.stringContaining("permanent"), expect.objectContaining({ permanent: 1 }));
      expect(JSON.stringify(warn.mock.calls)).not.toMatch(new RegExp(id("author")));
    });

    it("échec RÉESSAYABLE (base indisponible) : le retrait est refusé et l'annonce est conservée", async () => {
      const row = await relayed();
      faults.eventCreation = true;
      const { deletePlayerListing } = await import("./player-listings");
      expect(await deletePlayerListing({ userId: id("author"), communityId, listingId: row.id })).toBe("forum_unavailable");
      expect(await db.playerClassified.count({ where: { id: row.id } })).toBe(1);
    });

    it("suppression du compte : le fil est supprimé par la file ; jamais bloquée par un échec permanent ; refusée sur un échec réessayable", async () => {
      const blobOps = { listPublicUrls: vi.fn(async () => []), deletePublic: vi.fn(async () => undefined), deletePrivate: vi.fn(async () => undefined) };
      const { deleteAccount, AccountBlobUnavailableError } = await import("./account-deletion");
      const permanent = await relayed({ communityId: bareCommunityId });
      const normal = await relayed({ forumThreadId: THREAD_2 });
      faults.eventCreation = true;
      await expect(deleteAccount(id("author"), { blobOps })).rejects.toBeInstanceOf(AccountBlobUnavailableError);
      expect(await db.playerClassified.count({ where: { id: { in: [permanent.id, normal.id] } } })).toBe(2);
      faults.eventCreation = false;
      expect((await deleteAccount(id("author"), { blobOps })).status).toBe("deleted");
      expect(await db.playerClassified.count({ where: { id: { in: [permanent.id, normal.id] } } })).toBe(0);
      expect((await events("remove")).map((event) => event.occurrence)).toEqual(["remove:" + THREAD_2]);
    });

    it("« Dispo ce soir » (remplacement) ne supprime jamais en silence une annonce dont le fil existe", async () => {
      const kept = await relayed({ message: "🟢 Dispo ce soir — Hades II" });
      const plain = await listing({ message: "🟢 Dispo ce soir — autre" });
      const { replaceTonightClassifieds } = await import("./tonight-write");
      await replaceTonightClassifieds({ communityId, userId: id("author"), gameIds: [id("game")], message: "🟢 Dispo ce soir — Hades II", createdAt: new Date(), expiresAt: new Date(Date.now() + 3600_000) });
      expect(await db.playerClassified.count({ where: { id: kept.id } })).toBe(1);
      expect(await db.playerClassified.count({ where: { id: plain.id } })).toBe(0);
    });

    it("expiration : le fil est ARCHIVÉ (pas supprimé), une seule fois, relais éteint, et l'exécuteur l'archive", async () => {
      const row = await relayed({ expiresAt: new Date(Date.now() - 1000) });
      vi.stubEnv("PLAYER_CLASSIFIED_FORUM_RELAY_ENABLED", "false");
      const { runPlayerClassifiedForumLifecycle } = await import("./player-classified-forum");
      await runPlayerClassifiedForumLifecycle(new Date());
      await runPlayerClassifiedForumLifecycle(new Date());
      expect(await events("close")).toHaveLength(1);
      expect(await events("remove")).toHaveLength(0);
      expect((await run("close", row.id, THREAD)).ok).toBe(true);
      expect(discord.archive).toHaveBeenCalledWith(expect.objectContaining({ threadId: THREAD }));
      expect(discord.deleteThread).not.toHaveBeenCalled();
    });

    it("suppression d'un fil d'une annonce déjà retirée : succès, et rejouer ou un fil déjà absent (404) reste sans effet", async () => {
      discord.deleteThread.mockResolvedValue({ ok: false, kind: "not_found", message: "absent", retryable: false });
      for (let attempt = 0; attempt < 2; attempt++) expect((await run("remove", id("disparue"), THREAD)).ok).toBe(true);
    });
  });

  describe("au plus un post, jamais de fil orphelin", () => {
    it("la marque d'envoi est posée AVANT l'appel Discord", async () => {
      const row = await listing();
      discord.createPost.mockImplementation(async () => {
        expect((await db.playerClassified.findUniqueOrThrow({ where: { id: row.id } })).forumPostingAt).not.toBeNull();
        return { ok: true, data: { threadId: THREAD } };
      });
      expect((await run("post", row.id)).ok).toBe(true);
      expect((await db.playerClassified.findUniqueOrThrow({ where: { id: row.id } })).forumThreadId).toBe(THREAD);
    });

    it("rejeu après un plantage (marque ancienne, aucun identifiant de fil) : aucun second post, échec définitif", async () => {
      const row = await listing({ forumPostingAt: new Date(Date.now() - 10 * 60_000) });
      const result = await run("post", row.id);
      expect(result).toMatchObject({ ok: false, retryable: false });
      expect(discord.createPost).not.toHaveBeenCalled();
    });

    it("marque récente : un autre exécuteur poste en ce moment, nouvel essai plus tard (réessayable)", async () => {
      const row = await listing({ forumPostingAt: new Date() });
      expect(await run("post", row.id)).toMatchObject({ ok: false, retryable: true });
      expect(discord.createPost).not.toHaveBeenCalled();
    });

    it("échec certain (permission) : la marque est levée ; échec incertain (réseau) : elle reste, jamais de second post", async () => {
      const row = await listing();
      discord.createPost.mockResolvedValueOnce({ ok: false, kind: "forbidden", message: "refusé", retryable: false });
      await run("post", row.id);
      expect((await db.playerClassified.findUniqueOrThrow({ where: { id: row.id } })).forumPostingAt).toBeNull();
      discord.createPost.mockResolvedValueOnce({ ok: false, kind: "network_uncertain", message: "réseau", retryable: true });
      await run("post", row.id);
      expect((await db.playerClassified.findUniqueOrThrow({ where: { id: row.id } })).forumPostingAt).not.toBeNull();
    });

    it("annonce retirée PENDANT la création : la suppression du fil orphelin est MISE EN FILE (occurrence propre) puis exécutée", async () => {
      const row = await listing();
      discord.createPost.mockImplementation(async () => {
        await db.playerClassified.delete({ where: { id: row.id } });
        return { ok: true, data: { threadId: THREAD } };
      });
      await run("post", row.id);
      const [event] = await events("remove");
      expect(event?.occurrence).toBe("remove:" + THREAD);
      expect(event?.payload).toMatchObject({ intent: "remove", threadId: THREAD });
      expect(discord.archive).not.toHaveBeenCalled();
      expect((await run("remove", row.id, THREAD)).ok).toBe(true);
      expect(discord.deleteThread).toHaveBeenCalledWith(expect.objectContaining({ threadId: THREAD }));
    });
  });

  describe("pings : opt-in, rôle mentionnable, 3 par joueur et par jour de Paris", () => {
    it("frontière de minuit à Paris, hiver (22 h 59 / 23 h 00 UTC) et été (21 h 59 / 22 h 00 UTC)", async () => {
      const { consumePlayerClassifiedPing } = await import("./player-classified-pings");
      const cases: Array<[string, string]> = [
        ["2027-01-15T22:59:00Z", "2027-01-15"], ["2027-01-15T23:00:00Z", "2027-01-16"],
        ["2027-07-15T21:59:00Z", "2027-07-15"], ["2027-07-15T22:00:00Z", "2027-07-16"],
      ];
      for (const [at] of cases) expect(await consumePlayerClassifiedPing({ communityId, userId: id("author"), now: new Date(at) })).toBe(true);
      expect((await pingRows()).map((row) => row.day.toISOString().slice(0, 10)).sort()).toEqual(cases.map(([, day]) => day).sort());
    });

    it("le 4e ping du même jour de Paris est refusé, le premier du lendemain de Paris passe", async () => {
      const { consumePlayerClassifiedPing } = await import("./player-classified-pings");
      const noon = new Date("2027-01-15T11:00:00Z");
      const results = [];
      for (let i = 0; i < 4; i++) results.push(await consumePlayerClassifiedPing({ communityId, userId: id("author"), now: noon }));
      expect(results).toEqual([true, true, true, false]);
      expect(await consumePlayerClassifiedPing({ communityId, userId: id("author"), now: new Date("2027-01-15T22:59:00Z") })).toBe(false);
      expect(await consumePlayerClassifiedPing({ communityId, userId: id("author"), now: new Date("2027-01-15T23:00:00Z") })).toBe(true);
    });

    it("le plafond est PAR JOUEUR, toutes communautés confondues : 2 sur un serveur + 2 sur un autre = 3 au total", async () => {
      const { consumePlayerClassifiedPing } = await import("./player-classified-pings");
      const noon = new Date("2027-01-15T11:00:00Z");
      const results = [
        await consumePlayerClassifiedPing({ communityId, userId: id("author"), now: noon }),
        await consumePlayerClassifiedPing({ communityId, userId: id("author"), now: noon }),
        await consumePlayerClassifiedPing({ communityId: otherCommunityId, userId: id("author"), now: noon }),
        await consumePlayerClassifiedPing({ communityId: otherCommunityId, userId: id("author"), now: noon }),
      ];
      expect(results).toEqual([true, true, true, false]);
    });

    it("concurrence : 10 relais simultanés (deux serveurs) ne dépassent jamais 3 pings au total", async () => {
      const { consumePlayerClassifiedPing } = await import("./player-classified-pings");
      const noon = new Date("2027-03-10T11:00:00Z");
      const results = await Promise.all(Array.from({ length: 10 }, (_, index) =>
        consumePlayerClassifiedPing({ communityId: index % 2 ? communityId : otherCommunityId, userId: id("author"), now: noon })));
      expect(results.filter(Boolean)).toHaveLength(3);
      expect((await pingRows()).reduce((sum, row) => sum + row.count, 0)).toBe(3);
    });

    it.each([
      ["hiver, 22 h 30 UTC (23 h 30 à Paris)", "2027-01-15T22:30:00Z", "2027-01-15"],
      ["été, 21 h 30 UTC (23 h 30 à Paris)", "2027-07-15T21:30:00Z", "2027-07-15"],
    ])("chemin de production SANS instant injecté (createPlayerListing puis page web), horloge simulée %s : le jour compté est celui de Paris", async (_label, instant, day) => {
      await optIn("other"); mentionable();
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(instant));
      expect((await create("Annonce via le service")).status).toBe("created");
      expect(await createViaWeb("Annonce via la page web")).toBe("REDIRECT:/joueurs");
      const rows = await db.playerClassified.findMany({ where: { createdById: id("author") } });
      expect(rows).toHaveLength(2);
      for (const row of rows) expect(await run("post", row.id)).toMatchObject({ ok: true });
      const counted = await pingRows();
      expect(counted.map((row) => row.day.toISOString().slice(0, 10))).toEqual([day]);
      expect(counted[0].count).toBe(2);
      // L'ancienne double conversion (heure murale reconvertie en Europe/Paris) aurait compté le lendemain.
      const { playerClassifiedPingDay } = await import("./player-classified-pings");
      const { toWallClock } = await import("./wallclock");
      expect(playerClassifiedPingDay(toWallClock(new Date(instant))).toISOString().slice(0, 10)).not.toBe(day);
    });

    it("rien n'est consommé : relais éteint, aucun abonné, rôle absent, rôle ambigu, rôle sensible, profil masqué", async () => {
      const scenarios: Array<[string, () => Promise<void>]> = [
        ["aucun abonné", async () => { mentionable(); }],
        ["rôle absent", async () => { await optIn("other"); discord.roles.mockResolvedValue({ ok: true, data: { roles: [] } }); }],
        ["rôle ambigu", async () => { discord.roles.mockResolvedValue({ ok: true, data: { roles: [ROLE, { ...ROLE, id: "666666666666666666" }] } }); }],
        ["rôle sensible", async () => { discord.roles.mockResolvedValue({ ok: true, data: { roles: [{ ...ROLE, permissions: "8" }] } }); }],
      ];
      for (const [label, setup] of scenarios) {
        await db.gamePingOptIn.deleteMany({ where: { communityId } });
        await setup();
        const row = await listing({ message: label });
        expect((await run("post", row.id)).ok, label).toBe(true);
        expect((await db.playerClassified.findUniqueOrThrow({ where: { id: row.id } })).pingedAt, label).toBeNull();
        expect(discord.createPost.mock.calls.at(-1)?.[0].allowedMentions, label).toEqual({ parse: [] });
      }
      expect(await pingRows()).toHaveLength(0);
      vi.stubEnv("PLAYER_CLASSIFIED_FORUM_RELAY_ENABLED", "false");
      await create("Relais éteint");
      expect(await pingRows()).toHaveLength(0);
    });

    it("mise en file impossible (échec permanent) : aucun événement, donc aucun ping consommé", async () => {
      await db.gamePingOptIn.create({ data: { userId: id("other"), communityId: bareCommunityId, gameId: id("game") } }).catch(() => undefined);
      mentionable();
      await create("Sans serveur relié", { community: bareCommunityId });
      expect(await events("post")).toHaveLength(0);
      expect(await pingRows()).toHaveLength(0);
    });

    it("rôle mentionnable : ping consommé UNE fois (un rejeu ne consomme pas deux fois), mentions exactement { parse: [], roles: [rôle] }", async () => {
      await optIn("other"); mentionable();
      const row = await listing();
      expect((await run("post", row.id)).ok).toBe(true);
      const call = discord.createPost.mock.calls[0][0];
      expect(call.allowedMentions).toEqual({ parse: [], roles: [ROLE.id] });
      expect(call.content).not.toMatch(/@everyone|@here/);
      expect(call.content).toContain(`<@&${ROLE.id}>`);
      await db.playerClassified.update({ where: { id: row.id }, data: { forumThreadId: null, forumPostingAt: null } });
      await run("post", row.id);
      expect((await pingRows())[0].count).toBe(1);
    });

    it("plafond atteint : le post est créé SANS ping, pingedAt reste vide", async () => {
      await optIn("other"); mentionable();
      const { consumePlayerClassifiedPing } = await import("./player-classified-pings");
      for (let i = 0; i < 3; i++) await consumePlayerClassifiedPing({ communityId: otherCommunityId, userId: id("author") });
      const row = await listing();
      expect((await run("post", row.id)).ok).toBe(true);
      expect(discord.createPost.mock.calls[0][0].allowedMentions).toEqual({ parse: [] });
      expect((await db.playerClassified.findUniqueOrThrow({ where: { id: row.id } })).pingedAt).toBeNull();
    });
  });

  describe("la création de l'annonce ne dépend jamais du relais", () => {
    it("page web : profil masqué = annonce créée sans événement ni ping ; profil visible = événement", async () => {
      await optIn("other"); mentionable();
      await hideInDb();
      expect(await createViaWeb("Annonce masquée")).toBe("REDIRECT:/joueurs");
      expect(await events("post")).toHaveLength(0);
      expect(await pingRows()).toHaveLength(0);
      await db.userProfileVisibility.deleteMany({ where: { userId: id("author") } });
      expect(await createViaWeb("Annonce visible")).toBe("REDIRECT:/joueurs");
      expect(await events("post")).toHaveLength(1);
    });

    it("panne du relais (contrôle du profil, puis création d'événement) : l'annonce existe, la page redirige normalement, l'erreur est journalisée", async () => {
      const { logger } = await import("@/lib/logger");
      const error = vi.spyOn(logger, "error");
      faults.hiddenCheck = true;
      expect(await createViaWeb("Panne du contrôle")).toBe("REDIRECT:/joueurs");
      faults.hiddenCheck = false;
      faults.eventCreation = true;
      expect(await createViaWeb("Panne de la file")).toBe("REDIRECT:/joueurs");
      expect(await db.playerClassified.count({ where: { createdById: id("author") } })).toBe(2);
      expect(error).toHaveBeenCalledWith("player-listings", expect.any(Error), expect.objectContaining({ step: "forum-relay" }));
      expect(await events("post")).toHaveLength(0);
    });
  });

  describe("balayage : rotation des lignes bloquées", () => {
    it("26 lignes expirées bloquées en permanence (aucun serveur relié) ne privent jamais une ligne joignable d'être traitée au passage suivant", async () => {
      for (let i = 0; i < 26; i++) {
        await relayed({ communityId: bareCommunityId, forumThreadId: "5000000000000000" + String(10 + i), expiresAt: new Date(Date.now() - 100_000 + i) });
      }
      const reachable = await relayed({ forumThreadId: THREAD_2, expiresAt: new Date(Date.now() - 1) });
      const { runPlayerClassifiedForumLifecycle } = await import("./player-classified-forum");
      await runPlayerClassifiedForumLifecycle(new Date());
      await runPlayerClassifiedForumLifecycle(new Date());
      const closed = await events("close");
      expect(closed.some((event) => event.sourceId === reachable.id)).toBe(true);
    });
  });
});
