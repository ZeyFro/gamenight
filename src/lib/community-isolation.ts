import { communityRead } from "@/lib/community-read-context";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { DEFAULT_COMMUNITY_SLUG } from "@/lib/default-community";
import { getActiveCommunityState, isCommunityPickerEnabled } from "@/lib/community-picker";

/**
 * Multi-communautés, PR4 — les données collectives sont toujours limitées aux
 * communautés ACTIVE où l'utilisateur a un Membership ACTIVE (relu en base à
 * chaque appel, jamais dans le JWT). L'interrupteur n'accorde aucun droit.
 * `communityId = null` désigne la communauté `default` (lignes historiques) :
 * elles ne sont visibles qu'à ses membres. Fail-closed : sans aucune
 * communauté, rien n'est visible. Seuls les appels système explicites peuvent
 * demander un scope global (`null`).
 *
 * Attention aux opérateurs Prisma : un `OR` vide ne renvoie RIEN mais un `AND`
 * vide renvoie TOUT. Ici le filtre est toujours un `OR` non vide.
 *
 * Ce module ne lit que des modèles non collectifs (Membership, Community) :
 * il n'a donc pas besoin d'exception dans `community-scope.test.ts`.
 */

export function isCommunityIsolationEnabled(): boolean {
  return process.env.COMMUNITY_ISOLATION_ENABLED === "true";
}

export interface IsolationScope {
  communityIds: string[];
  /** La communauté `default` en fait partie : les lignes `communityId = null` sont visibles. */
  includesDefault: boolean;
}

/** Portée collective d'un utilisateur ; une portée vide donne zéro droit. */
export async function getIsolationScope(userId: string): Promise<IsolationScope> {
  return communityRead(`getIsolationScope:${userId}`, async () => {
    const memberships = await prisma.membership.findMany({
      where: { userId, status: "ACTIVE", community: { status: "ACTIVE" } },
      select: { communityId: true, community: { select: { slug: true } } },
    });
    return {
      communityIds: memberships.map((m) => m.communityId),
      includesDefault: memberships.some((m) => m.community.slug === DEFAULT_COMMUNITY_SLUG),
    };
  });
}

/** Filtre des lignes `Session` / `Tournament` (colonne `communityId` nullable). */
export function communityIdFilter(scope: IsolationScope | null): {
  OR?: Array<{ communityId: { in: string[] } | null }>;
} {
  if (!scope) return {};
  return {
    OR: [
      { communityId: { in: scope.communityIds } },
      ...(scope.includesDefault ? [{ communityId: null }] : []),
    ],
  };
}

/** Potes visibles : membres ACTIVE d'au moins une des communautés de l'utilisateur. */
export function memberUserWhere(scope: IsolationScope | null): Prisma.UserWhereInput {
  if (!scope) return {};
  return { memberships: { some: { communityId: { in: scope.communityIds }, status: "ACTIVE" } } };
}

export async function memberUserWhereFor(userId: string): Promise<Prisma.UserWhereInput> {
  return memberUserWhere(await getIsolationScope(userId));
}

/**
 * Membres ACTIVE d'UNE communauté (`null` = `default`) : sert à restreindre
 * les invités et les destinataires de mention à la communauté de la soirée ou
 * du tournoi, quelles que soient les autres communautés de l'invitant.
 */
export async function communityMemberUserWhere(communityId: string | null): Promise<Prisma.UserWhereInput> {
  let id = communityId;
  if (id === null) {
    const fallback = await prisma.community.findUnique({
      where: { slug: DEFAULT_COMMUNITY_SLUG },
      select: { id: true },
    });
    if (!fallback) return { id: { in: [] } };
    id = fallback.id;
  }
  return { memberships: { some: { communityId: id, status: "ACTIVE", community: { status: "ACTIVE" } } } };
}

/**
 * `viewerId` peut-il voir la fiche de `poteId` ? À vérifier dans CHAQUE page
 * `/potes/[id]/*` : un `layout` Next n'est pas garanti de s'exécuter avant ses
 * pages enfants (navigation côté client), il ne suffit donc pas seul.
 */
export async function canViewPote(viewerId: string, poteId: string): Promise<boolean> {
  if (viewerId === poteId) return true;
  const scope = await getIsolationScope(viewerId);
  const where = memberUserWhere(scope);
  return (await prisma.user.findFirst({ where: { id: poteId, ...where }, select: { id: true } })) !== null;
}

/**
 * Potes proposables à la création d'une soirée/tournoi (invités, mentions) :
 * les membres de la communauté active du créateur ; personne s'il n'en a
 * aucune (jamais le roster de la communauté par défaut par défaut).
 */
export async function creationMemberUserWhere(userId: string): Promise<Prisma.UserWhereInput> {
  const scope = await getIsolationScope(userId);
  if (scope.communityIds.length === 0 && !scope.includesDefault) return { id: { in: [] } };
  const communityId = await resolveActiveCommunityId(userId);
  if (communityId === null) return { id: { in: [] } };
  return { memberships: { some: { communityId, status: "ACTIVE" } } };
}

/**
 * Communauté « active » d'un utilisateur. Sélecteur allumé
 * (`COMMUNITY_PICKER_ENABLED`) : son serveur unique, ou le choix enregistré
 * s'il est encore valide (revalidé en base). Sinon — éteint, ou plusieurs
 * serveurs sans choix valide — règle provisoire : la communauté par défaut
 * s'il en est membre, sinon sa plus ancienne. `null` si aucune.
 */
export async function resolveActiveCommunityId(userId: string): Promise<string | null> {
  return communityRead(`resolveActiveCommunityId:${userId}`, async () => {
    if (isCommunityPickerEnabled()) {
      const state = await getActiveCommunityState(userId);
      if (state.kind === "none") return null;
      if (state.kind === "needs-choice") return null;
      if (state.kind === "single" || state.kind === "chosen") return state.communityId;
    }
    const memberships = await prisma.membership.findMany({
      where: { userId, status: "ACTIVE", community: { status: "ACTIVE" } },
      select: { communityId: true, community: { select: { slug: true } } },
      orderBy: { joinedAt: "asc" },
    });
    if (memberships.length === 0) return null;
    return (memberships.find((m) => m.community.slug === DEFAULT_COMMUNITY_SLUG) ?? memberships[0]).communityId;
  });
}

/**
 * Périmètre de la SEULE communauté « active » de l'utilisateur (voir
 * `resolveActiveCommunityId`), pour les surfaces qui ne montrent qu'un serveur à
 * la fois (chat global, dettes de l'accueil). Le scope vide refuse tout sans
 * adhésion. Les
 * lignes historiques `communityId = null` ne sont visibles que si la communauté
 * active est `default`.
 */
export async function resolveActiveCommunityScope(userId: string): Promise<IsolationScope> {
  return communityRead(`resolveActiveCommunityScope:${userId}`, async () => {
    const communityId = await resolveActiveCommunityId(userId);
    if (communityId === null) return { communityIds: [], includesDefault: false };
    const community = await prisma.community.findUnique({ where: { id: communityId }, select: { slug: true } });
    return { communityIds: [communityId], includesDefault: community?.slug === DEFAULT_COMMUNITY_SLUG };
  });
}

/** Périmètre système des crons : communautés actives seulement, sans autorité issue d'un JWT. */
export async function cronCommunityScope(): Promise<IsolationScope | null> {
  if (!isCommunityIsolationEnabled()) return null;
  const communities = await prisma.community.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, slug: true },
  });
  return {
    communityIds: communities.map((c) => c.id),
    includesDefault: communities.some((c) => c.slug === DEFAULT_COMMUNITY_SLUG),
  };
}

/** Clés collectives requises : les crons traitent default seule quand l'isolation est éteinte. */
export async function listCronCommunityIds(): Promise<string[]> {
  if (!isCommunityIsolationEnabled()) {
    const { getDefaultCommunityId } = await import("@/lib/default-community");
    return [await getDefaultCommunityId()];
  }
  return (await cronCommunityScope())!.communityIds;
}

/** Relu à la livraison : un départ/suspension coupe aussi les MP déjà en attente. */
export async function isMemberOfCommunity(userId: string, communityId: string | null): Promise<boolean> {
  let id = communityId;
  if (id === null) {
    const community = await prisma.community.findUnique({
      where: { slug: DEFAULT_COMMUNITY_SLUG },
      select: { id: true },
    });
    if (!community) return false;
    id = community.id;
  }
  return (await prisma.membership.findFirst({
    where: { userId, communityId: id, status: "ACTIVE", community: { status: "ACTIVE" } },
    select: { id: true },
  })) !== null;
}
