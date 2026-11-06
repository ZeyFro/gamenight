import { prisma } from "@/lib/prisma";
import { scopedTransactionPrisma } from "@/lib/community-scoped-client";
import { TONIGHT_MESSAGE_PREFIX } from "@/lib/tonight-rules";

export async function replaceTonightClassifieds(input: {
  userId: string;
  communityId: string;
  gameIds: string[];
  message: string;
  createdAt: Date;
  expiresAt: Date;
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const scopedDb = scopedTransactionPrisma(tx, {
      communityIds: [input.communityId], includesDefault: false,
    });
    await scopedDb.playerClassified.deleteMany({
      where: { communityId: input.communityId, createdById: input.userId,
        message: { startsWith: TONIGHT_MESSAGE_PREFIX } },
    });
    await scopedDb.playerClassified.createMany({
      data: input.gameIds.map((gameId) => ({
        communityId: input.communityId, gameId,
        createdById: input.userId, message: input.message,
        createdAt: input.createdAt, expiresAt: input.expiresAt,
      })),
    });
  });
}
