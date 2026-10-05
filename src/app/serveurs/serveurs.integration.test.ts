import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * Multi-communautés, PR5 — page `/serveurs` et action `selectCommunityAction`.
 * 0 serveur = message, 1 serveur = redirection, plusieurs = choix. Drapeau
 * éteint = 404 (la page n'existe pas). Postgres réel requis.
 *
 * Nécessite `TEST_DATABASE_URL` — suite SKIPPÉE si absente.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const { currentUserMock, NOT_FOUND } = vi.hoisted(() => ({
  currentUserMock: vi.fn(),
  NOT_FOUND: "NEXT_HTTP_ERROR_FALLBACK;404",
}));

vi.mock("@/lib/current-user", () => ({ getCurrentUser: currentUserMock }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error(NOT_FOUND);
  },
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  if (!TEST_DATABASE_URL) {
    return { prisma: {} as unknown };
  }
  return { prisma: new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) };
});

if (!TEST_DATABASE_URL) {
  console.warn(
    "[serveurs.integration.test] TEST_DATABASE_URL absente — suite SKIPPÉE. " +
      "La page /serveurs N'EST PAS validée par cette exécution."
  );
}

describe.skipIf(!TEST_DATABASE_URL)("/serveurs (Postgres isolée)", () => {
  let db: import("@prisma/client").PrismaClient;
  let Page: typeof import("./page").default;
  let actions: typeof import("./actions");

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as unknown as typeof db;
    Page = (await import("./page")).default;
    actions = await import("./actions");
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv("COMMUNITY_PICKER_ENABLED", "true");
    await db.$executeRawUnsafe(`TRUNCATE "Membership", "CommunityChannelConfig", "Community", "User" CASCADE`);
  });

  let n = 0;
  async function newUser() {
    n += 1;
    return db.user.create({ data: { discordId: `u${n}`, discordName: `u${n}` } });
  }
  async function newCommunity(name: string, status: "ACTIVE" | "SUSPENDED" = "ACTIVE") {
    n += 1;
    return db.community.create({ data: { slug: `c${n}`, name, status } });
  }
  async function join(userId: string, communityId: string, status: "ACTIVE" | "LEFT" = "ACTIVE") {
    await db.membership.create({ data: { userId, communityId, status } });
  }
  async function stored(userId: string) {
    const rows = await db.$queryRawUnsafe<Array<{ activeCommunityId: string | null }>>(
      `SELECT "activeCommunityId" FROM "User" WHERE id = $1`,
      userId
    );
    return rows[0].activeCommunityId;
  }
  async function render(searchParams: { next?: string } = {}) {
    const element = await Page({ searchParams: Promise.resolve(searchParams) });
    return renderToStaticMarkup(createElement(() => element));
  }
  function form(data: Record<string, string>) {
    const f = new FormData();
    for (const [k, v] of Object.entries(data)) f.set(k, v);
    return f;
  }

  describe("page", () => {
    it("drapeau éteint → 404", async () => {
      vi.stubEnv("COMMUNITY_PICKER_ENABLED", "");
      currentUserMock.mockResolvedValue(await newUser());
      await expect(render()).rejects.toThrow(NOT_FOUND);
    });

    it("non connecté → redirige vers l'accueil", async () => {
      currentUserMock.mockResolvedValue(null);
      await expect(render()).rejects.toThrow("REDIRECT:/");
    });

    it("0 serveur → message explicite, aucune redirection", async () => {
      currentUserMock.mockResolvedValue(await newUser());
      const html = await render();
      expect(html).toContain("Le bot n&#x27;est sur aucun de tes serveurs");
    });

    it("0 serveur actif (membre parti, serveur suspendu) → même message", async () => {
      const user = await newUser();
      await join(user.id, (await newCommunity("Parti")).id, "LEFT");
      await join(user.id, (await newCommunity("Suspendu", "SUSPENDED")).id);
      currentUserMock.mockResolvedValue(user);
      expect(await render()).toContain("Le bot n&#x27;est sur aucun de tes serveurs");
    });

    it("1 serveur → redirige vers l'accueil", async () => {
      const user = await newUser();
      await join(user.id, (await newCommunity("Unique")).id);
      currentUserMock.mockResolvedValue(user);
      await expect(render()).rejects.toThrow("REDIRECT:/");
    });

    it("1 serveur → redirige vers `next` quand il est interne", async () => {
      const user = await newUser();
      await join(user.id, (await newCommunity("Unique")).id);
      currentUserMock.mockResolvedValue(user);
      await expect(render({ next: "/classement" })).rejects.toThrow("REDIRECT:/classement");
    });

    it("1 serveur → `next` externe ignoré (pas de redirection ouverte)", async () => {
      const user = await newUser();
      await join(user.id, (await newCommunity("Unique")).id);
      currentUserMock.mockResolvedValue(user);
      await expect(render({ next: "https://evil.example" })).rejects.toThrow("REDIRECT:/");
      await expect(render({ next: "//evil.example" })).rejects.toThrow("REDIRECT:/");
    });

    it("plusieurs serveurs → liste de choix avec le serveur actuel signalé", async () => {
      const user = await newUser();
      const a = await newCommunity("Les Potes du Jeudi");
      const b = await newCommunity("Team LAN");
      await join(user.id, a.id);
      await join(user.id, b.id);
      await db.$executeRawUnsafe(`UPDATE "User" SET "activeCommunityId" = $1 WHERE id = $2`, b.id, user.id);
      currentUserMock.mockResolvedValue(user);
      const html = await render();
      expect(html).toContain("Les Potes du Jeudi");
      expect(html).toContain("Team LAN");
      expect(html).toContain("Serveur actuel");
      expect(html).not.toContain("aucun de tes serveurs");
    });

    it("n'affiche jamais un serveur dont l'utilisateur n'est pas membre actif", async () => {
      const user = await newUser();
      const a = await newCommunity("Visible A");
      const b = await newCommunity("Visible B");
      const foreign = await newCommunity("Serveur Étranger");
      const left = await newCommunity("Serveur Quitté");
      await join(user.id, a.id);
      await join(user.id, b.id);
      await join(user.id, left.id, "LEFT");
      void foreign;
      currentUserMock.mockResolvedValue(user);
      const html = await render();
      expect(html).not.toContain("Serveur Étranger");
      expect(html).not.toContain("Serveur Quitté");
    });
  });

  describe("selectCommunityAction", () => {
    it("enregistre le choix et redirige vers `next`", async () => {
      const user = await newUser();
      const a = await newCommunity("A");
      const b = await newCommunity("B");
      await join(user.id, a.id);
      await join(user.id, b.id);
      currentUserMock.mockResolvedValue(user);
      await expect(actions.selectCommunityAction(form({ communityId: b.id, next: "/sessions" }))).rejects.toThrow(
        "REDIRECT:/sessions"
      );
      expect(await stored(user.id)).toBe(b.id);
    });

    it("serveur dont on n'est pas membre → rien d'écrit, retour sur /serveurs", async () => {
      const user = await newUser();
      const mine = await newCommunity("Mine");
      const foreign = await newCommunity("Étranger");
      await join(user.id, mine.id);
      currentUserMock.mockResolvedValue(user);
      await expect(actions.selectCommunityAction(form({ communityId: foreign.id }))).rejects.toThrow(
        "REDIRECT:/serveurs"
      );
      expect(await stored(user.id)).toBeNull();
    });

    it("`next` externe ignoré après un choix valide", async () => {
      const user = await newUser();
      const a = await newCommunity("A");
      const b = await newCommunity("B");
      await join(user.id, a.id);
      await join(user.id, b.id);
      currentUserMock.mockResolvedValue(user);
      await expect(
        actions.selectCommunityAction(form({ communityId: a.id, next: "https://evil.example" }))
      ).rejects.toThrow("REDIRECT:/");
    });

    it("communityId absent ou non textuel → rien d'écrit", async () => {
      const user = await newUser();
      await join(user.id, (await newCommunity("A")).id);
      currentUserMock.mockResolvedValue(user);
      await expect(actions.selectCommunityAction(new FormData())).rejects.toThrow("REDIRECT:/serveurs");
      expect(await stored(user.id)).toBeNull();
    });

    it("drapeau éteint → 404, rien d'écrit", async () => {
      vi.stubEnv("COMMUNITY_PICKER_ENABLED", "");
      const user = await newUser();
      const a = await newCommunity("A");
      await join(user.id, a.id);
      currentUserMock.mockResolvedValue(user);
      await expect(actions.selectCommunityAction(form({ communityId: a.id }))).rejects.toThrow(NOT_FOUND);
      expect(await stored(user.id)).toBeNull();
    });

    it("non connecté → redirige vers l'accueil, rien d'écrit", async () => {
      const a = await newCommunity("A");
      currentUserMock.mockResolvedValue(null);
      await expect(actions.selectCommunityAction(form({ communityId: a.id }))).rejects.toThrow("REDIRECT:/");
    });
  });
});
