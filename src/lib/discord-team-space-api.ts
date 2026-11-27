import {
  addGuildMemberRole,
  createGuildRole,
  createSetupChannel,
  deleteChannelMemberPermission,
  deleteGuildChannel,
  editGuildChannel,
  listGuildRoles,
  listSetupChannels,
  putChannelMemberPermission,
  removeGuildMemberRole,
  type DiscordRestFailure,
} from "@/lib/discord-rest";
import type { OverwritePlan } from "@/lib/discord-team-spaces";
import type { TeamSpaceDiscordApi } from "@/lib/discord-team-space-service";

/**
 * Adaptateur Discord réel des espaces d'équipe, appelé UNIQUEMENT par l'executor
 * de notifications (`discord-team-space-runner.ts`) : jamais par une commande ou
 * une action. Toute écriture passe par `discord-rest` (délai borné, pas de retry
 * interne, 204 géré) ; aucun appel n'est tenté sans `DISCORD_TEAM_SPACES_ENABLED`
 * (vérifié par le service et par le résolveur).
 *
 * Aucune suppression n'existe ici : archiver = renommer. Un rôle est créé avec
 * `permissions: "0"` (voir `createGuildRole`), donc jamais administrateur.
 */
export const TEAM_SPACE_BUDGET_MS = 8_000;

function unwrap<T>(result: { ok: true; data: T } | DiscordRestFailure): T {
  if (!result.ok) throw new Error(`discord_${result.kind}`);
  return result.data;
}

/** `executorDeadline` : échéance du bail de la livraison, partagée par tous les appels. */
export function createDiscordTeamSpaceApi(executorDeadline?: Date): TeamSpaceDiscordApi {
  const deadline = (): Date => executorDeadline ?? new Date(Date.now() + TEAM_SPACE_BUDGET_MS);
  return {
    async snapshot(guildId) {
      const [channels, roles] = await Promise.all([
        listSetupChannels({ guildId, deadline: deadline() }),
        listGuildRoles({ guildId, deadline: deadline() }),
      ]);
      return {
        channels: unwrap(channels).map((channel) => ({
          id: channel.id,
          name: channel.name,
          type: channel.type,
          parentId: channel.parent_id ?? null,
          memberOverwriteIds: (channel.permission_overwrites ?? []).filter((row) => row.type === 1).map((row) => row.id),
        })),
        roles: unwrap(roles).roles,
      };
    },
    // Legacy : plus appelé par le provisionnement sans rôle, conservé pour les liens antérieurs.
    async createRole(guildId, name) {
      return unwrap(await createGuildRole({ guildId, name, deadline: deadline() })).id;
    },
    async createChannel(guildId, name, type, overwrites) {
      // `type` vient du plan : 0 = salon textuel, 2 = salon vocal.
      // Chaque membre reçoit sa permission nominative, sans rôle d'équipe.
      const created = unwrap(
        await createSetupChannel({
          guildId,
          deadline: deadline(),
          channel: {
            name,
            type,
            permission_overwrites: buildOverwrites(guildId, overwrites),
          },
        })
      );
      return created.id;
    },
    async setMemberPermission(channelId, userId, allow, action) {
      if (action === "remove") {
        const result = await deleteChannelMemberPermission({ channelId, userId, deadline: deadline() });
        if (!result.ok && result.kind !== "not_found") throw new Error(`discord_${result.kind}`);
        return;
      }
      unwrap(await putChannelMemberPermission({ channelId, userId, allow, deadline: deadline() }));
    },
    async deleteChannel(channelId) {
      const result = await deleteGuildChannel({ channelId, deadline: deadline() });
      // Déjà absent = état cible atteint ; le rejeu après échec partiel reste idempotent.
      if (!result.ok && result.kind !== "not_found") throw new Error(`discord_${result.kind}`);
    },
    async renameChannel(channelId, name) {
      unwrap(await editGuildChannel({ channelId, name, deadline: deadline() }));
    },
    async addMemberRole(guildId, userId, roleId) {
      unwrap(await addGuildMemberRole({ guildId, userId, roleId, deadline: deadline() }));
    },
    async removeMemberRole(guildId, userId, roleId) {
      const result = await removeGuildMemberRole({ guildId, userId, roleId, deadline: deadline() });
      // Rejouer un départ (rôle déjà retiré) est un succès idempotent.
      if (!result.ok && result.kind !== "not_found") throw new Error(`discord_${result.kind}`);
    },
  };
}

/** Traduit les cibles symboliques du plan en identifiants Discord réels. */
export function buildOverwrites(
  guildId: string,
  roleIdOrOverwrites: string | null | OverwritePlan[],
  legacyOverwrites?: OverwritePlan[],
) {
  // Compatibilité des appels historiques (rôle) : le chemin actuel passe le plan.
  const overwrites = Array.isArray(roleIdOrOverwrites)
    ? roleIdOrOverwrites
    : (legacyOverwrites ?? []).map((row) => row.target === "everyone"
      ? row
      : { ...row, target: "member" as const, userId: roleIdOrOverwrites ?? undefined });
  return overwrites
    .map((overwrite) => {
      const id = overwrite.target === "everyone" ? guildId : overwrite.userId;
      if (!id) return null;
      return {
        id,
        type: overwrite.target === "everyone" ? 0 : 1,
        allow: overwrite.allow ?? "0",
        deny: overwrite.deny ?? "0",
      };
    })
    .filter((row): row is { id: string; type: 0 | 1; allow: string; deny: string } => row !== null);
}

