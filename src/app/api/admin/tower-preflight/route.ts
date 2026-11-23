import { isVercelPreview } from "@/lib/preview-safety";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { logger } from "@/lib/logger";
import { botGuildPermissions, missingBotPermissions } from "@/lib/discord-bot-permissions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const API = "https://discord.com/api/v10";
const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Inventaire en lecture seule des salons du serveur `DISCORD_BOT_GUILD_ID`
 * (préparation de la mise en page Tower). Réservé aux admins (`requireAdmin`),
 * éteint sauf `TOWER_DISCORD_PREFLIGHT_ENABLED=true`. Aucune écriture Discord.
 * Indique aussi les permissions de serveur qui manquent au bot (`botPermissions`, docs/PERMISSIONS_BOTS.md), dont
 * « Mentionner @everyone, @here et tous les rôles » : à relire après le retrait du droit Administrateur.
 */
export async function GET() {
  if (isVercelPreview()) return NextResponse.json({ error: "preview_disabled" }, { status: 503 });
  const user = await requireAdmin();
  if (!user) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: NO_STORE });
  }
  if (process.env.TOWER_DISCORD_PREFLIGHT_ENABLED !== "true") {
    return NextResponse.json({ error: "Preflight disabled" }, { status: 404, headers: NO_STORE });
  }
  const token = process.env.DISCORD_BOT_TOKEN;
  const guildId = process.env.DISCORD_BOT_GUILD_ID;
  if (!token || !guildId) {
    return NextResponse.json({ error: "Discord bot not configured" }, { status: 503, headers: NO_STORE });
  }
  try {
    const response = await fetch(API + "/guilds/" + guildId + "/channels", {
      method: "GET",
      headers: { Authorization: "Bot " + token },
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) {
      logger.warn("admin:tower-preflight", "Inventaire Discord refusé.", { status: response.status });
      return NextResponse.json({ error: "Discord inventory failed", status: response.status }, { status: 502, headers: NO_STORE });
    }
    const channels = await response.json() as Array<{ id: string; name: string; type: number; parent_id: string | null; permission_overwrites?: unknown[]; position?: number }>;
    const botPermissions = await readBotPermissions(token, guildId);
    // Never expose bot token, message content, member list or role assignments.
    return NextResponse.json({
      guildId,
      checkedAt: new Date().toISOString(),
      totalChannels: channels.length,
      categories: channels.filter(c => c.type === 4).map(c => ({
        id: c.id, name: c.name, position: c.position,
        children: channels.filter(x => x.parent_id === c.id).map(x => ({
          id: x.id, name: x.name, type: x.type,
          permissionOverwriteCount: x.permission_overwrites?.length ?? 0,
        })),
      })),
      unparentedChannelCount: channels.filter(c => c.type !== 4 && c.parent_id === null).length,
      botPermissions,
      phase: "read-only-preflight",
      writesApplied: false,
    }, { headers: { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" } });
  } catch (error) {
    logger.error("admin:tower-preflight", error);
    return NextResponse.json({ error: "Discord request unavailable" }, { status: 502, headers: NO_STORE });
  }
}

const get = (token: string, path: string) => fetch(API + path, {
  method: "GET", headers: { Authorization: "Bot " + token }, cache: "no-store", signal: AbortSignal.timeout(12000),
});

/** Permissions de serveur du bot (lecture seule) ; `unavailable` si Discord refuse une des lectures. */
async function readBotPermissions(token: string, guildId: string) {
  const me = await get(token, "/users/@me");
  if (!me.ok) return { status: "unavailable", http: me.status } as const;
  const { id } = await me.json() as { id: string };
  const [member, roles] = await Promise.all([get(token, "/guilds/" + guildId + "/members/" + id), get(token, "/guilds/" + guildId + "/roles")]);
  if (!member.ok || !roles.ok) return { status: "unavailable", http: member.ok ? roles.status : member.status } as const;
  const { roles: botRoleIds } = await member.json() as { roles: string[] };
  const permissions = botGuildPermissions(guildId, botRoleIds, await roles.json() as Array<{ id: string; permissions: string }>);
  return { status: "checked", administrator: (permissions & BigInt(8)) !== BigInt(0), missing: missingBotPermissions(permissions) } as const;
}
