import { Prisma } from "@prisma/client";

/** Correlated to attempt alias `a`; enqueue/PENDING never starts the appeal clock. */
export function towerRejectionAnnouncementJoin(communityId: string) {
  return Prisma.sql`JOIN LATERAL (
    SELECT MIN(d."sentAt") AS "announcedAt"
    FROM "NotificationEvent" e
    JOIN "NotificationDelivery" d ON d."eventId" = e.id
    JOIN "Community" c ON c.id = e."communityId"
    WHERE e."communityId" = ${communityId} AND e."sourceId" = a.id
      AND e.category = 'ACHIEVEMENT' AND e."eventType" = 'TOWER_CHALLENGE_REJECTED'
      AND d.channel = 'DISCORD_CHANNEL' AND d.transport = 'BOT' AND d.operation = 'SEND' AND d.status = 'SENT'
      AND d."sentAt" >= a."rejectedAt" AND d."discordMessageId" IS NOT NULL
      AND d."discordChannelId" = d."recipientKey"
      AND d."targetSlot" = c."discordGuildId" || ':TOWER:' || a.id || ':rejection'
  ) notice ON TRUE`;
}
