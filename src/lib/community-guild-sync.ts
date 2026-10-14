import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { listBotGuilds, type BotGuild } from "@/lib/discord-rest";
import { provisionCommunityFromGuild } from "@/lib/community-provisioning";
import { DEFAULT_COMMUNITY_SLUG } from "@/lib/default-community";

/**
 * Multi-communautés, PR2 — rattrapage par cron (`GET /users/@me/guilds`) :
 * crée en PENDING les communautés que le webhook `APPLICATION_AUTHORIZED` a
 * manquées et marque LEFT celles dont le bot est parti (Discord n'émet aucun
 * webhook au retrait du bot). Fail-safe : une liste incomplète, vide ou en
 * erreur, ou un échec de création, ne marque JAMAIS rien LEFT.
 */

const PAGE_SIZE = 200;
// Plafond : au-delà (5 000 serveurs) la liste est considérée incomplète.
const MAX_PAGES = 25;

export interface CommunityGuildSyncSummary {
  ok: true;
  guilds: number;
  created: number;
  resetPending: number;
  failed: number;
  markedLeft: number;
  /** La communauté `default` n'est jamais marquée LEFT automatiquement. */
  skippedDefault: boolean;
}

export type CommunityGuildSyncResult = CommunityGuildSyncSummary | { ok: false; reason: string };

export async function syncCommunitiesWithBotGuilds(input: {
  deadline: Date;
  now?: Date;
}): Promise<CommunityGuildSyncResult> {
  const now = input.now ?? new Date();

  const guilds: BotGuild[] = [];
  let after: string | undefined;
  let complete = false;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await listBotGuilds({ after, deadline: input.deadline, now });
    if (!res.ok) return { ok: false, reason: res.message };
    guilds.push(...res.data.guilds);
    if (res.data.guilds.length < PAGE_SIZE) {
      complete = true;
      break;
    }
    after = res.data.guilds[res.data.guilds.length - 1].id;
  }
  if (!complete) return { ok: false, reason: "Liste des serveurs potentiellement incomplète (plafond de pages)." };

  const summary: CommunityGuildSyncSummary = {
    ok: true,
    guilds: guilds.length,
    created: 0,
    resetPending: 0,
    failed: 0,
    markedLeft: 0,
    skippedDefault: false,
  };

  for (const guild of guilds) {
    try {
      const { action } = await provisionCommunityFromGuild(guild, null);
      if (action === "created") summary.created++;
      if (action === "reset_pending") summary.resetPending++;
    } catch (error) {
      summary.failed++;
      logger.error("community-guild-sync", error, { guildId: guild.id });
    }
  }

  // Une liste vide (jeton révoqué, panne) ou un échec de création rend la
  // liste de référence incertaine : on ne déclare personne parti.
  if (guilds.length === 0 || summary.failed > 0) return summary;

  const present = new Set(guilds.map((g) => g.id));
  const tracked = await prisma.community.findMany({
    where: { status: { in: ["PENDING", "ACTIVE"] }, discordGuildId: { not: null } },
    select: { id: true, slug: true, discordGuildId: true },
  });
  for (const community of tracked) {
    if (present.has(community.discordGuildId as string)) continue;
    if (community.slug === DEFAULT_COMMUNITY_SLUG) {
      summary.skippedDefault = true;
      logger.warn("community-guild-sync", "Le bot n'est plus dans le serveur de la communauté par défaut : non marquée LEFT automatiquement.");
      continue;
    }
    await prisma.community.update({ where: { id: community.id }, data: { status: "LEFT", leftAt: now } });
    summary.markedLeft++;
  }
  return summary;
}
