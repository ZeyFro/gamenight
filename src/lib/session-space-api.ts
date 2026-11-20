import {
  addThreadMember,
  createSetupChannel,
  deleteChannelMemberPermission,
  deleteGuildChannel,
  getGuildMemberVoiceChannel,
  putChannelMemberPermission,
  removeThreadMember,
  startPrivateThread,
  type DiscordRestFailure,
} from "@/lib/discord-rest";
import { buildVoiceOverwrites } from "@/lib/session-space-plan";
import { VOICE_CHANNEL_ALLOW } from "@/lib/discord-team-spaces";
import type { SessionSpaceApi } from "@/lib/session-space-service";

/**
 * Adaptateur Discord réel de l'espace temporaire d'une soirée, appelé UNIQUEMENT par
 * l'executor (`session-space-runner.ts`) : jamais par une action web. Aucun rôle n'est
 * créé ni modifié ; les accès sont des overwrites par membre sur CE vocal et des membres
 * de CE fil privé. Les suppressions ne visent que des identifiants persistés par GameNight.
 */
export const SESSION_SPACE_BUDGET_MS = 8_000;

function unwrap<T>(result: { ok: true; data: T } | DiscordRestFailure): T {
  if (!result.ok) throw new Error(`discord_${result.kind}`);
  return result.data;
}

export function createDiscordSessionSpaceApi(executorDeadline?: Date): SessionSpaceApi {
  const deadline = (): Date => executorDeadline ?? new Date(Date.now() + SESSION_SPACE_BUDGET_MS);
  return {
    async createPrivateThread(parentChannelId, name) {
      // Fil PRIVÉ non invitable : seuls les membres ajoutés par GameNight y accèdent.
      return unwrap(await startPrivateThread({ channelId: parentChannelId, name, invitable: false, autoArchiveDuration: 1440, deadline: deadline() })).threadId;
    },
    async addThreadMember(threadId, discordUserId) {
      unwrap(await addThreadMember({ threadId, discordUserId, deadline: deadline() }));
    },
    async removeThreadMember(threadId, discordUserId) {
      const result = await removeThreadMember({ threadId, discordUserId, deadline: deadline() });
      if (!result.ok && result.kind !== "not_found") throw new Error(`discord_${result.kind}`);
    },
    async createVoiceChannel(guildId, name, memberDiscordIds) {
      const created = unwrap(
        await createSetupChannel({
          guildId,
          deadline: deadline(),
          channel: { name, type: 2, permission_overwrites: buildVoiceOverwrites(guildId, memberDiscordIds) },
        })
      );
      return created.id;
    },
    async allowVoiceMember(channelId, discordUserId) {
      unwrap(await putChannelMemberPermission({ channelId, userId: discordUserId, allow: VOICE_CHANNEL_ALLOW, deadline: deadline() }));
    },
    async denyVoiceMember(channelId, discordUserId) {
      const result = await deleteChannelMemberPermission({ channelId, userId: discordUserId, deadline: deadline() });
      if (!result.ok && result.kind !== "not_found") throw new Error(`discord_${result.kind}`);
    },
    async memberVoiceChannel(guildId, discordUserId) {
      return unwrap(await getGuildMemberVoiceChannel({ guildId, userId: discordUserId, deadline: deadline() })).channelId;
    },
    async deleteChannel(channelId) {
      const result = await deleteGuildChannel({ channelId, deadline: deadline() });
      // Déjà absent = état cible atteint.
      if (!result.ok && result.kind !== "not_found") throw new Error(`discord_${result.kind}`);
    },
  };
}
