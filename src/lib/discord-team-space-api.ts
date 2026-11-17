import {
  addGuildMemberRole,
  createGuildRole,
  createSetupChannel,
  editGuildChannel,
  listGuildRoles,
  listSetupChannels,
  removeGuildMemberRole,
  type DiscordRestFailure,
} from "@/lib/discord-rest";
import type { OverwritePlan } from "@/lib/discord-team-spaces";
import type { TeamSpaceDiscordApi } from "@/lib/discord-team-space-service";

/**
 * Adaptateur Discord réel des espaces d'équipe. Toute écriture passe par
 * `discord-rest` (délai borné, pas de retry interne, 204 géré) ; aucun de ces
 * appels n'est déclenché sans le flag `DISCORD_TEAM_SPACES_ENABLED`.
 *
 * Aucune suppression n'existe ici : archiver = renommer. Un rôle est créé avec
 * `permissions: "0"` (voir `createGuildRole`), donc jamais administrateur.
 */
export const TEAM_SPACE_BUDGET_MS = 8_000;

function deadline(): Date {
  return new Date(Date.now() + TEAM_SPACE_BUDGET_MS);
}

function unwrap<T>(result: { ok: true; data: T } | DiscordRestFailure): T {
  if (!result.ok) throw new Error(`discord_${result.kind}`);
  return result.data;
}

export function createDiscordTeamSpaceApi(): TeamSpaceDiscordApi {
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
        })),
        roles: unwrap(roles).roles,
      };
    },
    async createRole(guildId, name) {
      return unwrap(await createGuildRole({ guildId, name, deadline: deadline() })).id;
    },
    async createChannel(guildId, name, overwrites, roleId) {
      const created = unwrap(
        await createSetupChannel({
          guildId,
          deadline: deadline(),
          channel: {
            name,
            type: 0,
            permission_overwrites: buildOverwrites(guildId, roleId, overwrites),
          },
        })
      );
      return created.id;
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
export function buildOverwrites(guildId: string, roleId: string | null, overwrites: OverwritePlan[]) {
  return overwrites
    .map((overwrite) => {
      const id = overwrite.target === "everyone" ? guildId : roleId;
      if (!id) return null;
      return { id, type: 0, allow: overwrite.allow ?? "0", deny: overwrite.deny ?? "0" };
    })
    .filter((row): row is { id: string; type: 0; allow: string; deny: string } => row !== null);
}

