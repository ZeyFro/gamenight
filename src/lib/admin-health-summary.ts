import { prisma } from "@/lib/prisma";
import { isTowerOwner, towerGuildId } from "@/lib/tower-config";

export const HEALTH_FLAG_NAMES = [
  "NOTIFICATION_EXECUTOR_ENABLED", "TOWER_CHALLENGES_ENABLED",
  "TOWER_DISCORD_ANNOUNCE_ENABLED", "DISCORD_BOT_SESSION_ANNOUNCE_ENABLED",
  "DISCORD_BOT_TOURNAMENT_ANNOUNCE_ENABLED", "WHO_PLAYS_TONIGHT_ENABLED",
  "TEAM_CAPTAIN_HANDOVER_ENABLED",
] as const;

export function healthFlagStates(env: Record<string, string | undefined>) {
  return HEALTH_FLAG_NAMES.map(name => ({ name, enabled: env[name] === "true" }));
}

export async function getTowerAdminHealth() {
  const community = await prisma.community.findFirst({
    where: { discordGuildId: towerGuildId() }, select: { id: true },
  });
  const failed = community ? await prisma.notificationDelivery.findMany({
    where: { status: "FAILED", event: { communityId: community.id } },
    orderBy: { createdAt: "desc" },
    take: 25,
    select: { errorClass: true, createdAt: true, event: { select: { eventType: true } } },
  }) : [];
  return {
    flags: healthFlagStates(process.env),
    failed: failed.map(item => ({
      errorCode: item.errorClass ?? "unknown", eventType: item.event.eventType,
      createdAt: item.createdAt.toISOString(),
    })),
    cronLastRuns: "Non instrumenté : CronLock n'est pas un journal de passages.",
  };
}
