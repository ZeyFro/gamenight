import "server-only";

import { findActiveMembership } from "@/lib/community-access";
import { resolveActiveCommunityId } from "@/lib/community-isolation";
import {
  getDiscordForumMember,
  getSetupGuild,
  listActiveDiscordThreads,
  listArchivedDiscordForumThreads,
  listDiscordForumChannels,
} from "@/lib/discord-rest";
import { channelPermissions } from "@/lib/discord-setup-permissions";
import { normalizeForSearch } from "@/lib/game-search";
import { checkRateLimit } from "@/lib/rate-limit";
import { towerGuildId } from "@/lib/tower-config";

// Noms du plan Discord et tags proposés dans docs/TOWER_FORUM_TAGS.md.
const FORUMS = [
  { id: "players", name: "🔎・recherche-de-joueurs", label: "Recherche de joueurs",
    suggestedTags: ["PC", "PlayStation", "Xbox", "Switch", "Cross-play"] },
  { id: "teams", name: "🛡️・recrutement-équipes", label: "Recrutement d’équipes",
    suggestedTags: ["Débutants bienvenus", "Détente", "Compétitif", "Long terme", "Recherche capitaine"] },
  { id: "projects", name: "🌍・projets-et-aventures", label: "Projets et aventures",
    suggestedTags: ["Coop", "Construction", "Exploration", "Survival", "Événement"] },
] as const;

export const TOWER_FORUM_QUERY_MAX = 80;
const ADMINISTRATOR = BigInt(8);
const READ_FORUM = (BigInt(1) << BigInt(10)) | (BigInt(1) << BigInt(16));

type ForumSearch = {
  status: "invalid" | "forbidden" | "unavailable" | "rate_limited";
} | {
  status: "ready";
  forums: {
    id: string;
    label: string;
    suggestedTags: readonly string[];
    posts: { title: string; url: string; tags: string[] }[];
  }[];
};

function searchWords(value: string) {
  return normalizeForSearch(value).split(/[^\p{L}\p{N}+#]+/u).filter(Boolean).join(" ");
}

export async function searchTowerForums(
  user: { id: string; discordId: string },
  game: string,
): Promise<ForumSearch> {
  const query = searchWords(game);
  if (!query || game.length > TOWER_FORUM_QUERY_MAX) return { status: "invalid" };

  const guildId = towerGuildId();
  const communityId = await resolveActiveCommunityId(user.id);
  const membership = communityId ? await findActiveMembership(user.id, communityId) : null;
  if (membership?.community.discordGuildId !== guildId) return { status: "forbidden" };
  if (!checkRateLimit(user.id, "tower-forum-search")) return { status: "rate_limited" };

  const read = { guildId, deadline: new Date(Date.now() + 8_000) };
  const [guild, member, channels] = await Promise.all([
    getSetupGuild(read),
    getDiscordForumMember({ ...read, userId: user.discordId }),
    listDiscordForumChannels(read),
  ]);
  if (!member.ok && member.kind === "not_found") return { status: "forbidden" };
  if (!guild.ok || guild.data.id !== guildId || !member.ok || !channels.ok) return { status: "unavailable" };
  if (member.data.pending) return { status: "forbidden" };

  const rolePermissions = new Map(guild.data.roles.map(({ id, permissions }) => [id, BigInt(permissions)]));
  const roleIds = [guildId, ...member.data.roles];
  if (roleIds.some((id) => !rolePermissions.has(id))) return { status: "unavailable" };
  const base = roleIds.reduce((bits, id) => bits | rolePermissions.get(id)!, BigInt(0));
  const isOwner = guild.data.owner_id === user.discordId;
  const forums = FORUMS.flatMap((forum) => {
    const matches = channels.data.filter((channel) => channel.name === forum.name);
    if (matches.length !== 1) return [];
    const channel = matches[0];
    const permissions = channelPermissions(base, guildId, user.discordId, member.data.roles, channel.permission_overwrites);
    if (!isOwner && !(permissions & ADMINISTRATOR) && (permissions & READ_FORUM) !== READ_FORUM) return [];
    return [{ ...forum, channel }];
  });
  if (!forums.length) return { status: "ready", forums: [] };

  const [active, ...archived] = await Promise.all([
    listActiveDiscordThreads(read),
    ...forums.map(({ channel }) => listArchivedDiscordForumThreads({ channelId: channel.id, deadline: read.deadline })),
  ]);
  if (!active.ok || archived.some((archive) => !archive.ok)) return { status: "unavailable" };

  return {
    status: "ready",
    forums: forums.map(({ id, label, suggestedTags, channel }, index) => {
      const archive = archived[index];
      const tags = new Map(channel.available_tags.map((tag) => [tag.id, tag.name]));
      const threads = [...active.data, ...(archive.ok ? archive.data : [])].filter((thread) =>
        thread.type === 11 && thread.parent_id === channel.id && (!thread.guild_id || thread.guild_id === guildId));
      const seen = new Set<string>();
      const posts = threads.flatMap((thread) => {
        if (seen.has(thread.id)) return [];
        seen.add(thread.id);
        const appliedTags = thread.applied_tags.flatMap((tagId) => {
          const name = tags.get(tagId);
          return name ? [name] : [];
        });
        const titleMatches = ` ${searchWords(thread.name)} `.includes(` ${query} `);
        if (!titleMatches && !appliedTags.some((tag) => searchWords(tag) === query)) return [];
        return [{ title: thread.name, tags: appliedTags, url: `https://discord.com/channels/${guildId}/${thread.id}` }];
      });
      return { id, label, suggestedTags, posts: posts.slice(0, 25) };
    }),
  };
}
