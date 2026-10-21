import { notFound } from "next/navigation";
import type { Community, CommunityRole, Membership, User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import {
  communityIdFilter,
  getIsolationScope,
  isCommunityIsolationEnabled,
  resolveActiveCommunityId,
} from "@/lib/community-isolation";

/**
 * Multi-communautés, PR A — point de contrôle unique de l'accès à une
 * communauté (généralise `session-access.ts`, qui reste pour l'accès invité
 * aux soirées). Règle : Membership ACTIVE dans une communauté ACTIVE, relus
 * EN BASE à chaque appel — jamais depuis le JWT, pour qu'un départ (LEFT,
 * REMOVED) ou une suspension coupe l'accès dès la requête suivante (même
 * logique que `forceReloginAt`).
 *
 * Tout refus est un 404 (`notFound()`), indistinct pour l'appelant : « la
 * communauté existe mais tu n'en es pas » serait déjà une fuite. Le client
 * Prisma scopé par communauté viendra dans une PR suivante ; le garde-fou
 * statique `community-scope.test.ts` liste les accès directs restants.
 */

export interface CommunityAccess {
  user: User;
  membership: Membership;
  community: Community;
}

const ROLE_RANK: Record<CommunityRole, number> = { MEMBER: 0, ADMIN: 1, OWNER: 2 };

/** Vrai si `role` vaut au moins `min` (OWNER ⊃ ADMIN ⊃ MEMBER). Pure. */
export function hasCommunityRole(role: CommunityRole, min: CommunityRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

/** Membership ACTIVE de `userId` dans `communityId` si la communauté est ACTIVE, sinon `null`. */
export async function findActiveMembership(
  userId: string,
  communityId: string
): Promise<(Membership & { community: Community }) | null> {
  const membership = await prisma.membership.findUnique({
    where: { communityId_userId: { communityId, userId } },
    include: { community: true },
  });
  if (!membership || membership.status !== "ACTIVE" || membership.community.status !== "ACTIVE") {
    return null;
  }
  return membership;
}

/**
 * `userId` peut-il voir/agir sur ce tournoi ? Toujours limité aux Memberships
 * ACTIVE de communautés ACTIVE. `communityId = null` désigne les lignes
 * historiques de `default` ; une autre communauté est indistinguable d'un
 * tournoi inexistant.
 */
export async function canAccessTournament(userId: string, tournamentId: string): Promise<boolean> {
  const scope = await getIsolationScope(userId);
  const row = await prisma.tournament.findFirst({
    where: { id: tournamentId, ...communityIdFilter(scope) },
    select: { id: true },
  });
  return row !== null;
}

/**
 * Communauté du classement. `null` = aucune communauté autorisée
 * (classement vide) ; sinon l'id. Une communauté demandée
 * explicitement (`?communaute=`) passe par `requireMembership` : 404 si
 * l'utilisateur n'en est pas membre ACTIF — jamais le classement d'une autre.
 */
export async function getScoreboardCommunityId(
  userId: string,
  requested?: string | null
): Promise<string | null | undefined> {
  if (!isCommunityIsolationEnabled()) {
    return resolveActiveCommunityId(userId);
  }
  if (requested) return (await requireMembership(requested)).community.id;
  return resolveActiveCommunityId(userId);
}

/** Utilisateur connecté, membre ACTIVE de la communauté ACTIVE `communityId` ; sinon 404. */
export async function requireMembership(communityId: string): Promise<CommunityAccess> {
  const user = await getCurrentUser();
  if (!user) notFound();
  const membership = await findActiveMembership(user.id, communityId);
  if (!membership) notFound();
  const { community, ...rest } = membership;
  return { user, membership: rest, community };
}

/** Comme `requireMembership`, avec un rôle minimum dans la communauté ; sinon 404. */
export async function requireCommunityRole(
  communityId: string,
  min: CommunityRole
): Promise<CommunityAccess> {
  const access = await requireMembership(communityId);
  if (!hasCommunityRole(access.membership.role, min)) notFound();
  return access;
}
