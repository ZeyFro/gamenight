import { prisma } from "@/lib/prisma";
import type { UserNotificationCategory } from "@prisma/client";

/** Réglages proposés uniquement parce que tous leurs chemins actuels les respectent. */
export const AVAILABLE_NOTIFICATION_CATEGORIES = ["SESSION", "ROULETTE", "TOURNAMENT", "INSTANT_SESSION"] as const satisfies readonly UserNotificationCategory[];

export type AvailableNotificationCategory = (typeof AVAILABLE_NOTIFICATION_CATEGORIES)[number];

export const NOTIFICATION_CATEGORY_DETAILS: Record<
  AvailableNotificationCategory,
  { label: string; description: string }
> = {
  SESSION: {
    label: "Soirées",
    description: "Créations, modifications et rappels des soirées auxquelles tu es convié.",
  },
  ROULETTE: {
    label: "Roulettes",
    description: "Invitations, rappels et résultats des roulettes du gambling.",
  },
  TOURNAMENT: {
    label: "Tournois",
    description: "Mention à l'ouverture des inscriptions d'un tournoi, si le créateur t'a sélectionné.",
  },
  INSTANT_SESSION: {
    label: "Jouer maintenant",
    description: "Invitation rapide (MP Discord + notification) quand un pote démarre une session instantanée.",
  },
};

export function isAvailableNotificationCategory(value: string): value is AvailableNotificationCategory {
  return (AVAILABLE_NOTIFICATION_CATEGORIES as readonly string[]).includes(value);
}

type PreferenceSubject = {
  silenceReminders: boolean;
  notificationPreferences?: { category: UserNotificationCategory; enabled: boolean }[];
};

/**
 * Source de vérité : une ligne catégorielle explicite prime. Sans ligne
 * (nouveau compte pendant un déploiement progressif, ou rollback partiel),
 * le booléen legacy conserve exactement le comportement historique pour
 * SESSION et ROULETTE, les deux familles qu'il gouvernait réellement.
 */
export function isPersonalNotificationEnabled(
  user: PreferenceSubject,
  category: AvailableNotificationCategory
): boolean {
  return user.notificationPreferences?.find((preference) => preference.category === category)?.enabled
    ?? !user.silenceReminders;
}

/** Filtre central partagé par les webhooks actuels et les futurs résolveurs de l'exécuteur. */
export async function filterUsersByNotificationPreference<T extends { id: string; silenceReminders: boolean }>(
  users: T[],
  category: AvailableNotificationCategory
): Promise<T[]> {
  if (users.length === 0) return [];
  const preferences = await prisma.userNotificationPreference.findMany({
    where: { userId: { in: users.map((user) => user.id) }, category },
    select: { userId: true, enabled: true },
  });
  const enabledByUser = new Map(preferences.map((preference) => [preference.userId, preference.enabled]));
  return users.filter((user) => enabledByUser.get(user.id) ?? !user.silenceReminders);
}

export async function getUserNotificationPreferences(user: PreferenceSubject) {
  return Object.fromEntries(
    AVAILABLE_NOTIFICATION_CATEGORIES.map((category) => [
      category,
      isPersonalNotificationEnabled(user, category),
    ])
  ) as Record<AvailableNotificationCategory, boolean>;
}

/**
 * Écrit une préférence du seul utilisateur authentifié fourni par l'action.
 * SESSION synchronise le champ legacy, car il reste son sens canonique
 * pendant la transition. ROULETTE est désormais indépendante.
 */
export async function setOwnNotificationPreference(
  authenticatedUserId: string,
  category: AvailableNotificationCategory,
  enabled: boolean
): Promise<void> {
  await prisma.$transaction([
    prisma.userNotificationPreference.upsert({
      where: { userId_category: { userId: authenticatedUserId, category } },
      create: { userId: authenticatedUserId, category, enabled },
      update: { enabled },
    }),
    ...(category === "SESSION"
      ? [prisma.user.update({ where: { id: authenticatedUserId }, data: { silenceReminders: !enabled } })]
      : []),
  ]);
}
