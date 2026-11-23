import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { creationMemberUserWhere, getIsolationScope } from "@/lib/community-isolation";
import { communityIdFilter } from "@/lib/community-isolation";
import { getScopedPrisma } from "@/lib/community-scoped-client";
import { effectiveVisibility } from "@/lib/session-visibility";
import { wallClockNow } from "@/lib/wallclock";
import { profileVisibilityWhere } from "@/lib/profile-visibility";
import {
  FRIEND_SEARCH_LIMIT,
  friendPairKey,
  isFriendsEnabled,
  normalizeFriendSearch,
  relationFor,
  type FriendRelation,
} from "@/lib/friends-rules";

/**
 * Potes = amis (cahier C128). Demande d'ami à accepter, recherche par pseudo. Une seule ligne `Friendship` par paire
 * de membres (`pairKey`). Toute écriture exige que l'autre personne soit un membre ACTIF de la communauté active du
 * demandeur et que son profil ne soit pas masqué (`PROFILE_VISIBILITY_ENABLED`) : un profil masqué n'est ni trouvé
 * ni demandable. Aucune notification (ni MP ni annonce) : la demande se voit dans `/potes`.
 */
export type SendResult = "sent" | "accepted" | "already_friends" | "already_sent" | "not_found" | "self" | "disabled";
export type RespondResult = "accepted" | "declined" | "not_found" | "disabled";

async function visibleMember(viewerId: string, targetId: string): Promise<boolean> {
  const found = await prisma.user.findFirst({
    where: { AND: [{ id: targetId }, await creationMemberUserWhere(viewerId), profileVisibilityWhere()] },
    select: { id: true },
  });
  return found !== null;
}

export async function sendFriendRequest(viewerId: string, targetId: string, retry = true): Promise<SendResult> {
  if (!isFriendsEnabled()) return "disabled";
  if (viewerId === targetId) return "self";
  if (!(await visibleMember(viewerId, targetId))) return "not_found";
  const pairKey = friendPairKey(viewerId, targetId);
  const existing = await prisma.friendship.findUnique({ where: { pairKey } });
  if (!existing) {
    try {
      await prisma.friendship.create({ data: { requesterId: viewerId, addresseeId: targetId, pairKey } });
      return "sent";
    } catch (error) {
      // Deux demandes croisées en même temps : l'autre a gagné la course, on relit la ligne unique.
      if (retry && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return sendFriendRequest(viewerId, targetId, false);
      throw error;
    }
  }
  if (existing.status === "ACCEPTED") return "already_friends";
  if (existing.status === "PENDING") {
    if (existing.requesterId === viewerId) return "already_sent";
    // Demande croisée : l'autre m'avait déjà demandé, la mienne vaut acceptation.
    const updated = await prisma.friendship.updateMany({ where: { id: existing.id, status: "PENDING" }, data: { status: "ACCEPTED", respondedAt: new Date() } });
    return updated.count === 1 ? "accepted" : "already_friends";
  }
  // DECLINED : celui qui a refusé peut demander ; celui qui s'est fait refuser reste sur « demande envoyée ».
  if (existing.addresseeId !== viewerId) return "already_sent";
  const reopened = await prisma.friendship.updateMany({
    where: { id: existing.id, status: "DECLINED" },
    data: { requesterId: viewerId, addresseeId: targetId, status: "PENDING", respondedAt: null, createdAt: new Date() },
  });
  return reopened.count === 1 ? "sent" : "already_sent";
}

/** Seul le destinataire répond, et seulement à une demande en attente. */
export async function respondFriendRequest(viewerId: string, friendshipId: string, accept: boolean): Promise<RespondResult> {
  if (!isFriendsEnabled()) return "disabled";
  const updated = await prisma.friendship.updateMany({
    where: { id: friendshipId, addresseeId: viewerId, status: "PENDING" },
    data: { status: accept ? "ACCEPTED" : "DECLINED", respondedAt: new Date() },
  });
  if (updated.count !== 1) return "not_found";
  return accept ? "accepted" : "declined";
}

/** Le demandeur retire sa demande en attente (ou refusée : elle disparaît pour lui). */
export async function cancelFriendRequest(viewerId: string, friendshipId: string): Promise<boolean> {
  if (!isFriendsEnabled()) return false;
  const removed = await prisma.friendship.deleteMany({ where: { id: friendshipId, requesterId: viewerId, status: { in: ["PENDING", "DECLINED"] } } });
  return removed.count === 1;
}

/** Retire une amitié (l'un ou l'autre) ; chacun pourra redemander plus tard. */
export async function removeFriend(viewerId: string, otherId: string): Promise<boolean> {
  if (!isFriendsEnabled()) return false;
  const removed = await prisma.friendship.deleteMany({ where: { pairKey: friendPairKey(viewerId, otherId), status: "ACCEPTED" } });
  return removed.count === 1;
}

/** Identifiants de mes amis. Éteint : liste vide (l'appelant ne filtre pas). */
export async function listFriendIds(viewerId: string): Promise<string[]> {
  if (!isFriendsEnabled()) return [];
  const rows = await prisma.friendship.findMany({
    where: { status: "ACCEPTED", OR: [{ requesterId: viewerId }, { addresseeId: viewerId }] },
    select: { requesterId: true, addresseeId: true },
  });
  return rows.map((row) => (row.requesterId === viewerId ? row.addresseeId : row.requesterId));
}

export interface FriendRequestRow {
  id: string;
  userId: string;
  name: string;
  avatar: string | null;
  createdAt: Date;
}

/** Demandes reçues en attente, et demandes envoyées (en attente, ou refusées en silence). Les comptes sans profil visible n'apparaissent pas. */
export async function listFriendRequests(viewerId: string): Promise<{ incoming: FriendRequestRow[]; outgoing: FriendRequestRow[] }> {
  if (!isFriendsEnabled()) return { incoming: [], outgoing: [] };
  const [incoming, outgoing] = await Promise.all([
    prisma.friendship.findMany({
      where: { addresseeId: viewerId, status: "PENDING", requester: profileVisibilityWhere() },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, createdAt: true, requester: { select: { id: true, discordName: true, discordAvatar: true } } },
    }),
    prisma.friendship.findMany({
      where: { requesterId: viewerId, status: { in: ["PENDING", "DECLINED"] }, addressee: profileVisibilityWhere() },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, createdAt: true, addressee: { select: { id: true, discordName: true, discordAvatar: true } } },
    }),
  ]);
  return {
    incoming: incoming.map((row) => ({ id: row.id, userId: row.requester.id, name: row.requester.discordName, avatar: row.requester.discordAvatar, createdAt: row.createdAt })),
    outgoing: outgoing.map((row) => ({ id: row.id, userId: row.addressee.id, name: row.addressee.discordName, avatar: row.addressee.discordAvatar, createdAt: row.createdAt })),
  };
}

export interface FriendSearchHit {
  id: string;
  name: string;
  avatar: string | null;
  relation: FriendRelation;
}

/**
 * Recherche par pseudo parmi les membres ACTIFS de ma communauté active, jamais moi, jamais un profil masqué.
 * Requête trop courte ou trop longue : aucun résultat et aucune requête base.
 */
export async function searchMembersByName(viewerId: string, rawQuery: unknown): Promise<FriendSearchHit[]> {
  if (!isFriendsEnabled()) return [];
  const query = normalizeFriendSearch(rawQuery);
  if (!query) return [];
  const users = await prisma.user.findMany({
    where: { AND: [{ id: { not: viewerId } }, await creationMemberUserWhere(viewerId), profileVisibilityWhere(), { discordName: { contains: query, mode: "insensitive" } }] },
    orderBy: [{ discordName: "asc" }, { id: "asc" }],
    take: FRIEND_SEARCH_LIMIT,
    select: { id: true, discordName: true, discordAvatar: true },
  });
  if (users.length === 0) return [];
  const rows = await prisma.friendship.findMany({
    where: { pairKey: { in: users.map((user) => friendPairKey(viewerId, user.id)) } },
    select: { pairKey: true, requesterId: true, status: true },
  });
  const byKey = new Map(rows.map((row) => [row.pairKey, row]));
  return users.map((user) => ({
    id: user.id,
    name: user.discordName,
    avatar: user.discordAvatar,
    relation: relationFor(viewerId, user.id, byKey.get(friendPairKey(viewerId, user.id)) ?? null),
  }));
}

/** Relation entre moi et un membre (fiche d'un non-ami : bouton « Demander en ami » ou état). */
export async function getFriendRelation(viewerId: string, otherId: string): Promise<FriendRelation> {
  if (viewerId === otherId) return "self";
  if (!isFriendsEnabled()) return "friend";
  const row = await prisma.friendship.findUnique({ where: { pairKey: friendPairKey(viewerId, otherId) }, select: { requesterId: true, status: true } });
  return relationFor(viewerId, otherId, row);
}

export interface StrangerSessions {
  /** Soirées à venir ouvertes à tous les membres du serveur : on peut les rejoindre (publique) ou candidater. */
  open: { id: string; date: Date; kind: "PUBLIC" | "APPLICATION" }[];
  /** Nombre de soirées à venir PRIVÉES (sur invitation) : jamais de date, de jeu, d’invités ni d’identifiant. */
  privateCount: number;
}

/**
 * Ce qu’un non-ami voit des soirées d’un membre : pour chaque soirée à venir de son serveur, seulement SI elle est
 * publique (il peut la rejoindre), sur candidature, ou privée (sur invitation). Les soirées privées ne sont que
 * comptées, sans aucun détail. L’accès au contenu d’une soirée reste celui des invitations (session-access.ts).
 * Visibilité des soirées éteinte (SESSION_VISIBILITY_ENABLED) : toutes comptent comme privées.
 */
export async function listStrangerSessions(viewerId: string, poteId: string, now: Date = wallClockNow()): Promise<StrangerSessions> {
  const scope = await getIsolationScope(viewerId);
  const scopedDb = await getScopedPrisma(viewerId);
  const rows = await scopedDb.session.findMany({
    where: { AND: [{ createdById: poteId }, { status: { in: ["VOTING", "SCHEDULED"] } }, { date: { gt: now } }, communityIdFilter(scope)] },
    orderBy: { date: "asc" },
    take: 50,
    select: { id: true, date: true, visibility: true },
  });
  const open: StrangerSessions["open"] = [];
  let privateCount = 0;
  for (const row of rows) {
    const visibility = effectiveVisibility(row.visibility);
    if (visibility === "PUBLIC" || visibility === "APPLICATION") open.push({ id: row.id, date: row.date, kind: visibility });
    else privateCount += 1;
  }
  return { open, privateCount };
}
