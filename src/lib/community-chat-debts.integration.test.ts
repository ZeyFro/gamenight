import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Multi-communautés, PR8 — chat, dettes et flux d'activité de l'accueil, sur un
 * Postgres réel. Deux communautés (c1, c2) + `default` ; isolation allumée sauf
 * mention contraire. Nécessite `TEST_DATABASE_URL` — suite SKIPPÉE si absente.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const { currentUserMock } = vi.hoisted(() => ({ currentUserMock: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: currentUserMock }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: () => true, RATE_LIMIT_ERROR_KEY: "rate_limited" }));
vi.mock("@/lib/session-access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/session-access")>()),
  canAccessSession: async () => true,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  if (!TEST_DATABASE_URL) return { prisma: {} as unknown };
  return { prisma: new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) };
});

if (!TEST_DATABASE_URL) {
  console.warn(
    "[community-chat-debts.integration.test] TEST_DATABASE_URL absente — suite SKIPPÉE. " +
      "L'isolation du chat et des dettes N'EST PAS validée par cette exécution."
  );
}

describe.skipIf(!TEST_DATABASE_URL)("chat et dettes par communauté (Postgres isolée)", () => {
  let db: import("@prisma/client").PrismaClient;
  let chat: typeof import("./chat");
  let chatActions: typeof import("@/app/chat/actions");
  let debts: typeof import("./debts");
  let debtActions: typeof import("@/app/dettes/actions");
  let home: typeof import("./home");

  const ids: Record<string, string> = {};

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as unknown as typeof db;
    chat = await import("./chat");
    chatActions = await import("@/app/chat/actions");
    debts = await import("./debts");
    debtActions = await import("@/app/dettes/actions");
    home = await import("./home");
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  beforeEach(async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "true");
    const defaults = await import("./default-community");
    defaults.resetDefaultCommunityIdCache();
    await db.$executeRawUnsafe(
      `TRUNCATE "ChatReaction", "ChatMessage", "Debt", "Notification", "UserBadge", "Badge", "LevelUpEvent", "Session", "Membership", "Community", "User" CASCADE`
    );
    const community = async (slug: string) =>
      (await db.community.create({ data: { slug, name: slug, status: "ACTIVE" } })).id;
    ids.def = await community("default");
    ids.c1 = await community("c1");
    ids.c2 = await community("c2");
    const user = async (name: string) => (await db.user.create({ data: { discordId: name, discordName: name } })).id;
    ids.alice = await user("alice"); // c1
    ids.bob = await user("bob"); // c2
    ids.carol = await user("carol"); // c1 + c2
    ids.zed = await user("zed"); // aucune
    // joinedAt explicite : la communauté active de carol (règle provisoire = la plus ancienne) est c1.
    for (const [i, [u, c]] of [["alice", "c1"], ["bob", "c2"], ["carol", "c1"], ["carol", "c2"]].entries()) {
      await db.membership.create({
        data: { userId: ids[u], communityId: ids[c], status: "ACTIVE", joinedAt: new Date(Date.UTC(2026, 0, i + 1)) },
      });
    }
    const session = async (key: string, createdBy: string, communityId: string | null) => {
      ids[key] = (await db.session.create({ data: { date: new Date(), createdById: ids[createdBy], communityId } })).id;
    };
    await session("s1", "alice", ids.c1);
    await session("s2", "bob", ids.c2);
  });

  const asUser = (name: string) => currentUserMock.mockResolvedValue({ id: ids[name] });
  const send = async (content: string, sessionId = "") => {
    const form = new FormData();
    form.set("content", content);
    form.set("sessionId", sessionId);
    return chatActions.sendChatMessageAction(form);
  };
  const texts = async (sessionId: string | null, viewer: string) =>
    (await chat.getChatMessages(sessionId, ids[viewer])).map((m) => m.content);

  describe("chat", () => {
    it("canal global : chaque message est rattaché à la communauté active et reste dans son serveur", async () => {
      asUser("alice");
      expect(await send("salut c1")).toEqual({ ok: true });
      asUser("bob");
      expect(await send("salut c2")).toEqual({ ok: true });

      expect(await texts(null, "alice")).toEqual(["salut c1"]);
      expect(await texts(null, "bob")).toEqual(["salut c2"]);
      const rows = await db.chatMessage.findMany({ orderBy: { createdAt: "asc" } });
      expect(rows.map((r) => r.communityId)).toEqual([ids.c1, ids.c2]);
    });

    it("sans aucune communauté : envoi refusé, canal vide", async () => {
      asUser("zed");
      expect(await send("seul")).toEqual({ ok: false });
      expect(await texts(null, "zed")).toEqual([]);
      expect(await db.chatMessage.count()).toBe(0);
    });

    it("canal de soirée : le message hérite de la communauté de la soirée, même si l'utilisateur a deux serveurs", async () => {
      asUser("carol");
      expect(await send("dans s2", ids.s2)).toEqual({ ok: true });
      expect((await db.chatMessage.findFirstOrThrow()).communityId).toBe(ids.c2);
      expect(await texts(ids.s2, "carol")).toEqual(["dans s2"]);
      // Un membre de l'autre communauté ne lit pas ce canal, même en connaissant l'identifiant.
      expect(await texts(ids.s2, "alice")).toEqual([]);
    });

    it("soirée d'une autre communauté : envoi refusé (soirée introuvable dans le périmètre)", async () => {
      asUser("alice");
      expect(await send("intrus", ids.s2)).toEqual({ ok: false });
      expect(await db.chatMessage.count()).toBe(0);
    });

    it("réaction : sur un message d'une autre communauté, rien n'est enregistré", async () => {
      asUser("bob");
      await send("privé c2");
      const message = await db.chatMessage.findFirstOrThrow();
      asUser("alice");
      const form = new FormData();
      form.set("messageId", message.id);
      form.set("emoji", "👍");
      await chatActions.toggleReactionAction(form);
      expect(await db.chatReaction.count()).toBe(0);
      asUser("bob");
      await chatActions.toggleReactionAction(form);
      expect(await db.chatReaction.count()).toBe(1);
    });

    it("isolation éteinte : comportement historique (tout visible, communityId laissé à null)", async () => {
      vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "");
      asUser("zed");
      expect(await send("libre")).toEqual({ ok: true });
      expect((await db.chatMessage.findFirstOrThrow()).communityId).toBeNull();
      expect(await texts(null, "alice")).toEqual(["libre"]);
    });
  });

  describe("dettes", () => {
    it("detectDebts : la dette hérite de la communauté de la soirée", async () => {
      await debts.detectDebts(ids.s2, [ids.bob], "Mario Kart", new Date(), ids.c2);
      expect((await db.debt.findFirstOrThrow()).communityId).toBe(ids.c2);
    });

    it("detectDebts : soirée historique (communityId null) → dette à null", async () => {
      await db.membership.create({ data: { userId: ids.alice, communityId: ids.def, status: "ACTIVE" } });
      await debts.detectDebts(ids.s1, [ids.alice], "Mario Kart", new Date(), null);
      expect((await db.debt.findFirstOrThrow()).communityId).toBeNull();
    });

    it("détection isolation éteinte : communityId laissé à null", async () => {
      vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "");
      await debts.detectDebts(ids.s2, [ids.bob], "Mario Kart", new Date(), ids.c2);
      expect((await db.debt.findFirstOrThrow()).communityId).toBeNull();
    });

    it("accueil : seules les dettes de la communauté active ; le badge 💀 suit les communautés de l'utilisateur", async () => {
      await debts.detectDebts(ids.s1, [ids.alice], "Jeu A", new Date(), ids.c1);
      await debts.detectDebts(ids.s2, [ids.bob], "Jeu B", new Date(), ids.c2);
      const forAlice = await debts.getActiveDebts(ids.alice);
      expect(forAlice.map((d) => d.debtorId)).toEqual([ids.alice]);
      expect((await debts.getActiveDebts(ids.bob)).map((d) => d.debtorId)).toEqual([ids.bob]);
      expect(await debts.getActiveDebts(ids.zed)).toEqual([]);
      // carol est dans c1 et c2 : l'accueil ne montre que la communauté active (c1), pas l'autre.
      expect((await debts.getActiveDebts(ids.carol)).map((d) => d.debtorId)).toEqual([ids.alice]);
      expect([...(await debts.getActiveDebtorIds(ids.alice))]).toEqual([ids.alice]);
      expect([...(await debts.getActiveDebtorIds(ids.carol))].sort()).toEqual([ids.alice, ids.bob].sort());
      expect((await debts.getActiveDebtorIds(ids.zed)).size).toBe(0);
    });

    it("gage et paiement : le créateur d'une soirée d'une autre communauté n'agit pas sur sa dette", async () => {
      await debts.detectDebts(ids.s2, [ids.carol], "Jeu B", new Date(), ids.c2);
      const debt = await db.debt.findFirstOrThrow();
      // alice a créé s1 (c1) mais ne voit pas la dette de s2 : même en forgeant l'identifiant, rien ne change.
      await db.session.update({ where: { id: ids.s2 }, data: { createdById: ids.alice } });
      asUser("alice");
      const form = new FormData();
      form.set("debtId", debt.id);
      form.set("gage", "piraté");
      await debtActions.setDebtGageAction(form);
      await debtActions.markDebtPaidAction(form);
      const after = await db.debt.findUniqueOrThrow({ where: { id: debt.id } });
      expect(after.gage).toBeNull();
      expect(after.paidAt).toBeNull();
    });

    it("gage et paiement : fonctionnent pour le créateur dans sa communauté", async () => {
      await debts.detectDebts(ids.s1, [ids.carol], "Jeu A", new Date(), ids.c1);
      const debt = await db.debt.findFirstOrThrow();
      asUser("alice");
      const form = new FormData();
      form.set("debtId", debt.id);
      form.set("gage", "une tournée");
      await debtActions.setDebtGageAction(form);
      await debtActions.markDebtPaidAction(form);
      const after = await db.debt.findUniqueOrThrow({ where: { id: debt.id } });
      expect(after.gage).toBe("une tournée");
      expect(after.paidAt).not.toBeNull();
    });
  });

  describe("flux d'activité de l'accueil", () => {
    it("badges, niveaux : seulement ceux du serveur actif, même pour un membre commun", async () => {
      const badge = await db.badge.create({
        data: { name: "Premier", description: "d", icon: "🏅", category: "PARTICIPATION", rarity: "COMMON", criteria: {}, modifiedById: ids.alice },
      });
      for (const u of ["alice", "bob"]) {
        const communityId = u === "alice" ? ids.c1 : ids.c2;
        await db.userBadge.create({ data: { communityId, userId: ids[u], badgeId: badge.id } });
        await db.levelUpEvent.create({ data: { communityId, userId: ids[u], level: 2 } });
      }
      await db.levelUpEvent.create({ data: { communityId: ids.c2, userId: ids.carol, level: 99 } });
      const feed = async (viewer: string) => (await home.getRecentActivity(ids[viewer], 10)).map((i) => i.text).join("|");
      expect(await feed("alice")).toContain("alice");
      expect(await feed("alice")).not.toContain("bob");
      expect(await feed("bob")).not.toContain("alice");
      expect(await feed("carol")).toContain("alice");
      expect(await feed("carol")).not.toContain("bob");
      expect(await feed("carol")).not.toContain("99");
      vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "");
      expect(await feed("alice")).not.toContain("bob");
      expect(await feed("alice")).not.toContain("99");
    });
  });
});
