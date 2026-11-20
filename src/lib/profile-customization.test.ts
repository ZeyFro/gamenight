import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  canView: vi.fn(),
  community: vi.fn(),
  tower: vi.fn(),
  pref: { findUnique: vi.fn(), upsert: vi.fn() },
  db: {
    profileCustomization: { findUnique: vi.fn(), upsert: vi.fn() },
    communityMemberCosmetic: { findMany: vi.fn() },
    profileEntitlement: { findMany: vi.fn(), createMany: vi.fn(), upsert: vi.fn(), updateMany: vi.fn() },
    userBadge: { findMany: vi.fn() },
    tournament: { count: vi.fn() },
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: { userProfileEffectsPreference: mocks.pref } }));
vi.mock("@/lib/community-scoped-client", () => ({ scopedPrismaForCommunityId: async () => mocks.db }));
vi.mock("@/lib/community-isolation", () => ({ canViewPote: mocks.canView }));
vi.mock("@/lib/community-stats", () => ({ writeCommunityIdForUser: mocks.community }));
vi.mock("@/lib/tower-personal-progress", () => ({ getTowerPersonalProgress: mocks.tower }));

import {
  buildPresentation,
  getCustomizationState,
  grantProfileEntitlement,
  hasBoosterEligibility,
  isEntitlementActive,
  loadProfilePresentation,
  resolveOwnedIds,
  revokeProfileEntitlement,
  saveCustomization,
  setEffectsPreference,
  syncEarnedEntitlements,
  type EntitlementRow,
} from "./profile-customization";
import { buyShopItem, getPurchasableItem } from "./xp-shop";

const NOW = new Date("2026-12-05T12:00:00Z");
const past = new Date("2026-12-01T00:00:00Z");
const future = new Date("2027-01-01T00:00:00Z");
const row = (over: Partial<EntitlementRow>): EntitlementRow => ({ key: "x", source: "EARNED", startsAt: past, expiresAt: null, revokedAt: null, ...over });
const badges = new Map(["a", "b", "c", "d"].map((id) => [id, { id, name: `Badge ${id}`, icon: "★" }]));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("PROFILE_CUSTOMIZATION_ENABLED", "true");
  mocks.canView.mockResolvedValue(true);
  mocks.community.mockResolvedValue("community");
  mocks.pref.findUnique.mockResolvedValue(null);
  mocks.db.profileCustomization.findUnique.mockResolvedValue(null);
  mocks.db.communityMemberCosmetic.findMany.mockResolvedValue([]);
  mocks.db.profileEntitlement.findMany.mockResolvedValue([]);
  mocks.db.userBadge.findMany.mockResolvedValue([]);
  mocks.db.tournament.count.mockResolvedValue(0);
  mocks.tower.mockResolvedValue({ status: "DISABLED" });
});
afterEach(() => vi.unstubAllEnvs());

describe("droits (entitlements)", () => {
  it("n'est actif que dans sa fenêtre de dates et tant qu'il n'est pas révoqué", () => {
    expect(isEntitlementActive(row({}), NOW)).toBe(true);
    expect(isEntitlementActive(row({ startsAt: future }), NOW)).toBe(false);
    expect(isEntitlementActive(row({ expiresAt: past }), NOW)).toBe(false);
    expect(isEntitlementActive(row({ expiresAt: future }), NOW)).toBe(true);
    expect(isEntitlementActive(row({ revokedAt: past }), NOW)).toBe(false);
  });

  it("possède les achats boutique, les éléments gagnés actifs et les exclusifs boosters éligibles seulement", () => {
    const booster = row({ key: "booster-support", source: "BOOSTER" });
    const owned = resolveOwnedIds({ purchasedIds: ["fx-flames"], entitlements: [row({ key: "name-gold" }), booster], now: NOW });
    expect([...owned].sort()).toEqual(["fx-flames", "frame-nitro", "name-gold", "name-nitro", "ptitle-supporter"].sort());
    expect(hasBoosterEligibility([booster], NOW)).toBe(true);
    // Fin du boost : exclusifs retirés ; droit gagné expiré : retiré aussi.
    const ended = resolveOwnedIds({ purchasedIds: [], entitlements: [{ ...booster, revokedAt: past }, row({ key: "name-gold", expiresAt: past })], now: NOW });
    expect(ended.size).toBe(0);
  });

  it("ne rend jamais possédé un élément gagné ou booster à partir d'un simple achat, ni d'un autre droit", () => {
    const owned = resolveOwnedIds({ purchasedIds: ["name-gold", "name-nitro", "ptitle-climber"], entitlements: [row({ key: "name-nitro", source: "GRANT" })], now: NOW });
    expect(owned.has("name-gold")).toBe(false);
    expect(owned.has("ptitle-climber")).toBe(false);
    // Un droit GRANT sur un exclusif booster ne remplace pas le drapeau d'éligibilité.
    expect(owned.has("name-nitro")).toBe(false);
  });

  it("n'accepte pas le drapeau booster venant d'une autre source", () => {
    expect(hasBoosterEligibility([row({ key: "booster-support", source: "GRANT" })], NOW)).toBe(false);
    expect(hasBoosterEligibility([row({ key: "booster-support", source: "PREMIUM" })], NOW)).toBe(false);
  });
});

describe("présentation", () => {
  const owned = new Set(["name-aurora", "card-midnight", "frame-orbit", "ptitle-climber", "fx-shine", "entrance-fade", "banner-nebula"]);
  const customization = { nameStyleId: "name-aurora", cardThemeId: "card-midnight", frameFxId: "frame-orbit", titleId: "ptitle-climber", effectId: "fx-shine", entranceId: "entrance-fade", bannerFxId: "banner-nebula", showcaseBadgeIds: ["a", "b", "c"] };

  it("retient les choix possédés et la vitrine de 3 badges débloqués", () => {
    const view = buildPresentation({ customization, owned, unlockedBadges: badges, effectsEnabled: true });
    expect(view.nameStyle?.id).toBe("name-aurora");
    expect(view.title?.name).toBe("Grimpeur");
    expect(view.showcase.map((badge) => badge.id)).toEqual(["a", "b", "c"]);
  });

  it("ignore un élément non possédé, de mauvais type ou inconnu", () => {
    const view = buildPresentation({ customization: { ...customization, nameStyleId: "card-midnight", cardThemeId: "name-gold", frameFxId: "inconnu", effectId: "fx-flames" }, owned: new Set([...owned, "name-gold"]), unlockedBadges: badges, effectsEnabled: true });
    expect(view).toMatchObject({ nameStyle: null, cardTheme: null, frameFx: null, effect: null });
  });

  it("masque la vitrine sous 3 badges débloqués et ignore les badges non débloqués", () => {
    const view = buildPresentation({ customization: { showcaseBadgeIds: ["a", "b", "zzz"] }, owned, unlockedBadges: badges, effectsEnabled: true });
    expect(view.showcase).toEqual([]);
  });

  it("limite la vitrine à 6 badges", () => {
    const many = new Map(Array.from({ length: 9 }, (_, i) => [`b${i}`, { id: `b${i}`, name: `B${i}`, icon: "★" }]));
    const view = buildPresentation({ customization: { showcaseBadgeIds: [...many.keys()] }, owned, unlockedBadges: many, effectsEnabled: true });
    expect(view.showcase).toHaveLength(6);
  });

  it("garde la préférence d'effets du spectateur", () => {
    expect(buildPresentation({ customization: null, owned, unlockedBadges: badges, effectsEnabled: false }).effectsEnabled).toBe(false);
  });
});

describe("loadProfilePresentation : visibilité", () => {
  it("flag éteint : null, aucune requête", async () => {
    vi.stubEnv("PROFILE_CUSTOMIZATION_ENABLED", "");
    expect(await loadProfilePresentation("viewer", "owner", NOW)).toBeNull();
    expect(mocks.canView).not.toHaveBeenCalled();
    expect(mocks.db.profileCustomization.findUnique).not.toHaveBeenCalled();
  });

  it("profil masqué ou hors communauté : null et AUCUNE donnée du propriétaire lue", async () => {
    mocks.canView.mockResolvedValue(false);
    expect(await loadProfilePresentation("viewer", "owner", NOW)).toBeNull();
    expect(mocks.canView).toHaveBeenCalledWith("viewer", "owner");
    for (const fn of [mocks.db.profileCustomization.findUnique, mocks.db.communityMemberCosmetic.findMany, mocks.db.profileEntitlement.findMany, mocks.db.userBadge.findMany, mocks.pref.findUnique]) {
      expect(fn).not.toHaveBeenCalled();
    }
  });

  it("sans communauté : null", async () => {
    mocks.community.mockResolvedValue(null);
    expect(await loadProfilePresentation("viewer", "owner", NOW)).toBeNull();
    expect(mocks.db.profileCustomization.findUnique).not.toHaveBeenCalled();
  });

  it("lit le propriétaire et la préférence du spectateur après contrôle d'accès", async () => {
    mocks.pref.findUnique.mockResolvedValue({ effectsEnabled: false });
    mocks.db.profileCustomization.findUnique.mockResolvedValue({ nameStyleId: "name-gold" });
    mocks.db.profileEntitlement.findMany.mockResolvedValue([row({ key: "name-gold" })]);
    const view = await loadProfilePresentation("viewer", "owner", NOW);
    expect(view?.nameStyle?.id).toBe("name-gold");
    expect(view?.effectsEnabled).toBe(false);
    expect(mocks.pref.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "viewer" } }));
  });
});

describe("saveCustomization", () => {
  beforeEach(() => {
    mocks.db.communityMemberCosmetic.findMany.mockResolvedValue([{ itemId: "name-aurora" }]);
    mocks.db.userBadge.findMany.mockResolvedValue(["a", "b", "c"].map((id) => ({ badge: { id, name: id, icon: "★" } })));
  });

  it("enregistre un choix possédé", async () => {
    expect(await saveCustomization("u", "community", { nameStyleId: "name-aurora", showcaseBadgeIds: ["a", "b", "c"] }, NOW)).toBe("saved");
    expect(mocks.db.profileCustomization.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: { communityId: "community", userId: "u", nameStyleId: "name-aurora", showcaseBadgeIds: ["a", "b", "c"] },
    }));
  });

  it("refuse un élément non possédé, gagné non obtenu ou exclusif booster sans éligibilité", async () => {
    expect(await saveCustomization("u", "community", { nameStyleId: "name-sunset" }, NOW)).toBe("not_owned");
    expect(await saveCustomization("u", "community", { nameStyleId: "name-gold" }, NOW)).toBe("not_owned");
    expect(await saveCustomization("u", "community", { nameStyleId: "name-nitro" }, NOW)).toBe("not_owned");
    expect(mocks.db.profileCustomization.upsert).not.toHaveBeenCalled();
  });

  it("refuse un identifiant inconnu ou rangé dans le mauvais type (jamais de CSS libre)", async () => {
    expect(await saveCustomization("u", "community", { nameStyleId: "red; background:url(x)" }, NOW)).toBe("invalid");
    expect(await saveCustomization("u", "community", { effectId: "name-aurora" }, NOW)).toBe("invalid");
    expect(mocks.db.profileCustomization.upsert).not.toHaveBeenCalled();
  });

  it("valide la vitrine : 3 à 6 badges distincts réellement débloqués", async () => {
    expect(await saveCustomization("u", "community", { showcaseBadgeIds: ["a", "b"] }, NOW)).toBe("showcase_too_few");
    expect(await saveCustomization("u", "community", { showcaseBadgeIds: ["a", "a", "b"] }, NOW)).toBe("showcase_duplicate");
    expect(await saveCustomization("u", "community", { showcaseBadgeIds: ["a", "b", "c", "d", "e", "f", "g"] }, NOW)).toBe("showcase_too_many");
    expect(await saveCustomization("u", "community", { showcaseBadgeIds: ["a", "b", "z"] }, NOW)).toBe("showcase_locked");
    expect(await saveCustomization("u", "community", { showcaseBadgeIds: [] }, NOW)).toBe("saved");
  });

  it("retire un élément avec une valeur vide et refuse tout si le flag est éteint", async () => {
    expect(await saveCustomization("u", "community", { nameStyleId: null }, NOW)).toBe("saved");
    expect(mocks.db.profileCustomization.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { nameStyleId: null } }));
    vi.stubEnv("PROFILE_CUSTOMIZATION_ENABLED", "");
    mocks.db.profileCustomization.upsert.mockClear();
    expect(await saveCustomization("u", "community", { nameStyleId: null }, NOW)).toBe("disabled");
    expect(mocks.db.profileCustomization.upsert).not.toHaveBeenCalled();
  });
});

describe("obtention par événement", () => {
  it("attribue les éléments gagnés selon la progression (étages, tournois), sans toucher XP ni étages", async () => {
    mocks.tower.mockResolvedValue({ status: "PROGRESS", floorsClimbed: "30", completedSeasons: 1, seasonChallenges: 0, rank: "Ranker" });
    mocks.db.tournament.count.mockResolvedValue(1);
    const keys = await syncEarnedEntitlements("u", "community", NOW);
    expect(keys).toEqual(expect.arrayContaining(["card-tower", "name-gold", "fx-flames-ranker", "banner-season", "frame-champion"]));
    expect(keys).not.toContain("name-crimson");
    const call = mocks.db.profileEntitlement.createMany.mock.calls[0][0];
    expect(call.skipDuplicates).toBe(true);
    expect(call.data.every((entry: { source: string; communityId: string }) => entry.source === "EARNED" && entry.communityId === "community")).toBe(true);
  });

  it("n'écrit rien sans progression ni quand le flag est éteint", async () => {
    expect(await syncEarnedEntitlements("u", "community", NOW)).toEqual([]);
    expect(mocks.db.profileEntitlement.createMany).not.toHaveBeenCalled();
    vi.stubEnv("PROFILE_CUSTOMIZATION_ENABLED", "");
    expect(await syncEarnedEntitlements("u", "community", NOW)).toEqual([]);
    expect(mocks.tower).toHaveBeenCalledTimes(1);
  });

  it("la page lit l'état après synchronisation et signale l'éligibilité booster", async () => {
    mocks.db.profileEntitlement.findMany.mockResolvedValue([row({ key: "booster-support", source: "BOOSTER" })]);
    const state = await getCustomizationState("u", "community", NOW);
    expect(state.boosterEligible).toBe(true);
    expect(state.owned.has("frame-nitro")).toBe(true);
    expect(state.effectsEnabled).toBe(true);
  });
});

describe("attribution et révocation", () => {
  it("accorde le drapeau booster (source BOOSTER) et une attribution staff (source GRANT)", async () => {
    expect(await grantProfileEntitlement({ communityId: "c", userId: "u", key: "booster-support", source: "BOOSTER" }, NOW)).toBe("granted");
    expect(await grantProfileEntitlement({ communityId: "c", userId: "u", key: "name-violet", source: "GRANT", reason: "Irregular" }, NOW)).toBe("granted");
    expect(mocks.db.profileEntitlement.upsert).toHaveBeenCalledTimes(2);
  });

  it("refuse la source PREMIUM (aucun paiement), une clé inconnue et un drapeau mal sourcé", async () => {
    for (const input of [
      { key: "name-gold", source: "PREMIUM" },
      { key: "inconnue", source: "GRANT" },
      { key: "booster-support", source: "GRANT" },
      { key: "name-gold", source: "BOOSTER" },
    ]) {
      expect(await grantProfileEntitlement({ communityId: "c", userId: "u", ...input } as never, NOW)).toBe("invalid");
    }
    expect(mocks.db.profileEntitlement.upsert).not.toHaveBeenCalled();
  });

  it("révoque sans effacer les choix enregistrés", async () => {
    await revokeProfileEntitlement({ communityId: "c", userId: "u", key: "booster-support", source: "BOOSTER" }, NOW);
    expect(mocks.db.profileEntitlement.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { revokedAt: NOW } }));
    expect(mocks.db.profileCustomization.upsert).not.toHaveBeenCalled();
  });
});

describe("préférence du spectateur", () => {
  it("enregistre la préférence, refusée si le flag est éteint", async () => {
    expect(await setEffectsPreference("u", false)).toBe("saved");
    expect(mocks.pref.upsert).toHaveBeenCalledWith({ where: { userId: "u" }, create: { userId: "u", effectsEnabled: false }, update: { effectsEnabled: false } });
    vi.stubEnv("PROFILE_CUSTOMIZATION_ENABLED", "");
    expect(await setEffectsPreference("u", true)).toBe("unavailable");
  });
});

describe("boutique XP étendue", () => {
  it("n'expose les éléments de personnalisation à l'achat qu'avec le flag, jamais les gagnés ni les boosters", () => {
    expect(getPurchasableItem("fx-flames")).toEqual({ id: "fx-flames", price: 800 });
    expect(getPurchasableItem("title-strategist")).toEqual({ id: "title-strategist", price: 250 });
    expect(getPurchasableItem("name-gold")).toBeNull();
    expect(getPurchasableItem("name-nitro")).toBeNull();
    expect(getPurchasableItem("inconnu")).toBeNull();
    vi.stubEnv("PROFILE_CUSTOMIZATION_ENABLED", "");
    expect(getPurchasableItem("fx-flames")).toBeNull();
    expect(getPurchasableItem("title-strategist")).not.toBeNull();
  });

  it("refuse l'achat d'un élément gagné avant toute transaction", async () => {
    expect(await buyShopItem("u", "community", "name-gold")).toBe("invalid");
  });
});
