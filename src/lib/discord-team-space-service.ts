import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import {
  applyTeamSpacePlan,
  planTeamSpace,
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
 * Ce service ne supprime jamais de salon. Le flag `DISCORD_TEAM_SPACES_ENABLED`
 * reste fermé par défaut : sans lui, aucune écriture Discord n'est tentée.
 *
 * Persistance : `DiscordTeamSpace` n'existe en base qu'après application de la
 * migration isolée (`docs/migrations/pending/20261117_discord_team_space`).
 * Tant qu'elle n'est pas appliquée, toutes les opérations renvoient
 * `migration_required` — jamais un succès simulé en mémoire.
 */

export type SpaceProvisionStatus =
  | "created"
  | "reused"
  | "partial"
  | "quota"
  | "unmanaged"
  | "disabled"
  | "community_not_linked"
  | "migration_required"
  | "failed";

export interface SpaceProvisionResult {
  status: SpaceProvisionStatus;
  roleId?: string;
  channelId?: string;
  steps?: TeamSpaceApplyResult["steps"];
}

export interface SpaceMemberResult {
  status: "updated" | "removed" | "not_member" | "not_provisioned" | "disabled" | "migration_required" | "failed";
}

export interface SpaceLinkStore {
  find(teamId: string): Promise<ManagedSpaceLink | null>;
  listByCommunity(communityId: string): Promise<ManagedSpaceLink[]>;
  save(link: { teamId: string; communityId: string; guildId: string; channelId: string; roleId: string }): Promise<void>;
  setArchived(teamId: string, archived: boolean): Promise<void>;
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
        // Idempotence : on ne remplace pas un salon déjà associé par un autre.
        const existing = rows.get(link.teamId)!;
        rows.set(link.teamId, { ...existing, roleId: existing.roleId ?? link.roleId });
        return;
      }
      rows.set(link.teamId, { ...link, archived: false });
    },
    async setArchived(teamId, archived) {
      const row = rows.get(teamId);
      if (row) rows.set(teamId, { ...row, archived });
    },
  };
}

/** Accès Prisma isolé : une seule dépendance à retirer si le schéma évolue. */
export function createPrismaSpaceLinkStore(client = prisma): SpaceLinkStore {
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
        client.discordTeamSpace.findUnique({
          where: { teamId },
          select: { teamId: true, channelId: true, roleId: true, archived: true },
        })
      ),
    listByCommunity: (communityId) =>
      guard(() =>
        client.discordTeamSpace.findMany({
          where: { communityId },
          select: { teamId: true, channelId: true, roleId: true, archived: true },
        })
      ),
    save: async (link) => {
      await guard(() =>
        client.discordTeamSpace.upsert({
          where: { teamId: link.teamId },
          // Rejeu : on conserve les identifiants déjà associés.
          update: {},
          create: { teamId: link.teamId, communityId: link.communityId, guildId: link.guildId, channelId: link.channelId, roleId: link.roleId },
        })
      );
    },
    setArchived: async (teamId, archived) => {
      await guard(() => client.discordTeamSpace.updateMany({ where: { teamId }, data: { archived } }));
    },
  };
}

export interface TeamSpaceDiscordApi {
  snapshot(guildId: string): Promise<{ channels: GuildChannelSummary[]; roles: GuildRoleSummaryLite[] }>;
  createRole(guildId: string, name: string): Promise<string>;
  createChannel(guildId: string, name: string, overwrites: OverwritePlan[], roleId: string | null): Promise<string>;
  renameChannel(channelId: string, name: string): Promise<void>;
  addMemberRole(guildId: string, userId: string, roleId: string): Promise<void>;
  removeMemberRole(guildId: string, userId: string, roleId: string): Promise<void>;
}

function clientFrom(api: TeamSpaceDiscordApi, guildId: string): TeamSpaceClient {
  // Le rôle créé sert d'overwrite au salon : il doit exister avant sa création.
  let roleId: string | null = null;
  return {
    async createRole(input) {
      roleId = await api.createRole(guildId, input.name);
      return { id: roleId };
    },
    async createChannel(input) {
      return { id: await api.createChannel(guildId, input.name, input.overwrites, roleId) };
    },
    async editChannel(input) {
      await api.renameChannel(input.id, input.name);
    },
    async addMemberRole(input) {
      await api.addMemberRole(guildId, input.userId, input.roleId);
    },
    async removeMemberRole(input) {
      await api.removeMemberRole(guildId, input.userId, input.roleId);
    },
  };
}

interface LoadedTeam {
  id: string;
  name: string;
  communityId: string;
  guildId: string | null;
  createdById: string;
  members: Array<{ userId: string; discordId: string | null }>;
}

async function loadTeam(teamId: string, communityId: string): Promise<LoadedTeam | null> {
  const team = await prisma.communityTeam.findFirst({
    where: { id: teamId, communityId },
    select: {
      id: true,
      name: true,
      communityId: true,
      createdById: true,
      community: { select: { discordGuildId: true } },
      members: {
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
  return plan.reason === "quota" ? "quota" : plan.reason === "unmanaged" ? "unmanaged" : "failed";
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
  const store = input.store ?? createPrismaSpaceLinkStore();
  const team = await loadTeam(input.teamId, input.communityId);
  if (!team) return { status: "failed" };
  if (!team.guildId) return { status: "community_not_linked" };

  try {
    const link = await store.find(team.id);
    if (link && !input.dryRun) return { status: "reused", roleId: link.roleId, channelId: link.channelId };
    const links = await store.listByCommunity(team.communityId);
    const snapshot = await input.api.snapshot(team.guildId);
    const plan = planFrom(team, snapshot, link ? [link, ...links.filter((row) => row.teamId !== team.id)] : links);
    if (plan.status !== "planned") return { status: ineligibleStatus(plan) };
    if (input.dryRun) return { status: "failed" };

    const applied = await applyTeamSpacePlan(plan, clientFrom(input.api, team.guildId), env);
    if (applied.status === "disabled") return { status: "disabled" };
    if (applied.roleId && applied.channelId) {
      await store.save({
        teamId: team.id,
        communityId: team.communityId,
        guildId: team.guildId,
        channelId: applied.channelId,
        roleId: applied.roleId,
      });
    }
    const created = !link && applied.status === "applied";
    return {
      status: applied.status === "partial" ? "partial" : created ? "created" : "reused",
      roleId: applied.roleId,
      channelId: applied.channelId,
      steps: applied.steps,
    };
  } catch (error) {
    if (error instanceof SpaceStoreUnavailableError) return { status: "migration_required" };
    logger.warn("discord-team-space", "Provisionnement d’espace impossible.", {
      errorType: error instanceof Error ? error.name : "unknown",
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
  const store = input.store ?? createPrismaSpaceLinkStore();
  try {
    const team = await loadTeam(input.teamId, input.communityId);
    if (!team || !team.guildId) return { status: "not_member" };
    const guildId = team.guildId;
    const link = await store.find(team.id);
    if (!link?.roleId) return { status: "not_provisioned" };
    const roleId = link.roleId;
    const member = team.members.find((candidate) => candidate.discordId === input.discordId);
    if (input.action === "join" && !member) return { status: "not_member" };
    if (input.action === "join") {
      await input.api.addMemberRole(guildId, input.discordId, roleId);
      return { status: "updated" };
    }
    // Départ : retrait du rôle uniquement — aucun XP, aucune ressource supprimée.
    await input.api.removeMemberRole(guildId, input.discordId, roleId);
    return { status: "removed" };
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
  const store = input.store ?? createPrismaSpaceLinkStore();
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
  const store = input.store ?? createPrismaSpaceLinkStore();
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
    return { status: applied.status === "applied" ? "reused" : "partial", roleId: link.roleId, channelId: link.channelId, steps: applied.steps };
  } catch (error) {
    if (error instanceof SpaceStoreUnavailableError) return { status: "migration_required" };
    return { status: "failed" };
  }
}
