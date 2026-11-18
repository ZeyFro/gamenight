import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  user: vi.fn(),
  rate: vi.fn(),
  community: vi.fn(),
  memberWhere: vi.fn(),
  upsertGame: vi.fn(),
  findOwner: vi.fn(),
  voteUpsert: vi.fn(),
  wlCreate: vi.fn(),
  wlFind: vi.fn(),
  wlUpdateMany: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: m.user }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: m.rate, RATE_LIMIT_ERROR_KEY: "rate_limited" }));
vi.mock("@/lib/community-stats", () => ({ writeCommunityIdForUser: m.community }));
vi.mock("@/lib/community-isolation", () => ({ communityMemberUserWhere: m.memberWhere }));
vi.mock("@/lib/wallclock", () => ({ wallClockNow: () => new Date("2026-01-01T00:00:00Z") }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    game: { upsert: m.upsertGame },
    userGame: { findFirst: m.findOwner },
    gameWishlistVote: { upsert: m.voteUpsert },
  },
}));
vi.mock("@/lib/community-scoped-client", () => ({
  getActiveScopedPrisma: async () => ({
    gameWishlist: { create: m.wlCreate, findUnique: m.wlFind, updateMany: m.wlUpdateMany },
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidate }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Error(`REDIRECT:${url}`);
  },
}));

import { proposeWishlistGameAction, saveWishlistPurchasePlanAction, voteWishlistAction } from "./actions";

function fd(entries: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}
const propose = (over: Record<string, string> = {}) =>
  fd({ igdbId: "42", name: " Hades ", coverUrl: "", reason: "", ...over });
const plan = (over: Record<string, string> = {}) =>
  fd({ wishlistId: "w1", targetDate: "2999-01-01", note: " ensemble ", ...over });

beforeEach(() => {
  vi.resetAllMocks();
  m.user.mockResolvedValue({ id: "me" });
  m.rate.mockReturnValue(true);
  m.community.mockResolvedValue("c1");
  m.memberWhere.mockResolvedValue({ memberships: "scope" });
  m.upsertGame.mockResolvedValue({ id: "g1" });
  m.findOwner.mockResolvedValue(null);
  m.wlCreate.mockResolvedValue({});
  m.wlFind.mockResolvedValue({
    id: "w1",
    proposedById: "me",
    purchasedById: null,
    community: { groupPurchasePlansEnabled: true },
  });
  m.wlUpdateMany.mockResolvedValue({ count: 1 });
  m.voteUpsert.mockResolvedValue({});
});

describe("proposeWishlistGameAction", () => {
  it("redirige sans connexion, au rate limit et sur entrée invalide, sans écriture", async () => {
    m.user.mockResolvedValue(null);
    await expect(proposeWishlistGameAction(propose())).rejects.toThrow("REDIRECT:/");
    m.user.mockResolvedValue({ id: "me" });
    m.rate.mockReturnValue(false);
    await expect(proposeWishlistGameAction(propose())).rejects.toThrow("REDIRECT:/wishlist?error=");
    m.rate.mockReturnValue(true);
    const invalidInputs: Record<string, string>[] = [{ igdbId: "abc" }, { name: "  " }, { coverUrl: "javascript:x" }, { reason: "x".repeat(201) }];
    for (const bad of invalidInputs) {
      await expect(proposeWishlistGameAction(propose(bad))).rejects.toThrow("REDIRECT:/wishlist?error=");
    }
    expect(m.upsertGame).not.toHaveBeenCalled();
    expect(m.wlCreate).not.toHaveBeenCalled();
  });

  it("refuse sans communauté active", async () => {
    m.community.mockResolvedValue(null);
    await expect(proposeWishlistGameAction(propose())).rejects.toThrow("REDIRECT:/wishlist?error=");
    expect(m.upsertGame).not.toHaveBeenCalled();
    expect(m.wlCreate).not.toHaveBeenCalled();
  });

  it("crée l'entrée non achetée dans la communauté active", async () => {
    await expect(proposeWishlistGameAction(propose({ reason: "à tester" }))).rejects.toThrow("REDIRECT:/wishlist");
    expect(m.upsertGame).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { igdbId: 42 },
        update: {},
        create: expect.objectContaining({ name: "Hades", coverUrl: null, igdbId: 42, addedById: "me" }),
      }),
    );
    expect(m.wlCreate).toHaveBeenCalledWith({
      data: { communityId: "c1", gameId: "g1", proposedById: "me", reason: "à tester", purchasedById: null, purchasedAt: null },
    });
    expect(m.revalidate).toHaveBeenCalledWith("/wishlist");
  });

  it("marque d'emblée acheté si un membre de la communauté possède déjà le jeu", async () => {
    m.findOwner.mockResolvedValue({ userId: "owner" });
    await expect(proposeWishlistGameAction(propose())).rejects.toThrow("REDIRECT:/wishlist");
    expect(m.findOwner).toHaveBeenCalledWith(
      expect.objectContaining({ where: { gameId: "g1", owned: true, user: { memberships: "scope" } } }),
    );
    expect(m.wlCreate.mock.calls[0][0].data).toMatchObject({
      purchasedById: "owner",
      purchasedAt: new Date("2026-01-01T00:00:00Z"),
    });
  });

  it("ignore un doublon (contrainte unique) et redirige vers la liste", async () => {
    m.wlCreate.mockRejectedValue(Error("P2002"));
    await expect(proposeWishlistGameAction(propose())).rejects.toThrow("REDIRECT:/wishlist");
    expect(m.revalidate).toHaveBeenCalledWith("/wishlist");
  });
});

describe("voteWishlistAction", () => {
  const vote = (over: Record<string, string> = {}) => fd({ wishlistId: "w1", interested: "true", ...over });

  it("redirige sans connexion et refuse au rate limit sans écrire", async () => {
    m.user.mockResolvedValue(null);
    await expect(voteWishlistAction(vote())).rejects.toThrow("REDIRECT:/");
    m.user.mockResolvedValue({ id: "me" });
    m.rate.mockReturnValue(false);
    expect(await voteWishlistAction(vote())).toEqual({ ok: false, error: "rate_limited" });
    expect(m.voteUpsert).not.toHaveBeenCalled();
  });

  it("n'écrit rien pour une entrée invalide ou hors communauté (find scopé vide)", async () => {
    expect(await voteWishlistAction(vote({ interested: "maybe" }))).toEqual({ ok: true });
    expect(await voteWishlistAction(vote({ wishlistId: "" }))).toEqual({ ok: true });
    m.wlFind.mockResolvedValue(null);
    expect(await voteWishlistAction(vote())).toEqual({ ok: true });
    expect(m.voteUpsert).not.toHaveBeenCalled();
    expect(m.revalidate).not.toHaveBeenCalled();
  });

  it("enregistre intéressé / pas pour moi par upsert sur (entrée, utilisateur)", async () => {
    expect(await voteWishlistAction(vote())).toEqual({ ok: true });
    expect(m.voteUpsert).toHaveBeenLastCalledWith({
      where: { wishlistId_userId: { wishlistId: "w1", userId: "me" } },
      create: { wishlistId: "w1", userId: "me", interested: true },
      update: { interested: true },
    });
    await voteWishlistAction(vote({ interested: "false" }));
    expect(m.voteUpsert.mock.calls[1][0]).toMatchObject({ create: { interested: false }, update: { interested: false } });
    expect(m.revalidate).toHaveBeenCalledWith("/wishlist");
  });
});

describe("saveWishlistPurchasePlanAction", () => {
  const run = (f = plan()) => saveWishlistPurchasePlanAction(f);
  const row = (over: object = {}) => ({
    id: "w1",
    proposedById: "me",
    purchasedById: null,
    community: { groupPurchasePlansEnabled: true },
    ...over,
  });

  it("redirige selon connexion, rate limit et saisie invalide, sans écriture", async () => {
    m.user.mockResolvedValue(null);
    await expect(run()).rejects.toThrow("REDIRECT:/");
    m.user.mockResolvedValue({ id: "me" });
    m.rate.mockReturnValue(false);
    await expect(run()).rejects.toThrow("REDIRECT:/wishlist?plan=rate_limited");
    m.rate.mockReturnValue(true);
    const invalidInputs: Record<string, string>[] = [{ wishlistId: "" }, { targetDate: "2000-01-01" }, { targetDate: "2999-02-30" }, { note: "x".repeat(301) }];
    for (const bad of invalidInputs) {
      await expect(run(plan(bad))).rejects.toThrow("REDIRECT:/wishlist?plan=invalid");
    }
    expect(m.wlUpdateMany).not.toHaveBeenCalled();
  });

  it("refuse si l'entrée est introuvable, achetée ou si le réglage est OFF", async () => {
    m.wlFind.mockResolvedValue(null);
    await expect(run()).rejects.toThrow("REDIRECT:/wishlist?plan=unavailable");
    m.wlFind.mockResolvedValue(row({ purchasedById: "x" }));
    await expect(run()).rejects.toThrow("REDIRECT:/wishlist?plan=unavailable");
    m.wlFind.mockResolvedValue(row({ community: { groupPurchasePlansEnabled: false } }));
    await expect(run()).rejects.toThrow("REDIRECT:/wishlist?plan=unavailable");
    expect(m.wlUpdateMany).not.toHaveBeenCalled();
  });

  it("refuse à quelqu'un d'autre que le proposeur", async () => {
    m.wlFind.mockResolvedValue(row({ proposedById: "other" }));
    await expect(run()).rejects.toThrow("REDIRECT:/wishlist?plan=forbidden");
    expect(m.wlUpdateMany).not.toHaveBeenCalled();
  });

  it("enregistre date et note avec garde atomique, puis redirige saved", async () => {
    await expect(run()).rejects.toThrow("REDIRECT:/wishlist?plan=saved");
    expect(m.wlUpdateMany).toHaveBeenCalledWith({
      where: { id: "w1", proposedById: "me", purchasedById: null, community: { is: { groupPurchasePlansEnabled: true } } },
      data: { groupPurchaseTargetDate: new Date(Date.UTC(2999, 0, 1, 12)), groupPurchaseNote: "ensemble" },
    });
    expect(m.revalidate).toHaveBeenCalledWith("/wishlist");
  });

  it("ne prétend pas avoir enregistré si la mise à jour atomique ne touche rien (course)", async () => {
    m.wlUpdateMany.mockResolvedValue({ count: 0 });
    await expect(run()).rejects.toThrow("REDIRECT:/wishlist?plan=unavailable");
    expect(m.revalidate).not.toHaveBeenCalled();
  });
});
