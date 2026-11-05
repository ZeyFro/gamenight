import { logger } from "@/lib/logger";
import type { Notification, NotificationType } from "@prisma/client";
import { getActiveScopedPrisma, scopedPrismaForCommunity } from "@/lib/community-scoped-client";
import { sendUserWebPush } from "@/lib/web-push-delivery";
import { getEligibleUserIdsForNotificationChannel } from "@/lib/notification-channel-preferences";
import type { AvailableNotificationChannel } from "@/lib/notification-channel-preferences";
import type { AvailableNotificationCategory } from "@/lib/notification-preferences";

export interface CreateNotificationInput {
  communityId: string | null;
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  relatedSessionId?: string;
  relatedBadgeId?: string;
  relatedGameId?: string;
  personalCategory?: AvailableNotificationCategory;
}

function requireNotificationCommunity(input: CreateNotificationInput): void {
  if (input.communityId === undefined) throw new Error("La communauté de la notification doit être explicite.");
}

/**
 * Notifications in-app (Sprint 2 PR-C, U3) — une ligne écrite EN PLUS de
 * chaque webhook Discord déjà envoyé (mêmes événements, mêmes données),
 * jamais à sa place. `relatedSessionId`/`relatedBadgeId` sont des ids
 * "libres" (pas de relation Prisma) — voir le commentaire sur le modèle
 * `Notification` dans schema.prisma.
 *
 * Best-effort volontaire : une erreur d'écriture ici ne doit jamais faire
 * échouer l'action qui vient de réussir (créer une soirée, débloquer un
 * badge...) — même philosophie que `postToDiscord`, qui ne lève jamais
 * non plus. Loggée pour rester visible sans bloquer personne.
 */
export async function createNotification(input: CreateNotificationInput): Promise<void> {
  try {
    requireNotificationCommunity(input);
  } catch (error) {
    logger.error("notifications", error, { userId: input.userId, type: input.type });
    return;
  }
  try {
    const inApp = await eligibleInputs([input], "IN_APP");
    const push = await eligibleInputs([input], "WEB_PUSH");
    if (inApp.length > 0) await writeInApp(inApp, true);
    if (push.length > 0) await deliverWebPush(push[0]);
  } catch (error) {
    logger.error("notifications", error, { userId: input.userId, type: input.type });
  }
}

export async function createNotifications(inputs: CreateNotificationInput[]): Promise<void> {
  if (inputs.length === 0) return;
  try {
    for (const input of inputs) requireNotificationCommunity(input);
  } catch (error) {
    logger.error("notifications", error, { count: inputs.length });
    return;
  }
  try {
    const [inApp, push] = await Promise.all([
      eligibleInputs(inputs, "IN_APP"),
      eligibleInputs(inputs, "WEB_PUSH"),
    ]);
    await writeInApp(inApp, false);
    for (const input of push) await deliverWebPush(input);
  } catch (error) {
    logger.error("notifications", error, { count: inputs.length });
  }
}

async function eligibleInputs(
  inputs: CreateNotificationInput[],
  channel: Extract<AvailableNotificationChannel, "IN_APP" | "WEB_PUSH">,
): Promise<CreateNotificationInput[]> {
  const byCategory = new Map<AvailableNotificationCategory, CreateNotificationInput[]>();
  const eligible = inputs.filter((input) => input.personalCategory === undefined);
  for (const input of inputs) {
    if (!input.personalCategory) continue;
    byCategory.set(input.personalCategory, [...(byCategory.get(input.personalCategory) ?? []), input]);
  }
  for (const [category, group] of byCategory) {
    const allowedIds = await getEligibleUserIdsForNotificationChannel(group.map(({ userId }) => userId), category, channel);
    eligible.push(...group.filter(({ userId }) => allowedIds.has(userId)));
  }
  return eligible;
}

async function writeInApp(inputs: CreateNotificationInput[], single: boolean): Promise<void> {
  if (inputs.length === 0) return;
  const groups = new Map<string | null, CreateNotificationInput[]>();
  for (const input of inputs) groups.set(input.communityId, [...(groups.get(input.communityId) ?? []), input]);
  for (const [communityId, group] of groups) {
    try {
      const scopedDb = scopedPrismaForCommunity(communityId);
      const data = group.map(({ personalCategory: _personalCategory, ...row }) => row);
      if (single) await scopedDb.notification.create({ data: data[0] });
      else await scopedDb.notification.createMany({ data });
    } catch (error) {
      logger.error("notifications", error, { count: group.length });
    }
  }
}

async function deliverWebPush(input: CreateNotificationInput): Promise<void> {
  try {
    const href = notificationHref({
      type: input.type,
      relatedSessionId: input.relatedSessionId ?? null,
      relatedBadgeId: input.relatedBadgeId ?? null,
      relatedGameId: input.relatedGameId ?? null,
    });
    await sendUserWebPush(input.userId, { title: input.title, body: input.message, url: href ?? "/" });
  } catch {
    logger.warn("notifications", "Échec de notification push.", { userId: input.userId, type: input.type });
  }
}

export async function getUnreadNotificationCount(userId: string): Promise<number> {
  const scopedDb = await getActiveScopedPrisma(userId);
  return scopedDb.notification.count({ where: { userId, read: false } });
}

export async function listRecentNotifications(
  userId: string,
  limit = 20
): Promise<Notification[]> {
  const scopedDb = await getActiveScopedPrisma(userId);
  return scopedDb.notification.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

/** Lien vers la page concernée par une notification, `null` si aucune. */
export function notificationHref(
  notification: Pick<Notification, "type" | "relatedSessionId" | "relatedBadgeId" | "relatedGameId">
): string | null {
  // V2 ("Jouer maintenant") — `relatedSessionId` réutilisé pour porter
  // l'id de l'`InstantSession` (même champ "libre", pas de nouvelle
  // colonne dédiée) : SEUL ce type précis pointe vers
  // `/jouer-maintenant/<id>` plutôt que `/sessions/<id>`.
  if (notification.type === "INSTANT_SESSION_INVITE" && notification.relatedSessionId) {
    return `/jouer-maintenant/${notification.relatedSessionId}`;
  }
  if (notification.relatedSessionId) return `/sessions/${notification.relatedSessionId}`;
  if (notification.relatedBadgeId) return "/profil/badges";
  // FEATURE 3 (revanche) — même mécanisme de préremplissage que "Proposer
  // une soirée avec ce jeu" depuis une fiche jeu (`?gameId=`), réutilisé
  // tel quel : le bouton "Proposer" de la notif atterrit directement sur
  // le formulaire de création avec ce jeu déjà sélectionné.
  if (notification.relatedGameId) return `/sessions?gameId=${notification.relatedGameId}`;
  return null;
}

export interface GroupedNotificationItem {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  read: boolean;
  createdAtIso: string;
  href: string | null;
  /** > 1 pour une ligne regroupée ("5 récompenses pour la soirée X"). */
  count: number;
}

/**
 * Regroupe les notifications SUPERLATIVE_AWARD d'une même soirée en une
 * seule ligne (Amélioration des features existantes, PR-B, item 4 — ex.
 * "5 récompenses pour la soirée Deadlock" plutôt que 5 lignes "X a
 * gagné..."). Les autres types ne sont jamais groupés : chacun reste un
 * événement distinct, déjà court en une ligne (level up, badge, dette...).
 * `relatedSessionId` étant un id "libre" (pas de relation Prisma, cf.
 * commentaire sur le modèle `Notification`), le nom du jeu est re-résolu
 * ici via une requête dédiée plutôt que stocké sur la notification.
 */
export async function groupNotifications(
  items: Pick<
    Notification,
    "id" | "type" | "title" | "message" | "read" | "createdAt" | "relatedSessionId" | "relatedBadgeId" | "relatedGameId"
  >[],
  viewerId?: string
): Promise<GroupedNotificationItem[]> {
  if (!viewerId) return [];
  const scopedDb = await getActiveScopedPrisma(viewerId);
  const visible = await scopedDb.notification.findMany({ where: { userId: viewerId, id: { in: items.map((item) => item.id) } }, select: { id: true } });
  const visibleIds = new Set(visible.map((item) => item.id));
  items = items.filter((item) => visibleIds.has(item.id));
  const awardSessionIds = [
    ...new Set(
      items
        .filter((n) => n.type === "SUPERLATIVE_AWARD" && n.relatedSessionId)
        .map((n) => n.relatedSessionId as string)
    ),
  ];
  const sessions = awardSessionIds.length
    ? await scopedDb.session.findMany({
        where: { id: { in: awardSessionIds } },
        select: { id: true, decidedGame: { select: { name: true } } },
      })
    : [];
  const gameNameBySession = new Map(sessions.map((s) => [s.id, s.decidedGame?.name ?? "ce jeu"]));

  const countBySession = new Map<string, number>();
  for (const n of items) {
    if (n.type !== "SUPERLATIVE_AWARD" || !n.relatedSessionId) continue;
    countBySession.set(n.relatedSessionId, (countBySession.get(n.relatedSessionId) ?? 0) + 1);
  }

  const seenSessions = new Set<string>();
  const result: GroupedNotificationItem[] = [];
  for (const n of items) {
    if (n.type === "SUPERLATIVE_AWARD" && n.relatedSessionId) {
      if (seenSessions.has(n.relatedSessionId)) continue;
      seenSessions.add(n.relatedSessionId);
      const count = countBySession.get(n.relatedSessionId) ?? 1;
      const gameName = gameNameBySession.get(n.relatedSessionId) ?? "ce jeu";
      result.push({
        id: n.id,
        type: n.type,
        title: "🏆 Récompenses",
        message:
          count > 1 ? `${count} récompenses pour la soirée ${gameName}` : n.message,
        read: n.read,
        createdAtIso: n.createdAt.toISOString(),
        href: `/sessions/${n.relatedSessionId}`,
        count,
      });
      continue;
    }
    result.push({
      id: n.id,
      type: n.type,
      title: n.title,
      message: n.message,
      read: n.read,
      createdAtIso: n.createdAt.toISOString(),
      href: notificationHref(n),
      count: 1,
    });
  }
  return result;
}
