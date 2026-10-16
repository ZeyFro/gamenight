import { getActiveScopedPrisma } from "@/lib/community-scoped-client";
import type { IgdbGameDetails } from "@/lib/igdb";
import type { CommunityQuizGame } from "@/lib/community-game-quiz";

export async function getCommunityQuizGames(viewerId: string): Promise<CommunityQuizGame[]> {
  const scopedDb = await getActiveScopedPrisma(viewerId);
  const played = await scopedDb.groupGameStat.findMany({
    where: { playCount: { gt: 0 } },
    orderBy: { playCount: "desc" },
    take: 100,
    select: { game: { select: { name: true, igdbDetails: true } } },
  });
  return played.map(({ game }) => ({
    name: game.name,
    details: game.igdbDetails as unknown as IgdbGameDetails | null,
  }));
}
