import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const API = "https://discord.com/api/v10";
const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Inventaire en lecture seule des salons du serveur `DISCORD_BOT_GUILD_ID`
 * (préparation de la mise en page Tower). Réservé aux admins (`requireAdmin`),
 * éteint sauf `TOWER_DISCORD_PREFLIGHT_ENABLED=true`. Aucune écriture Discord.
 */
export async function GET() {
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
      phase: "read-only-preflight",
      writesApplied: false,
    }, { headers: { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" } });
  } catch (error) {
    logger.error("admin:tower-preflight", error);
    return NextResponse.json({ error: "Discord request unavailable" }, { status: 502, headers: NO_STORE });
  }
}
