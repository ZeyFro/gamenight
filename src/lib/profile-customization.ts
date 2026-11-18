import { prisma } from "@/lib/prisma";
import { scopedPrismaForCommunityId } from "@/lib/community-scoped-client";
import { canViewPote } from "@/lib/community-isolation";
import { writeCommunityIdForUser } from "@/lib/community-stats";
import { getTowerPersonalProgress } from "@/lib/tower-personal-progress";
import {
  BOOSTER_ELIGIBILITY_KEY,
  PROFILE_COSMETICS,
  PROFILE_KIND_FIELD,
  SHOWCASE_MAX,
  SHOWCASE_MIN,
  earnedKeysFor,
  getProfileCosmetic,
  isProfileCustomizationEnabled,
  validateShowcaseSize,
  type EarnProgress,
  type ProfileCosmetic,
  type ProfileCosmeticKind,
  type ProfileCustomizationField,
} from "@/lib/profile-cosmetics";

/**
 * Personnalisation du profil : lecture, validation et écriture. DONNÉES DE PRÉSENTATION UNIQUEMENT :
 * rien ici ne touche l'XP, les étages, une priorité ou un droit. Aucun paiement n'est implémenté.
 */

export type EntitlementRow = {
  key: string;
  source: "EARNED" | "BOOSTER" | "GRANT" | "PREMIUM";
  startsAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
};

export function isEntitlementActive(row: Pick<EntitlementRow, "startsAt" | "expiresAt" | "revokedAt">, now: Date): boolean {
  if (row.revokedAt) return false;
  if (row.startsAt.getTime() > now.getTime()) return false;
  return !row.expiresAt || row.expiresAt.getTime() > now.getTime();
}

/** Drapeau d'éligibilité aux exclusifs boosters (lecture seule : l'attribution vient d'une autre PR). */
export function hasBoosterEligibility(entitlements: readonly EntitlementRow[], now: Date): boolean {
  return entitlements.some((row) => row.key === BOOSTER_ELIGIBILITY_KEY && row.source === "BOOSTER" && isEntitlementActive(row, now));
}

/**
 * Identifiants de catalogue que le membre peut équiper : achetés (boutique XP), gagnés ou attribués
 * (droit actif), exclusifs boosters tant que le drapeau d'éligibilité est actif. Un élément gagné ou
 * exclusif ne peut JAMAIS être obtenu par achat, même si un achat figurait en base.
 */
export function resolveOwnedIds(input: { purchasedIds: Iterable<string>; entitlements: readonly EntitlementRow[]; now: Date }): Set<string> {
  const purchased = new Set(input.purchasedIds);
  const booster = hasBoosterEligibility(input.entitlements, input.now);
  const active = new Set(input.entitlements.filter((row) => row.source !== "BOOSTER" && isEntitlementActive(row, input.now)).map((row) => row.key));
  const owned = new Set<string>();
  for (const item of PROFILE_COSMETICS) {
    const mode = item.acquisition.mode;
    if (mode === "SHOP" && (purchased.has(item.id) || active.has(item.id))) owned.add(item.id);
    if (mode === "EARNED" && active.has(item.id)) owned.add(item.id);
    if (mode === "BOOSTER" && booster) owned.add(item.id);
  }
  return owned;
}

export type CustomizationRow = Partial<Record<ProfileCustomizationField, string | null>> & { showcaseBadgeIds?: string[] };

export type ShowcaseBadge = { id: string; name: string; icon: string };

export type ProfilePresentation = {
  /** Effets animés visibles pour CE spectateur (préférence stockée). Les styles statiques restent affichés. */
  effectsEnabled: boolean;
  nameStyle: ProfileCosmetic | null;
  cardTheme: ProfileCosmetic | null;
  frameFx: ProfileCosmetic | null;
  bannerFx: ProfileCosmetic | null;
  effect: ProfileCosmetic | null;
  title: ProfileCosmetic | null;
  entrance: ProfileCosmetic | null;
  showcase: ShowcaseBadge[];
};

const KIND_TO_KEY: Record<ProfileCosmeticKind, keyof Omit<ProfilePresentation, "effectsEnabled" | "showcase">> = {
  NAME_STYLE: "nameStyle",
  CARD_THEME: "cardTheme",
  FRAME_FX: "frameFx",
  BANNER_FX: "bannerFx",
  EFFECT: "effect",
  PROFILE_TITLE: "title",
  ENTRANCE: "entrance",
};

/**
 * Présentation à afficher. Tout élément inconnu, du mauvais type ou non (ou plus) possédé est ignoré :
 * un exclusif booster disparaît quand l'éligibilité s'arrête, sans effacer le choix en base. La vitrine
 * est limitée aux badges réellement débloqués et masquée si elle compte moins de 3 badges.
 */
export function buildPresentation(input: {
  customization: CustomizationRow | null;
  owned: ReadonlySet<string>;
  unlockedBadges: ReadonlyMap<string, ShowcaseBadge>;
  effectsEnabled: boolean;
}): ProfilePresentation {
  const view: ProfilePresentation = {
    effectsEnabled: input.effectsEnabled,
    nameStyle: null, cardTheme: null, frameFx: null, bannerFx: null, effect: null, title: null, entrance: null,
    showcase: [],
  };
  const row = input.customization;
  if (!row) return view;
  for (const [kind, field] of Object.entries(PROFILE_KIND_FIELD) as [ProfileCosmeticKind, ProfileCustomizationField][]) {
    const item = getProfileCosmetic(row[field]);
    if (item && item.kind === kind && input.owned.has(item.id)) view[KIND_TO_KEY[kind]] = item;
  }
  const badges = [...new Set(row.showcaseBadgeIds ?? [])]
    .map((id) => input.unlockedBadges.get(id))
    .filter((badge): badge is ShowcaseBadge => Boolean(badge))
    .slice(0, SHOWCASE_MAX);
  view.showcase = badges.length >= SHOWCASE_MIN ? badges : [];
  return view;
}

export function hasAnyPresentation(view: ProfilePresentation): boolean {
  return Boolean(view.nameStyle || view.cardTheme || view.frameFx || view.bannerFx || view.effect || view.title || view.entrance || view.showcase.length);
}

// ─── Lecture ─────────────────────────────────────────────────────────────────

async function loadOwnerData(userId: string, communityId: string, now: Date) {
  const scopedDb = await scopedPrismaForCommunityId(communityId);
  const [customization, purchased, entitlements, unlocked] = await Promise.all([
    scopedDb.profileCustomization.findUnique({ where: { communityId_userId: { communityId, userId } } }),
    scopedDb.communityMemberCosmetic.findMany({ where: { communityId, userId }, select: { itemId: true } }),
    scopedDb.profileEntitlement.findMany({ where: { communityId, userId }, select: { key: true, source: true, startsAt: true, expiresAt: true, revokedAt: true } }),
    scopedDb.userBadge.findMany({ where: { communityId, userId }, select: { badge: { select: { id: true, name: true, icon: true } } } }),
  ]);
  const owned = resolveOwnedIds({ purchasedIds: purchased.map((row) => row.itemId), entitlements, now });
  const unlockedBadges = new Map<string, ShowcaseBadge>(unlocked.map((row) => [row.badge.id, row.badge]));
  return { customization, owned, unlockedBadges, entitlements };
}

export async function getEffectsPreference(userId: string): Promise<boolean> {
  const row = await prisma.userProfileEffectsPreference.findUnique({ where: { userId }, select: { effectsEnabled: true } });
  return row?.effectsEnabled ?? true;
}

export async function setEffectsPreference(userId: string, enabled: boolean): Promise<"saved" | "unavailable"> {
  if (!isProfileCustomizationEnabled()) return "unavailable";
  await prisma.userProfileEffectsPreference.upsert({
    where: { userId },
    create: { userId, effectsEnabled: enabled },
    update: { effectsEnabled: enabled },
  });
  return "saved";
}

/**
 * Présentation du profil de `ownerId` pour `viewerId`. `null` : fonctionnalité éteinte, profil non
 * visible par ce spectateur (membre d'une autre communauté, profil masqué via PROFILE_VISIBILITY_ENABLED,
 * contrôlé par `canViewPote`) ou communauté inconnue. Dans tous ces cas, AUCUNE donnée du propriétaire
 * n'est lue : un profil masqué ne fuit rien.
 */
export async function loadProfilePresentation(viewerId: string, ownerId: string, now: Date = new Date()): Promise<ProfilePresentation | null> {
  if (!isProfileCustomizationEnabled()) return null;
  if (!(await canViewPote(viewerId, ownerId))) return null;
  const communityId = await writeCommunityIdForUser(viewerId);
  if (!communityId) return null;
  const [owner, effectsEnabled] = await Promise.all([loadOwnerData(ownerId, communityId, now), getEffectsPreference(viewerId)]);
  return buildPresentation({ customization: owner.customization, owned: owner.owned, unlockedBadges: owner.unlockedBadges, effectsEnabled });
}

// ─── Page de personnalisation (propriétaire) ──────────────────────────────────

export type CustomizationState = {
  customization: CustomizationRow | null;
  owned: Set<string>;
  boosterEligible: boolean;
  unlockedBadges: ShowcaseBadge[];
  effectsEnabled: boolean;
};

export async function getCustomizationState(userId: string, communityId: string, now: Date = new Date()): Promise<CustomizationState> {
  await syncEarnedEntitlements(userId, communityId, now);
  const [owner, effectsEnabled] = await Promise.all([loadOwnerData(userId, communityId, now), getEffectsPreference(userId)]);
  return {
    customization: owner.customization,
    owned: owner.owned,
    boosterEligible: hasBoosterEligibility(owner.entitlements, now),
    unlockedBadges: [...owner.unlockedBadges.values()],
    effectsEnabled,
  };
}

export type SaveCustomizationInput = Partial<Record<ProfileCustomizationField, string | null>> & { showcaseBadgeIds?: string[] };
export type SaveCustomizationStatus =
  | "saved" | "disabled" | "invalid" | "not_owned" | "showcase_too_few" | "showcase_too_many" | "showcase_duplicate" | "showcase_locked";

/**
 * Enregistre les choix du membre. Chaque identifiant est vérifié côté serveur : présent dans le
 * catalogue, du bon type, possédé (acheté, gagné ou exclusif encore éligible). La vitrine ne peut
 * contenir que des badges réellement débloqués, 3 à 6 (ou aucun). Seuls les champs fournis changent.
 */
export async function saveCustomization(userId: string, communityId: string, input: SaveCustomizationInput, now: Date = new Date()): Promise<SaveCustomizationStatus> {
  if (!isProfileCustomizationEnabled()) return "disabled";
  const { owned, unlockedBadges } = await loadOwnerData(userId, communityId, now);
  const data: Record<string, string | string[] | null> = {};
  for (const [kind, field] of Object.entries(PROFILE_KIND_FIELD) as [ProfileCosmeticKind, ProfileCustomizationField][]) {
    if (!(field in input)) continue;
    const value = input[field] ?? null;
    if (value !== null) {
      const item = getProfileCosmetic(value);
      if (!item || item.kind !== kind) return "invalid";
      if (!owned.has(item.id)) return "not_owned";
    }
    data[field] = value;
  }
  if (input.showcaseBadgeIds) {
    const size = validateShowcaseSize(input.showcaseBadgeIds);
    if (size === "too_few") return "showcase_too_few";
    if (size === "too_many") return "showcase_too_many";
    if (size === "duplicate") return "showcase_duplicate";
    if (input.showcaseBadgeIds.some((id) => !unlockedBadges.has(id))) return "showcase_locked";
    data.showcaseBadgeIds = input.showcaseBadgeIds;
  }
  const scopedDb = await scopedPrismaForCommunityId(communityId);
  await scopedDb.profileCustomization.upsert({
    where: { communityId_userId: { communityId, userId } },
    create: { communityId, userId, ...data },
    update: data,
  });
  return "saved";
}

// ─── Obtention (gagnée / attribuée) ───────────────────────────────────────────

/** Progression « gagnée » d'un membre : étages, saisons et défis (Tower), tournois remportés. Lecture seule. */
export async function loadEarnProgress(userId: string, communityId: string, now: Date = new Date()): Promise<EarnProgress> {
  const scopedDb = await scopedPrismaForCommunityId(communityId);
  const [tower, tournamentWins] = await Promise.all([
    getTowerPersonalProgress({ viewerId: userId, memberId: userId, communityId }, now),
    scopedDb.tournament.count({ where: { championId: userId, status: "DONE" } }),
  ]);
  const progress = tower.status === "PROGRESS" ? tower : null;
  return {
    floors: progress ? BigInt(progress.floorsClimbed) : BigInt(0),
    grade: progress?.rank ?? "Régulars",
    seasonsCompleted: progress?.completedSeasons ?? 0,
    tournamentWins,
    challengesValidated: progress?.seasonChallenges ?? 0,
  };
}

/**
 * Attribue les cosmétiques GAGNÉS dont la règle est satisfaite (jamais retirés : un étage ou un tournoi
 * déjà obtenu reste acquis). Idempotent. Appelé à l'ouverture de la page de personnalisation et exposé
 * pour que les événements (fin de saison, victoire de tournoi, validation de défi) l'appellent aussi.
 */
export async function syncEarnedEntitlements(userId: string, communityId: string, now: Date = new Date()): Promise<string[]> {
  if (!isProfileCustomizationEnabled()) return [];
  const keys = earnedKeysFor(await loadEarnProgress(userId, communityId, now));
  if (keys.length === 0) return [];
  const scopedDb = await scopedPrismaForCommunityId(communityId);
  await scopedDb.profileEntitlement.createMany({
    data: keys.map((key) => ({ communityId, userId, key, source: "EARNED" as const, reason: "règle gagnée", startsAt: now })),
    skipDuplicates: true,
  });
  return keys;
}

export type GrantInput = {
  communityId: string;
  userId: string;
  key: string;
  source: "BOOSTER" | "GRANT";
  reason?: string;
  expiresAt?: Date | null;
};

/**
 * Attribution explicite (staff, ou futur cron booster : drapeau `booster-support`). La source PREMIUM
 * est réservée : aucun paiement n'est implémenté, elle est refusée ici. Une clé hors catalogue est refusée.
 */
export async function grantProfileEntitlement(input: GrantInput, now: Date = new Date()): Promise<"granted" | "invalid" | "disabled"> {
  if (!isProfileCustomizationEnabled()) return "disabled";
  const known = input.key === BOOSTER_ELIGIBILITY_KEY ? input.source === "BOOSTER" : input.source === "GRANT" && getProfileCosmetic(input.key) !== null;
  if (!known) return "invalid";
  const scopedDb = await scopedPrismaForCommunityId(input.communityId);
  const where = { communityId_userId_key_source: { communityId: input.communityId, userId: input.userId, key: input.key, source: input.source } };
  const fields = { reason: input.reason?.slice(0, 120) ?? null, startsAt: now, expiresAt: input.expiresAt ?? null, revokedAt: null };
  await scopedDb.profileEntitlement.upsert({
    where,
    create: { communityId: input.communityId, userId: input.userId, key: input.key, source: input.source, ...fields },
    update: fields,
  });
  return "granted";
}

/** Fin de l'éligibilité (ex. fin du boost) : le droit est révoqué, les choix en base ne sont pas effacés. */
export async function revokeProfileEntitlement(input: Pick<GrantInput, "communityId" | "userId" | "key" | "source">, now: Date = new Date()): Promise<void> {
  const scopedDb = await scopedPrismaForCommunityId(input.communityId);
  await scopedDb.profileEntitlement.updateMany({
    where: { communityId: input.communityId, userId: input.userId, key: input.key, source: input.source, revokedAt: null },
    data: { revokedAt: now },
  });
}
