import { beforeAll, beforeEach, afterAll, afterEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

const state = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: async () => state.user }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: () => true, RATE_LIMIT_ERROR_KEY: "rate_limited" }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); } }));
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: process.env.TEST_DATABASE_URL ? new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL }) : {} };
});

describe.skipIf(!process.env.TEST_DATABASE_URL)("stabilisation : concurrence et réponses perdues sur PostgreSQL", () => {
  let db: PrismaClient;
  beforeAll(async () => {
    expect(new URL(process.env.TEST_DATABASE_URL!).hostname).toBe("127.0.0.1");
    db = (await import("@/lib/prisma")).prisma as unknown as PrismaClient;
  });
  afterAll(async () => { await db?.$disconnect(); });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  beforeEach(async () => {
    await db.$executeRawUnsafe('TRUNCATE "CreationIntent", "User", "Community", "Game", "NotificationEvent", "Badge" CASCADE');
    (await import("@/lib/default-community")).resetDefaultCommunityIdCache();
    state.user = await db.user.create({ data: { id: "creator", discordId: "111111111111111111", discordName: "Créateur" } });
    await db.user.create({ data: { id: "guest", discordId: "222222222222222222", discordName: "Invité" } });
    await db.game.create({ data: { id: "game", name: "Jeu", source: "MANUAL", addedById: "creator" } });
    for (const flag of ["COMMUNITY_ISOLATION_ENABLED", "COMMUNITY_PICKER_ENABLED", "COMMUNITY_CHANNELS_ENABLED", "DISCORD_BOT_SESSION_ANNOUNCE_ENABLED", "DISCORD_BOT_TOURNAMENT_ANNOUNCE_ENABLED", "DISCORD_DM_SESSION_ENABLED", "DISCORD_DM_TOURNAMENT_ENABLED", "DISCORD_DM_ROULETTE_ENABLED", "DISCORD_BOT_INSTANT_SESSION_INVITE_ENABLED"]) vi.stubEnv(flag, "false");
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Aucun HTTP réel autorisé"); }));
  });

  function form(key: string) {
    const form = new FormData();
    for (const [name, value] of Object.entries({ creationKey: key, date: "2026-12-01", time: "20:00", gameId: "game", name: "Tournoi", maxPlayers: "4", deadlineOffset: "1" })) form.set(name, value);
    form.append("participantId", "guest");
    form.append("participantId", "creator");
    form.append("notifyUserId", "guest");
    return form;
  }
  async function destination(run: Promise<unknown>) {
    try { await run; throw new Error("Redirection attendue"); }
    catch (error) {
      const message = String(error);
      expect(message).toMatch(/REDIRECT:\/(sessions|roulette|tournois|jouer-maintenant)\//);
      return message.split("REDIRECT:")[1].split("?")[0];
    }
  }
  it.each(["session", "roulette", "roulette-session", "instant", "tournament"])("%s : 6 appels concurrents + réponse perdue = un seul événement", async (kind) => {
    const action = kind === "session" ? (await import("@/app/sessions/actions/session-lifecycle")).createSession
      : kind === "roulette" ? (await import("@/app/roulette/actions")).createRouletteAction
      : kind === "roulette-session" ? (await import("@/app/roulette/actions")).createSessionFromRouletteAction
      : kind === "instant" ? (await import("@/app/jouer-maintenant/actions")).createInstantSessionAction
      : (await import("@/app/tournois/actions")).createTournamentAction;
    const destinations = await Promise.all(Array.from({ length: 6 }, () => destination(action(form("same-attempt-00000001")))));
    expect(new Set(destinations).size).toBe(1);
    expect(await destination(action(form("same-attempt-00000001")))).toBe(destinations[0]);
    expect(await db.creationIntent.count()).toBe(1);
    if (kind !== "instant") {
      const fresh = await destination(action(form("new-attempt-000000002")));
      expect(fresh).not.toBe(destinations[0]);
      expect(await db.creationIntent.count()).toBe(2);
    }
    if (kind === "session" || kind === "roulette-session") {
      expect(await db.session.count()).toBe(2);
      expect(await db.xpEvent.count({ where: { reason: "CREATE_SESSION" } })).toBe(2);
      expect(await db.sessionInvite.count()).toBe(2);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rollback : aucun reçu ni mutation partielle ; une tentative peut reprendre", async () => {
    const { createOnce } = await import("@/lib/creation-intent");
    const create = async (tx: import("@prisma/client").Prisma.TransactionClient) => tx.user.create({ data: { id: "atomic", discordId: "atomic", discordName: "Atomic" } });
    await expect(createOnce("creator", "TEST", "rollback-00000000001", async (tx) => { await create(tx); throw new Error("interruption"); }, (u: { id: string }) => u.id, (tx, id) => tx.user.findUniqueOrThrow({ where: { id } }))).rejects.toThrow("interruption");
    expect(await db.user.findUnique({ where: { id: "atomic" } })).toBeNull();
    expect(await db.creationIntent.count()).toBe(0);
    const result = await createOnce("creator", "TEST", "rollback-00000000001", create, (u) => u.id, (tx, id) => tx.user.findUniqueOrThrow({ where: { id } }));
    expect(result.replayed).toBe(false);
    await db.user.delete({ where: { id: "atomic" } });
    await expect(createOnce("creator", "TEST", "rollback-00000000001", create, (u) => u.id, (tx, id) => tx.user.findUniqueOrThrow({ where: { id } }))).rejects.toThrow();
    expect(await db.user.findUnique({ where: { id: "atomic" } })).toBeNull();
  });

  it("cache de lecture : contexte isolé, sélection et retrait revalidés au chargement suivant", async () => {
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "true");
    vi.stubEnv("COMMUNITY_PICKER_ENABLED", "true");
    for (const id of ["a", "b"]) {
      await db.community.create({ data: { id, slug: id, name: id, status: "ACTIVE" } });
      await db.membership.create({ data: { communityId: id, userId: "creator" } });
      await db.tournament.create({ data: { id: `t-${id}`, communityId: id, name: id, createdById: "creator", gameId: "game", maxPlayers: 4 } });
    }
    const { withCommunityReadContext } = await import("@/lib/community-read-context");
    const { resolveActiveCommunityId } = await import("@/lib/community-isolation");
    const Page = (await import("@/app/tournois/page")).default;
    for (const selected of ["a", "b", "a"]) {
      await db.user.update({ where: { id: "creator" }, data: { activeCommunityId: selected } });
      await withCommunityReadContext(async () => {
        expect(await Promise.all(Array.from({ length: 6 }, () => resolveActiveCommunityId("creator")))).toEqual(Array(6).fill(selected));
        function links(node: unknown): string[] {
          if (Array.isArray(node)) return node.flatMap(links);
          if (!node || typeof node !== "object" || !("props" in node)) return [];
          const props = node.props as { href?: string; children?: unknown };
          return [...(props.href ? [props.href] : []), ...links(props.children)];
        }
        const rendered = links(await Page({ searchParams: Promise.resolve({ tab: "a-venir" }) })).join(" ");
        expect(rendered).toContain(`/tournois/t-${selected}`);
        expect(rendered).not.toContain(`/tournois/t-${selected === "a" ? "b" : "a"}`);
      });
    }
    await db.membership.updateMany({ where: { userId: "creator" }, data: { status: "REMOVED" } });
    expect(await withCommunityReadContext(() => resolveActiveCommunityId("creator"))).toBeNull();
  });

  it.each(["FAILED", "SKIPPED", "PENDING", "RESERVED"] as const)("édition dépendante d’un SEND %s : termine seulement les impossibles", async (status) => {
    const lib = await import("@/lib/notification-delivery");
    const event = await lib.createNotificationEvent({ category: "INSTANT_SESSION", eventType: "test", sourceId: "missing" });
    const send = await lib.enqueueDelivery({ eventId: event.id, channel: "DISCORD_DM", transport: "BOT", operation: "SEND", recipientKey: "guest", targetSlot: "test-slot" });
    await db.notificationDelivery.update({ where: { id: send.id }, data: { status, nextAttemptAt: new Date(Date.now() + 60_000) } });
    const update = await lib.createNotificationEvent({ category: "INSTANT_SESSION", eventType: "update", sourceId: "missing" });
    const edit = await lib.enqueueDelivery({ eventId: update.id, channel: "DISCORD_DM", transport: "BOT", operation: "EDIT", recipientKey: "guest", targetSlot: "test-slot" });
    expect(await lib.claimNextDelivery("test")).toBeNull();
    const fresh = await db.notificationDelivery.findUniqueOrThrow({ where: { id: edit.id } });
    expect(fresh.status).toBe(status === "FAILED" || status === "SKIPPED" ? "SKIPPED" : "PENDING");
    expect((await db.notificationEvent.findUniqueOrThrow({ where: { id: event.id } })).communityId).toBeNull();
  });

  it("messages bot : modèles actifs, catégories et variables réelles, texte personnel prioritaire", async () => {
    const { sessionMessage } = await import("@/lib/session-message");
    const { wallClockNow } = await import("@/lib/wallclock");
    const now = wallClockNow();
    const date = new Date(now.getTime() + 60 * 60_000);
    const source = { date, createdById: "creator", customReminderMessage: null as string | null };
    for (const [category, text] of [
      ["SESSION_CREATED", "Créé par {createur} le {date} à {heure}"],
      ["SESSION_MODIFIED", "Ancien {ancienne_date} {ancienne_heure}, nouveau {date} {heure}"],
      ["REMINDER_2H", "Proche : {pote}, {jeu} à {heure}"],
      ["REMINDER_24H", "Loin : {pote}, {jeu} à {heure}"],
    ] as const) await db.messageTemplate.create({ data: { text, categories: [category], variables: [], createdById: "creator", modifiedById: "creator" } });
    expect(await sessionMessage(source, "created", { creatorName: "Créateur" })).toContain("Créé par Créateur");
    const changed = await sessionMessage(source, "date", { creatorName: "Créateur", previousDate: new Date(Date.UTC(2026, 9, 1, 18)) });
    expect(changed).toContain("18:00");
    expect(changed).not.toMatch(/\{[a-z_]+\}/);
    expect(await sessionMessage(source, "reminder", { creatorName: "Créateur", recipientName: "Invité", gameName: "Jeu" })).toContain("Proche : Invité, Jeu");
    expect(await sessionMessage({ ...source, date: new Date(now.getTime() + 8 * 60 * 60_000) }, "reminder", { creatorName: "Créateur", gameName: "Jeu" })).toContain("Loin :");
    expect(await sessionMessage({ ...source, customReminderMessage: "Personnel {jeu} {heure}" }, "reminder", { creatorName: "Créateur", gameName: "Jeu" })).toContain("Personnel Jeu");
  });

  it.each(["SESSION", "TOURNAMENT"] as const)("%s : retrait après enqueue exclu des mentions et MP ; journal étranger refusé", async (category) => {
    for (const flag of ["COMMUNITY_ISOLATION_ENABLED", "COMMUNITY_CHANNELS_ENABLED", "DISCORD_BOT_SESSION_ANNOUNCE_ENABLED", "DISCORD_BOT_TOURNAMENT_ANNOUNCE_ENABLED", "DISCORD_DM_SESSION_ENABLED", "DISCORD_DM_TOURNAMENT_ENABLED"]) vi.stubEnv(flag, "true");
    await db.community.create({ data: { id: "server", slug: "server", name: "Serveur", status: "ACTIVE", discordGuildId: "333333333333333333" } });
    await db.communityChannelConfig.create({ data: { communityId: "server", category, discordChannelId: "444444444444444444" } });
    await db.community.create({ data: { id: "other-server", slug: "other-server", name: "Autre", status: "ACTIVE", discordGuildId: "555555555555555555" } });
    await db.communityChannelConfig.create({ data: { communityId: "other-server", category, discordChannelId: "666666666666666666" } });
    await db.membership.createMany({ data: [{ userId: "creator", communityId: "server" }, { userId: "guest", communityId: "server" }] });
    let sourceId: string;
    const sessionLib = await import("@/lib/session-announce");
    const tournamentLib = await import("@/lib/tournament-announce");
    if (category === "SESSION") {
      const session = await db.session.create({ data: { createdById: "creator", communityId: "server", date: new Date(Date.UTC(2026, 11, 1, 20)), announceViaBot: true, notifiedUserIds: ["guest"] } });
      sourceId = session.id;
      await db.sessionInvite.create({ data: { sessionId: sourceId, userId: "guest", invitedById: "creator" } });
      await sessionLib.enqueueSessionCreationDeliveries(sourceId);
    } else {
      const tournament = await db.tournament.create({ data: { createdById: "creator", communityId: "server", gameId: "game", name: "Tournoi", maxPlayers: 4, announceViaBot: true, discordGuildId: "333333333333333333", discordChannelId: "444444444444444444", notifiedUserIds: ["guest"] } });
      sourceId = tournament.id;
      await tournamentLib.enqueueTournamentCreationDeliveries(sourceId);
    }
    const prefix = `default-guild:${category}:${sourceId}:`;
    await db.notificationDelivery.updateMany({ where: { targetSlot: `${prefix}thread` }, data: { status: "SENT", discordMessageId: "thread-message", discordThreadId: "private-thread", discordChannelId: "444444444444444444" } });
    await db.membership.updateMany({ where: { userId: "guest", communityId: "server" }, data: { status: "REMOVED" } });
    const target = await db.notificationDelivery.findFirstOrThrow({ where: { targetSlot: `${prefix}announce` } });
    const deliveryLib = await import("@/lib/notification-delivery");
    const claimed = await deliveryLib.claimNextDelivery("test", { deliveryId: target.id });
    expect(claimed).not.toBeNull();
    const event = await db.notificationEvent.findUniqueOrThrow({ where: { id: target.eventId } });
    const resolver = category === "SESSION" ? sessionLib.sessionAnnounceResolver : tournamentLib.tournamentAnnounceResolver;
    const result = await resolver.resolve({ delivery: claimed!, event, now: new Date() });
    expect(result.eligible).toBe(true);
    expect(JSON.stringify(result)).not.toContain("<@222222222222222222>");
    expect(await db.notificationDelivery.count({ where: { event: { sourceId }, channel: "DISCORD_DM", recipientKey: "user:guest" } })).toBe(0);
    if (category === "TOURNAMENT") {
      expect(await db.notificationDelivery.count({ where: { targetSlot: `${prefix}thread-invite` } })).toBe(0);
      const queued = await deliveryLib.createNotificationEvent({ category: "TOURNAMENT", eventType: "TOURNAMENT_THREAD_INVITE", sourceId, occurrence: "thread-invite" });
      await deliveryLib.enqueueDelivery({ eventId: queued.id, channel: "DISCORD_CHANNEL", transport: "BOT", operation: "SEND", recipientKey: "channel", targetSlot: `${prefix}thread-invite` });
      const invite = await db.notificationDelivery.findFirstOrThrow({ where: { targetSlot: `${prefix}thread-invite` } });
      const pending = await deliveryLib.claimNextDelivery("test", { deliveryId: invite.id });
      const inviteEvent = await db.notificationEvent.findUniqueOrThrow({ where: { id: invite.eventId } });
      const invitation = await resolver.resolve({ delivery: pending!, event: inviteEvent, now: new Date() });
      expect(invitation.eligible).toBe(true);
      expect(JSON.stringify(invitation)).not.toContain("<@222222222222222222>");
    }
    expect(await resolver.resolve({ delivery: claimed!, event: { ...event, communityId: "other-server" }, now: new Date() })).toEqual({ eligible: false, reason: "expired" });
    expect(fetch).not.toHaveBeenCalled();
  });
});
