import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { getCurrentUser } from "@/lib/current-user";
import { requireAdmin } from "@/lib/admin";
import plan from "@/lib/tower-discord-layout.json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GUILD = "553922938101825536";
const OWNER = "699223334046531636";
const ARCHIVE_NAME = "📦・ARCHIVES PRIVÉES";
const DENY_VIEW = BigInt(1024);
const HEADERS = { "Cache-Control": "private, no-store" };
type Overwrite = { id: string; type: number; allow: string; deny: string };
type Channel = { id: string; name: string; type: number; parent_id: string | null; permission_overwrites?: Overwrite[]; position?: number };
type Action = { id: string; name: string; source: string; target: string; overwrites: Overwrite[] };
function error(message: string, status: number) { return NextResponse.json({ error: message }, { status, headers: HEADERS }); }
async function authorized() {
  const user = await getCurrentUser({ allowPlatformAdminWithoutMembership: true });
  const admin = user ? await requireAdmin() : null;
  return !!admin && admin.discordId === OWNER;
}
async function discord(method: string, url: string, data?: object): Promise<unknown> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) throw Error("Token unavailable");
  for (let i=0; i<5; i++) {
    const r = await fetch("https://discord.com/api/v10"+url, {
      method,
      headers: { Authorization: "Bot "+token, ...(data ? { "Content-Type": "application/json" } : {}) },
      ...(data ? { body: JSON.stringify(data) } : {}),
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    if (r.status === 429) {
      const j = await r.json() as { retry_after?: number };
      await new Promise(resolve => setTimeout(resolve, Math.min(4000, Math.ceil(1000*(j.retry_after || 1)))));
      continue;
    }
    if (!r.ok) throw Error("Discord HTTP "+r.status+" on "+method+" "+url);
    return r.status === 204 ? null : r.json();
  }
  throw Error("Discord rate limit exhausted");
}
const DENY_EVERYONE: Overwrite[] = [{ id: GUILD, type: 0, allow: "0", deny: DENY_VIEW.toString() }];
function privateFromEveryone(x: Channel) {
  const everyone = (x.permission_overwrites || []).find(o => o.id === GUILD && o.type === 0);
  return !!everyone && (BigInt(everyone.deny) & DENY_VIEW) === DENY_VIEW &&
    (x.permission_overwrites || []).every(o => o.id === GUILD && o.type === 0 && BigInt(o.allow) === BigInt(0));
}
function snapshot(channels: Channel[]) {
  return createHash("sha256").update(JSON.stringify(channels
    .map(x => ({ id: x.id, parent_id: x.parent_id, permission_overwrites: x.permission_overwrites || [] }))
    .sort((a,b) => a.id.localeCompare(b.id)))).digest("hex");
}
function prepare(channels: Channel[]) {
  const byId = new Map(channels.map(x => [x.id,x]));
  const errors: string[] = [];
  const archive = channels.find(x => x.type === 4 && x.name === ARCHIVE_NAME);
  if (archive && !privateFromEveryone(archive)) errors.push("Archive category exists but is not explicitly private");
  const actions: Action[] = [];
  for (const source of plan.archive_candidates) {
    const category = byId.get(source.id);
    if (!category || category.type !== 4) {
      errors.push("Missing legacy category: "+source.name);
      continue;
    }
    for (const child of channels.filter(x => x.parent_id === source.id)) {
      if (![0, 2, 5, 15].includes(child.type)) {
        errors.push("Unsupported legacy channel: "+child.name);
        continue;
      }
      actions.push({
        id: child.id, name: child.name, source: source.name, target: ARCHIVE_NAME,
        overwrites: child.permission_overwrites || [],
      });
    }
  }
  if (archive) {
    for (const child of channels.filter(x => x.parent_id === archive.id)) {
      if (!privateFromEveryone(child)) errors.push("Archive contains potentially visible channel: "+child.name);
    }
  }
  return { errors, actions, archiveId: archive?.id, snapshot: snapshot(channels) };
}
export async function GET() {
  if (!(await authorized())) return error("Forbidden", 403);
  try {
    const channels = await discord("GET","/guilds/"+GUILD+"/channels") as Channel[];
    const p = prepare(channels);
    // Detailed recovery snapshot, available only to the owner's authenticated session.
    return NextResponse.json({
      guildId: GUILD,
      archiveCategory: ARCHIVE_NAME,
      preview: p.actions.map(a => ({ id:a.id, name:a.name, source:a.source })),
      errors: p.errors,
      fingerprint: p.snapshot,
      backup: {
        capturedAt: new Date().toISOString(),
        categories: plan.archive_candidates.map(a => channels.find(c => c.id===a.id)).filter(Boolean),
        channels: p.actions.map(a => channels.find(c=>c.id===a.id)).filter(Boolean),
      },
      note: "Save the backup JSON before starting. The archive overwrites every legacy channel to deny @everyone, keeping administrator access.",
    }, { headers: HEADERS });
  } catch {
    return error("Discord archive preflight unavailable", 502);
  }
}
export async function POST(req: NextRequest) {
  if (!(await authorized())) return error("Forbidden",403);
  if (req.headers.get("origin") !== new URL(req.url).origin) return error("Origin mismatch",403);
  const body = await req.json().catch(() => ({}));
  if (body?.confirm !== "ARCHIVER_THE_TOWER_SANS_SUPPRIMER" || body?.guildId !== GUILD || typeof body?.fingerprint !== "string") return error("Missing confirmation",400);
  try {
    const channels = await discord("GET","/guilds/"+GUILD+"/channels") as Channel[];
    const p = prepare(channels);
    if (p.errors.length) return NextResponse.json({errors:p.errors},{status:409,headers:HEADERS});
    if (body.fingerprint !== p.snapshot) return error("Discord changed since the preview. Refresh and export the backup again.",409);
    if (!p.archiveId) {
      const archive = await discord("POST","/guilds/"+GUILD+"/channels",{
        name:ARCHIVE_NAME,type:4,permission_overwrites:DENY_EVERYONE,
      }) as Channel;
      return NextResponse.json({createdArchive:archive.id, moved:[],remaining:p.actions.length,refreshRequired:true},{headers:HEADERS});
    }
    const moved: string[] = [];
    for (const task of p.actions.slice(0,2)) {
      await discord("PATCH","/channels/"+task.id,{
        parent_id:p.archiveId,
        lock_permissions:false,
        // Replace all legacy allows with explicit deny, preventing accidental exposure.
        permission_overwrites:DENY_EVERYONE,
      });
      moved.push(task.name);
    }
    const after = await discord("GET","/guilds/"+GUILD+"/channels") as Channel[];
    const next = prepare(after);
    return NextResponse.json({moved,remaining:next.actions.length,fingerprint:next.snapshot,completed:next.actions.length===0,errors:next.errors},{headers:HEADERS});
  } catch {
    return error("Archive operation stopped. Refresh the inventory.",502);
  }
}
