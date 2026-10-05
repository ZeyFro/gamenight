import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";

/**
 * Multi-communautés, PR5 — sélecteur de serveur, derrière
 * `COMMUNITY_PICKER_ENABLED` (exactement `true`, éteint par défaut).
 *
 * Éteint : aucune lecture, aucune redirection, `/serveurs` n'existe pas (404)
 * — comportement strictement identique à avant.
 *
 * Règle centrale : `User.activeCommunityId` n'est qu'une PRÉFÉRENCE
 * d'affichage. Elle est revalidée contre les Membership ACTIVE (communauté
 * ACTIVE) à CHAQUE usage — un départ, un retrait ou une suspension la rend
 * caduque à la requête suivante — et ne donne JAMAIS accès à rien : l'accès
 * reste décidé par `community-access.ts` (`requireMembership`).
 *
 * Ce module ne lit que `User`, `Membership` et `Community` (non collectifs) :
 * il n'a pas besoin d'exception dans `community-scope.test.ts`.
 */

export const SERVEURS_PATH = "/serveurs";

export function isCommunityPickerEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return env.COMMUNITY_PICKER_ENABLED === "true";
}

/**
 * Chemin de retour (`?next=`) : uniquement un chemin interne (`/…`), jamais une
 * URL absolue, un `//hôte`, un antislash ni un caractère de contrôle (open
 * redirect, injection d'en-tête), et jamais `/serveurs` (boucle). Repli : `/`.
 */
export function safeNextPath(next: string | null | undefined): string {
  if (typeof next !== "string" || next === "") return "/";
  if (!/^\/(?![/\\])/.test(next)) return "/";
  if (/[\\\u0000-\u001f\u007f]/.test(next)) return "/";
  if (/^\/serveurs(?:[/?#]|$)/.test(next)) return "/";
  return next;
}

export interface PickableCommunity {
  id: string;
  name: string;
  slug: string;
}

/** Serveurs (communautés ACTIVE) où `userId` a un Membership ACTIVE, du plus ancien au plus récent. */
export async function listPickableCommunities(userId: string): Promise<PickableCommunity[]> {
  const memberships = await prisma.membership.findMany({
    where: { userId, status: "ACTIVE", community: { status: "ACTIVE" } },
    select: { community: { select: { id: true, name: true, slug: true } } },
    orderBy: { joinedAt: "asc" },
  });
  return memberships.map((m) => m.community);
}

export type ActiveCommunityState =
  /** Drapeau éteint : rien à faire. */
  | { kind: "disabled" }
  /** Aucun serveur : message sur `/serveurs`. */
  | { kind: "none" }
  /** Un seul serveur : c'est lui, sans rien enregistrer. */
  | { kind: "single"; communityId: string }
  /** Plusieurs serveurs et un choix encore valide. */
  | { kind: "chosen"; communityId: string }
  /** Plusieurs serveurs, aucun choix valide : l'utilisateur doit choisir. */
  | { kind: "needs-choice"; communityIds: string[] };

/** État du choix de serveur, choix enregistré revalidé contre les Membership ACTIVE. */
export async function getActiveCommunityState(userId: string): Promise<ActiveCommunityState> {
  if (!isCommunityPickerEnabled()) return { kind: "disabled" };
  const communities = await listPickableCommunities(userId);
  if (communities.length === 0) return { kind: "none" };
  if (communities.length === 1) return { kind: "single", communityId: communities[0].id };
  const row = await prisma.user.findUnique({ where: { id: userId }, select: { activeCommunityId: true } });
  const stored = row?.activeCommunityId;
  if (stored && communities.some((c) => c.id === stored)) return { kind: "chosen", communityId: stored };
  return { kind: "needs-choice", communityIds: communities.map((c) => c.id) };
}

/**
 * Enregistre le choix de `userId` si — et seulement si — il a un Membership
 * ACTIVE dans cette communauté ACTIVE. Sinon `false`, rien n'est écrit.
 */
export async function setActiveCommunity(userId: string, communityId: string): Promise<boolean> {
  const membership = await prisma.membership.findFirst({
    where: { userId, communityId, status: "ACTIVE", community: { status: "ACTIVE" } },
    select: { id: true },
  });
  if (!membership) return false;
  await prisma.user.update({ where: { id: userId }, data: { activeCommunityId: communityId } });
  return true;
}

/**
 * Porte des pages (accueil, /sessions, /tournois, /classement) : sans serveur
 * → `/serveurs` (message) ; plusieurs serveurs sans choix valide → `/serveurs`
 * avec le chemin de retour. Éteint, ou un serveur résolu : ne fait rien.
 * `path` = chemin demandé (avec sa query) pour y revenir après le choix.
 */
export async function requireCommunityChosen(userId: string, path: string): Promise<void> {
  const state = await getActiveCommunityState(userId);
  if (state.kind === "none") redirect(SERVEURS_PATH);
  if (state.kind === "needs-choice") redirect(`${SERVEURS_PATH}?next=${encodeURIComponent(path)}`);
}
