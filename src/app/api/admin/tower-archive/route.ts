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
  const hideCategories: Array<{id:string;name:string}> = [];
  for (const source of plan.archive_candidates) {
    const category = byId.get(source.id);
    if (!category || category.type !== 4) {
      errors.push("Missing legacy category: "+source.name);
      continue;
    }
    if (!privateFromEveryone(category)) hideCategories.push({id:category.id,name:category.name});
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
  return { errors, actions, hideCategories, archiveId: archive?.id, snapshot: snapshot(channels) };
}
export async function GET() {
  if (!(await authorized())) return error("Forbidden", 403);
  try {
    const channels = await discord("GET","/guilds/"+GUILD+"/channels") as Channel[];
    const p = prepare(channels);
    // Detailed recovery snapshot, available only to the owner's authenticated session.
    return NextResponse.json({
      guildId: GUILD,
      mode: "read-only",
      writeEnabled: false,
      archiveCategory: ARCHIVE_NAME,
      preview: p.actions.map(a => ({ id:a.id, name:a.name, source:a.source })),
      errors: p.errors,
      categoriesToHide: p.hideCategories,
      fingerprint: p.snapshot,
      backup: {
        capturedAt: new Date().toISOString(),
        categories: plan.archive_candidates.map(a => channels.find(c => c.id===a.id)).filter(Boolean),
        channels: p.actions.map(a => channels.find(c=>c.id===a.id)).filter(Boolean),
      },
      note: "Inventaire et sauvegarde uniquement. Archivage suspendu tant que les salons, les bots et les systèmes existants ne sont pas audités. Aucune modification Discord possible depuis cette route.",
    }, { headers: HEADERS });
  } catch {
    return error("Discord archive preflight unavailable", 502);
  }
}
export async function POST(_req: NextRequest) {
  // User requested a fresh audit before any further archiving or destructive cleanup.
  return NextResponse.json({ error: "Archivage suspendu : vérification des systèmes déjà actifs requise." }, { status: 423, headers: HEADERS });
}
