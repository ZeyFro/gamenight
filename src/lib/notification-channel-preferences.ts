import type { UserNotificationCategory, UserNotificationChannel } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isPersonalNotificationEnabled, type AvailableNotificationCategory } from "@/lib/notification-preferences";

export const AVAILABLE_NOTIFICATION_CHANNELS = ["IN_APP", "WEB_PUSH", "DISCORD_DM", "DISCORD_MENTION"] as const satisfies readonly UserNotificationChannel[];
export type AvailableNotificationChannel = (typeof AVAILABLE_NOTIFICATION_CHANNELS)[number];

const COVERED_CHANNELS: Record<AvailableNotificationCategory, readonly AvailableNotificationChannel[]> = {
  SESSION: ["IN_APP", "WEB_PUSH", "DISCORD_DM", "DISCORD_MENTION"],
  ROULETTE: ["IN_APP", "WEB_PUSH", "DISCORD_DM"],
  TOURNAMENT: ["DISCORD_DM", "DISCORD_MENTION"],
  INSTANT_SESSION: ["IN_APP", "DISCORD_DM"],
  REWARD: ["IN_APP"],
};

export function isCoveredNotificationChannel(
  category: AvailableNotificationCategory,
  channel: AvailableNotificationChannel,
): boolean {
  return COVERED_CHANNELS[category].includes(channel);
}

export function availableChannelsForCategory(category: AvailableNotificationCategory): readonly AvailableNotificationChannel[] {
  return COVERED_CHANNELS[category];
}

export function isAvailableNotificationChannel(value: string): value is AvailableNotificationChannel {
  return (AVAILABLE_NOTIFICATION_CHANNELS as readonly string[]).includes(value);
}

export type ChannelPreferenceSubject = {
  silenceReminders: boolean;
  notificationPreferences?: { category: UserNotificationCategory; enabled: boolean }[];
};

export function resolveNotificationChannelEnabled(
  user: ChannelPreferenceSubject,
  category: AvailableNotificationCategory,
  channel: AvailableNotificationChannel,
  channelPreference?: { enabled: boolean } | null,
): boolean {
  return isPersonalNotificationEnabled(user, category) && (channelPreference?.enabled ?? true);
}

type PreferenceDb = Pick<typeof prisma, "user" | "userNotificationPreference" | "userNotificationChannelPreference">;

/** Batch read of the legacy/category gate and the channel-specific override. */
export async function filterUsersByNotificationChannelPreference<
  T extends { id: string; silenceReminders: boolean },
>(
  users: T[],
  category: AvailableNotificationCategory,
  channel: AvailableNotificationChannel,
  db: PreferenceDb = prisma,
): Promise<T[]> {
  if (users.length === 0) return [];
  const userIds = [...new Set(users.map(({ id }) => id))];
  const [categoryPreferences, channelPreferences] = await Promise.all([
    db.userNotificationPreference.findMany({
      where: { userId: { in: userIds }, category },
      select: { userId: true, enabled: true },
    }),
    db.userNotificationChannelPreference.findMany({
      where: { userId: { in: userIds }, category, channel },
      select: { userId: true, enabled: true },
    }),
  ]);
  const categoryByUser = new Map(categoryPreferences.map(({ userId, enabled }) => [userId, enabled]));
  const channelByUser = new Map(channelPreferences.map(({ userId, enabled }) => [userId, enabled]));
  return users.filter((user) =>
    resolveNotificationChannelEnabled(
      {
        silenceReminders: user.silenceReminders,
        notificationPreferences: categoryByUser.has(user.id)
          ? [{ category, enabled: categoryByUser.get(user.id)! }]
          : undefined,
      },
      category,
      channel,
      channelByUser.has(user.id) ? { enabled: channelByUser.get(user.id)! } : undefined,
    ),
  );
}

export async function getEligibleUserIdsForNotificationChannel(
  userIds: string[],
  category: AvailableNotificationCategory,
  channel: AvailableNotificationChannel,
  db: PreferenceDb = prisma,
): Promise<Set<string>> {
  const uniqueIds = [...new Set(userIds)];
  if (uniqueIds.length === 0) return new Set();
  const users = await db.user.findMany({
    where: { id: { in: uniqueIds } },
    select: { id: true, silenceReminders: true },
  });
  const eligible = await filterUsersByNotificationChannelPreference(users, category, channel, db);
  return new Set(eligible.map(({ id }) => id));
}

export async function setOwnNotificationChannelPreference(
  authenticatedUserId: string,
  category: AvailableNotificationCategory,
  channel: AvailableNotificationChannel,
  enabled: boolean,
): Promise<void> {
  await prisma.userNotificationChannelPreference.upsert({
    where: { userId_category_channel: { userId: authenticatedUserId, category, channel } },
    create: { userId: authenticatedUserId, category, channel, enabled },
    update: { enabled },
  });
}
