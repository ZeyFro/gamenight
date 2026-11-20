import { prisma } from "@/lib/prisma";
import { resolveActiveCommunityId } from "@/lib/community-isolation";
import { scopedPrismaForCommunity } from "@/lib/community-scoped-client";
import { createNotifications } from "@/lib/notifications";

/**
 * Centre de notifications (sujet I) — interrupteur `NOTIFICATION_CENTER_ENABLED`, OFF par défaut :
 * actif seulement si la valeur vaut exactement `true`. Éteint : /notifications répond 404 et
 * aucune écriture opt-in n'a lieu (la cloche existante et les préférences #406 ne changent pas).
 */
export function isNotificationCenterEnabled(): boolean {
  return process.env.NOTIFICATION_CENTER_ENABLED === "true";
}

export const MAX_GAME_PING_OPT_INS = 50;

export type GamePingResult = "ok" | "disabled" | "no_community" | "unknown_game" | "too_many";

/** Communauté de l'opt-in : celle de l'utilisateur, uniquement s'il en est membre ACTIF (revalidé en base). */
async function optInCommunityId(userId: string): Promise<string | null> {
  return resolveActiveCommunityId(userId);
}

/**
 * Active ou coupe le ping d'un jeu pour l'utilisateur authentifié SEUL (jamais pour un autre).
 * Le consentement est explicite et révocable : aucune ligne n'est créée sans appel volontaire.
 */
export async function setOwnGamePingOptIn(userId: string, gameId: string, enabled: boolean): Promise<GamePingResult> {
  if (!isNotificationCenterEnabled()) return "disabled";
  const communityId = await optInCommunityId(userId);
  if (!communityId) return "no_community";
  const scopedDb = scopedPrismaForCommunity(communityId);
  if (!enabled) {
    await scopedDb.gamePingOptIn.deleteMany({ where: { userId, communityId, gameId } });
    return "ok";
  }
  const game = await prisma.game.findUnique({ where: { id: gameId }, select: { id: true } });
  if (!game) return "unknown_game";
  const existing = await scopedDb.gamePingOptIn.count({ where: { userId, communityId } });
  if (existing >= MAX_GAME_PING_OPT_INS) return "too_many";
  await scopedDb.gamePingOptIn.upsert({
    where: { userId_communityId_gameId: { userId, communityId, gameId } },
    create: { userId, communityId, gameId },
    update: {},
  });
  return "ok";
}

export async function listOwnGamePingOptIns(userId: string): Promise<{ gameId: string; name: string }[]> {
  if (!isNotificationCenterEnabled()) return [];
  const communityId = await optInCommunityId(userId);
  if (!communityId) return [];
  const rows = await scopedPrismaForCommunity(communityId).gamePingOptIn.findMany({
    where: { userId, communityId },
    select: { gameId: true, game: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((row) => ({ gameId: row.gameId, name: row.game.name }));
}

export async function countGamePingOptIns(communityId: string, gameId: string): Promise<number> {
  return scopedPrismaForCommunity(communityId).gamePingOptIn.count({ where: { communityId, gameId } });
}

/**
 * Notification dans l'app (jamais de MP, jamais de mention) aux seuls abonnés opt-in d'un jeu,
 * membres encore ACTIFS de la communauté. `excludeUserId` : l'auteur n'est pas notifié.
 * Retourne le nombre de destinataires.
 */
export async function notifyGamePingOptIns(input: {
  communityId: string;
  gameId: string;
  title: string;
  message: string;
  excludeUserId?: string;
}): Promise<number> {
  if (!isNotificationCenterEnabled()) return 0;
  const rows = await scopedPrismaForCommunity(input.communityId).gamePingOptIn.findMany({
    where: {
      communityId: input.communityId,
      gameId: input.gameId,
      ...(input.excludeUserId ? { userId: { not: input.excludeUserId } } : {}),
      user: { memberships: { some: { communityId: input.communityId, status: "ACTIVE" } } },
    },
    select: { userId: true },
  });
  if (rows.length === 0) return 0;
  await createNotifications(
    rows.map(({ userId }) => ({
      communityId: input.communityId,
      userId,
      type: "SESSION_CREATED" as const,
      title: input.title,
      message: input.message,
      relatedGameId: input.gameId,
    })),
  );
  return rows.length;
}
