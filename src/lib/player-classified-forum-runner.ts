import {
  archiveThread,
  createForumPost,
  listDiscordForumChannels,
  listGuildRoles,
  NO_MENTIONS,
  type DiscordRestResult,
} from "@/lib/discord-rest";
import { scopedPrisma } from "@/lib/community-scoped-client";
import { countGamePingOptIns } from "@/lib/game-ping-optin";
import { buildGameRolePing } from "@/lib/notification-policy";
import { PLAYER_CLASSIFIED_FORUM_NAME, type PlayerClassifiedForumIntent } from "@/lib/player-classified-forum";

/**
 * Exécution du relais forum. Le runner relit toujours l'annonce : un rejeu après
 * crash ne crée pas de second post si `forumThreadId` est déjà écrit.
 */
export async function runPlayerClassifiedForumAction(
  input: { intent: PlayerClassifiedForumIntent; listingId: string; communityId: string; threadId?: string },
  deadline: Date,
): Promise<DiscordRestResult<{ threadId?: string }>> {
  const scopedDb = scopedPrisma(null);
  const listing = await scopedDb.playerClassified.findUnique({
    where: { id: input.listingId },
    select: {
      id: true,
      communityId: true,
      message: true,
      pingedAt: true,
      forumThreadId: true,
      forumClosedAt: true,
      game: { select: { id: true, name: true } },
      createdBy: { select: { discordId: true, discordName: true, profileVisibility: { select: { visibility: true } } } },
      community: { select: { discordGuildId: true } },
    },
  });

  // Annonce retirée : la ligne n'existe plus, mais le fil à fermer est porté par
  // l'événement. Aucune autre lecture n'est nécessaire.
  if (!listing) {
    if (input.intent === "close" && input.threadId) {
      const archived = await archiveThread({ threadId: input.threadId, locked: false, deadline });
      if (!archived.ok && archived.kind !== "not_found") return archived;
      return { ok: true, data: { threadId: input.threadId } };
    }
    return { ok: false, kind: "not_found", message: "Annonce introuvable.", retryable: false };
  }
  if (listing.communityId !== input.communityId || !listing.community.discordGuildId) {
    return { ok: false, kind: "not_found", message: "Annonce introuvable.", retryable: false };
  }

  if (input.intent === "close") {
    if (!listing.forumThreadId) {
      return { ok: false, kind: "not_found", message: "Aucun post forum à fermer.", retryable: false };
    }
    if (!listing.forumClosedAt) {
      const archived = await archiveThread({ threadId: listing.forumThreadId, locked: false, deadline });
      if (!archived.ok && archived.kind !== "not_found") return archived;
      await scopedDb.playerClassified.updateMany({
        where: { id: listing.id, communityId: listing.communityId, forumClosedAt: null },
        data: { forumClosedAt: new Date() },
      });
    }
    return { ok: true, data: { threadId: listing.forumThreadId } };
  }

  if (listing.forumThreadId) return { ok: true, data: { threadId: listing.forumThreadId } };
  // Un profil masqué ne fuit jamais son annonce dans le forum public.
  if (listing.createdBy.profileVisibility?.visibility === "HIDDEN") {
    return { ok: false, kind: "not_found", message: "Profil masqué : annonce non relayée.", retryable: false };
  }

  const forums = await listDiscordForumChannels({
    guildId: listing.community.discordGuildId,
    deadline,
  });
  if (!forums.ok) return forums;
  const matches = forums.data.filter((forum) => forum.name === PLAYER_CLASSIFIED_FORUM_NAME);
  if (matches.length !== 1) {
    return { ok: false, kind: "not_found", message: "Forum de recherche de joueurs introuvable ou ambigu.", retryable: false };
  }

  let ping = null;
  if (listing.pingedAt) {
    const [roles, optedInCount] = await Promise.all([
      listGuildRoles({ guildId: listing.community.discordGuildId, deadline }),
      countGamePingOptIns(listing.communityId, listing.game.id),
    ]);
    if (roles.ok) {
      ping = buildGameRolePing({ gameName: listing.game.name, roles: roles.data.roles, optedInCount });
    }
  }

  const title = `${listing.game.name} · ${listing.createdBy.discordName}`.slice(0, 100);
  const content = [
    ping?.content,
    `**${listing.game.name}** — ${listing.message}`,
    `<@${listing.createdBy.discordId}>`,
  ].filter(Boolean).join("\n");

  const created = await createForumPost({
    forumChannelId: matches[0].id,
    name: title,
    content,
    allowedMentions: ping?.allowedMentions ?? NO_MENTIONS,
    autoArchiveDuration: 1440,
    deadline,
  });
  if (!created.ok) return created;

  await scopedDb.playerClassified.updateMany({
    where: { id: listing.id, communityId: listing.communityId, forumThreadId: null },
    data: { forumThreadId: created.data.threadId, forumRelayedAt: new Date() },
  });
  return { ok: true, data: { threadId: created.data.threadId } };
}
