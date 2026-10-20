import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * S0 — contrôles applicatifs de bout en bout (Postgres local isolé, jamais Neon).
 * Seuls `auth()` (Auth.js/Discord) et l'envoi Discord sont simulés : garde de
 * session, accès aux communautés, actions serveur et Prisma sont réels.
 *
 * 1. Membre ACTIVE de la seule communauté B, isolation ET sélecteur éteints :
 *    aucun accès ni écriture dans la communauté `default` (A).
 * 2. `ADMIN_DISCORD_IDS` sans Membership : accès administratif prévu, mais aucun
 *    accès collectif implicite.
 * 3. Ancien JWT d'un compte désormais non admissible : comportement avant /
 *    après `forceReloginAt`.
 *
 * Suite SKIPPÉE (avec avertissement) sans `TEST_DATABASE_URL`.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const { authMock, discordMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  discordMock: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// Aucune vraie notification Discord, même pour la reconnexion forcée.
vi.mock("@/lib/discord", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/discord")>()),
  postToDiscord: discordMock,
}));
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  if (!TEST_DATABASE_URL) return { prisma: {} as unknown };
  return { prisma: new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) };
});

if (!TEST_DATABASE_URL) {
  console.warn("[s0-access-controls.integration.test] TEST_DATABASE_URL absente — suite SKIPPÉE.");
}

type Db = import("@prisma/client").PrismaClient;

describe.skipIf(!TEST_DATABASE_URL)("S0 — contrôles applicatifs (Postgres isolé)", () => {
  let db: Db;
  const ids = {} as Record<string, string>;

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as unknown as Db;
  });
  afterAll(async () => {
    await db.$disconnect();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "false");
    vi.stubEnv("COMMUNITY_PICKER_ENABLED", "false");
    vi.stubEnv("ADMIN_DISCORD_IDS", "secours-admin");
    discordMock.mockResolvedValue({ ok: true });
    await db.$executeRawUnsafe(
      'TRUNCATE "User", "Community", "Game", "Badge" CASCADE'
    );
    // Ids FIXES : `getDefaultCommunityId` met l'id de `default` en cache pour le processus.
    ids.A = (await db.community.create({
      data: { id: "community-a-default", slug: "default", name: "A", status: "ACTIVE", discordGuildId: "111111111111111111" },
    })).id;
    ids.B = (await db.community.create({
      data: { id: "community-b", slug: "b", name: "B", status: "ACTIVE", discordGuildId: "222222222222222222" },
    })).id;
    // Membre de A (propriétaire des données de A) et membre de B seulement.
    ids.memberA = (await db.user.create({ data: { discordId: "member-a", discordName: "Membre A" } })).id;
    ids.memberB = (await db.user.create({ data: { discordId: "member-b", discordName: "Membre B" } })).id;
    // Compte de secours : admin par ADMIN_DISCORD_IDS, AUCUN Membership.
    ids.admin = (await db.user.create({ data: { discordId: "secours-admin", discordName: "Secours" } })).id;
    await db.membership.create({ data: { communityId: ids.A, userId: ids.memberA, role: "OWNER" } });
    await db.membership.create({ data: { communityId: ids.B, userId: ids.memberB } });

    // Données de A (`communityId` nul = communauté par défaut, comme en production).
    const game = await db.game.create({ data: { name: "Jeu A", source: "MANUAL", addedById: ids.memberA } });
    ids.sessionA = (await db.session.create({
      data: { date: new Date(Date.now() + 86_400_000), createdById: ids.memberA },
    })).id;
    ids.tournamentA = (await db.tournament.create({
      data: { name: "Tournoi A", createdById: ids.memberA, gameId: game.id, maxPlayers: 4 },
    })).id;
    await db.chatMessage.create({ data: { userId: ids.memberA, content: "message de A" } });
    await db.communityMemberStats.create({ data: { communityId: ids.A, userId: ids.memberA, xpTotal: 500 } });
  });

  const asUser = (discordId: string, sessionCreatedAt = Date.now() - 60_000) =>
    authMock.mockResolvedValue({ user: { discordId, sessionCreatedAt } });
  const statsOf = (communityId: string, userId: string) =>
    db.communityMemberStats.findUnique({ where: { communityId_userId: { communityId, userId } } });

  const isolation = (on: boolean) => vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", on ? "true" : "false");
  const chatForm = (content: string, sessionId = "") => {
    const form = new FormData();
    form.set("content", content);
    form.set("sessionId", sessionId);
    return form;
  };
  const NOT_FOUND = /NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/;

  describe("1 — membre de B seulement (isolation et sélecteur éteints)", () => {
    it("tient : aucune soirée privée de A (lecture, chat de soirée), requireMembership(A) = 404", async () => {
      asUser("member-b");
      const { canAccessSession } = await import("@/lib/session-access");
      const { getChatMessagesAction, sendChatMessageAction } = await import("@/app/chat/actions");
      const { requireMembership } = await import("@/lib/community-access");
      expect(await canAccessSession(ids.memberB, ids.sessionA)).toBe(false);
      expect(await getChatMessagesAction(ids.sessionA)).toBeNull();
      expect(await sendChatMessageAction(chatForm("intrusion", ids.sessionA))).toMatchObject({ ok: false });
      expect(await db.chatMessage.count({ where: { sessionId: ids.sessionA } })).toBe(0);
      await expect(requireMembership(ids.A)).rejects.toThrow(NOT_FOUND);
    });

    // ÉCARTS CONNUS : isolation éteinte = « aucun filtre » (CLAUDE.md, COMMUNITY_ISOLATION_ENABLED).
    // Ces assertions DÉCRIVENT le comportement actuel pour qu'un correctif les fasse changer
    // volontairement ; elles ne cautionnent pas l'écart. Corriger = refuser à la connexion tout
    // compte hors communauté par défaut tant que l'isolation est éteinte (décision produit).
    it("ÉCART CONNU : lit le tournoi de A et le canal global de A", async () => {
      asUser("member-b");
      const { canAccessTournament } = await import("@/lib/community-access");
      const { getChatMessagesAction } = await import("@/app/chat/actions");
      expect(await canAccessTournament(ids.memberB, ids.tournamentA)).toBe(true);
      expect(((await getChatMessagesAction(null)) ?? []).map((m) => m.content)).toContain("message de A");
    });

    it("ÉCART CONNU : écrit dans le canal global de A (communityId nul = par défaut)", async () => {
      asUser("member-b");
      const { sendChatMessageAction } = await import("@/app/chat/actions");
      expect(await sendChatMessageAction(chatForm("bonjour depuis B"))).toMatchObject({ ok: true });
      const row = await db.chatMessage.findFirstOrThrow({ where: { userId: ids.memberB } });
      expect(row.communityId).toBeNull();
    });

    it("ÉCART CONNU : la simple visite (getCurrentUser) crée sa ligne de statistiques dans A", async () => {
      asUser("member-b");
      const { getCurrentUser } = await import("@/lib/current-user");
      expect(await getCurrentUser()).not.toBeNull();
      expect(await statsOf(ids.A, ids.memberB)).not.toBeNull();
    });
  });

  describe("1 bis — membre de B seulement, isolation ALLUMÉE (le contrôle qui tient)", () => {
    beforeEach(() => isolation(true));

    it("aucun accès ni écriture dans A", async () => {
      asUser("member-b");
      const { canAccessTournament, requireMembership } = await import("@/lib/community-access");
      const { canAccessSession } = await import("@/lib/session-access");
      const { getChatMessagesAction, sendChatMessageAction } = await import("@/app/chat/actions");
      const { getCurrentUser } = await import("@/lib/current-user");
      expect(await canAccessTournament(ids.memberB, ids.tournamentA)).toBe(false);
      expect(await canAccessSession(ids.memberB, ids.sessionA)).toBe(false);
      await expect(requireMembership(ids.A)).rejects.toThrow(NOT_FOUND);
      expect(((await getChatMessagesAction(null)) ?? []).map((m) => m.content)).not.toContain("message de A");

      expect(await sendChatMessageAction(chatForm("bonjour depuis B"))).toMatchObject({ ok: true });
      expect((await db.chatMessage.findFirstOrThrow({ where: { userId: ids.memberB } })).communityId).toBe(ids.B);

      expect(await getCurrentUser()).not.toBeNull();
      expect(await statsOf(ids.A, ids.memberB)).toBeNull();
      expect(await statsOf(ids.B, ids.memberB)).not.toBeNull();
      expect(await db.chatMessage.count({ where: { communityId: null, userId: ids.memberB } })).toBe(0);
    });
  });

  describe("2 — ADMIN_DISCORD_IDS sans Membership", () => {
    it("accès administratif prévu (requireAdmin), refusé à un membre ordinaire", async () => {
      const { requireAdmin } = await import("@/lib/admin");
      asUser("secours-admin");
      expect((await requireAdmin())?.id).toBe(ids.admin);
      asUser("member-b");
      expect(await requireAdmin()).toBeNull();
    });

    it("retirer l'identifiant de ADMIN_DISCORD_IDS coupe l'accès admin immédiatement (relu à chaque appel, sans reconnexion)", async () => {
      const { requireAdmin } = await import("@/lib/admin");
      asUser("secours-admin");
      expect(await requireAdmin()).not.toBeNull();
      vi.stubEnv("ADMIN_DISCORD_IDS", "quelquun-d-autre");
      expect(await requireAdmin()).toBeNull();
    });

    it("isolation ALLUMÉE : aucun accès collectif implicite (A comme B), aucune écriture", async () => {
      isolation(true);
      asUser("secours-admin");
      const { requireAdmin } = await import("@/lib/admin");
      const { canAccessTournament, requireMembership } = await import("@/lib/community-access");
      const { canAccessSession } = await import("@/lib/session-access");
      const { getIsolationScope } = await import("@/lib/community-isolation");
      const { getChatMessagesAction, sendChatMessageAction } = await import("@/app/chat/actions");
      const { getCurrentUser } = await import("@/lib/current-user");
      expect(await requireAdmin()).not.toBeNull();
      expect(await getIsolationScope(ids.admin)).toEqual({ communityIds: [], includesDefault: false });
      expect(await canAccessTournament(ids.admin, ids.tournamentA)).toBe(false);
      expect(await canAccessSession(ids.admin, ids.sessionA)).toBe(false);
      await expect(requireMembership(ids.A)).rejects.toThrow(NOT_FOUND);
      await expect(requireMembership(ids.B)).rejects.toThrow(NOT_FOUND);
      expect(await getChatMessagesAction(null)).toEqual([]);
      expect(await sendChatMessageAction(chatForm("depuis le compte de secours"))).toMatchObject({ ok: false });
      expect(await db.chatMessage.count({ where: { userId: ids.admin } })).toBe(0);
      expect(await getCurrentUser()).not.toBeNull();
      expect(await db.communityMemberStats.count({ where: { userId: ids.admin } })).toBe(0);
      expect(await db.membership.count({ where: { userId: ids.admin } })).toBe(0);
    });

    it("isolation ÉTEINTE : ÉCART CONNU — pas de filtre collectif, la visite crée sa ligne de statistiques dans A", async () => {
      asUser("secours-admin");
      const { canAccessTournament, requireMembership } = await import("@/lib/community-access");
      const { canAccessSession } = await import("@/lib/session-access");
      const { getCurrentUser } = await import("@/lib/current-user");
      expect(await canAccessSession(ids.admin, ids.sessionA)).toBe(false); // soirée privée : jamais d'accès admin
      await expect(requireMembership(ids.A)).rejects.toThrow(NOT_FOUND); // explicite : toujours 404
      expect(await canAccessTournament(ids.admin, ids.tournamentA)).toBe(true);
      expect(await getCurrentUser()).not.toBeNull();
      expect(await statsOf(ids.A, ids.admin)).not.toBeNull();
    });
  });

  describe("3 — ancien JWT d'un compte désormais non admissible", () => {
    // Compte dont l'appartenance est perdue (serveur quitté → LEFT) : une reconnexion neuve est
    // refusée (voir community-oauth.integration.test.ts, scénario iii), mais le JWT émis avant
    // vit jusqu'à 30 jours. Le JWT ne porte aucune appartenance : tout est relu en base.
    beforeEach(async () => {
      await db.membership.updateMany({ where: { userId: ids.memberB }, data: { status: "LEFT", leftAt: new Date() } });
    });

    it("AVANT forceReloginAt : session valide ; isolation allumée = plus aucun accès collectif", async () => {
      isolation(true);
      asUser("member-b");
      const { getCurrentUser } = await import("@/lib/current-user");
      const { getValidSession } = await import("@/lib/valid-session");
      const { requireAdmin } = await import("@/lib/admin");
      const { canAccessTournament } = await import("@/lib/community-access");
      const { getChatMessagesAction, sendChatMessageAction } = await import("@/app/chat/actions");
      expect(await getValidSession()).not.toBeNull(); // le JWT reste accepté
      expect(await getCurrentUser()).not.toBeNull();
      expect(await requireAdmin()).toBeNull();
      expect(await canAccessTournament(ids.memberB, ids.tournamentA)).toBe(false);
      expect(await getChatMessagesAction(null)).toEqual([]);
      expect(await sendChatMessageAction(chatForm("fantôme"))).toMatchObject({ ok: false });
      expect(await db.communityMemberStats.count({ where: { userId: ids.memberB } })).toBe(0);
    });

    it("AVANT forceReloginAt, isolation éteinte : ÉCART CONNU — l'ancien JWT garde l'accès au canal global", async () => {
      asUser("member-b");
      const { getChatMessagesAction } = await import("@/app/chat/actions");
      expect(((await getChatMessagesAction(null)) ?? []).map((m) => m.content)).toContain("message de A");
    });

    it.each([true, false])("APRÈS forceReloginAt (triggerGlobalRelogin), isolation=%s : l'ancien JWT est refusé partout", async (on) => {
      isolation(on);
      const sessionCreatedAt = Date.now() - 60_000;
      asUser("member-b", sessionCreatedAt);
      const { triggerGlobalRelogin } = await import("@/lib/force-relogin");
      const { getCurrentUser } = await import("@/lib/current-user");
      const { getValidSession } = await import("@/lib/valid-session");
      const { requireAdmin } = await import("@/lib/admin");
      const { getChatMessagesAction, sendChatMessageAction } = await import("@/app/chat/actions");

      await triggerGlobalRelogin(); // Discord simulé : aucune vraie notification
      expect(discordMock).toHaveBeenCalledOnce();

      expect(await getValidSession()).toBeNull();
      expect(await getCurrentUser()).toBeNull();
      expect(await requireAdmin()).toBeNull();
      expect(await getChatMessagesAction(null)).toBeNull();
      expect(await sendChatMessageAction(chatForm("fantôme"))).toMatchObject({ ok: false });
      expect(await db.chatMessage.count({ where: { userId: ids.memberB } })).toBe(0);
      expect(await db.communityMemberStats.count({ where: { userId: ids.memberB } })).toBe(0);
    });

    it("l'admin de secours est aussi déconnecté par forceReloginAt (le filet ne contourne pas la reconnexion forcée)", async () => {
      asUser("secours-admin");
      const { triggerGlobalRelogin } = await import("@/lib/force-relogin");
      const { requireAdmin } = await import("@/lib/admin");
      expect(await requireAdmin()).not.toBeNull();
      await triggerGlobalRelogin();
      expect(await requireAdmin()).toBeNull();
    });

    it("contre-épreuve : une session émise APRÈS forceReloginAt est valide — elle ne s'obtient que par une connexion OAuth, refusée à ce compte", async () => {
      asUser("member-b");
      const { triggerGlobalRelogin } = await import("@/lib/force-relogin");
      const { getCurrentUser } = await import("@/lib/current-user");
      await triggerGlobalRelogin();
      expect(await getCurrentUser()).toBeNull();
      asUser("member-b", Date.now() + 1_000); // simule un JWT neuf (impossible à obtenir : signIn refuse)
      expect(await getCurrentUser()).not.toBeNull();
    });
  });
});
