import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Exécuté en CI uniquement (base Postgres jetable) ; jamais lancé en local (base partagée entre agents).
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
vi.mock("@/lib/discord-level-up", () => ({ announceLevelUp: vi.fn() }));
vi.mock("@/lib/community-announce", () => ({ postToCommunity: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn() }));

vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  if (TEST_DATABASE_URL && new URL(TEST_DATABASE_URL).hostname !== "127.0.0.1") throw new Error("Postgres local uniquement");
  return { prisma: TEST_DATABASE_URL ? new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) : {} };
});

if (!TEST_DATABASE_URL) console.warn("[profile-customization] TEST_DATABASE_URL absente : tests Postgres ignorés.");

describe.skipIf(!TEST_DATABASE_URL)("personnalisation du profil : PostgreSQL", () => {
  let db: import("@prisma/client").PrismaClient;
  let lib: typeof import("./profile-customization");
  let shop: typeof import("./xp-shop");
  const ids = {} as Record<"community" | "other" | "viewer" | "owner" | "outsider" | "game" | "b1" | "b2" | "b3" | "b4", string>;

  beforeAll(async () => {
    const { PrismaClient } = await import("@prisma/client");
    db = new PrismaClient({ datasourceUrl: TEST_DATABASE_URL });
    lib = await import("./profile-customization");
    shop = await import("./xp-shop");
  });
  afterAll(async () => { await db?.$disconnect(); });

  beforeEach(async () => {
    process.env.COMMUNITY_ISOLATION_ENABLED = "true";
    process.env.PROFILE_CUSTOMIZATION_ENABLED = "true";
    delete process.env.PROFILE_VISIBILITY_ENABLED;
    delete process.env.TOWER_CHALLENGES_ENABLED;
    await db.$executeRawUnsafe(
      `TRUNCATE "ProfileEntitlement", "ProfileCustomization", "UserProfileEffectsPreference", "UserProfileVisibility", "UserBadge", "Badge", "Tournament", "Game", "CommunityMemberCosmetic", "XpEvent", "CommunityMemberStats", "Membership", "User", "Community" CASCADE`,
    );
    ids.community = (await db.community.create({ data: { slug: "pc", name: "PC", status: "ACTIVE" } })).id;
    ids.other = (await db.community.create({ data: { slug: "pc2", name: "PC2", status: "ACTIVE" } })).id;
    ids.viewer = (await db.user.create({ data: { discordId: "viewer", discordName: "Viewer" } })).id;
    ids.owner = (await db.user.create({ data: { discordId: "owner", discordName: "Owner" } })).id;
    ids.outsider = (await db.user.create({ data: { discordId: "outsider", discordName: "Outsider" } })).id;
    await db.membership.createMany({ data: [
      { communityId: ids.community, userId: ids.viewer, status: "ACTIVE" },
      { communityId: ids.community, userId: ids.owner, status: "ACTIVE" },
      { communityId: ids.other, userId: ids.outsider, status: "ACTIVE" },
    ] });
    await db.communityMemberStats.create({ data: { communityId: ids.community, userId: ids.owner, xpTotal: 2_000, xpBalance: 2_000 } });
    ids.game = (await db.game.create({ data: { name: "Jeu", source: "MANUAL", addedById: ids.viewer } })).id;
    for (const key of ["b1", "b2", "b3", "b4"] as const) {
      ids[key] = (await db.badge.create({ data: { name: key, icon: "★", description: key, category: "PARTICIPATION", rarity: "COMMON", criteria: {}, modifiedById: ids.viewer } })).id;
    }
    // b4 n'est PAS débloqué par le propriétaire.
    await db.userBadge.createMany({ data: ["b1", "b2", "b3"].map((key) => ({ communityId: ids.community, userId: ids.owner, badgeId: ids[key as "b1"] })) });
    (await import("./default-community")).resetDefaultCommunityIdCache();
  });

  const present = () => lib.loadProfilePresentation(ids.viewer, ids.owner);

  it("achète avec le solde seul, refuse les éléments gagnés, puis équipe et affiche pour un autre membre", async () => {
    expect(await shop.buyShopItem(ids.owner, ids.community, "fx-flames")).toBe("purchased");
    expect(await shop.buyShopItem(ids.owner, ids.community, "name-gold")).toBe("invalid");
    expect(await shop.buyShopItem(ids.owner, ids.community, "name-nitro")).toBe("invalid");
    expect(await db.communityMemberStats.findUniqueOrThrow({ where: { communityId_userId: { communityId: ids.community, userId: ids.owner } } })).toMatchObject({ xpTotal: 2_000, xpBalance: 1_200 });
    expect(await db.xpEvent.count({ where: { userId: ids.owner, reason: "SHOP_BALANCE_PURCHASE" } })).toBe(1);

    expect(await lib.saveCustomization(ids.owner, ids.community, { effectId: "fx-flames", nameStyleId: "name-gold" })).toBe("not_owned");
    expect(await lib.saveCustomization(ids.owner, ids.community, { effectId: "fx-flames", showcaseBadgeIds: [ids.b1, ids.b2, ids.b3] })).toBe("saved");
    expect(await lib.saveCustomization(ids.owner, ids.community, { showcaseBadgeIds: [ids.b1, ids.b2, ids.b4] })).toBe("showcase_locked");

    const view = await present();
    expect(view?.effect?.id).toBe("fx-flames");
    expect(view?.showcase.map((badge) => badge.id).sort()).toEqual([ids.b1, ids.b2, ids.b3].sort());
  });

  it("stocke les badges de la vitrine par identifiant et refuse un badge non débloqué", async () => {
    expect(await lib.saveCustomization(ids.owner, ids.community, { showcaseBadgeIds: [ids.b1, ids.b2, ids.b4] })).toBe("showcase_locked");
    expect(await lib.saveCustomization(ids.owner, ids.community, { showcaseBadgeIds: [ids.b1, ids.b2, ids.b3] })).toBe("saved");
    expect((await present())?.showcase).toHaveLength(3);
    await db.userBadge.deleteMany({ where: { userId: ids.owner, badgeId: ids.b3 } });
    // Badge perdu : la vitrine tombe sous 3 et se masque, sans fuite.
    expect((await present())?.showcase).toEqual([]);
  });

  it("attribue les éléments gagnés (tournoi remporté) une seule fois, même en concurrence", async () => {
    await db.tournament.create({ data: { communityId: ids.community, name: "T", createdById: ids.owner, gameId: ids.game, maxPlayers: 4, status: "DONE", championId: ids.owner } });
    await Promise.all([lib.syncEarnedEntitlements(ids.owner, ids.community), lib.syncEarnedEntitlements(ids.owner, ids.community)]);
    const rows = await db.profileEntitlement.findMany({ where: { userId: ids.owner } });
    expect(rows.map((row) => row.key).sort()).toEqual(["frame-champion"]);
    expect(rows[0]).toMatchObject({ source: "EARNED", communityId: ids.community });
    expect(await lib.saveCustomization(ids.owner, ids.community, { frameFxId: "frame-champion" })).toBe("saved");
    expect((await present())?.frameFx?.id).toBe("frame-champion");
    // Un tournoi remporté dans une autre communauté ne compte pas.
    await db.profileEntitlement.deleteMany({});
    await db.tournament.deleteMany({});
    await db.tournament.create({ data: { communityId: ids.other, name: "T2", createdById: ids.outsider, gameId: ids.game, maxPlayers: 4, status: "DONE", championId: ids.owner } });
    expect(await lib.syncEarnedEntitlements(ids.owner, ids.community)).toEqual([]);
  });

  it("exclusifs boosters : drapeau d'éligibilité lisible, retiré à la révocation sans effacer le choix", async () => {
    expect(await lib.saveCustomization(ids.owner, ids.community, { frameFxId: "frame-nitro" })).toBe("not_owned");
    expect(await lib.grantProfileEntitlement({ communityId: ids.community, userId: ids.owner, key: "booster-support", source: "BOOSTER" })).toBe("granted");
    expect((await lib.getCustomizationState(ids.owner, ids.community)).boosterEligible).toBe(true);
    expect(await lib.saveCustomization(ids.owner, ids.community, { frameFxId: "frame-nitro", nameStyleId: "name-nitro" })).toBe("saved");
    expect((await present())?.frameFx?.id).toBe("frame-nitro");
    await lib.revokeProfileEntitlement({ communityId: ids.community, userId: ids.owner, key: "booster-support", source: "BOOSTER" });
    expect((await present())?.frameFx).toBeNull();
    expect(await db.profileCustomization.findUniqueOrThrow({ where: { communityId_userId: { communityId: ids.community, userId: ids.owner } } })).toMatchObject({ frameFxId: "frame-nitro" });
    // Nouvelle attribution : le droit revient (pas de doublon de ligne).
    await lib.grantProfileEntitlement({ communityId: ids.community, userId: ids.owner, key: "booster-support", source: "BOOSTER" });
    expect((await present())?.frameFx?.id).toBe("frame-nitro");
    expect(await db.profileEntitlement.count({ where: { userId: ids.owner, key: "booster-support" } })).toBe(1);
  });

  it("n'implémente aucun paiement : la source PREMIUM est refusée et n'écrit rien", async () => {
    expect(await lib.grantProfileEntitlement({ communityId: ids.community, userId: ids.owner, key: "name-gold", source: "PREMIUM" } as never)).toBe("invalid");
    expect(await db.profileEntitlement.count()).toBe(0);
  });

  it("un profil masqué (PROFILE_VISIBILITY_ENABLED) ou d'une autre communauté ne fuit rien ; le propriétaire se voit toujours", async () => {
    await db.profileEntitlement.create({ data: { communityId: ids.community, userId: ids.owner, key: "name-gold", source: "GRANT" } });
    await lib.saveCustomization(ids.owner, ids.community, { nameStyleId: "name-gold" });
    expect((await present())?.nameStyle?.id).toBe("name-gold");

    process.env.PROFILE_VISIBILITY_ENABLED = "true";
    await db.userProfileVisibility.create({ data: { userId: ids.owner, visibility: "HIDDEN" } });
    expect(await present()).toBeNull();
    expect((await lib.loadProfilePresentation(ids.owner, ids.owner))?.nameStyle?.id).toBe("name-gold");

    delete process.env.PROFILE_VISIBILITY_ENABLED;
    expect((await present())?.nameStyle?.id).toBe("name-gold");
    expect(await lib.loadProfilePresentation(ids.outsider, ids.owner)).toBeNull();
  });

  it("garde la préférence d'effets du spectateur, pas celle du propriétaire", async () => {
    expect(await lib.setEffectsPreference(ids.viewer, false)).toBe("saved");
    expect((await present())?.effectsEnabled).toBe(false);
    expect((await lib.loadProfilePresentation(ids.owner, ids.owner))?.effectsEnabled).toBe(true);
    await lib.setEffectsPreference(ids.viewer, true);
    expect((await present())?.effectsEnabled).toBe(true);
  });

  it("flag éteint : aucune présentation, achat des éléments de personnalisation refusé, boutique historique intacte", async () => {
    process.env.PROFILE_CUSTOMIZATION_ENABLED = "";
    expect(await present()).toBeNull();
    expect(await lib.saveCustomization(ids.owner, ids.community, { effectId: null })).toBe("disabled");
    expect(await shop.buyShopItem(ids.owner, ids.community, "fx-flames")).toBe("invalid");
    expect(await shop.buyShopItem(ids.owner, ids.community, "title-strategist")).toBe("purchased");
  });

  it("cascade : supprimer le membre supprime ses données de personnalisation", async () => {
    await db.profileEntitlement.create({ data: { communityId: ids.community, userId: ids.owner, key: "name-gold", source: "GRANT" } });
    await lib.saveCustomization(ids.owner, ids.community, { nameStyleId: "name-gold" });
    await lib.setEffectsPreference(ids.owner, false);
    await db.user.delete({ where: { id: ids.owner } });
    expect(await db.profileEntitlement.count()).toBe(0);
    expect(await db.profileCustomization.count()).toBe(0);
    expect(await db.userProfileEffectsPreference.count()).toBe(0);
  });
});
