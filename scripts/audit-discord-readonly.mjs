#!/usr/bin/env node
/**
 * Read-only Discord guild inventory for The Tower.
 *
 * No Discord mutations. Uses only GET endpoints. Never prints tokens, member
 * lists, messages, private channel names or role names.
 *
 * Usage (in an authorised shell with a bot token already configured):
 *   DISCORD_BOT_TOKEN=... TOWER_DISCORD_GUILD_ID=... node scripts/audit-discord-readonly.mjs
 *
 * Results are coarse aggregate counts, not an effective-permissions test.
 */
const token = process.env.DISCORD_BOT_TOKEN;
const guildId = process.env.TOWER_DISCORD_GUILD_ID || process.env.DISCORD_BOT_GUILD_ID;
if (!token || !guildId || !/^\d{16,20}$/.test(guildId)) {
  process.stderr.write("Missing DISCORD_BOT_TOKEN or valid TOWER_DISCORD_GUILD_ID/DISCORD_BOT_GUILD_ID.\n");
  process.exit(2);
}

const API = "https://discord.com/api/v10";
async function get(path) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await fetch(API + path, {
      method: "GET",
      headers: { Authorization: "Bot " + token },
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 429) {
      let retryAfter = 1;
      try {
        const body = await response.json();
        if (Number.isFinite(body.retry_after)) retryAfter = body.retry_after;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, Math.min(10_000, Math.max(250, retryAfter * 1000))));
      continue;
    }
    if (response.status >= 500 && attempt < 4) {
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
      continue;
    }
    if (!response.ok) throw new Error("Discord GET failed: HTTP " + response.status + " (" + path.replace(/\d{16,20}/g, "{guild}") + ")");
    return response.json();
  }
  throw new Error("Discord read rate limit / service unavailable after retry budget.");
}

const bit = (p, flag) => {
  try { return (BigInt(p || "0") & flag) === flag; } catch { return false; }
};
const ADMIN = 8n;
const VIEW = 1024n;
const CONNECT = 1048576n;
const counts = (items, predicate) => items.reduce((n, item) => n + Number(predicate(item)), 0);
const guildPath = "/guilds/" + guildId;

try {
  const [guild, roles, channels] = await Promise.all([
    get(guildPath + "?with_counts=true"),
    get(guildPath + "/roles"),
    get(guildPath + "/channels"),
  ]);
  if (!Array.isArray(roles) || !Array.isArray(channels)) throw new Error("Unexpected Discord response shape.");
  const everyone = roles.find((role) => role.id === guildId);
  const categories = channels.filter((c) => c.type === 4);
  const voice = channels.filter((c) => c.type === 2 || c.type === 13);
  const forums = channels.filter((c) => c.type === 15);
  const privateByEveryoneOverwrite = channels.filter((c) =>
    (c.permission_overwrites || []).some((o) => o.id === guildId && bit(o.deny, VIEW))
  );
  const check = {
    collectedAt: new Date().toISOString(),
    readOnly: true,
    guildIdSuffix: guildId.slice(-6),
    memberCountApprox: Number.isFinite(guild.approximate_member_count) ? guild.approximate_member_count : null,
    presenceCountApprox: Number.isFinite(guild.approximate_presence_count) ? guild.approximate_presence_count : null,
    roles: {
      total: roles.length,
      cap: 250,
      remaining: 250 - roles.length,
      administratorsByRolePermission: counts(roles, (r) => r.id !== guildId && bit(r.permissions, ADMIN)),
      everyoneHasAdministrator: everyone ? bit(everyone.permissions, ADMIN) : null,
    },
    channels: {
      total: channels.length,
      cap: 500,
      remaining: 500 - channels.length,
      categories: categories.length,
      voice: voice.length,
      forums: forums.length,
      everyoneViewDeniedExplicitly: privateByEveryoneOverwrite.length,
      noExplicitEveryoneViewDeny: channels.length - privateByEveryoneOverwrite.length,
      voiceEveryoneConnectDeniedExplicitly: counts(voice, (c) =>
        (c.permission_overwrites || []).some((o) => o.id === guildId && bit(o.deny, CONNECT))
      ),
      permissionOverwriteCount: channels.reduce((sum, c) => sum + (c.permission_overwrites || []).length, 0),
      orphanedChildChannels: counts(channels, (c) => c.parent_id && !categories.some((p) => p.id === c.parent_id)),
      forumTagsOver20: counts(forums, (c) => (c.available_tags || []).length > 20),
    },
    warnings: [
      "Overwrite counts do not establish effective visibility for specific members or roles.",
      "No messages, members, role names, channel names or private content were downloaded.",
      "No user journeys were executed. Audit permissions with separate authorised test accounts.",
    ],
  };
  process.stdout.write(JSON.stringify(check, null, 2) + "\n");
} catch (error) {
  process.stderr.write(String(error instanceof Error ? error.message : error) + "\n");
  process.exitCode = 1;
}
