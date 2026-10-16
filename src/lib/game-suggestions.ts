import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { resolveActiveCommunityScope } from "@/lib/community-isolation";
import { gameParticipantsSchema, rankGameSuggestions } from "@/lib/game-preferences";

export async function gamePreferenceMemberWhere(viewerId: string): Promise<Prisma.UserWhereInput> {
  const scope = await resolveActiveCommunityScope(viewerId);
  return scope === null ? {} : { memberships: { some: {
    communityId: { in: scope.communityIds }, status: "ACTIVE", community: { status: "ACTIVE" },
  } } };
}
export async function visiblePreferenceGames(viewerId: string) {
  return prisma.game.findMany({
    where: { userGames: { some: { owned: true, user: await gamePreferenceMemberWhere(viewerId) } } },
    select: { id: true, name: true }, orderBy: [{ name: "asc" }, { id: "asc" }],
  });
}
export async function loadGameSuggestions(viewerId: string, requestedIds: unknown) {
  const memberWhere = await gamePreferenceMemberWhere(viewerId);
  const members = await prisma.user.findMany({ where: memberWhere, select: { id: true, discordName: true }, orderBy: [{ discordName: "asc" }, { id: "asc" }] });
  const parsed = gameParticipantsSchema.safeParse(requestedIds);
  const empty = { members, suggestions: [], unknownMetadataCount: 0, totalSuggestions: 0 };
  if (!parsed.success) return { ...empty, error: "invalid_participants" as const };
  const ids = parsed.data;
  if (!ids.length) return { ...empty, error: null };
  const users = await prisma.user.findMany({ where: { AND: [memberWhere, { id: { in: ids } }] }, select: { id: true, preferredGameCategories: true, refusedGameCategories: true } });
  if (users.length !== ids.length) return { ...empty, error: "participants_changed" as const };
  const games = await prisma.game.findMany({
    where: {
      AND: ids.map(userId => ({ userGames: { some: { userId, owned: true, user: memberWhere } } })),
      userRefusals: { none: { userId: { in: ids } } },
    },
    select: { id: true, name: true, isCoop: true, playInfoManual: true, minPlayers: true, maxPlayers: true, igdbDetails: true },
  });
  const ranked = rankGameSuggestions(games, users);
  // Jamais de préférences ou de refus individuels dans la réponse.
  return { members, suggestions: ranked.suggestions.slice(0, 24), totalSuggestions: ranked.suggestions.length, unknownMetadataCount: ranked.unknownMetadataCount, error: null };
}
