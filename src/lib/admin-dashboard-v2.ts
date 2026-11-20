import { prisma } from "@/lib/prisma";
import { scopedPrisma } from "@/lib/community-scoped-client";
import { listGuildRoles, listSetupChannels } from "@/lib/discord-rest";
import { CAPACITY_WARNING_RATIO, GUILD_CHANNEL_LIMIT, GUILD_ROLE_LIMIT } from "@/lib/discord-team-spaces";

/**
 * Tableau de bord staff v2 (`ADMIN_DASHBOARD_V2_ENABLED`) : LECTURE SEULE, sans migration, réservé aux
 * admins (`requireAdmin` côté page). Agrège ce que le staff doit traiter :
 * candidatures d'équipe en attente, opérations Discord échouées (NotificationDelivery FAILED), espaces
 * d'équipe archivés à nettoyer à la main, contestations Tower ouvertes, et le remplissage des rôles et
 * salons de chaque serveur contre les limites Discord (250 / 500).
 *
 * Aucune écriture (base ou Discord) : uniquement `find*`, `count` et des GET Discord. Aucun secret, aucun
 * contenu de message ni identifiant de destinataire n'est exposé.
 */
export const DASHBOARD_FAILED_LIMIT = 25;
export const DASHBOARD_MAX_COMMUNITIES = 10;
const DISCORD_BUDGET_MS = 4_000;

export const adminDashboardV2Enabled = (env: NodeJS.ProcessEnv = process.env): boolean => env.ADMIN_DASHBOARD_V2_ENABLED === "true";

export type CapacityLevel = "ok" | "alert" | "full" | "unavailable";

export interface Capacity {
  count: number | null;
  limit: number;
  level: CapacityLevel;
}

/** Pure : `alert` dès 80 % de la limite Discord, `full` à la limite. */
export function capacityOf(count: number | null, limit: number): Capacity {
  if (count === null) return { count, limit, level: "unavailable" };
  if (count >= limit) return { count, limit, level: "full" };
  return { count, limit, level: count >= Math.ceil(limit * CAPACITY_WARNING_RATIO) ? "alert" : "ok" };
}

export interface DashboardCommunity {
  id: string;
  name: string;
  slug: string;
  pendingApplications: number;
  openAppeals: number;
  overdueAppeals: number;
  archivedSpaces: Array<{ teamName: string; archivedAt: Date }>;
  failedOperations: number;
  roles: Capacity;
  channels: Capacity;
}

export interface FailedOperation {
  communityName: string;
  eventType: string;
  errorClass: string;
  attempts: number;
  createdAt: Date;
}

export interface AdminDashboardV2 {
  generatedAt: Date;
  communities: DashboardCommunity[];
  failedOperations: FailedOperation[];
  /** Alertes « 80 % de 250 rôles » enregistrées par /role (événements ADMIN, 7 derniers jours). */
  roleCapacityAlerts: number;
  totals: { pendingApplications: number; openAppeals: number; overdueAppeals: number; archivedSpaces: number; failedOperations: number };
}

export interface DiscordCounts {
  roles: number | null;
  channels: number | null;
}

/** GET Discord en lecture seule ; `null` = indisponible (jamais un zéro trompeur). */
export async function readDiscordCounts(guildId: string): Promise<DiscordCounts> {
  const deadline = new Date(Date.now() + DISCORD_BUDGET_MS);
  const [roles, channels] = await Promise.all([listGuildRoles({ guildId, deadline }), listSetupChannels({ guildId, deadline })]);
  return { roles: roles.ok ? roles.data.roles.length : null, channels: channels.ok ? channels.data.length : null };
}

export async function loadAdminDashboardV2(
  deps: { now?: Date; discordCounts?: (guildId: string) => Promise<DiscordCounts> } = {}
): Promise<AdminDashboardV2> {
  const now = deps.now ?? new Date();
  const discordCounts = deps.discordCounts ?? readDiscordCounts;
  const botConfigured = Boolean(process.env.DISCORD_BOT_TOKEN?.trim());
  const rows = await prisma.community.findMany({
    where: { status: "ACTIVE" },
    orderBy: { name: "asc" },
    take: DASHBOARD_MAX_COMMUNITIES,
    select: { id: true, name: true, slug: true, discordGuildId: true },
  });

  const communities = await Promise.all(
    rows.map(async (community): Promise<DashboardCommunity> => {
      const scopedDb = scopedPrisma({ communityIds: [community.id], includesDefault: false });
      const [pendingApplications, openAppeals, overdueAppeals, archived, failedOperations, counts] = await Promise.all([
        scopedDb.teamApplication.count({ where: { communityId: community.id, status: "PENDING" } }),
        scopedDb.towerChallengeAppeal.count({ where: { communityId: community.id, status: "OPEN" } }),
        scopedDb.towerChallengeAppeal.count({ where: { communityId: community.id, status: "OPEN", dueAt: { lt: now } } }),
        scopedDb.discordTeamSpace.findMany({
          where: { communityId: community.id, archived: true },
          orderBy: { updatedAt: "asc" },
          take: 50,
          select: { updatedAt: true, team: { select: { name: true } } },
        }),
        prisma.notificationDelivery.count({ where: { status: "FAILED", event: { communityId: community.id } } }),
        community.discordGuildId && botConfigured
          ? discordCounts(community.discordGuildId).catch((): DiscordCounts => ({ roles: null, channels: null }))
          : Promise.resolve<DiscordCounts>({ roles: null, channels: null }),
      ]);
      return {
        id: community.id,
        name: community.name,
        slug: community.slug,
        pendingApplications,
        openAppeals,
        overdueAppeals,
        archivedSpaces: archived.map((space) => ({ teamName: space.team.name, archivedAt: space.updatedAt })),
        failedOperations,
        roles: capacityOf(counts.roles, GUILD_ROLE_LIMIT),
        channels: capacityOf(counts.channels, GUILD_CHANNEL_LIMIT),
      };
    })
  );

  const names = new Map(rows.map((row) => [row.id, row.name]));
  const failed = await prisma.notificationDelivery.findMany({
    where: { status: "FAILED", event: { communityId: { in: rows.map((row) => row.id) } } },
    orderBy: { createdAt: "desc" },
    take: DASHBOARD_FAILED_LIMIT,
    select: { errorClass: true, attempts: true, createdAt: true, event: { select: { eventType: true, communityId: true } } },
  });
  const roleCapacityAlerts = await prisma.notificationEvent.count({
    where: {
      category: "ADMIN",
      eventType: "ROLE_CAPACITY_ALERT",
      communityId: { in: rows.map((row) => row.id) },
      createdAt: { gte: new Date(now.getTime() - 7 * 24 * 60 * 60_000) },
    },
  });

  const sum = (pick: (community: DashboardCommunity) => number) => communities.reduce((total, community) => total + pick(community), 0);
  return {
    generatedAt: now,
    communities,
    failedOperations: failed.map((item) => ({
      communityName: names.get(item.event.communityId ?? "") ?? "—",
      eventType: item.event.eventType,
      errorClass: item.errorClass ?? "unknown",
      attempts: item.attempts,
      createdAt: item.createdAt,
    })),
    roleCapacityAlerts,
    totals: {
      pendingApplications: sum((c) => c.pendingApplications),
      openAppeals: sum((c) => c.openAppeals),
      overdueAppeals: sum((c) => c.overdueAppeals),
      archivedSpaces: sum((c) => c.archivedSpaces.length),
      failedOperations: sum((c) => c.failedOperations),
    },
  };
}
