import { NextRequest, NextResponse } from "next/server";
import plan from "@/lib/tower-discord-layout.json";
import { requireAdmin } from "@/lib/admin";
import { getCurrentUser } from "@/lib/current-user";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Channel = { id: string; name: string; type: number; parent_id: string | null; permission_overwrites?: Array<{ id: string; type: number; allow: string; deny: string }> };
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
    return NextResponse.json({ ...publicData, mode: "read-only", guildId: GUILD }, { headers });
  } catch {
    return NextResponse.json({ error: "Discord preflight unavailable" }, { status: 502, headers });
  }
}
export async function POST(req: NextRequest) {
  const currentUser = await getCurrentUser({ allowPlatformAdminWithoutMembership: true });
  const admin = currentUser ? await requireAdmin() : null;
  if (!admin || admin.discordId !== OWNER) return NextResponse.json({ error: "Forbidden" }, { status: 403, headers });
  if (req.headers.get("origin") !== new URL(req.url).origin) return NextResponse.json({ error: "Origin mismatch" }, { status: 403, headers });
  const body = await req.json().catch(() => ({}));
  if (body?.confirm !== "THE_TOWER_PHASE_1" || body?.guildId !== GUILD) {
    return NextResponse.json({ error: "Explicit confirmation required" }, { status: 400, headers });
  }
  try {
    const state = await overview();
    if (state.errors.length) return NextResponse.json({ error: "Preflight failed", details: state.errors }, { status: 409, headers });
    // Small batches avoid Vercel function timeout; refresh before each invocation.
    const completed: string[] = [];
    for (const task of state.actions.slice(0, 4)) {
      if (task.operation === "rename-category" || task.operation === "rename-channel") {
        await discord("PATCH", "/channels/" + task.id, { name: task.name });
      } else if (task.operation === "create-category") {
        await discord("POST", "/guilds/" + GUILD + "/channels", { name: task.name, type: 4 });
      } else if (task.operation === "reorder-categories") {
        const current = await discord("GET", "/guilds/" + GUILD + "/channels") as Channel[];
        const ids = plan.category_order.map(category =>
          "reuse_category_id" in category
            ? category.reuse_category_id
            : current.find(x => x.type === 4 && x.name === category.name)?.id
        );
        if (ids.some(id => !id)) throw new Error("Missing category for ordering");
        await discord("PATCH", "/guilds/" + GUILD + "/channels",
          ids.map((id, position) => ({ id, position }))
        );
      } else {
        const current = await discord("GET", "/guilds/" + GUILD + "/channels") as Channel[];
        const parent = current.find(x => x.type === 4 && x.name === task.category);
        if (!parent) break;
        const already = current.some(x => x.parent_id === parent.id && x.name === task.name);
        if (!already) {
          await discord("POST", "/guilds/" + GUILD + "/channels", {
            name: task.name, type: task.type, parent_id: parent.id,
            // Copy category overrides explicitly. No existing channel is moved.
            permission_overwrites: parent.permission_overwrites || [],
          });
        }
      }
      completed.push(task.operation + ": " + task.name);
    }
    const after = await overview();
    return NextResponse.json({
      completed, remaining: after.actions.length, errors: after.errors,
      archivesDeferred: after.archivesDeferred, complete: after.actions.length === 0,
      warning: "Phase 1 only. Archives, reparenting and permission changes are intentionally not performed.",
    }, { headers });
  } catch {
    return NextResponse.json({ error: "Discord operation stopped; refresh the preview to resume safely" }, { status: 502, headers });
  }
}
