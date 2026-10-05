import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { DEFAULT_COMMUNITY_SLUG } from "@/lib/default-community";
import { getActiveCommunityState, isCommunityPickerEnabled } from "@/lib/community-picker";

/**
 * Multi-communautés, PR4 — isolation des données par communauté, derrière
 * `COMMUNITY_ISOLATION_ENABLED` (exactement `true`, éteint par défaut).
 *
 * Éteint : AUCUN filtre (chaque fonction renvoie `null` / `{}`), aucune
 * lecture en base — comportement strictement identique à avant.
 *
 * Allumé : un utilisateur ne voit que les données des communautés ACTIVE où
 * il a un Membership ACTIVE (relu en base à chaque appel, jamais dans le JWT).
 * `communityId = null` désigne la communauté `default` (lignes historiques) :
 * elles ne sont visibles qu'à ses membres. Fail-closed : sans aucune
 * communauté, rien n'est visible.
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

/** `null` si l'isolation est éteinte (aucun filtre à appliquer). */
export async function getIsolationScope(userId: string): Promise<IsolationScope | null> {
  if (!isCommunityIsolationEnabled()) return null;
  const memberships = await prisma.membership.findMany({
    where: { userId, status: "ACTIVE", community: { status: "ACTIVE" } },
    select: { communityId: true, community: { select: { slug: true } } },
  });
  return {
    communityIds: memberships.map((m) => m.communityId),
    includesDefault: memberships.some((m) => m.community.slug === DEFAULT_COMMUNITY_SLUG),
  };
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
  if (!isCommunityIsolationEnabled()) return {};
  let id = communityId;
  if (id === null) {
    const fallback = await prisma.community.findUnique({
      where: { slug: DEFAULT_COMMUNITY_SLUG },
      select: { id: true },
    });
    if (!fallback) return { id: { in: [] } };
    id = fallback.id;
  }
  return { memberships: { some: { communityId: id, status: "ACTIVE" } } };
}

/**
 * `viewerId` peut-il voir la fiche de `poteId` ? À vérifier dans CHAQUE page
 * `/potes/[id]/*` : un `layout` Next n'est pas garanti de s'exécuter avant ses
 * pages enfants (navigation côté client), il ne suffit donc pas seul.
 */
export async function canViewPote(viewerId: string, poteId: string): Promise<boolean> {
  if (!isCommunityIsolationEnabled() || viewerId === poteId) return true;
  const where = memberUserWhere(await getIsolationScope(viewerId));
  return (await prisma.user.findFirst({ where: { id: poteId, ...where }, select: { id: true } })) !== null;
}

/**
 * Potes proposables à la création d'une soirée/tournoi (invités, mentions) :
 * les membres de la communauté active du créateur ; personne s'il n'en a
 * aucune (jamais le roster de la communauté par défaut par défaut).
 */
export async function creationMemberUserWhere(userId: string): Promise<Prisma.UserWhereInput> {
  if (!isCommunityIsolationEnabled()) return {};
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
  if (isCommunityPickerEnabled()) {
    const state = await getActiveCommunityState(userId);
    if (state.kind === "none") return null;
    if (state.kind === "single" || state.kind === "chosen") return state.communityId;
  }
  const memberships = await prisma.membership.findMany({
    where: { userId, status: "ACTIVE", community: { status: "ACTIVE" } },
    select: { communityId: true, community: { select: { slug: true } } },
    orderBy: { joinedAt: "asc" },
  });
  if (memberships.length === 0) return null;
  return (memberships.find((m) => m.community.slug === DEFAULT_COMMUNITY_SLUG) ?? memberships[0]).communityId;
}

/**
 * Périmètre de la SEULE communauté « active » de l'utilisateur (voir
 * `resolveActiveCommunityId`), pour les surfaces qui ne montrent qu'un serveur à
 * la fois (chat global, dettes de l'accueil). `null` si l'isolation est éteinte ;
 * périmètre vide (rien de visible) si l'utilisateur n'a aucune communauté. Les
 * lignes historiques `communityId = null` ne sont visibles que si la communauté
 * active est `default`.
 */
export async function resolveActiveCommunityScope(userId: string): Promise<IsolationScope | null> {
  if (!isCommunityIsolationEnabled()) return null;
  const communityId = await resolveActiveCommunityId(userId);
  if (communityId === null) return { communityIds: [], includesDefault: false };
  const community = await prisma.community.findUnique({ where: { id: communityId }, select: { slug: true } });
  return { communityIds: [communityId], includesDefault: community?.slug === DEFAULT_COMMUNITY_SLUG };
}
