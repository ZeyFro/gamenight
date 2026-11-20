import {
  addThreadMember,
  archiveThread,
  removeThreadMember,
  sendThreadMessage,
  startPrivateThread,
  startPublicThread,
  NO_MENTIONS,
  type DiscordRestFailure,
} from "@/lib/discord-rest";
import type { ProjectSpaceApi } from "@/lib/project-space-service";

/**
 * Adaptateur Discord réel des fils de projet, appelé UNIQUEMENT par l'executor
 * (`project-space-runner.ts`). Aucun rôle, aucune suppression : archivage seulement.
 */
export const PROJECT_SPACE_BUDGET_MS = 8_000;

function unwrap<T>(result: { ok: true; data: T } | DiscordRestFailure): T {
  if (!result.ok) throw new Error(`discord_${result.kind}`);
  return result.data;
}

export function createDiscordProjectSpaceApi(executorDeadline?: Date): ProjectSpaceApi {
  const deadline = (): Date => executorDeadline ?? new Date(Date.now() + PROJECT_SPACE_BUDGET_MS);
  return {
    async createPublicThread(parentChannelId, name, introduction) {
      const thread = unwrap(await startPublicThread({ channelId: parentChannelId, name, deadline: deadline() }));
      // Texte fixe, sans mention : aucun ping.
      unwrap(await sendThreadMessage({ threadId: thread.threadId, content: introduction, allowedMentions: NO_MENTIONS, deadline: deadline() }));
      return thread.threadId;
    },
    async createPrivateThread(parentChannelId, name) {
      return unwrap(await startPrivateThread({ channelId: parentChannelId, name, invitable: false, deadline: deadline() })).threadId;
    },
    async addThreadMember(threadId, discordUserId) {
      unwrap(await addThreadMember({ threadId, discordUserId, deadline: deadline() }));
    },
    async removeThreadMember(threadId, discordUserId) {
      const result = await removeThreadMember({ threadId, discordUserId, deadline: deadline() });
      if (!result.ok && result.kind !== "not_found") throw new Error(`discord_${result.kind}`);
    },
    async archiveThread(threadId) {
      const result = await archiveThread({ threadId, deadline: deadline() });
      // Fil déjà absent : état cible atteint.
      if (!result.ok && result.kind !== "not_found") throw new Error(`discord_${result.kind}`);
    },
  };
}
