import { prisma } from "@/lib/prisma";
import { suggestCompatiblePartners, type Compatibility, type MatchingProfile } from "@/lib/player-matching-rules";

const profileSelect = { languages: true, playHabits: true, communityPreferences: true, availablePlatforms: true, userTags: { select: { tagId: true } } } as const;

type ProfileRow = { languages: string[]; playHabits: string[]; communityPreferences: string[]; availablePlatforms: string[]; userTags: { tagId: string }[] };
const toProfile = (row: ProfileRow): MatchingProfile => ({
  languages: row.languages, playHabits: row.playHabits, communityPreferences: row.communityPreferences,
  availablePlatforms: row.availablePlatforms, tagIds: row.userTags.map(tag => tag.tagId),
});

/**
 * Partenaires compatibles (cahier §12.3) parmi `visibleCandidateIds`, que l'appelant a DÉJÀ restreints aux membres
 * de ses communautés dont le profil est visible (liste Potes : `creationMemberUserWhere` + `profileVisibilityWhere`).
 * Aucun autre profil n'est lu. Lecture seule.
 */
export async function loadCompatiblePartners(viewerId: string, visibleCandidateIds: readonly string[]): Promise<Compatibility[]> {
  const candidateIds = [...new Set(visibleCandidateIds)].filter(id => id !== viewerId);
  if (!candidateIds.length) return [];
  const viewer = await prisma.user.findUnique({ where: { id: viewerId }, select: profileSelect });
  if (!viewer) return [];
  const viewerGames = await prisma.userGame.findMany({ where: { userId: viewerId, owned: true }, select: { gameId: true } });
  const commonRows = viewerGames.length ? await prisma.userGame.groupBy({
    by: ["userId"],
    where: { userId: { in: candidateIds }, owned: true, gameId: { in: viewerGames.map(game => game.gameId) } },
    _count: { _all: true },
  }) : [];
  const commonByUser = new Map(commonRows.map(row => [row.userId, row._count._all]));
  const withGames = candidateIds.filter(id => commonByUser.has(id));
  if (!withGames.length) return [];
  const candidates = await prisma.user.findMany({ where: { id: { in: withGames } }, select: { id: true, ...profileSelect } });
  return suggestCompatiblePartners(toProfile(viewer), candidates.map(row => ({ userId: row.id, commonGames: commonByUser.get(row.id) ?? 0, ...toProfile(row) })));
}
