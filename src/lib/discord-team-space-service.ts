import { scopedPrisma } from "@/lib/community-scoped-client";
import { logger } from "@/lib/logger";
import { recordSensitiveOperation } from "@/lib/sensitive-operation-log";
import {
  applyTeamSpacePlan,
  planTeamSpace,
  TEXT_CHANNEL_ALLOW,
  VOICE_CHANNEL_ALLOW,
  spaceChannelName,
  spaceVoiceChannelName,
  teamSpacesEnabled,
  type GuildChannelSummary,
  type GuildRoleSummaryLite,
  type ManagedSpaceLink,
  type OverwritePlan,
  type TeamSpaceApplyResult,
  type TeamSpaceClient,
  type TeamSpacePlan,
} from "@/lib/discord-team-spaces";

/**
 * Gestion réelle des espaces Discord d'équipe : lecture GameNight, planification
 * vérifiée (`discord-team-spaces`), application via un adaptateur Discord
 * injectable, association persistée dans `DiscordTeamSpace`.
 *
 * Ce service ne supprime que les deux salons enregistrés dans `DiscordTeamSpace`
 * pour l'équipe dissoute, vérifiés par identifiant (jamais par nom). Le flag
 * `DISCORD_TEAM_SPACES_ENABLED` reste fermé par défaut : sans lui, aucune
 * écriture Discord n'est tentée.
 *
 * Persistance : `DiscordTeamSpace` n'existe en base qu'après application de la
 * migration `prisma/migrations/20261118110000_discord_team_space` (jouée par la
 * CI sur un PostgreSQL jetable, jamais sur Neon).
 *
 * Aucun appelant n'écrit directement sur Discord : les actions passent par la
 * file de notifications (`discord-team-space-queue.ts`) puis l'executor, qui
 * appelle ces fonctions avec l'adaptateur réel (`discord-team-space-api.ts`).
 * Tant qu'elle n'est pas appliquée, toutes les opérations renvoient
 * `migration_required` — jamais un succès simulé en mémoire.
 */

export type SpaceProvisionStatus =
  | "created"
  | "reused"
  | "partial"
  | "quota"
  | "capacity"
  | "unmanaged"
  | "disabled"
  | "community_not_linked"
  | "migration_required"
  | "failed";

export interface SpaceProvisionResult {
  status: SpaceProvisionStatus;
  roleId?: string;
  /** Salon textuel privé permanent. */
  channelId?: string;
  /** Salon vocal privé permanent (option A). */
  voiceChannelId?: string;
  steps?: TeamSpaceApplyResult["steps"];
}

export interface SpaceMemberResult {
  status: "updated" | "removed" | "not_member" | "not_provisioned" | "disabled" | "migration_required" | "failed";
}

export interface SpaceLinkStore {
  find(teamId: string): Promise<ManagedSpaceLink | null>;
  listByCommunity(communityId: string): Promise<ManagedSpaceLink[]>;
  save(link: {
    teamId: string;
    communityId: string;
    guildId: string;
    channelId: string;
    voiceChannelId?: string | null;
    roleId?: string | null;
  }): Promise<void>;
  setArchived(teamId: string, archived: boolean): Promise<void>;
  markDeleted?(teamId: string, deletedAt: Date): Promise<void>;
}

/** Table absente (migration pas encore appliquée) — jamais confondu avec un échec réseau. */
export class SpaceStoreUnavailableError extends Error {
  constructor() {
    super("DiscordTeamSpace indisponible (migration non appliquée).");
    this.name = "SpaceStoreUnavailableError";
  }
}

export function createMemorySpaceLinkStore(seed: Array<ManagedSpaceLink & { communityId: string; guildId: string }> = []): SpaceLinkStore {
  const rows = new Map<string, ManagedSpaceLink & { communityId: string; guildId: string }>(
    seed.map((row) => [row.teamId, { ...row }])
  );
  return {
    async find(teamId) {
      const row = rows.get(teamId);
      return row ? { ...row } : null;
    },
    async listByCommunity(communityId) {
      return [...rows.values()].filter((row) => row.communityId === communityId).map((row) => ({ ...row }));
    },
    async save(link) {
      if (rows.has(link.teamId)) {
        // Idempotence : on ne remplace pas un salon déjà associé par un autre ;
        // on complète seulement le vocal manquant (lien créé avant l'option A).
        const existing = rows.get(link.teamId)!;
        rows.set(link.teamId, {
          ...existing,
          roleId: existing.roleId ?? link.roleId ?? null,
          voiceChannelId: existing.voiceChannelId ?? link.voiceChannelId ?? null,
        });
        return;
      }
      rows.set(link.teamId, { ...link, archived: false });
    },
    async setArchived(teamId, archived) {
      const row = rows.get(teamId);
      if (row) rows.set(teamId, { ...row, archived });
    },
    async markDeleted(teamId, deletedAt) {
      const row = rows.get(teamId);
      if (row) rows.set(teamId, { ...row, archived: true, deletedAt } as typeof row);
    },
  };
}

/** Accès Prisma isolé : une seule dépendance à retirer si le schéma évolue. */
export function createPrismaSpaceLinkStore(communityId: string): SpaceLinkStore {
  const scopedDb = scopedPrisma({ communityIds: [communityId], includesDefault: false });
  const guard = async <T>(run: () => Promise<T>): Promise<T> => {
    try {
      return await run();
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "P2021" || code === "P2022" || (error as Error).message?.includes("does not exist")) {
        throw new SpaceStoreUnavailableError();
      }
      throw error;
    }
  };
  return {
    find: (teamId) =>
      guard(() =>
        scopedDb.discordTeamSpace.findUnique({
          where: { teamId },
          select: { teamId: true, channelId: true, voiceChannelId: true, roleId: true, archived: true },
        })
      ),
    listByCommunity: (communityId) =>
      guard(() =>
        scopedDb.discordTeamSpace.findMany({
          where: { communityId },
          select: { teamId: true, channelId: true, voiceChannelId: true, roleId: true, archived: true },
        })
      ),
    save: async (link) => {
      await guard(() =>
        scopedDb.discordTeamSpace.upsert({
          where: { teamId: link.teamId },
          // Rejeu : on complète le vocal manquant, jamais on ne remplace un identifiant.
          update: link.voiceChannelId ? { voiceChannelId: link.voiceChannelId } : {},
          create: {
            teamId: link.teamId,
            communityId: link.communityId,
            guildId: link.guildId,
            channelId: link.channelId,
            voiceChannelId: link.voiceChannelId ?? null,
            roleId: link.roleId ?? null,
          },
        })
      );
    },
    setArchived: async (teamId, archived) => {
      await guard(() => scopedDb.discordTeamSpace.updateMany({ where: { teamId }, data: { archived } }));
    },
    markDeleted: async (teamId, deletedAt) => {
      await guard(() => scopedDb.discordTeamSpace.updateMany({ where: { teamId }, data: { archived: true, deletedAt } }));
    },
  };
}

export interface TeamSpaceDiscordApi {
  snapshot(guildId: string): Promise<{ channels: GuildChannelSummary[]; roles: GuildRoleSummaryLite[] }>;
  /** Legacy, plus utilisé par le provisionnement sans rôle. */
  createRole(guildId: string, name: string): Promise<string>;
  createChannel(
    guildId: string,
    name: string,
    type: 0 | 2,
    overwrites: OverwritePlan[],
    roleId: string | null
  ): Promise<string>;
  /** Permission nominative d'un membre sur un salon (aucun rôle d'équipe). */
  setMemberPermission?(
    channelId: string,
    userId: string,
    allow: string,
    action: "allow" | "remove"
  ): Promise<void>;
  deleteChannel?(channelId: string): Promise<void>;
  renameChannel(channelId: string, name: string): Promise<void>;
  addMemberRole(guildId: string, userId: string, roleId: string): Promise<void>;
  removeMemberRole(guildId: string, userId: string, roleId: string): Promise<void>;
}

function clientFrom(api: TeamSpaceDiscordApi, guildId: string): TeamSpaceClient {
  return {
    async createChannel(input) {
      return { id: await api.createChannel(guildId, input.name, input.type, input.overwrites, null) };
    },
    async editChannel(input) {
      await api.renameChannel(input.id, input.name);
    },
    async setMemberPermission(input) {
      if (!api.setMemberPermission) throw new Error("setMemberPermission indisponible");
      await api.setMemberPermission(input.channelId, input.userId, input.allow, input.action);
    },
  };
}

interface LoadedTeam {
  id: string;
  name: string;
  communityId: string;
  guildId: string | null;
  createdById: string;
  captainId: string | null;
  members: Array<{ userId: string; discordId: string | null }>;
}

async function loadTeam(teamId: string, communityId: string): Promise<LoadedTeam | null> {
  const scopedDb = scopedPrisma({ communityIds: [communityId], includesDefault: false });
  const team = await scopedDb.communityTeam.findFirst({
    where: { id: teamId, communityId },
    select: {
      id: true,
      name: true,
      communityId: true,
      createdById: true,
      captainId: true,
      community: { select: { discordGuildId: true } },
      members: {
        orderBy: [{ joinedAt: "asc" }, { userId: "asc" }],
        select: {
          userId: true,
          user: {
            select: {
              discordId: true,
              memberships: { where: { communityId, status: "ACTIVE" }, select: { id: true } },
            },
          },
        },
      },
    },
  });
  if (!team) return null;
  return {
    id: team.id,
    name: team.name,
    communityId: team.communityId,
    guildId: team.community.discordGuildId,
    createdById: team.createdById,
    captainId: team.captainId,
    // Seuls les membres encore actifs dans la communauté reçoivent un accès.
    members: team.members
      .filter((member) => member.user.memberships.length > 0)
      .map((member) => ({ userId: member.userId, discordId: member.user.discordId })),
  };
}

function planFrom(team: LoadedTeam, snapshot: { channels: GuildChannelSummary[]; roles: GuildRoleSummaryLite[] }, links: ManagedSpaceLink[], previousArchived?: boolean) {
  return planTeamSpace({
    team: {
      id: team.id,
      name: team.name,
      communityId: team.communityId,
      createdById: team.createdById,
      captainId: team.captainId,
      members: team.members
        .filter((member): member is { userId: string; discordId: string } => Boolean(member.discordId))
        .map((member) => ({ userId: member.userId, discordId: member.discordId })),
    },
    existing: snapshot,
    managedSpaces: links,
    previousArchived,
  });
}

function ineligibleStatus(plan: TeamSpacePlan): SpaceProvisionStatus {
  if (plan.status !== "ineligible") return "failed";
  if (plan.reason === "quota") return "quota";
  if (plan.reason === "capacity") return "capacity";
  return plan.reason === "unmanaged" ? "unmanaged" : "failed";
}

export async function provisionTeamSpace(input: {
  teamId: string;
  communityId: string;
  api: TeamSpaceDiscordApi;
  store?: SpaceLinkStore;
  env?: NodeJS.ProcessEnv;
  /** Rejeu explicite : retourne l'association existante sans écrire. */
  dryRun?: boolean;
}): Promise<SpaceProvisionResult> {
  const env = input.env ?? process.env;
  if (!teamSpacesEnabled(env)) return { status: "disabled" };
  const store = input.store ?? createPrismaSpaceLinkStore(input.communityId);
  const team = await loadTeam(input.teamId, input.communityId);
  if (!team) return { status: "failed" };
  if (!team.guildId) return { status: "community_not_linked" };

  try {
    const link = await store.find(team.id);
    // Les ressources complètes ne sont jamais recréées, mais leur persistance
    // ne prouve pas que les accès membres ont tous réussi au premier passage.
    if (link?.voiceChannelId && !input.dryRun) {
      const reconciled = await reconcileTeamSpace({ ...input, store, env });
      if (reconciled.status !== "consistent" && reconciled.status !== "repaired") {
        return { status: reconciled.status === "unlinked" ? "failed" : reconciled.status };
      }
      return { status: "reused", roleId: link.roleId ?? undefined, channelId: link.channelId, voiceChannelId: link.voiceChannelId };
    }
    const links = await store.listByCommunity(team.communityId);
    const snapshot = await input.api.snapshot(team.guildId);
    const plan = planFrom(team, snapshot, link ? [link, ...links.filter((row) => row.teamId !== team.id)] : links);
    if (plan.status !== "planned") return { status: ineligibleStatus(plan) };
    if (input.dryRun) return { status: "failed" };

    const applied = await applyTeamSpacePlan(plan, clientFrom(input.api, team.guildId), env);
    if (applied.status === "disabled") return { status: "disabled" };
    // On persiste dès que le rôle et le salon textuel existent : si le vocal
    // échoue ensuite, le rejeu réutilise ces ressources au lieu de les recréer.
    if (applied.channelId) {
      await store.save({
        teamId: team.id,
        communityId: team.communityId,
        guildId: team.guildId,
        channelId: applied.channelId,
        voiceChannelId: applied.voiceChannelId ?? null,
        roleId: null,
      });
    }
    const created = !link && applied.status === "applied";
    return {
      status: applied.status === "partial" ? "partial" : created ? "created" : "reused",
      channelId: applied.channelId,
      voiceChannelId: applied.voiceChannelId,
      steps: applied.steps,
    };
  } catch (error) {
    if (error instanceof SpaceStoreUnavailableError) return { status: "migration_required" };
    logger.warn("discord-team-space", "Provisionnement d’espace impossible.", {
      errorType: error instanceof Error ? error.name : "unknown",
      errorMessage: error instanceof Error ? error.message : "unknown",
    });
    return { status: "failed" };
  }
}

/** Adhésion/départ : met à jour le seul rôle de l'espace de CETTE équipe. */
export async function syncTeamSpaceMember(input: {
  teamId: string;
  communityId: string;
  discordId: string;
  action: "join" | "leave";
  api: TeamSpaceDiscordApi;
  store?: SpaceLinkStore;
  env?: NodeJS.ProcessEnv;
}): Promise<SpaceMemberResult> {
  const env = input.env ?? process.env;
  if (!teamSpacesEnabled(env)) return { status: "disabled" };
  const store = input.store ?? createPrismaSpaceLinkStore(input.communityId);
  try {
    const team = await loadTeam(input.teamId, input.communityId);
    if (!team || !team.guildId) return { status: "not_member" };
    const link = await store.find(team.id);
    if (!link?.channelId) return { status: "not_provisioned" };
    const member = team.members.find((candidate) => candidate.discordId === input.discordId);
    if (input.action === "join" && !member) return { status: "not_member" };
    if (!input.api.setMemberPermission) return { status: "failed" };
    for (const [channelId, allow] of [[link.channelId, TEXT_CHANNEL_ALLOW], [link.voiceChannelId, VOICE_CHANNEL_ALLOW]] as const) {
      if (!channelId) continue;
      await input.api.setMemberPermission(channelId, input.discordId, allow, input.action === "join" ? "allow" : "remove");
    }
    return { status: input.action === "join" ? "updated" : "removed" };
  } catch (error) {
    if (error instanceof SpaceStoreUnavailableError) return { status: "migration_required" };
    logger.warn("discord-team-space", "Synchronisation d’accès impossible.", {
      errorType: error instanceof Error ? error.name : "unknown",
    });
    return { status: "failed" };
  }
}

export async function archiveInactiveTeamSpace(input: {
  teamId: string;
  communityId: string;
  api: TeamSpaceDiscordApi;
  store?: SpaceLinkStore;
  env?: NodeJS.ProcessEnv;
}): Promise<SpaceProvisionResult | { status: "still_active" }> {
  const env = input.env ?? process.env;
  if (!teamSpacesEnabled(env)) return { status: "disabled" };
  const store = input.store ?? createPrismaSpaceLinkStore(input.communityId);
  const team = await loadTeam(input.teamId, input.communityId);
  if (!team) return { status: "failed" };
  if (team.members.length > 0) return { status: "still_active" };
  if (!team.guildId) return { status: "community_not_linked" };
  try {
    const link = await store.find(team.id);
    if (!link) return { status: "unmanaged" };
    const snapshot = await input.api.snapshot(team.guildId);
    const plan = planFrom({ ...team, members: [] }, snapshot, [link]);
    if (plan.status !== "planned") return { status: ineligibleStatus(plan) };
    const applied = await applyTeamSpacePlan(plan, clientFrom(input.api, team.guildId), env);
    if (applied.status === "applied") await store.setArchived(team.id, true);
    return { status: applied.status === "applied" ? "reused" : "partial", channelId: link.channelId, steps: applied.steps };
  } catch (error) {
    if (error instanceof SpaceStoreUnavailableError) return { status: "migration_required" };
    return { status: "failed" };
  }
}

export async function reactivateTeamSpace(input: {
  teamId: string;
  communityId: string;
  api: TeamSpaceDiscordApi;
  store?: SpaceLinkStore;
  env?: NodeJS.ProcessEnv;
}): Promise<SpaceProvisionResult> {
  const env = input.env ?? process.env;
  if (!teamSpacesEnabled(env)) return { status: "disabled" };
  const store = input.store ?? createPrismaSpaceLinkStore(input.communityId);
  const team = await loadTeam(input.teamId, input.communityId);
  if (!team || !team.guildId) return { status: "failed" };
  try {
    const link = await store.find(team.id);
    if (!link || !link.archived) return { status: "unmanaged" };
    const snapshot = await input.api.snapshot(team.guildId);
    const plan = planFrom(team, snapshot, [link], true);
    if (plan.status !== "planned") return { status: ineligibleStatus(plan) };
    const applied = await applyTeamSpacePlan(plan, clientFrom(input.api, team.guildId), env);
    if (applied.status === "applied") await store.setArchived(team.id, false);
    return { status: applied.status === "applied" ? "reused" : "partial", roleId: link.roleId ?? undefined, channelId: link.channelId, steps: applied.steps };
  } catch (error) {
    if (error instanceof SpaceStoreUnavailableError) return { status: "migration_required" };
    return { status: "failed" };
  }
}

export type SpaceDeleteResult = {
  status: "deleted" | "already_deleted" | "dry_run" | "unlinked" | "disabled" | "partial" | "failed" | "not_dissolved" | "open_report" | "blocked" | "mismatch";
  /** Identifiants vérifiés dans `DiscordTeamSpace` ; jamais un nom. */
  channelIds: string[];
};

type SpaceAbandonReason = "open_report" | "blocked" | "mismatch" | "not_dissolved";
type DeletionTrace = { teamId: string; communityId: string; actorId?: string };

/** Journal C055 sans catch silencieux : un échec d'écriture du journal est visible dans les logs (l'opération, elle, est déjà jouée). */
async function traceDeletion(input: DeletionTrace, outcome: string): Promise<void> {
  try {
    await recordSensitiveOperation({
      actorId: input.actorId ?? null, action: "discord.team_space_delete", communityId: input.communityId, target: input.teamId, outcome,
    });
  } catch (error) {
    logger.warn("discord-team-space", "Journal de suppression d’espace non écrit.", {
      teamId: input.teamId, outcome, errorType: error instanceof Error ? error.name : "unknown",
    });
  }
}

/**
 * Abandon propre d'une suppression dont une condition a changé : AUCUNE suppression de salon, trace au journal C055 et dans les logs.
 * `revoke` retire d'abord les accès nominatifs des anciens membres (réversible, ne détruit aucune preuve) : l'abandon est terminal, les
 * anciens membres ne doivent pas garder l'accès indéfiniment. Si ce retrait échoue, le résultat est « partial » (rejouable), jamais un
 * abandon silencieux avec des accès restants.
 */
async function abandon(input: DeletionTrace, status: SpaceAbandonReason, revoke?: () => Promise<void>): Promise<SpaceDeleteResult> {
  if (revoke) {
    try {
      await revoke();
    } catch (error) {
      logger.warn("discord-team-space", "Retrait des accès avant abandon impossible.", { teamId: input.teamId, errorType: error instanceof Error ? error.name : "unknown" });
      await traceDeletion(input, "partial");
      return { status: "partial", channelIds: [] };
    }
  }
  logger.warn("discord-team-space", "Suppression d’espace abandonnée : aucun salon supprimé.", { teamId: input.teamId, reason: status });
  await traceDeletion(input, status);
  return { status, channelIds: [] };
}

/**
 * Suppression réelle d'un espace dissous. Seuls les identifiants persistés de
 * CETTE équipe sont ciblés ; un dry-run vérifie leur présence sans rien écrire.
 * Un échec partiel laisse le lien en place : le rejeu reprend les identifiants
 * restants et ignore ceux déjà absents.
 *
 * D5 : toutes les conditions sont REVÉRIFIÉES ici (équipe vide, aucun signalement, défi ou contestation ouvert). Les accès nominatifs sont
 * retirés AVANT toute suppression ET avant tout abandon : les identifiants viennent des anciens membres transportés par l'événement ET
 * des surcharges réellement présentes sur les salons enregistrés (jamais d'un membre actuel de l'équipe), donc une liste perdue n'empêche pas
 * la révocation.
 */
export async function deleteTeamSpace(input: {
  teamId: string;
  communityId: string;
  api: TeamSpaceDiscordApi;
  store?: SpaceLinkStore;
  dryRun?: boolean;
  actorId?: string;
  /** Membres présents avant la dissolution : leurs accès sont retirés AVANT toute suppression. */
  formerMemberDiscordIds?: readonly string[];
  env?: NodeJS.ProcessEnv;
}): Promise<SpaceDeleteResult> {
  const env = input.env ?? process.env;
  if (!teamSpacesEnabled(env)) return { status: "disabled", channelIds: [] };
  const store = input.store ?? createPrismaSpaceLinkStore(input.communityId);
  try {
    const team = await loadTeam(input.teamId, input.communityId);
    if (!team?.guildId) return { status: "failed", channelIds: [] };
    const link = await store.find(team.id);
    if (!link?.channelId) return { status: "unlinked", channelIds: [] };
    const channelIds = [link.channelId, link.voiceChannelId].filter((id): id is string => Boolean(id));
    const scopedDb = scopedPrisma({ communityIds: [input.communityId], includesDefault: false });
    // Conditions de la dissolution, revérifiées À L'EXÉCUTION (pas seulement à la demande).
    let abandonReason: Exclude<SpaceAbandonReason, "mismatch"> | null = null;
    if (team.members.length > 0) {
      abandonReason = "not_dissolved";
    } else {
      const openReports = await scopedDb.moderationReport.count({
        where: { communityId: input.communityId, channelId: { in: channelIds }, closedAt: null },
      });
      if (openReports > 0) abandonReason = "open_report";
      else {
        const [activeChallenges, openAppeals] = await Promise.all([
          scopedDb.towerChallengeAttempt.count({ where: { communityId: input.communityId, teamId: team.id, status: { in: ["ASSIGNED", "SUBMITTED"] } } }),
          scopedDb.towerChallengeAppeal.count({ where: { communityId: input.communityId, status: "OPEN", attempt: { teamId: team.id } } }),
        ]);
        if (activeChallenges > 0 || openAppeals > 0) abandonReason = "blocked";
      }
    }
    // Identifiants ENREGISTRÉS uniquement, jamais un salon système : un identifiant égal à un salon configuré (…_CHANNEL_ID) est refusé.
    const systemChannels = new Set(Object.entries(env).filter(([key, value]) => /CHANNEL_ID$/.test(key) && value).map(([, value]) => String(value).trim()));
    if (channelIds.some((id) => systemChannels.has(id))) return abandon(input, "mismatch");
    const snapshot = await input.api.snapshot(team.guildId);
    const byId = new Map(snapshot.channels.map((channel) => [channel.id, channel]));
    // Le salon textuel enregistré doit être un salon textuel (0), le vocal un vocal (2) : sinon l'identifiant ne désigne plus notre salon.
    if ((byId.has(link.channelId) && byId.get(link.channelId)!.type !== 0)
      || (link.voiceChannelId && byId.has(link.voiceChannelId) && byId.get(link.voiceChannelId)!.type !== 2)) return abandon(input, "mismatch");
    const present = channelIds.filter((id) => byId.has(id));
    // Accès à retirer : anciens membres transportés + surcharges nominatives réellement posées sur NOS salons, moins les membres ACTUELS.
    const currentMembers = new Set(team.members.map((member) => member.discordId).filter((id): id is string => Boolean(id)));
    const accessIds = [...new Set([
      ...(input.formerMemberDiscordIds ?? []),
      ...present.flatMap((id) => byId.get(id)?.memberOverwriteIds ?? []),
    ])].filter((id) => /^[0-9]{16,20}$/.test(id) && !currentMembers.has(id));
    const revoke = async () => {
      if (!input.api.setMemberPermission) throw new Error("revoke_unavailable");
      for (const channelId of present) {
        for (const discordId of accessIds) await input.api.setMemberPermission(channelId, discordId, "0", "remove");
      }
    };
    if (abandonReason) return abandon(input, abandonReason, accessIds.length > 0 && present.length > 0 ? revoke : undefined);
    if (input.dryRun) return { status: "dry_run", channelIds: present };
    if (present.length === 0) {
      await store.markDeleted?.(team.id, new Date());
      return { status: "already_deleted", channelIds: [] };
    }
    if (!input.api.deleteChannel) return { status: "failed", channelIds: present };
    // D5 : révoquer d'abord les accès nominatifs. Si la suppression échoue ensuite, plus personne ne garde l'accès aux salons.
    if (accessIds.length > 0) {
      if (!input.api.setMemberPermission) return { status: "failed", channelIds: present };
      await revoke();
    }
    for (const channelId of [...present].reverse()) {
      await input.api.deleteChannel(channelId);
    }
    await store.markDeleted?.(team.id, new Date());
    await traceDeletion(input, "ok");
    return { status: "deleted", channelIds: present };
  } catch (error) {
    if (error instanceof SpaceStoreUnavailableError) return { status: "failed", channelIds: [] };
    logger.warn("discord-team-space", "Suppression d’espace incomplète.", {
      teamId: input.teamId,
      errorType: error instanceof Error ? error.name : "unknown",
    });
    await traceDeletion(input, "partial");
    return { status: "partial", channelIds: [] };
  }
}

export type SpaceLinkState =
  | { status: "linked"; channelId: string; voiceChannelId: string | null; roleId: string | null; archived: boolean }
  | { status: "unlinked" }
  | { status: "migration_required" };

/** Nombre d'espaces associés d'une communauté (lecture seule, pour le quota). */
export async function countTeamSpaces(input: { communityId: string; store?: SpaceLinkStore }): Promise<number | null> {
  const store = input.store ?? createPrismaSpaceLinkStore(input.communityId);
  try {
    return (await store.listByCommunity(input.communityId)).length;
  } catch (error) {
    if (error instanceof SpaceStoreUnavailableError) return null;
    logger.warn("discord-team-space", "Quota d’espaces illisible.", {
      errorType: error instanceof Error ? error.name : "unknown",
    });
    return null;
  }
}

/** Lecture seule de l'association persistée — aucun appel Discord. */
export async function readTeamSpaceLink(input: { teamId: string; communityId: string; store?: SpaceLinkStore }): Promise<SpaceLinkState> {
  const store = input.store ?? createPrismaSpaceLinkStore(input.communityId);
  try {
    const link = await store.find(input.teamId);
    if (!link?.channelId) return { status: "unlinked" };
    return {
      status: "linked",
      channelId: link.channelId,
      voiceChannelId: link.voiceChannelId ?? null,
      roleId: link.roleId ?? null,
      archived: link.archived === true,
    };
  } catch (error) {
    if (error instanceof SpaceStoreUnavailableError) return { status: "migration_required" };
    throw error;
  }
}

export type SpaceReconcileResult = {
  status: "consistent" | "repaired" | "partial" | "unlinked" | "disabled" | "migration_required" | "failed";
  steps: string[];
};

/**
 * Réconciliation : remet l'espace en cohérence **sans jamais recréer** un salon
 * ou un rôle disparu (risque de doublon et de cible erronée). Les ressources
 * manquantes sont signalées ; les accès des membres actuels sont réappliqués
 * (PUT idempotent) ; l'état archivé suit la présence de membres.
 */
export async function reconcileTeamSpace(input: {
  teamId: string;
  communityId: string;
  api: TeamSpaceDiscordApi;
  store?: SpaceLinkStore;
  env?: NodeJS.ProcessEnv;
}): Promise<SpaceReconcileResult> {
  const env = input.env ?? process.env;
  if (!teamSpacesEnabled(env)) return { status: "disabled", steps: [] };
  const store = input.store ?? createPrismaSpaceLinkStore(input.communityId);
  try {
    const team = await loadTeam(input.teamId, input.communityId);
    if (!team?.guildId) return { status: "failed", steps: ["team_or_guild_missing"] };
    const link = await store.find(team.id);
    if (!link?.channelId) return { status: "unlinked", steps: [] };
    const snapshot = await input.api.snapshot(team.guildId);
    const steps: string[] = [];
    if (!snapshot.channels.some((channel) => channel.id === link.channelId)) steps.push("channel_missing");
    // Lien antérieur à l'option A : le vocal n'est pas encore associé.
    if (!link.voiceChannelId) steps.push("voice_channel_unlinked");
    else if (!snapshot.channels.some((channel) => channel.id === link.voiceChannelId)) steps.push("voice_channel_missing");
    // Aucune recréation automatique d'une ressource disparue : on s'arrête avant
    // toute écriture Discord. Seul le vocal non associé n'est pas bloquant (le
    // provisionnement le crée, lui, de façon idempotente).
    if (steps.some((step) => step !== "voice_channel_unlinked")) {
      return { status: "partial", steps };
    }

    for (const member of team.members) {
      if (!member.discordId || !input.api.setMemberPermission) continue;
      await input.api.setMemberPermission(link.channelId, member.discordId, TEXT_CHANNEL_ALLOW, "allow");
      if (link.voiceChannelId) {
        await input.api.setMemberPermission(link.voiceChannelId, member.discordId, VOICE_CHANNEL_ALLOW, "allow");
      }
    }
    steps.push("members_resynced");

    const shouldArchive = team.members.length === 0;
    if (shouldArchive && !link.archived) {
      await input.api.renameChannel(link.channelId, `archive-${spaceChannelName(team)}`.slice(0, 100));
      if (link.voiceChannelId) {
        await input.api.renameChannel(link.voiceChannelId, `archive-${spaceVoiceChannelName(team)}`.slice(0, 100));
      }
      await store.setArchived(team.id, true);
      steps.push("archived");
      return { status: "repaired", steps };
    }
    if (!shouldArchive && link.archived) {
      await input.api.renameChannel(link.channelId, spaceChannelName(team));
      if (link.voiceChannelId) {
        await input.api.renameChannel(link.voiceChannelId, spaceVoiceChannelName(team));
      }
      await store.setArchived(team.id, false);
      steps.push("restored");
      return { status: "repaired", steps };
    }
    return { status: "consistent", steps };
  } catch (error) {
    if (error instanceof SpaceStoreUnavailableError) return { status: "migration_required", steps: [] };
    logger.warn("discord-team-space", "Réconciliation impossible.", {
      errorType: error instanceof Error ? error.name : "unknown",
    });
    return { status: "failed", steps: [] };
  }
}
