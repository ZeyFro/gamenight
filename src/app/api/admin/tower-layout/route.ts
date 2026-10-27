import { NextRequest, NextResponse } from "next/server";
import plan from "@/lib/tower-discord-layout.json";
import { requireAdmin } from "@/lib/admin";
import { getCurrentUser } from "@/lib/current-user";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Channel = { id: string; name: string; type: number; position?: number; parent_id: string | null; permission_overwrites?: Array<{ id: string; type: number; allow: string; deny: string }> };
const GUILD = "553922938101825536";
const OWNER = "699223334046531636";
const API = "https://discord.com/api/v10";
const headers = { "Cache-Control": "private, no-store" };
async function discord(method: string, resource: string, data?: object): Promise<unknown> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) throw new Error("Discord bot unavailable");
  for (let retry = 0; retry < 5; retry++) {
    const response = await fetch(API + resource, {
      method,
      headers: { Authorization: "Bot " + token, ...(data ? { "Content-Type": "application/json" } : {}) },
      ...(data ? { body: JSON.stringify(data) } : {}),
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    if (response.status === 429) {
      const body = await response.json() as { retry_after?: number };
      await new Promise(done => setTimeout(done, Math.max(100, Math.min(3000, (body.retry_after || 1) * 1000))));
      continue;
    }
    if (!response.ok) throw new Error("Discord responded " + response.status + " for " + method + " " + resource);
    return response.status === 204 ? null : response.json();
  }
  throw new Error("Discord rate limit");
}
function operations(channels: Channel[]) {
  const byId = new Map(channels.map(x => [x.id, x]));
  const actions: Array<{ operation: string; category: string; id?: string; name: string; type?: number; parent?: string }> = [];
  const errors: string[] = [];
  for (const category of plan.category_order) {
    const old = "reuse_category_id" in category ? byId.get(category.reuse_category_id as string) : undefined;
    if ("reuse_category_id" in category && (!old || old.type !== 4)) {
      errors.push("Catégorie manquante ou invalide : " + category.name);
      continue;
    }
    const parent = old?.id || channels.find(x => x.type === 4 && x.name === category.name)?.id;
    if (!parent) actions.push({ operation: "create-category", category: category.name, name: category.name });
    else if (old && old.name !== category.name) actions.push({ operation: "rename-category", category: category.name, name: category.name, id: old.id });
    for (const c of category.channels) {
      const id = "reuse_id" in c ? c.reuse_id : undefined;
      const found = id ? byId.get(id) : channels.find(x => x.parent_id === parent && x.name === c.name);
      if (id && !found) {
        errors.push("Salon manquant : " + c.name);
        continue;
      }
      const type = "type" in c && c.type === "forum" ? 15 : "type" in c && c.type === "voice_lobby" ? 2 : 0;
      if (found && ![0, 2, 5, 15].includes(found.type)) errors.push("Type de salon incompatible : " + c.name);
      else if (!found) actions.push({ operation: "create-channel", category: category.name, name: c.name, type, parent });
      else if (found.name !== c.name) actions.push({ operation: "rename-channel", category: category.name, id: found.id, name: c.name });
    }
  }
  const orderedCategories = plan.category_order.map(c => (
    "reuse_category_id" in c
      ? byId.get(c.reuse_category_id as string)
      : channels.find(x => x.type === 4 && x.name === c.name)
  ));
  if (orderedCategories.every((x): x is Channel => !!x)) {
    const wanted = orderedCategories.map(x => x.id);
    const actual = channels.filter(x => x.type === 4 && wanted.includes(x.id))
      .sort((a,b) => (a.position ?? 0) - (b.position ?? 0))
      .map(x => x.id);
    if (wanted.some((id,i) => actual[i] !== id)) {
      actions.push({ operation: "reorder-categories", category: "The Tower", name: "Ordre des catégories" });
    }
  }
  for (const archive of plan.archive_candidates) {
    const cat = byId.get(archive.id);
    if (!cat || cat.type !== 4) errors.push("Archive candidate absente : " + archive.name);
  }
  return { actions, errors, archivesDeferred: plan.archive_candidates.map(x => x.name), totalChannels: channels.length };
}
async function overview() {
  const channels = await discord("GET", "/guilds/" + GUILD + "/channels") as Channel[];
  return { channels, ...operations(channels) };
}
export async function GET() {
  const currentUser = await getCurrentUser({ allowPlatformAdminWithoutMembership: true });
  const admin = currentUser ? await requireAdmin() : null;
  if (!admin || admin.discordId !== OWNER) return NextResponse.json({ error: "Forbidden" }, { status: 403, headers });
  try {
    const publicData = operations((await overview()).channels);
    return NextResponse.json({ ...publicData, mode: "read-only", writeEnabled: false, guildId: GUILD }, { headers });
  } catch {
    return NextResponse.json({ error: "Discord preflight unavailable" }, { status: 502, headers });
  }
}
export async function POST(_req: NextRequest) {
  // Pause structure changes until existing Discord services and content have been audited.
  return NextResponse.json({ error: "Réorganisation suspendue : audit des salons et des systèmes existants requis." }, { status: 423, headers });
}
