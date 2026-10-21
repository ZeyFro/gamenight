import type { Prisma } from "@prisma/client";

/** Caller owns the transaction; user lock serializes concurrent fresh logins. */
export async function syncOAuthMemberships(
  tx: Prisma.TransactionClient,
  userId: string,
  guildIds: string[],
  verifiedAt: Date,
): Promise<string[]> {
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
  const latest = await tx.membership.findFirst({
    where: { userId, lastVerifiedAt: { not: null } },
    orderBy: { lastVerifiedAt: "desc" },
    select: { lastVerifiedAt: true },
  });
  // An older slow OAuth request must not overwrite a newer complete snapshot.
  if (!latest?.lastVerifiedAt || latest.lastVerifiedAt <= verifiedAt) {
    const communities = await tx.community.findMany({
      where: { status: "ACTIVE", discordGuildId: { in: guildIds } },
      select: { id: true },
    });
    const communityIds = communities.map((c) => c.id);
    await tx.membership.createMany({
      data: communityIds.map((communityId) => ({ communityId, userId, lastVerifiedAt: verifiedAt })),
      skipDuplicates: true,
    });
    await tx.membership.updateMany({
      where: { userId, communityId: { in: communityIds }, status: { in: ["ACTIVE", "LEFT"] }, community: { status: "ACTIVE" } },
      data: { status: "ACTIVE", leftAt: null, lastVerifiedAt: verifiedAt },
    });
    // Only a complete successful snapshot can prove a departure, including [].
    // Suspended communities and administratively REMOVED memberships are untouched.
    await tx.membership.updateMany({
      where: { userId, status: "ACTIVE", community: { status: "ACTIVE", OR: [
        { discordGuildId: { not: null, notIn: guildIds } }, { discordGuildId: null },
      ] } },
      data: { status: "LEFT", leftAt: verifiedAt, lastVerifiedAt: verifiedAt },
    });
  }
  const active = await tx.membership.findMany({
    where: { userId, status: "ACTIVE", community: { status: "ACTIVE" } },
    select: { communityId: true },
  });
  const activeIds = active.map((m) => m.communityId);
  await tx.user.updateMany({
    where: { id: userId, activeCommunityId: { not: null, notIn: activeIds } },
    data: { activeCommunityId: null },
  });
  return activeIds;
}
