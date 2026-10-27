import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const GUILD = "553922938101825536";
const ADMIN = "699223334046531636";
const API = "https://discord.com/api/v10";

export async function GET() {
  const user = await requireAdmin();
  if (!user || user.discordId !== ADMIN) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  if (process.env.TOWER_DISCORD_PREFLIGHT !== "enabled") {
    return NextResponse.json({ error: "Preflight disabled" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return NextResponse.json({ error: "Bot token unavailable" }, { status: 503 });
  try {
    const response = await fetch(API + "/guilds/" + GUILD + "/channels", {
      method: "GET",
      headers: { Authorization: "Bot " + token },
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) {
      return NextResponse.json({ error: "Discord inventory failed", status: response.status }, { status: 502, headers: { "Cache-Control": "no-store" } });
    }
    const channels = await response.json() as Array<{ id: string; name: string; type: number; parent_id: string | null; permission_overwrites?: unknown[]; position?: number }>;
    // Never expose bot token, message content, member list or role assignments.
    return NextResponse.json({
      guildId: GUILD,
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
  } catch {
    return NextResponse.json({ error: "Discord request unavailable" }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
