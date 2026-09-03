import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import type { Notification, NotificationType } from "@prisma/client";

export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  relatedSessionId?: string;
  relatedBadgeId?: string;
  relatedGameId?: string;
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
    await prisma.notification.create({ data: input });
  } catch (error) {
    logger.error("notifications", error, { userId: input.userId, type: input.type });
  }
}

export async function createNotifications(inputs: CreateNotificationInput[]): Promise<void> {
  if (inputs.length === 0) return;
  try {
    await prisma.notification.createMany({ data: inputs });
  } catch (error) {
    logger.error("notifications", error, { count: inputs.length });
  }
}

export async function getUnreadNotificationCount(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, read: false } });
}

export async function listRecentNotifications(
  userId: string,
  limit = 20
): Promise<Notification[]> {
  return prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

/** Lien vers la page concernée par une notification, `null` si aucune. */
export function notificationHref(
  notification: Pick<Notification, "relatedSessionId" | "relatedBadgeId" | "relatedGameId">
): string | null {
  if (notification.relatedSessionId) return `/sessions/${notification.relatedSessionId}`;
  if (notification.relatedBadgeId) return "/profil/badges";
  // FEATURE 3 (revanche) — même mécanisme de préremplissage que "Proposer
  // une soirée avec ce jeu" depuis une fiche jeu (`?gameId=`), réutilisé
  // tel quel : le bouton "Proposer" de la notif atterrit directement sur
  // le formulaire de création avec ce jeu déjà sélectionné.
  if (notification.relatedGameId) return `/sessions?gameId=${notification.relatedGameId}`;
  return null;
}
