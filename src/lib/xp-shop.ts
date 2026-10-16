import { prisma } from "@/lib/prisma";
import { scopedPrismaForCommunityId } from "@/lib/community-scoped-client";
import { lockCommunityProgress } from "@/lib/member-stats";
import { writeCommunityIdForUser } from "@/lib/community-stats";

export const XP_SHOP_ITEMS = [
  { id: "title-strategist", kind: "TITLE", name: "Stratège", value: "Stratège", price: 250 },
  { id: "title-night-owl", kind: "TITLE", name: "Noctambule", value: "Noctambule", price: 350 },
  { id: "frame-nebula", kind: "FRAME", name: "Nébuleuse", value: "#b99aff", price: 300 },
  { id: "frame-solar", kind: "FRAME", name: "Solaire", value: "#d4ef80", price: 300 },
  { id: "color-mint", kind: "COLOR", name: "Menthe", value: "#34d399", price: 200 },
  { id: "color-coral", kind: "COLOR", name: "Corail", value: "#fb7185", price: 200 },
  { id: "color-ice", kind: "COLOR", name: "Glace", value: "#38bdf8", price: 250 },
] as const;

export type CosmeticKind = (typeof XP_SHOP_ITEMS)[number]["kind"];

export function getShopItem(itemId: string) {
  return XP_SHOP_ITEMS.find((item) => item.id === itemId) ?? null;
}

export async function getShopState(userId: string, communityId: string) {
  const db = await scopedPrismaForCommunityId(communityId);
  const [stats, owned] = await Promise.all([
    db.communityMemberStats.findUnique({ where: { communityId_userId: { communityId, userId } } }),
    db.communityMemberCosmetic.findMany({ where: { communityId, userId }, select: { itemId: true } }),
  ]);
  return {
    balance: stats?.xpTotal ?? 0,
    ownedIds: new Set(owned.map((item) => item.itemId)),
    equipped: {
      TITLE: stats?.equippedTitleId ?? null,
      FRAME: stats?.equippedFrameId ?? null,
      COLOR: stats?.equippedColorId ?? null,
    },
  };
}

export async function getEquippedShopItems(userId: string, communityId: string) {
  const db = await scopedPrismaForCommunityId(communityId);
  const stats = await db.communityMemberStats.findUnique({
    where: { communityId_userId: { communityId, userId } },
    select: { equippedTitleId: true, equippedFrameId: true, equippedColorId: true },
  });
  return {
    TITLE: cosmeticById(stats?.equippedTitleId),
    FRAME: cosmeticById(stats?.equippedFrameId),
    COLOR: cosmeticById(stats?.equippedColorId),
  };
}

export async function getEquippedShopItemsForViewer(userId: string) {
  const communityId = await writeCommunityIdForUser(userId);
  return communityId
    ? getEquippedShopItems(userId, communityId)
    : { TITLE: null, FRAME: null, COLOR: null };
}

export async function buyShopItem(userId: string, communityId: string, itemId: string) {
  const item = getShopItem(itemId);
  if (!item) return "invalid" as const;

  return prisma.$transaction(async (tx) => {
    if (!(await lockCommunityProgress(tx, communityId, userId))) return "unavailable" as const;
    await tx.communityMemberStats.createMany({ data: [{ communityId, userId }], skipDuplicates: true });
    await tx.$queryRaw`SELECT "userId" FROM "CommunityMemberStats" WHERE "communityId" = ${communityId} AND "userId" = ${userId} FOR UPDATE`;

    const owned = await tx.communityMemberCosmetic.findUnique({
      where: { communityId_userId_itemId: { communityId, userId, itemId } },
    });
    if (owned) return "owned" as const;

    const stats = await tx.communityMemberStats.findUniqueOrThrow({
      where: { communityId_userId: { communityId, userId } },
      select: { xpTotal: true },
    });
    if (stats.xpTotal < item.price) return "insufficient" as const;

    await tx.communityMemberStats.update({
      where: { communityId_userId: { communityId, userId } },
      data: { xpTotal: { decrement: item.price } },
    });
    await tx.xpEvent.create({
      data: { communityId, userId, reason: "SHOP_PURCHASE", sourceId: itemId, amount: -item.price },
    });
    await tx.communityMemberCosmetic.create({ data: { communityId, userId, itemId } });
    return "purchased" as const;
  });
}

export async function equipShopItem(
  userId: string,
  communityId: string,
  kind: CosmeticKind,
  itemId: string | null
) {
  const item = itemId ? getShopItem(itemId) : null;
  if (itemId && (!item || item.kind !== kind)) return "invalid" as const;

  return prisma.$transaction(async (tx) => {
    if (!(await lockCommunityProgress(tx, communityId, userId))) return "unavailable" as const;
    await tx.communityMemberStats.createMany({ data: [{ communityId, userId }], skipDuplicates: true });
    if (item) {
      const owned = await tx.communityMemberCosmetic.findUnique({
        where: { communityId_userId_itemId: { communityId, userId, itemId: item.id } },
      });
      if (!owned) return "not_owned" as const;
    }
    const field = kind === "TITLE" ? "equippedTitleId" : kind === "FRAME" ? "equippedFrameId" : "equippedColorId";
    await tx.communityMemberStats.update({
      where: { communityId_userId: { communityId, userId } },
      data: { [field]: item?.id ?? null },
    });
    return "equipped" as const;
  });
}

export function cosmeticById(itemId: string | null | undefined) {
  return itemId ? getShopItem(itemId) : null;
}
