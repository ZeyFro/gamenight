// Répétition LOCALE (Docker uniquement) de la bascule XP avec rôles distincts et barrière d'écriture.
// Jamais Neon, jamais Production : cluster postgres:16-alpine jetable lié à 127.0.0.1, données synthétiques.
// Usage : node scripts/rehearse-xp-role-barrier.mjs   (crée puis détruit ses conteneurs gamenight-xp-roles-*)
//   env : XP_ROLES_PORT (déf. 55471 ; le pooler utilise PORT+1), XP_ROLES_CONTAINER (déf. gamenight-xp-roles-pg),
//         XP_ROLES_LABEL (déf. xp-role-barrier : valeur du label gamenight.rehearsal, p. ex. mission-B).
//   Le pooler et le réseau dérivent du nom du conteneur (<conteneur>-bouncer, <conteneur>-net) : deux répétitions
//   avec des conteneurs différents ne se touchent pas (les noms fixes d'avant permettaient de supprimer ceux d'un autre run).
// Prérequis : docker local, image postgres:16-alpine et edoburu/pgbouncer, node_modules/prisma (npx prisma migrate deploy).
// Aucune dépendance npm nouvelle : client PostgreSQL minimal (protocole simple + SCRAM-SHA-256) écrit ici.
// Le même fichier sert de « mode écrivain » (--writer) : le processus de l'ancien runtime, séparé de l'orchestrateur.
import assert from "node:assert/strict";
import net from "node:net";
import { spawn, spawnSync } from "node:child_process";
import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { assertLocalDockerContext, localDockerArgs } from "./recette-local-docker.mjs";
import { DATABASE_PATTERN } from "./xp-balance-bascule.mjs";
import { EXPECTED_XP_MIGRATIONS } from "./xp-rollout-migration-gate.mjs";

// Écart réel entre origin/main et ce checkout (2 migrations XP + 4 vocales/boutique), dans l'ordre d'application.
const PENDING_MIGRATIONS = [
  "20261019190000_separate_xp_balance",
  "20261020150000_session_voice_presence",
  "20261022120000_voice_presence_consent_coordination",
  "20261022130000_voice_presence_retention_gap_bounds",
  "20261022140000_voice_presence_gap_history",
  "20261022142500_shop_balance_purchase_reason",
];
const LABEL_VALUE = process.env.XP_ROLES_LABEL ?? "xp-role-barrier";
const LABEL = `gamenight.rehearsal=${LABEL_VALUE}`;
const FORBIDDEN_PORTS = [55439]; // Postgres des tests d'intégration (CLAUDE.md)

// ------------------------------------------------------------------ constantes et garde-fous
const HOST = "127.0.0.1";
const PG_PORT = Number(process.env.XP_ROLES_PORT ?? 55471);
const BOUNCER_PORT = PG_PORT + 1;
const PG_CONTAINER = process.env.XP_ROLES_CONTAINER ?? "gamenight-xp-roles-pg";
const BOUNCER_CONTAINER = `${PG_CONTAINER}-bouncer`;
const NETWORK = `${PG_CONTAINER}-net`;
const PRISMA_BIN = "node_modules/prisma/build/index.js";
const PW = {
  admin: "test", ownerOld: "owner-old-pw-rehearsal", ownerNew: "owner-new-pw-rehearsal",
  runtime: "gn-runtime-pw-rehearsal", migrator: "gn-migrator-pw-rehearsal", bouncer: "gn-bouncer-auth-pw-rehearsal",
};
const SECRETS = Object.values(PW);
const USERS = 2000;

export function assertSafeConfig(env = process.env) {
  assert.match(PG_CONTAINER, /^[A-Za-z0-9][A-Za-z0-9_.-]*$/, "Conteneur invalide");
  assert.match(LABEL_VALUE, /^[A-Za-z0-9][A-Za-z0-9_.-]*$/, "Label invalide");
  assert.ok(Number.isInteger(PG_PORT) && PG_PORT >= 1024 && PG_PORT < 65000, "Port invalide");
  assert.equal(HOST, "127.0.0.1");
  for (const port of [PG_PORT, BOUNCER_PORT]) assert.ok(!FORBIDDEN_PORTS.includes(port), `Port ${port} interdit (réservé aux tests d'intégration)`);
  for (const name of [PG_CONTAINER, BOUNCER_CONTAINER, NETWORK, HOST]) assert.ok(!/neon/i.test(name), "Cible Neon interdite (hôte/conteneur)");
  for (const [key, value] of Object.entries(env)) {
    if (/DATABASE|POSTGRES|PG|DIRECT|URL/i.test(key) && /neon/i.test(String(value))) throw new Error(`Variable ${key} pointe vers Neon : refus`);
  }
}
const assertDb = (name) => { assert.ok(name === "postgres" || DATABASE_PATTERN.test(name), `Base refusée : ${name}`); return name; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const redact = (text) => SECRETS.reduce((t, s) => t.split(s).join("***"), String(text));

// ------------------------------------------------------------------ client PostgreSQL minimal
const i32 = (n) => { const b = Buffer.alloc(4); b.writeInt32BE(n); return b; };
const cstr = (s) => Buffer.concat([Buffer.from(s, "utf8"), Buffer.from([0])]);
const frame = (type, body) => Buffer.concat([Buffer.from(type, "latin1"), i32(body.length + 4), body]);
const hmac = (key, data) => createHmac("sha256", key).update(data).digest();

class PgError extends Error {
  constructor(f) { super(f.M ?? "erreur PostgreSQL"); this.code = f.C ?? "XX000"; this.severity = f.S; }
}
const closedError = (fatal, cause) => fatal ?? Object.assign(new Error(cause ?? "connexion fermée"), { code: "08006" });

class Pg {
  static async connect(o, timeoutMs = 4000) {
    assert.equal(o.host, HOST, "Hôte non local");
    assert.ok([PG_PORT, BOUNCER_PORT].includes(o.port), "Port hors répétition");
    assertDb(o.database);
    const c = new Pg(o);
    await new Promise((resolveStart, rejectStart) => {
      const timer = setTimeout(() => { c.socket.destroy(); rejectStart(Object.assign(new Error("délai de connexion"), { code: "TIMEOUT" })); }, timeoutMs);
      c.startup = { resolve: () => { clearTimeout(timer); resolveStart(); }, reject: (e) => { clearTimeout(timer); rejectStart(e); } };
      c.socket = net.connect({ host: o.host, port: o.port }, () => {
        const params = Buffer.concat([cstr("user"), cstr(o.user), cstr("database"), cstr(o.database), cstr("application_name"), cstr(o.app ?? "gn-rehearsal"), Buffer.from([0])]);
        c.socket.write(Buffer.concat([i32(params.length + 8), i32(196608), params]));
      });
      c.socket.on("data", (d) => c.onData(d));
      c.socket.on("error", (e) => c.onClose(e));
      c.socket.on("close", () => c.onClose());
    });
    return c;
  }

  constructor(o) { this.o = o; this.buf = Buffer.alloc(0); this.dead = false; this.fatal = null; this.pid = null; this.waiter = null; this.startup = null; this.scram = null; }

  onClose(err) {
    if (this.dead) return;
    this.dead = true;
    const e = closedError(this.fatal, err?.message);
    if (this.startup) { const s = this.startup; this.startup = null; s.reject(e); }
    if (this.waiter) { const w = this.waiter; this.waiter = null; w.reject(e); }
  }

  onData(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    while (this.buf.length >= 5) {
      const len = this.buf.readInt32BE(1);
      if (this.buf.length < 1 + len) break;
      const type = String.fromCharCode(this.buf[0]);
      const payload = this.buf.subarray(5, 1 + len);
      this.buf = this.buf.subarray(1 + len);
      this.handle(type, payload);
    }
  }

  handle(type, p) {
    switch (type) {
      case "R": return this.auth(p);
      case "K": this.pid = p.readInt32BE(0); return;
      case "E": {
        const f = {};
        for (let i = 0; i < p.length && p[i] !== 0;) { const k = String.fromCharCode(p[i]); const end = p.indexOf(0, i + 1); f[k] = p.toString("utf8", i + 1, end); i = end + 1; }
        const err = new PgError(f);
        if (/FATAL|PANIC/.test(f.S ?? "")) this.fatal = err;
        if (this.startup) { const s = this.startup; this.startup = null; this.socket.destroy(); this.dead = true; s.reject(err); }
        else if (this.waiter) this.waiter.err ??= err;
        return;
      }
      case "Z":
        if (this.startup) { const s = this.startup; this.startup = null; s.resolve(); }
        else if (this.waiter) { const w = this.waiter; this.waiter = null; if (w.err) w.reject(w.err); else w.resolve({ rows: w.rows, tag: w.tag }); }
        return;
      case "T": if (this.waiter) this.waiter.rows = []; return;
      case "D": {
        if (!this.waiter) return;
        const n = p.readInt16BE(0); let off = 2; const row = [];
        for (let i = 0; i < n; i++) { const l = p.readInt32BE(off); off += 4; if (l < 0) row.push(null); else { row.push(p.toString("utf8", off, off + l)); off += l; } }
        this.waiter.rows.push(row); return;
      }
      case "C": if (this.waiter) this.waiter.tag = p.toString("utf8", 0, p.length - 1); return;
      default: return; // S, N, I, A, 2, 3…
    }
  }

  auth(p) {
    const code = p.readInt32BE(0);
    const pw = this.o.password;
    if (code === 0) return;
    if (code === 3) { this.socket.write(frame("p", cstr(pw))); return; }
    if (code === 5) {
      const md5 = (s) => createHash("md5").update(s).digest("hex");
      this.socket.write(frame("p", cstr(`md5${md5(Buffer.concat([Buffer.from(md5(pw + this.o.user)), p.subarray(4, 8)]))}`)));
      return;
    }
    if (code === 10) {
      const nonce = randomBytes(18).toString("base64");
      this.scram = { nonce, bare: `n=,r=${nonce}` };
      const first = `n,,${this.scram.bare}`;
      this.socket.write(frame("p", Buffer.concat([cstr("SCRAM-SHA-256"), i32(Buffer.byteLength(first)), Buffer.from(first)])));
      return;
    }
    if (code === 11) {
      const serverFirst = p.toString("utf8", 4);
      const kv = Object.fromEntries(serverFirst.split(",").map((s) => [s[0], s.slice(2)]));
      if (!kv.r.startsWith(this.scram.nonce)) { this.socket.destroy(); return; }
      const salted = pbkdf2Sync(pw, Buffer.from(kv.s, "base64"), Number(kv.i), 32, "sha256");
      const clientKey = hmac(salted, "Client Key");
      const storedKey = createHash("sha256").update(clientKey).digest();
      const noProof = `c=biws,r=${kv.r}`;
      const sig = hmac(storedKey, `${this.scram.bare},${serverFirst},${noProof}`);
      const proof = Buffer.from(clientKey.map((b, i) => b ^ sig[i]));
      this.socket.write(frame("p", Buffer.from(`${noProof},p=${proof.toString("base64")}`)));
      return;
    }
    if (code === 12) return; // SASLFinal : signature serveur non vérifiée (répétition locale)
    this.socket.destroy();
  }

  query(sql, timeoutMs = 30000) {
    if (this.dead) return Promise.reject(closedError(this.fatal));
    return new Promise((resolveQ, rejectQ) => {
      const timer = setTimeout(() => { this.waiter = null; this.socket.destroy(); rejectQ(Object.assign(new Error("délai de requête"), { code: "TIMEOUT" })); }, timeoutMs);
      this.waiter = { rows: [], tag: null, err: null, resolve: (r) => { clearTimeout(timer); resolveQ(r); }, reject: (e) => { clearTimeout(timer); rejectQ(e); } };
      this.socket.write(frame("Q", cstr(sql)));
    });
  }

  close() { if (this.dead) return; this.dead = true; this.socket.write(frame("X", Buffer.alloc(0))); this.socket.end(); }
}

// ------------------------------------------------------------------ mode écrivain (ancien runtime, processus séparé)
async function writerMain(cfg) {
  const emit = (o) => process.stdout.write(`${JSON.stringify({ t: Date.now(), ...o })}\n`);
  const conns = Array(5).fill(null);
  const cmds = { tx: 0 };
  let stopping = false; let seq = 0;
  // hors bornes de seed u1..u9 (dont le maximum Int) et hors u10..u14 réservés aux achats du nouveau runtime
  const pick = () => { const g = 15 + Math.floor(Math.random() * 1485); return { c: `comm-${g % 3}`, u: `u${g}` }; };
  const updSql = (p) => `UPDATE "CommunityMemberStats" SET "xpTotal" = "xpTotal" + 1 WHERE "communityId" = '${p.c}' AND "userId" = '${p.u}'`;
  const insSql = (p) => { const n = ++seq; const id = `w-${cfg.label}-${process.pid}-${n}`; return `INSERT INTO "XpEvent" ("communityId","id","userId","reason","sourceId","amount") VALUES ('${p.c}','${id}','${p.u}','VOTE','${id}',5)`; };
  const conn = async (i) => {
    if (conns[i] && !conns[i].dead) return conns[i];
    try { conns[i] = await Pg.connect({ ...cfg.conn, app: `gn-${cfg.label}-w${i}` }, 3000); emit({ w: i, ev: "connect", ok: true, pid: conns[i].pid }); return conns[i]; }
    catch (e) { conns[i] = null; emit({ w: i, ev: "connect", ok: false, code: e.code, msg: e.message.slice(0, 90) }); return null; }
  };
  const write = async (i, kind) => {
    const c = await conn(i); if (!c) return false;
    const p = pick(); const t0 = performance.now();
    try { await c.query(kind === "upd" ? updSql(p) : insSql(p), 15000); emit({ w: i, op: kind, ok: true, ms: Math.round(performance.now() - t0) }); return true; }
    catch (e) { emit({ w: i, op: kind, ok: false, code: e.code, msg: e.message.slice(0, 90) }); if (c.dead) conns[i] = null; return false; }
  };
  const tx = async (i, seconds) => {
    const c = await conn(i); if (!c) return;
    const p = pick(); const t0 = performance.now();
    try {
      for (const s of ["BEGIN", updSql(p), `SELECT pg_sleep(${seconds})`, insSql(p), "COMMIT"]) await c.query(s, 20000);
      emit({ w: i, op: "tx", ok: true, ms: Math.round(performance.now() - t0) });
    } catch (e) {
      emit({ w: i, op: "tx", ok: false, code: e.code, msg: e.message.slice(0, 90) });
      if (c.dead) conns[i] = null;
      else { try { await c.query("ROLLBACK"); } catch (r) { emit({ w: i, ev: "rollback-failed", code: r.code }); conns[i] = null; } }
    }
  };
  const busy = (i) => async () => { while (!stopping) { const ok = await write(i, seq % 2 ? "upd" : "ins"); await sleep(ok ? 40 : 250); } };
  const workers = [
    busy(0), busy(1),
    async () => { // connexion réutilisée, idle entre deux écritures (700 ms) ; porte aussi la transaction longue
      while (!stopping) {
        let ok = true;
        if (cmds.tx > 0) { cmds.tx--; await tx(2, 1.5); } else ok = await write(2, "upd");
        for (let k = 0; k < (ok ? 14 : 5) && !cmds.tx && !stopping; k++) await sleep(50);
      }
    },
    async () => { while (!stopping) { const ok = await write(3, "ins"); await sleep(ok ? 2000 : 250); } }, // idle 2 s
    async () => { // « connexion qui revient » : ouvre, écrit, ferme, dort 1,2 s
      while (!stopping) { const ok = await write(4, "upd"); if (conns[4] && !conns[4].dead) { conns[4].close(); conns[4] = null; } await sleep(ok ? 1200 : 250); }
    },
  ];
  let inbuf = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (d) => { inbuf += d; const lines = inbuf.split("\n"); inbuf = lines.pop(); for (const l of lines) { if (l === "tx") cmds.tx++; if (l === "stop") stopping = true; } });
  process.stdin.on("end", () => { stopping = true; });
  emit({ ev: "start", pid: process.pid });
  await Promise.all(workers.map((w) => w()));
  for (const c of conns) c?.close();
  await sleep(50);
  process.exit(0);
}

// ------------------------------------------------------------------ outils de l'orchestrateur
const timings = [];
async function timed(phase, step, fn) {
  const t0 = performance.now();
  try { return await fn(); } finally { timings.push({ phase, step, ms: Math.round(performance.now() - t0) }); console.log(`  [${phase}] ${step} : ${Math.round(performance.now() - t0)} ms`); }
}
const facts = {};
const fact = (key, value) => { facts[key] = value; };

let dockerHost;
function docker(args, options = {}) {
  const r = spawnSync("docker", localDockerArgs(dockerHost, args), { encoding: "utf8", windowsHide: true, ...options });
  if (r.error) throw r.error;
  if (options.allowFail) return r;
  assert.equal(r.status, 0, redact(r.stderr || r.stdout));
  return r.stdout.trim();
}
const labelOf = (kind, name) => {
  const r = docker([kind, "inspect", "--format", '{{ index .Config.Labels "gamenight.rehearsal" }}'.replace(".Config.Labels", kind === "network" ? ".Labels" : ".Config.Labels"), name], { allowFail: true });
  return r.status === 0 ? r.stdout.trim() : null; // null : n'existe pas
};
/** Supprime conteneurs et réseau de la répétition, uniquement s'ils portent notre label; refuse tout homonyme sans label. */
function removeOwned() {
  for (const name of [PG_CONTAINER, BOUNCER_CONTAINER]) {
    const label = labelOf("container", name);
    if (label === null) continue;
    assert.equal(label, LABEL_VALUE, `Le conteneur ${name} existe sans le label ${LABEL} : refus de le supprimer`);
    docker(["rm", "-f", name]);
  }
  const net = labelOf("network", NETWORK);
  if (net === null) return;
  assert.equal(net, LABEL_VALUE, `Le réseau ${NETWORK} existe sans le label ${LABEL} : refus de le supprimer`);
  docker(["network", "rm", NETWORK]);
}
/** Refuse un port déjà publié par un autre conteneur (en cours d'exécution). */
function assertPortsFree() {
  const published = docker(["ps", "--format", "{{.Names}}\t{{.Ports}}"]).split("\n").filter(Boolean);
  for (const port of [PG_PORT, BOUNCER_PORT]) {
    const other = published.find((line) => new RegExp(`:${port}->`).test(line));
    assert.ok(!other, `Port ${port} déjà publié par un autre conteneur : ${other?.split("\t")[0]}`);
  }
}
const dexec = (...cmd) => docker(["exec", PG_CONTAINER, ...cmd]);

const creds = () => ({
  admin: { user: "postgres", password: PW.admin },
  owner: { user: "neondb_owner", password: PW.ownerOld },
  ownerOld: { user: "neondb_owner", password: PW.ownerOld },
  runtime: { user: "gn_runtime", password: PW.runtime },
  migrator: { user: "gn_migrator", password: PW.migrator },
});
const open = (who, database, path = "direct", timeoutMs = 4000) =>
  Pg.connect({ host: HOST, port: path === "pooler" ? BOUNCER_PORT : PG_PORT, database, app: `gn-op-${who}`, ...creds()[who] }, timeoutMs);
async function sqlAs(who, database, sql, path = "direct") {
  const c = await open(who, database, path);
  try { return await c.query(sql); } finally { c.close(); }
}
const admin = (database, sql) => sqlAs("admin", database, sql);
const scalar = async (db, sql) => (await admin(db, sql)).rows[0]?.[0];
async function attempt(c, sql) {
  const t0 = performance.now();
  try { await c.query(sql, 15000); return { ok: true, ms: Math.round(performance.now() - t0) }; }
  catch (e) { return { ok: false, code: e.code, ms: Math.round(performance.now() - t0) }; }
}
const urlFor = (who, db, path = "direct") => {
  assertDb(db);
  const c = creds()[who];
  return `postgresql://${c.user}:${c.password}@${HOST}:${path === "pooler" ? BOUNCER_PORT : PG_PORT}/${db}${path === "pooler" ? "?pgbouncer=true" : ""}`;
};
function prisma(args, url, schema, timeoutMs = 120000) {
  assert.ok(url.startsWith(`postgresql://`) && url.includes(`@${HOST}:`), "URL non locale");
  const t0 = performance.now();
  const r = spawnSync(process.execPath, [PRISMA_BIN, ...args, "--schema", schema], { encoding: "utf8", windowsHide: true, timeout: timeoutMs, env: { ...process.env, DATABASE_URL: url } });
  return { status: r.status, signal: r.signal, ms: Math.round(performance.now() - t0), output: redact((r.stdout ?? "") + (r.stderr ?? "")) };
}

const FINGERPRINT_SQL = `SELECT md5(jsonb_build_object(
  'stats', (SELECT coalesce(jsonb_agg(to_jsonb(s) - 'xpBalance' ORDER BY "communityId", "userId"), '[]') FROM "CommunityMemberStats" s),
  'cosmetics', (SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY "communityId", "userId", "itemId"), '[]') FROM "CommunityMemberCosmetic" c),
  'users', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', "id", 'xpTotal', "xpTotal") ORDER BY "id"), '[]') FROM "User"),
  'events', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', "id", 'reason', "reason", 'amount', "amount") ORDER BY "id"), '[]') FROM "XpEvent")
)::text) || ' ' || (SELECT count(*) FROM "CommunityMemberStats") || ' ' || (SELECT count(*) FROM "CommunityMemberCosmetic")
  || ' ' || (SELECT count(*) FROM "XpEvent") || ' ' || (SELECT coalesce(sum("xpTotal"), 0) FROM "CommunityMemberStats");`;
const fingerprint = async (db) => scalar(db, FINGERPRINT_SQL);

const seedSql = (users) => `
  INSERT INTO "User" ("id", "discordId", "discordName") SELECT 'u' || g, 'discord-' || g, 'Joueur ' || g FROM generate_series(1, ${users}) g;
  INSERT INTO "CommunityMemberStats" ("communityId", "userId", "xpTotal", "streakCount", "bestStreakCount", "tournamentsParticipatedCount")
    SELECT 'comm-' || (g % 3), 'u' || g,
           CASE WHEN g <= 9 THEN (ARRAY[0,49,50,799,800,4049,4050,10000000,2147483647])[g] ELSE (g * 37) % 6000 END, g % 9, g % 14, g % 5
    FROM generate_series(1, ${users}) g;
  INSERT INTO "CommunityMemberStats" ("communityId", "userId", "xpTotal") SELECT 'comm-other', 'u' || g, (g * 11) % 900 FROM generate_series(1, ${Math.floor(users / 10)}) g;
  INSERT INTO "CommunityMemberCosmetic" ("communityId", "userId", "itemId") SELECT 'comm-' || (g % 3), 'u' || g, 'title-strategist' FROM generate_series(10, ${Math.floor(users / 4)}) g;
  UPDATE "CommunityMemberStats" SET "equippedTitleId" = 'title-strategist' WHERE ("communityId", "userId") IN (SELECT "communityId", "userId" FROM "CommunityMemberCosmetic");
  INSERT INTO "XpEvent" ("communityId", "id", "userId", "reason", "sourceId", "amount")
    SELECT 'comm-' || (g % 3), 'ev' || g, 'u' || (g % ${users} + 1), (ARRAY['SESSION_ATTENDANCE','SHOP_PURCHASE','VOTE'])[g % 3 + 1]::"XpReason", 'src-' || g, CASE WHEN g % 3 = 1 THEN -50 ELSE 25 END
    FROM generate_series(1, ${users * 3}) g;`;

// ------------------------------------------------------------------ écrivain côté orchestrateur
function startWriter({ label, path, database, user = "neondb_owner", password = PW.ownerOld }) {
  const cfg = { label, conn: { host: HOST, port: path === "pooler" ? BOUNCER_PORT : PG_PORT, user, password, database } };
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "--writer", Buffer.from(JSON.stringify(cfg)).toString("base64")], { stdio: ["pipe", "pipe", "inherit"], windowsHide: true });
  const journal = []; let rest = "";
  child.stdout.on("data", (d) => { rest += d; const lines = rest.split("\n"); rest = lines.pop(); for (const l of lines) if (l) journal.push(JSON.parse(l)); });
  let exited = false; child.on("exit", () => { exited = true; });
  return {
    label, path, journal, child,
    send: (c) => child.stdin.write(`${c}\n`),
    async stop() {
      if (exited) return;
      child.stdin.write("stop\n");
      for (let i = 0; i < 100 && !exited; i++) await sleep(50);
      if (!exited) child.kill();
    },
  };
}
function tally(journal, from, to, pred = () => true) {
  const e = journal.filter((x) => x.op && x.t >= from && x.t < to && pred(x));
  const codes = {}; let ok = 0;
  for (const x of e) { if (x.ok) ok++; else codes[x.code] = (codes[x.code] ?? 0) + 1; }
  const cf = journal.filter((x) => x.ev === "connect" && !x.ok && x.t >= from && x.t < to && pred(x));
  for (const x of cf) codes[`connect:${x.code}`] = (codes[`connect:${x.code}`] ?? 0) + 1;
  return { ok, err: e.length - ok + cf.length, codes };
}
const classes = (j, from, to) => ({
  all: tally(j, from, to),
  busy: tally(j, from, to, (x) => x.w <= 1),
  idleReused: tally(j, from, to, (x) => x.w === 2 || x.w === 3),
  reconnecting: tally(j, from, to, (x) => x.w === 4),
  tx: tally(j, from, to, (x) => x.op === "tx"),
});
const lastOk = (journals, after) => Math.max(0, ...journals.flatMap((j) => j.filter((x) => x.op && x.ok && x.t >= after).map((x) => x.t)));

// ------------------------------------------------------------------ méthodes de barrière
const OWNER = "neondb_owner";
const METHODS = [
  { id: "c", label: "changement de mot de passe + terminate", apply: () => `ALTER ROLE ${OWNER} PASSWORD '${PW.ownerNew}'`, revert: () => `ALTER ROLE ${OWNER} PASSWORD '${PW.ownerOld}'` },
  { id: "b", label: "NOLOGIN + terminate", apply: () => `ALTER ROLE ${OWNER} NOLOGIN`, revert: () => `ALTER ROLE ${OWNER} LOGIN` },
  { id: "d", label: "REVOKE CONNECT FROM PUBLIC, rôle + terminate", apply: (db) => `REVOKE CONNECT ON DATABASE "${db}" FROM PUBLIC, ${OWNER}`, revert: (db) => `GRANT CONNECT ON DATABASE "${db}" TO PUBLIC, ${OWNER}` },
  { id: "a", label: "default_transaction_read_only = on + terminate", apply: () => `ALTER ROLE ${OWNER} SET default_transaction_read_only = on`, revert: () => `ALTER ROLE ${OWNER} RESET default_transaction_read_only` },
  { id: "d0", label: "(témoin) REVOKE CONNECT du seul rôle (PUBLIC conservé)", apply: (db) => `REVOKE CONNECT ON DATABASE "${db}" FROM ${OWNER}`, revert: (db) => `GRANT CONNECT ON DATABASE "${db}" TO ${OWNER}` },
];
let canarySeq = 0;
const canarySql = (tag) => { const id = `canary-${tag}-${process.pid}-${++canarySeq}`; return `INSERT INTO "XpEvent" ("communityId","id","userId","reason","sourceId","amount") VALUES ('comm-0','${id}','u1','VOTE','${id}',0)`; };
const sessionsSql = (db, excludePid) => `SELECT count(*), count(*) FILTER (WHERE state = 'active'), count(*) FILTER (WHERE state = 'idle'), count(*) FILTER (WHERE state LIKE 'idle in%')
  FROM pg_stat_activity WHERE usename = '${OWNER}' AND datname = '${db}' AND pid <> ${excludePid}`;
const terminateSql = (db, keepPid) => `SELECT count(*) FILTER (WHERE pg_terminate_backend(pid)) FROM pg_stat_activity WHERE usename = '${OWNER}' AND datname = '${db}' AND pid <> pg_backend_pid() AND pid <> ${keepPid}`;

/** Applique une méthode : d'abord avec la session du propriétaire lui-même, sinon avec l'admin (stand-in de la console plateforme). */
async function applyMethod(m, db, operator, adminPg) {
  const sql = m.apply(db); const r = {};
  let t0 = performance.now();
  try { await operator.query(sql); r.selfApply = { ok: true, ms: Math.round(performance.now() - t0) }; }
  catch (e) { r.selfApply = { ok: false, code: e.code, ms: Math.round(performance.now() - t0) }; t0 = performance.now(); await adminPg.query(sql); r.adminApplyMs = Math.round(performance.now() - t0); }
  return r;
}
async function terminateOthers(db, operator, adminPg) {
  const sql = terminateSql(db, operator.pid); const t0 = performance.now();
  let via = "propriétaire";
  let res;
  try { res = await operator.query(sql); } catch (e) { via = `admin (propriétaire refusé : ${e.code})`; res = await adminPg.query(sql); }
  return { terminated: Number(res.rows[0][0]), ms: Math.round(performance.now() - t0), via };
}

// ------------------------------------------------------------------ orchestration
async function main() {
  assertSafeConfig();
  dockerHost = assertLocalDockerContext();
  const stamp = Date.now();
  const mk = (label) => assertDb(`gamenight_xp_roles_${label}_${stamp}`);
  const work = mkdtempSync(join(tmpdir(), "xp-roles-"));
  const baseline = join(work, "baseline");
  // Départ réel : schéma et migrations de origin/main seuls (comme scripts/rehearse-xp-full.mjs).
  mkdirSync(baseline, { recursive: true });
  const tarFile = join(work, "main.tar");
  const archive = spawnSync("git", ["archive", "--format=tar", "-o", tarFile, "origin/main", "prisma/schema.prisma", "prisma/migrations"], { encoding: "utf8" });
  assert.equal(archive.status, 0, `git archive origin/main a échoué (git fetch origin main ?) : ${archive.stderr}`);
  const untar = spawnSync("tar", ["-xf", "../main.tar"], { cwd: baseline, encoding: "utf8" });
  assert.equal(untar.status, 0, untar.stderr);
  const listMigrations = (dir) => readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  const mainMigrations = listMigrations(join(baseline, "prisma", "migrations"));
  const allMigrations = listMigrations(resolve("prisma/migrations"));
  assert.deepEqual(allMigrations.filter((n) => !mainMigrations.includes(n)), PENDING_MIGRATIONS, "Les migrations en attente par rapport à origin/main ne sont pas les 6 attendues");
  assert.deepEqual(mainMigrations.filter((n) => !allMigrations.includes(n)), [], "origin/main a des migrations absentes du checkout");
  const baselineSchema = join(baseline, "prisma", "schema.prisma");
  const fullSchema = resolve("prisma/schema.prisma");
  const writers = [];
  const created = [];
  const cleanup = async () => {
    for (const w of writers) await w.stop();
    removeOwned();
    rmSync(work, { recursive: true, force: true });
  };

  try {
    // ---- infrastructure jetable (hors mesures)
    removeOwned();
    assertPortsFree();
    docker(["network", "create", "--label", LABEL, NETWORK]);
    docker(["run", "-d", "--label", LABEL, "--name", PG_CONTAINER, "--network", NETWORK, "-p", `127.0.0.1:${PG_PORT}:5432`, "-e", `POSTGRES_PASSWORD=${PW.admin}`, "postgres:16-alpine",
      "-c", "fsync=off", "-c", "synchronous_commit=off", "-c", "full_page_writes=off", "-c", "checkpoint_timeout=1h", "-c", "max_wal_size=8GB"]);
    assert.equal(docker(["port", PG_CONTAINER, "5432/tcp"]), `127.0.0.1:${PG_PORT}`, "Le conteneur doit être lié à 127.0.0.1 uniquement");
    // L'entrypoint démarre un serveur temporaire puis le relance : attendre le second « ready to accept connections ».
    for (let i = 0; ; i++) {
      const logs = docker(["logs", PG_CONTAINER], { allowFail: true });
      if (((logs.stdout ?? "") + (logs.stderr ?? "")).split("ready to accept connections").length - 1 >= 2) break;
      assert.ok(i < 240, "PostgreSQL de répétition non prêt");
      await sleep(500);
    }
    for (let i = 0; ; i++) {
      try { await admin("postgres", "SELECT 1"); break; } catch (e) { if (i > 60) throw e; await sleep(500); }
    }
    const version = await scalar("postgres", "SHOW server_version");
    fact("serveur", { postgres: version, conteneur: PG_CONTAINER, fsync: await scalar("postgres", "SHOW fsync") });
    await admin("postgres", `
      CREATE ROLE ${OWNER} LOGIN NOSUPERUSER CREATEDB CREATEROLE REPLICATION BYPASSRLS PASSWORD '${PW.ownerOld}';
      CREATE ROLE gn_bouncer_auth LOGIN NOSUPERUSER PASSWORD '${PW.bouncer}';`);
    fact("propriétaire_initial", (await admin("postgres", `SELECT rolsuper, rolcanlogin, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls FROM pg_roles WHERE rolname='${OWNER}'`)).rows[0].join(","));

    const ini = `[databases]
* = host=${PG_CONTAINER} port=5432

[pgbouncer]
listen_addr = 0.0.0.0
listen_port = 6432
unix_socket_dir =
auth_type = scram-sha-256
auth_file = /tmp/userlist.txt
auth_user = gn_bouncer_auth
auth_query = SELECT usename, passwd FROM pgbouncer.get_auth($1)
pool_mode = transaction
default_pool_size = 5
max_client_conn = 200
server_login_retry = 1
query_wait_timeout = 8
ignore_startup_parameters = extra_float_digits
admin_users = gn_bouncer_auth
`;
    docker(["run", "-d", "--label", LABEL, "--name", BOUNCER_CONTAINER, "--network", NETWORK, "-p", `127.0.0.1:${BOUNCER_PORT}:6432`, "--entrypoint", "sh", "edoburu/pgbouncer", "-c",
      `printf '%s' '${ini.replace(/'/g, "'\\''")}' > /tmp/pgb.ini; printf '"gn_bouncer_auth" "${PW.bouncer}"\\n' > /tmp/userlist.txt; exec pgbouncer /tmp/pgb.ini`]);
    assert.equal(docker(["port", BOUNCER_CONTAINER, "6432/tcp"]), `127.0.0.1:${BOUNCER_PORT}`);
    fact("pooler", "pgbouncer 1.26 (edoburu/pgbouncer), pool_mode=transaction, auth_query, default_pool_size=5, réseau Docker dédié");

    // ---- modèle de base : migrations du checkout SAUF les deux migrations XP, exécutées par le propriétaire
    const tpl = mk("tpl");
    created.push(tpl);
    await admin("postgres", `CREATE DATABASE "${tpl}" OWNER ${OWNER}`);
    const base = prisma(["migrate", "deploy"], urlFor("owner", tpl), baselineSchema, 540000);
    assert.equal(base.status, 0, base.output);
    fact("migrations_de_départ", { dossier: readdirSync(join(baseline, "prisma", "migrations")).length - 1, duréeMs: base.ms });
    await admin(tpl, seedSql(USERS));
    await admin(tpl, `
      CREATE SCHEMA pgbouncer;
      CREATE FUNCTION pgbouncer.get_auth(p_usename text) RETURNS TABLE(usename name, passwd text) LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS
        $$ SELECT usename::name, passwd::text FROM pg_catalog.pg_shadow WHERE usename = p_usename $$;
      REVOKE ALL ON FUNCTION pgbouncer.get_auth(text) FROM PUBLIC;
      GRANT USAGE ON SCHEMA pgbouncer TO gn_bouncer_auth;
      GRANT EXECUTE ON FUNCTION pgbouncer.get_auth(text) TO gn_bouncer_auth;`);
    fact("propriété_des_tables", await scalar(tpl, `SELECT string_agg(DISTINCT pg_get_userbyid(relowner), ',') FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r'`));

    const cloneDb = async (label) => {
      const name = mk(label);
      await admin("postgres", `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${tpl}'`);
      await admin("postgres", `CREATE DATABASE "${name}" TEMPLATE "${tpl}" OWNER ${OWNER}`);
      created.push(name);
      return name;
    };
    const dropDb = async (name) => { await admin("postgres", `DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`); };
    const grantRoles = async (db) => {
      await admin(db, `
        GRANT CONNECT ON DATABASE "${db}" TO gn_runtime, gn_migrator, gn_bouncer_auth;
        GRANT USAGE ON SCHEMA public TO gn_runtime;
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO gn_runtime;
        REVOKE ALL ON TABLE public."_prisma_migrations" FROM gn_runtime;
        GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO gn_runtime;
        ALTER DEFAULT PRIVILEGES FOR ROLE ${OWNER} IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO gn_runtime;
        ALTER DEFAULT PRIVILEGES FOR ROLE ${OWNER} IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO gn_runtime;`);
    };

    // =============================================================== Phase 0 : ancien runtime
    console.log("\n== Phase 0 : ancien runtime (processus Node séparé, rôle neondb_owner)");
    const main = await timed("0", "clone de la base principale", () => cloneDb("main"));
    const startMainWriters = () => [startWriter({ label: "direct", path: "direct", database: main }), startWriter({ label: "pooler", path: "pooler", database: main })];
    let oldWriters = await timed("0", "démarrage de l'ancien runtime (2 processus : direct + pooler, 5 connexions chacun)", async () => startMainWriters());
    writers.push(...oldWriters);
    await sleep(3000);
    const base0 = oldWriters.map((w) => classes(w.journal, Date.now() - 2500, Date.now()));
    fact("phase0_écritures_2,5s", base0.map((c, i) => ({ writer: oldWriters[i].label, ...c.all, busy: c.busy.ok, idleReused: c.idleReused.ok, reconnecting: c.reconnecting.ok })));
    assert.ok(base0.every((c) => c.all.ok > 20 && c.all.err === 0), `L'ancien runtime doit écrire sans erreur avant toute modification : ${JSON.stringify({ base0: base0.map((c) => c.all), erreurs: oldWriters.map((w) => [w.label, w.journal.filter((x) => x.ok === false).slice(0, 4)]) })}`);

    // =============================================================== Phase 1 : introduction des rôles
    console.log("\n== Phase 1 : rôles gn_runtime et gn_migrator");
    const ownerSession = await open("owner", main);
    const adminSession = await open("admin", "postgres");
    const via = {};
    const ownerThenAdmin = async (step, sql) => timed("1", step, async () => {
      try { await ownerSession.query(sql); via[step] = "neondb_owner"; }
      catch (e) { via[step] = `admin (neondb_owner refusé : ${e.code})`; await adminSession.query(sql); }
    });
    const t1From = Date.now();
    await ownerThenAdmin("CREATE ROLE gn_runtime (LOGIN, sans privilège de rôle)", `CREATE ROLE gn_runtime LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS NOREPLICATION PASSWORD '${PW.runtime}'`);
    await ownerThenAdmin("CREATE ROLE gn_migrator (LOGIN)", `CREATE ROLE gn_migrator LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS NOREPLICATION PASSWORD '${PW.migrator}'`);
    await ownerThenAdmin("GRANT CONNECT (base) aux trois rôles", `GRANT CONNECT ON DATABASE "${main}" TO gn_runtime, gn_migrator, gn_bouncer_auth`);
    await ownerThenAdmin("GRANT DML tables + séquences à gn_runtime (hors _prisma_migrations)", `
      GRANT USAGE ON SCHEMA public TO gn_runtime;
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO gn_runtime;
      REVOKE ALL ON TABLE public."_prisma_migrations" FROM gn_runtime;
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO gn_runtime;
      ALTER DEFAULT PRIVILEGES FOR ROLE ${OWNER} IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO gn_runtime;
      ALTER DEFAULT PRIVILEGES FOR ROLE ${OWNER} IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO gn_runtime;`);
    // PostgreSQL 16 : le créateur (CREATEROLE) devient membre du rôle qu'il crée ; GRANT neondb_owner TO gn_migrator serait alors circulaire.
    fact("phase1_appartenances_après_CREATE_ROLE", (await admin("postgres", `SELECT pg_get_userbyid(roleid) || ' <- ' || pg_get_userbyid(member) || ' admin=' || admin_option || ' inherit=' || inherit_option || ' set=' || set_option || ' grantor=' || pg_get_userbyid(grantor) FROM pg_auth_members WHERE roleid IN ('gn_migrator'::regrole, 'gn_runtime'::regrole)`)).rows.map((r) => r[0]));
    await timed("1", "rompre l'appartenance circulaire : REVOKE gn_migrator FROM neondb_owner", async () => {
      const still = async () => Number(await scalar(main, `SELECT count(*) FROM pg_auth_members WHERE roleid = 'gn_migrator'::regrole AND member = '${OWNER}'::regrole`));
      await ownerSession.query(`REVOKE gn_migrator FROM ${OWNER}`);
      via.revokeCreatorMembership = (await still()) === 0 ? "neondb_owner" : "neondb_owner sans effet (octroi par le superutilisateur) ; admin requis";
      if ((await still()) > 0) await adminSession.query(`REVOKE gn_migrator FROM ${OWNER}`);
      assert.equal(await still(), 0);
    });
    await ownerThenAdmin("méthode A : GRANT neondb_owner TO gn_migrator (appartenance)", `GRANT ${OWNER} TO gn_migrator`);
    const migratorSession = await timed("1", "connexion gn_migrator + ALTER DEFAULT PRIVILEGES (objets qu'il créera)", async () => {
      const c = await open("migrator", main);
      await c.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO gn_runtime; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO gn_runtime;`);
      return c;
    });
    const t1To = Date.now();
    fact("phase1_créé_par", via);
    fact("phase1_attributs_rôles", (await admin("postgres", `SELECT rolname, rolsuper, rolcanlogin, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls FROM pg_roles WHERE rolname IN ('neondb_owner','gn_runtime','gn_migrator') ORDER BY 1`)).rows.map((r) => r.join(",")));
    const runtimeSession = await open("runtime", main);
    const rt = {};
    for (const [name, sql] of Object.entries({
      select: `SELECT count(*) FROM "XpEvent"`, update: `UPDATE "CommunityMemberStats" SET "streakCount" = "streakCount" WHERE "userId" = 'u1'`,
      insert: canarySql("runtime-p1"), delete: `DELETE FROM "XpEvent" WHERE "id" LIKE 'canary-runtime-p1-%'`,
      create: `CREATE TABLE gn_ddl_probe (i int)`, alter: `ALTER TABLE "XpEvent" ADD COLUMN zz int`, drop: `DROP TABLE "XpEvent"`,
      truncate: `TRUNCATE "XpEvent"`, prismaMigrations: `SELECT 1 FROM "_prisma_migrations" LIMIT 1`,
    })) { const r = await attempt(runtimeSession, sql); rt[name] = r.ok ? "autorisé" : `refusé (${r.code})`; }
    fact("phase1_gn_runtime", rt);
    const mg = {};
    for (const [name, sql] of Object.entries({
      commentTableDuPropriétaire: `COMMENT ON TABLE "XpEvent" IS 'rehearsal'`,
      alterTableDuPropriétaire: `BEGIN; ALTER TABLE "CommunityMemberStats" ADD COLUMN zz_probe int; ROLLBACK`,
      createTable: `CREATE TABLE gn_migrator_probe (i int)`, privilègesParDéfautVersRuntime: `SELECT has_table_privilege('gn_runtime','public.gn_migrator_probe','INSERT')`,
      dropTable: `DROP TABLE gn_migrator_probe`,
    })) { const r = await migratorSession.query(sql).then((x) => ({ ok: true, v: x.rows[0]?.[0] }), (e) => ({ ok: false, code: e.code })); mg[name] = r.ok ? (r.v ? `autorisé (${r.v})` : "autorisé") : `refusé (${r.code})`; }
    fact("phase1_gn_migrator", mg);
    fact("phase1_propriétaire_des_tables_inchangé", await scalar(main, `SELECT string_agg(DISTINCT pg_get_userbyid(relowner), ',') FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r'`));
    await sleep(2500);
    const afterRoles = oldWriters.map((w) => classes(w.journal, t1To + 100, Date.now()));
    const duringRoles = oldWriters.map((w) => classes(w.journal, t1From, t1To));
    fact("phase1_ancien_writer", oldWriters.map((w, i) => ({ writer: w.label, pendantLes_étapes: duringRoles[i].all, après: afterRoles[i].all })));
    assert.ok(afterRoles.every((c) => c.all.ok > 10 && c.all.err === 0) && duringRoles.every((c) => c.all.err === 0), `L'ancien writer doit continuer sans erreur après l'introduction des rôles : ${JSON.stringify({ durant: duringRoles.map((c) => c.all), après: afterRoles.map((c) => c.all), erreurs: oldWriters.map((w) => w.journal.filter((x) => x.ok === false).slice(0, 3)) })}`);
    runtimeSession.close(); migratorSession.close(); adminSession.close();

    // =============================================================== Phase 2 : matrice des barrières
    console.log("\n== Phase 2 : matrice des barrières (écrivain principal suspendu : les attributs de rôle sont globaux au cluster)");
    for (const w of oldWriters) await w.stop();
    ownerSession.close();
    const matrix = [];
    for (const path of ["direct", "pooler"]) {
      for (const m of METHODS) {
        const db = await cloneDb(`m${m.id}${path[0]}`);
        await grantRoles(db);
        const w = startWriter({ label: path, path, database: db });
        writers.push(w);
        const operator = await open("owner", db);
        const adminPg = await open("admin", "postgres");
        const r = { method: m.id, label: m.label, path };
        await sleep(1800);
        w.send("tx"); await sleep(400);
        const tApply = Date.now();
        Object.assign(r, await applyMethod(m, db, operator, adminPg));
        await sleep(2000);
        r.avantTerminate = classes(w.journal, tApply, tApply + 2000);
        r.avantTerminate.tx1 = w.journal.filter((x) => x.op === "tx" && x.t > tApply).slice(0, 1).map((x) => (x.ok ? "commit réussi" : `échec ${x.code}`))[0] ?? "pas de fin observée";
        const sess0 = (await adminPg.query(sessionsSql(db, operator.pid))).rows[0];
        r.sessionsAvantTerminate = { total: Number(sess0[0]), idle: Number(sess0[2]), actives: Number(sess0[1]) };
        w.send("tx"); await sleep(300);
        const term = await terminateOthers(db, operator, adminPg);
        const tTermEnd = Date.now();
        r.terminate = term;
        await sleep(3000);
        r.aprèsTerminate = classes(w.journal, tTermEnd + 150, tTermEnd + 3000);
        r.aprèsTerminate.tx2 = w.journal.filter((x) => x.op === "tx" && x.t > tApply + 1900).slice(0, 1).map((x) => (x.ok ? "commit réussi" : `échec ${x.code}`))[0] ?? "pas de fin observée";
        r.sessionsAprèsTerminate = Number((await adminPg.query(sessionsSql(db, operator.pid))).rows[0][0]);
        r.fuiteMs = Math.max(0, lastOk([w.journal], tApply) - tApply);
        // sondes avec les anciens identifiants
        const p = { connexion: null };
        try {
          const c = await open("ownerOld", db, path, 5000);
          p.connexion = "ouverte";
          p.defaultTransactionReadOnlyVuParLaSession = await c.query("SHOW default_transaction_read_only").then((x) => x.rows[0][0], (e) => e.code);
          p.canary = await attempt(c, canarySql(`m${m.id}`));
          p.contournement_BEGIN_READ_WRITE = await attempt(c, `BEGIN READ WRITE; ${canarySql(`m${m.id}bypass`)}; COMMIT`);
          p.annulation_par_le_writer = await attempt(c, m.revert(db));
          c.close();
        } catch (e) { p.connexion = `refusée (${e.code})`; }
        r.sonde = p;
        const mig = await open("migrator", db).then(async (c) => { const x = await attempt(c, `COMMENT ON TABLE "XpEvent" IS 'barrier-check'`); c.close(); return x; }, (e) => ({ ok: false, code: e.code }));
        r.migratorIntact = mig.ok;
        // réversibilité
        const tRev = performance.now(); let revVia = "propriétaire";
        try { await operator.query(m.revert(db)); } catch (e) { revVia = `admin (propriétaire refusé : ${e.code})`; await adminPg.query(m.revert(db)); }
        const revEnd = Date.now(); r.revert = { ms: Math.round(performance.now() - tRev), via: revVia };
        let resume = null;
        for (let i = 0; i < 200 && resume === null; i++) { const f = w.journal.find((x) => x.op && x.ok && x.t > revEnd); if (f) resume = f.t - revEnd; else await sleep(50); }
        r.reprise_ecritures_ms = resume;
        r.verdict = {
          bloqueToutAprèsTerminate: r.aprèsTerminate.all.ok === 0 && !p.canary?.ok,
          contournable: Boolean(p.contournement_BEGIN_READ_WRITE?.ok), annulableParLeWriter: Boolean(p.annulation_par_le_writer?.ok),
          migratorIntact: r.migratorIntact, autoAppliquable: r.selfApply.ok,
        };
        matrix.push(r);
        await w.stop(); operator.close(); adminPg.close();
        await dropDb(db);
        console.log(`  méthode ${m.id}/${path} : auto-application ${r.selfApply.ok ? "OK" : `refusée ${r.selfApply.code}`} ; avant terminate ${r.avantTerminate.all.ok} écritures OK ; après terminate ${r.aprèsTerminate.all.ok} OK / ${r.aprèsTerminate.all.err} refus ; sonde ${p.connexion}`);
        timings.push({ phase: "2", step: `méthode ${m.id} (${path}) : application`, ms: r.adminApplyMs ?? r.selfApply.ms });
        timings.push({ phase: "2", step: `méthode ${m.id} (${path}) : terminate des sessions`, ms: term.ms });
        timings.push({ phase: "2", step: `méthode ${m.id} (${path}) : retour arrière`, ms: r.revert.ms });
      }
    }
    fact("phase2_matrice", matrix);
    const okIn = (id) => ["direct", "pooler"].every((path) => { const r = matrix.find((x) => x.method === id && x.path === path); return r.verdict.bloqueToutAprèsTerminate && !r.verdict.contournable && !r.verdict.annulableParLeWriter && r.verdict.migratorIntact; });
    const candidates = METHODS.filter((m) => m.id !== "d0" && okIn(m.id));
    const selfOk = (id) => matrix.filter((x) => x.method === id).every((x) => x.verdict.autoAppliquable);
    const retained = candidates.sort((a, b) => Number(selfOk(b.id)) - Number(selfOk(a.id)))[0];
    assert.ok(retained, "Aucune méthode ne satisfait tous les critères");
    fact("phase2_retenue", { id: retained.id, label: retained.label, candidates: candidates.map((m) => m.id), autoAppliquable: selfOk(retained.id) });
    console.log(`  méthode retenue : ${retained.id} (${retained.label})`);

    // =============================================================== Phase 3 : preuve de drainage
    console.log("\n== Phase 3 : preuve de drainage sur la base principale");
    oldWriters = startMainWriters(); writers.push(...oldWriters);
    await sleep(2500);
    const operator = await open("owner", main);
    const adminPg = await open("admin", "postgres");
    const pre = await open("ownerOld", main);
    assert.ok((await attempt(pre, canarySql("pre-barrière"))).ok, "Le canari doit réussir AVANT la barrière (témoin positif)");
    pre.close();
    // 3a. un relevé pg_stat_activity seul est insuffisant
    const samples = [];
    const statsOf = async () => (await adminPg.query(`SELECT tup_inserted, tup_updated, tup_deleted FROM pg_stat_database WHERE datname='${main}'`)).rows[0].map(Number);
    oldWriters[0].send("tx");
    const ctlFrom = Date.now(); const s0 = await statsOf();
    for (let i = 0; i < 70; i++) {
      const r = (await adminPg.query(`SELECT count(*), count(*) FILTER (WHERE state='active' AND query NOT LIKE '%pg_stat_activity%'), count(*) FILTER (WHERE state='idle'), count(*) FILTER (WHERE state LIKE 'idle in%'),
        count(*) FILTER (WHERE application_name = 'gn-direct-w4'), count(*) FILTER (WHERE application_name = 'gn-direct-w3') FROM pg_stat_activity WHERE usename='${OWNER}' AND datname='${main}' AND pid <> ${operator.pid}`)).rows[0].map(Number);
      samples.push({ t: Date.now(), total: r[0], active: r[1], idle: r[2], idleInTx: r[3], reconnecting: r[4], idleReused: r[5] });
      await sleep(40);
    }
    const ctlTo = Date.now(); const s1 = await statsOf();
    const writesInWindow = tally(oldWriters[0].journal, ctlFrom, ctlTo).ok + tally(oldWriters[1].journal, ctlFrom, ctlTo).ok;
    const zeroActive = samples.filter((s) => s.active === 0);
    const firstReconnectAbsent = samples.find((s) => s.reconnecting === 0);
    const nextWrite = firstReconnectAbsent && oldWriters[0].journal.find((x) => x.w === 4 && x.op && x.ok && x.t > firstReconnectAbsent.t);
    fact("phase3a_relevé_insuffisant", {
      relevés: samples.length, fenêtreMs: ctlTo - ctlFrom, écrituresRéussiesDansLaFenêtre: writesInWindow,
      relevésSansRequêteActive: zeroActive.length, relevésAvecConnexionIdleRéutilisée: samples.filter((s) => s.idleReused > 0).length,
      relevésOùLaConnexionQuiRevientEstAbsente: samples.filter((s) => s.reconnecting === 0).length,
      premièreAbsence_puisÉcritureEnMs: nextWrite ? nextWrite.t - firstReconnectAbsent.t : null,
      relevésAvecTransactionEnVol: samples.filter((s) => s.idleInTx > 0 || s.active > 0).length,
      deltaPgStatDatabase_sansBarrière: { insérés: s1[0] - s0[0], modifiés: s1[1] - s0[1], supprimés: s1[2] - s0[2] },
    });
    // 3b. barrière retenue + terminate + échantillonnage + deltas + canari
    const tMaint = Date.now();
    await timed("3", "gn_runtime en maintenance (NOLOGIN) : seul le futur runtime est rendu en fin de bascule", () => adminPg.query(`ALTER ROLE gn_runtime NOLOGIN`));
    const applied = await timed("3", `barrière ${retained.id} appliquée`, () => applyMethod(retained, main, operator, adminPg));
    const term = await timed("3", "terminate des sessions neondb_owner restantes", () => terminateOthers(main, operator, adminPg));
    const tBarrier = Date.now();
    fact("phase3_barrière", { méthode: retained.id, application: applied, terminate: term, duréeTotaleMs: tBarrier - tMaint });
    await sleep(1800); // purge des statistiques (flush ~1 s) avant la ligne de base
    // Second balayage : une session qui terminait son authentification pendant le premier terminate n'y figurait pas encore.
    const term2 = await timed("3", "second terminate (filet contre une session en cours de démarrage)", () => terminateOthers(main, operator, adminPg));
    fact("phase3_second_balayage", term2);
    const bFrom = Date.now(); const b0 = await statsOf();
    const rel = [];
    for (let i = 0; i < 10; i++) {
      const r = (await adminPg.query(sessionsSql(main, operator.pid))).rows[0].map(Number);
      rel.push({ t: Date.now() - bFrom, sessions: r[0], actives: r[1] });
      if (i < 9) await sleep(500);
    }
    const bTo = Date.now(); const b1 = await statsOf();
    const after = oldWriters.map((w) => ({ writer: w.label, ...tally(w.journal, tBarrier + 150, bTo).codes, ok: tally(w.journal, tBarrier + 150, bTo).ok, refus: tally(w.journal, tBarrier + 150, bTo).err }));
    const canaryDirect = await open("ownerOld", main).then(async (c) => { const x = await attempt(c, canarySql("post-barrière")); c.close(); return x; }, (e) => ({ ok: false, code: e.code, connexion: "refusée" }));
    const canaryPooler = await open("ownerOld", main, "pooler", 8000).then(async (c) => { const x = await attempt(c, canarySql("post-barrière-pooler")); c.close(); return x; }, (e) => ({ ok: false, code: e.code, connexion: "refusée" }));
    const writeCanaryDuringWindow = await scalar(main, `SELECT count(*) FROM "XpEvent" WHERE "id" LIKE 'canary-post%'`);
    fact("phase3b_preuve", {
      relevés: rel.length, fenêtreMs: bTo - bFrom, sessionsParRelevé: rel.map((r) => r.sessions),
      deltaPgStatDatabase_avecBarrière: { insérés: b1[0] - b0[0], modifiés: b1[1] - b0[1], supprimés: b1[2] - b0[2] },
      écrituresDeL_ancienRuntime_aprèsBarrière: after, canari_directe: canaryDirect, canari_pooler: canaryPooler, lignesCanariPostBarrièreEnBase: Number(writeCanaryDuringWindow),
    });
    assert.ok(rel.every((r) => r.sessions === 0) && b1.every((v, i) => v === b0[i]) && after.every((a) => a.ok === 0) && !canaryDirect.ok && !canaryPooler.ok && Number(writeCanaryDuringWindow) === 0, "Preuve de drainage non satisfaite");

    // 3c. Trou documenté : la barrière vise les sessions de neondb_owner. gn_migrator, membre de neondb_owner (héritage), écrit encore :
    // c'est la voie légitime de la migration, pas une voie de l'ancien runtime. Prouvé sans effet (transaction annulée).
    const viaMigrator = await open("migrator", main).then(async (c) => {
      const direct = await attempt(c, `BEGIN; ${canarySql("migrateur-direct")}; ROLLBACK`);
      const setRole = await attempt(c, `BEGIN; SET LOCAL ROLE ${OWNER}; ${canarySql("migrateur-set-role")}; ROLLBACK`);
      c.close(); return { écritureDirecte: direct.ok, écritureViaSetRole: setRole.ok };
    }, (e) => ({ connexion: `refusée (${e.code})` }));
    const migratorSessionsDuring = Number(await scalar(main, `SELECT count(*) FROM pg_stat_activity WHERE usename = 'gn_migrator' AND datname = '${main}'`));
    fact("phase3c_voie_du_migrateur", { ...viaMigrator, sessionsGnMigratorOuvertesAprèsFermeture: migratorSessionsDuring, lignesCanariMigrateurEnBase: Number(await scalar(main, `SELECT count(*) FROM "XpEvent" WHERE "id" LIKE 'canary-migrateur%'`)) });
    assert.equal(viaMigrator.écritureDirecte, true, "gn_migrator (membre du propriétaire) devrait pouvoir écrire : le trou documenté n'existe plus, mettre la doc à jour");
    assert.equal(Number(await scalar(main, `SELECT count(*) FROM "XpEvent" WHERE "id" LIKE 'canary-migrateur%'`)), 0, "Les écritures de sonde du migrateur doivent être annulées");

    // =============================================================== Phase 4 : sauvegarde et restauration isolée
    console.log("\n== Phase 4 : sauvegarde et restauration isolée");
    const fingerprintBefore = await timed("4", "empreinte ordonnée de la source", () => fingerprint(main));
    const archive = `/tmp/${main}.dump`;
    await timed("4", "pg_dump -Fc", async () => dexec("pg_dump", "-U", "postgres", "-Fc", "--file", archive, main));
    const local = join(work, "main.dump");
    await timed("4", "docker cp du dump", async () => docker(["cp", `${PG_CONTAINER}:${archive}`, local]));
    const sha = await timed("4", "SHA-256 du dump", async () => createHash("sha256").update(readFileSync(local)).digest("hex"));
    const verify = mk("verify"); created.push(verify);
    await timed("4", "createdb + pg_restore (--single-transaction) dans une 2e base", async () => {
      dexec("createdb", "-U", "postgres", "-O", OWNER, verify);
      dexec("pg_restore", "-U", "postgres", "--exit-on-error", "--single-transaction", "-d", verify, archive);
    });
    const fingerprintRestored = await timed("4", "empreinte ordonnée de la restauration", () => fingerprint(verify));
    assert.equal(fingerprintRestored, fingerprintBefore, "La sauvegarde restaurée diffère de la source");
    fact("phase4", { sha256: sha, tailleOctets: readFileSync(local).length, empreinte: fingerprintBefore, restaurationIdentique: true });

    // =============================================================== Phase 5 : migrations XP par gn_migrator
    console.log("\n== Phase 5 : migrations XP appliquées par gn_migrator (prisma migrate deploy)");
    const appliedNames = (await admin(main, `SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`)).rows.map((r) => r[0]);
    const pending = allMigrations.filter((n) => !appliedNames.includes(n));
    assert.deepEqual(pending, PENDING_MIGRATIONS, "Avant la migration, exactement les 6 migrations doivent être en attente");
    const mig = await timed("5", "prisma migrate deploy (DATABASE_URL = gn_migrator, 6 migrations en attente)", async () => prisma(["migrate", "deploy"], urlFor("migrator", main), fullSchema));
    assert.equal(mig.status, 0, mig.output);
    assert.equal(Number(await scalar(main, `SELECT count(*) FROM _prisma_migrations WHERE migration_name = ANY(ARRAY['${PENDING_MIGRATIONS.join("','")}']) AND finished_at IS NOT NULL`)), PENDING_MIGRATIONS.length, "Les 6 migrations doivent être appliquées");
    const inv = async (db) => ({
      migrationsXp: (await admin(db, `SELECT migration_name || ':' || count(*) || ':' || bool_and(finished_at IS NOT NULL AND rolled_back_at IS NULL) FROM _prisma_migrations WHERE migration_name = ANY(ARRAY['${EXPECTED_XP_MIGRATIONS.join("','")}']) GROUP BY migration_name ORDER BY 1`)).rows.map((r) => r[0]),
      inachevées: Number(await scalar(db, `SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL`)),
      soldesDivergents: Number(await scalar(db, `SELECT count(*) FROM "CommunityMemberStats" WHERE "xpBalance" <> "xpTotal"`)),
      soldesNégatifs: Number(await scalar(db, `SELECT count(*) FROM "CommunityMemberStats" WHERE "xpBalance" < 0`)),
      sommeXpTotal: await scalar(db, `SELECT coalesce(sum("xpTotal"),0) FROM "CommunityMemberStats"`), sommeXpBalance: await scalar(db, `SELECT coalesce(sum("xpBalance"),0) FROM "CommunityMemberStats"`),
      ledger: Number(await scalar(db, `SELECT count(*) FROM "XpEvent"`)),
    });
    const invAfter = await timed("5", "invariants SQL après migration", () => inv(main));
    const fingerprintAfter = await timed("5", "empreinte progression/équipements/objets/ledger après migration", () => fingerprint(main));
    assert.equal(fingerprintAfter, fingerprintBefore, "Empreinte modifiée par la migration");
    assert.equal(invAfter.soldesDivergents, 0); assert.equal(invAfter.soldesNégatifs, 0); assert.equal(invAfter.inachevées, 0);
    assert.equal(invAfter.migrationsXp.length, 2); assert.ok(invAfter.migrationsXp.every((l) => l.endsWith(":1:true")));
    fact("phase5", { migrateDeployMs: mig.ms, sortie: mig.output.split("\n").filter((l) => /applied|migration/i.test(l)).slice(-5), invariants: invAfter, empreinteIdentique: true,
      propriétaireDeCommunityMemberStats: await scalar(main, `SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='public."CommunityMemberStats"'::regclass`) });

    // =============================================================== Phase 6 : nouveau runtime, réouverture
    console.log("\n== Phase 6 : nouveau runtime gn_runtime, réouverture");
    const refusedBefore = await open("runtime", main).then((c) => { c.close(); return "connexion possible"; }, (e) => `refusée (${e.code})`);
    await timed("6", "réouverture : ALTER ROLE gn_runtime LOGIN", () => adminPg.query(`ALTER ROLE gn_runtime LOGIN`));
    const debit = (g) => `UPDATE "CommunityMemberStats" SET "xpBalance" = "xpBalance" - 10 WHERE "communityId" = 'comm-${g % 3}' AND "userId" = 'u${g}' AND "xpBalance" >= 10;
      INSERT INTO "XpEvent" ("communityId","id","userId","reason","sourceId","amount") VALUES ('comm-${g % 3}','shop-${g}','u${g}','SHOP_BALANCE_PURCHASE','shop-${g}',-10);`;
    await timed("6", "gn_runtime direct : 3 achats (UPDATE xpBalance + INSERT SHOP_BALANCE_PURCHASE)", async () => { const c = await open("runtime", main); for (const g of [10, 11, 12]) await c.query(`BEGIN; ${debit(g)} COMMIT`); c.close(); });
    await timed("6", "gn_runtime via pooler : 2 achats", async () => { const c = await open("runtime", main, "pooler", 8000); for (const g of [13, 14]) await c.query(`BEGIN; ${debit(g)} COMMIT`); c.close(); });
    const ddlAsRuntime = await open("runtime", main).then(async (c) => { const x = await attempt(c, `ALTER TABLE "CommunityMemberStats" DROP COLUMN "xpBalance"`); c.close(); return x; });
    const oldCanary = await open("ownerOld", main).then(async (c) => { const x = await attempt(c, canarySql("après-réouverture")); c.close(); return x; }, (e) => ({ ok: false, code: e.code }));
    await sleep(1500);
    const invReopen = await timed("6", "invariants SQL après réouverture", () => inv(main));
    const lateOld = oldWriters.map((w) => tally(w.journal, tBarrier + 150, Date.now()));
    assert.equal(invReopen.soldesNégatifs, 0); assert.equal(invReopen.soldesDivergents, 5); assert.equal(invReopen.inachevées, 0);
    assert.equal(invReopen.sommeXpTotal, invAfter.sommeXpTotal); assert.equal(invReopen.ledger, invAfter.ledger + 5);
    assert.equal(Number(invAfter.sommeXpBalance) - Number(invReopen.sommeXpBalance), 50);
    assert.ok(!ddlAsRuntime.ok && !oldCanary.ok && lateOld.every((l) => l.ok === 0));
    fact("phase6", { runtimeAvantRéouverture: refusedBefore, DDLparRuntime: ddlAsRuntime, canariAncienPropriétaire: oldCanary, ancienRuntimeDepuisLaBarrière: oldWriters.map((w, i) => ({ writer: w.label, réussies: lateOld[i].ok, refus: lateOld[i].err, codes: lateOld[i].codes })), invariantsAprèsRéouverture: invReopen });

    // =============================================================== Point de build : migrate deploy avec chaque rôle
    console.log("\n== Point de build : scripts/build.mjs et prisma migrate deploy selon le rôle");
    const buildMjs = readFileSync("scripts/build.mjs", "utf8");
    const mainBuild = spawnSync("git", ["show", "origin/main:scripts/build.mjs"], { encoding: "utf8" }).stdout ?? "";
    fact("build_mjs", { checkoutExécutaMigrateDeploy: /"migrate",\s*"deploy"/.test(buildMjs), origin_main_exécuteMigrateDeploy: /"migrate",\s*"deploy"/.test(mainBuild), origin_main_saufPreview: /VERCEL_ENV === "preview"/.test(mainBuild) });
    const bc = await cloneDb("build"); await grantRoles(bc);
    const bcRuntime = await timed("build", "migrate deploy avec DATABASE_URL = gn_runtime (2 migrations en attente)", async () => prisma(["migrate", "deploy"], urlFor("runtime", bc), fullSchema));
    const bcXpColumn = await scalar(bc, `SELECT count(*) FROM information_schema.columns WHERE table_name='CommunityMemberStats' AND column_name='xpBalance'`);
    const bcMigrator = await timed("build", "migrate deploy avec DATABASE_URL = gn_migrator (2 migrations en attente)", async () => prisma(["migrate", "deploy"], urlFor("migrator", bc), fullSchema));
    const bcNoop = await timed("build", "migrate deploy gn_migrator, tout est appliqué (no-op)", async () => prisma(["migrate", "deploy"], urlFor("migrator", bc), fullSchema));
    const bcRuntimeNoop = await timed("build", "migrate deploy gn_runtime, tout est appliqué", async () => prisma(["migrate", "deploy"], urlFor("runtime", bc), fullSchema));
    const bcPool = await timed("build", "migrate deploy gn_migrator via pgbouncer (info, tout est appliqué)", async () => prisma(["migrate", "deploy"], urlFor("migrator", bc, "pooler"), fullSchema, 90000));
    const tail = (r) => r.output.split("\n").map((l) => l.trim()).filter(Boolean).filter((l) => /error|denied|permission|No pending|applied|P\d{4}|must be owner/i.test(l)).slice(0, 4);
    fact("build_prisma", {
      runtimeAvecEnAttente: { status: bcRuntime.status, colonneXpCréée: Number(bcXpColumn), extrait: tail(bcRuntime) },
      migratorAvecEnAttente: { status: bcMigrator.status, extrait: tail(bcMigrator) },
      migratorToutAppliqué: { status: bcNoop.status, extrait: tail(bcNoop) },
      runtimeToutAppliqué: { status: bcRuntimeNoop.status, extrait: tail(bcRuntimeNoop) },
      migratorViaPooler: { status: bcPool.status, signal: bcPool.signal, extrait: tail(bcPool) },
    });
    assert.notEqual(bcRuntime.status, 0); assert.equal(Number(bcXpColumn), 0); assert.equal(bcMigrator.status, 0); assert.equal(bcNoop.status, 0);

    // =============================================================== Phase 7 : replis testés
    console.log("\n== Phase 7 : replis testés");
    const fb2 = mk("fb2"); created.push(fb2);
    await timed("7ii", "échec après migration, avant réouverture : restauration du dump dans une autre base", async () => {
      dexec("createdb", "-U", "postgres", "-O", OWNER, fb2);
      dexec("pg_restore", "-U", "postgres", "--exit-on-error", "--single-transaction", "-d", fb2, archive);
    });
    const fp2 = await timed("7ii", "empreinte de la base de repli", () => fingerprint(fb2));
    const fb2State = {
      colonneXp: Number(await scalar(fb2, `SELECT count(*) FROM information_schema.columns WHERE table_name='CommunityMemberStats' AND column_name='xpBalance'`)),
      migrationsXp: Number(await scalar(fb2, `SELECT count(*) FROM _prisma_migrations WHERE migration_name = ANY(ARRAY['${EXPECTED_XP_MIGRATIONS.join("','")}'])`)),
      droitsRuntime: await scalar(fb2, `SELECT has_table_privilege('gn_runtime','public."XpEvent"','INSERT')`),
      propriétaire: await scalar(fb2, `SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='public."XpEvent"'::regclass`),
    };
    assert.equal(fp2, fingerprintBefore); assert.equal(fb2State.colonneXp, 0); assert.equal(fb2State.migrationsXp, 0);
    fact("phase7ii", { empreinteIdentiqueÀLaSource: true, état: fb2State, baseMigréeConservéeÀPart: main });

    for (const w of oldWriters) await w.stop();
    operator.close(); adminPg.close();
    // Le protocole principal est terminé : on retire la barrière du cluster (hors mesure) pour rejouer le repli sur une base à l'état PRE.
    await admin("postgres", retained.revert(main));
    const fb1 = await cloneDb("fb1"); await grantRoles(fb1);
    const w1 = startWriter({ label: "direct", path: "direct", database: fb1 }); writers.push(w1);
    const op1 = await open("owner", fb1); const ad1 = await open("admin", "postgres");
    await sleep(2000);
    const t7a = Date.now();
    await timed("7i", `barrière ${retained.id} + terminate (rejeu du protocole sur une base à l'état PRE)`, async () => { await applyMethod(retained, fb1, op1, ad1); await terminateOthers(fb1, op1, ad1); });
    await sleep(2500);
    const blocked = tally(w1.journal, t7a + 600, Date.now());
    assert.equal(blocked.ok, 0, "barrière non étanche avant repli");
    const tRevert = performance.now(); let revertVia = "propriétaire";
    await timed("7i", "échec simulé avant migration : retrait de la barrière", async () => { try { await op1.query(retained.revert(fb1)); } catch (e) { revertVia = `admin (${e.code})`; await ad1.query(retained.revert(fb1)); } });
    const revEnd = Date.now();
    let resumeMs = null;
    for (let i = 0; i < 200 && resumeMs === null; i++) { const f = w1.journal.find((x) => x.op && x.ok && x.t > revEnd); if (f) resumeMs = f.t - revEnd; else await sleep(50); }
    fact("phase7i", { bloquéAvantRepli: blocked, retraitVia: revertVia, ancienWriterReprendAprèsMs: resumeMs, étatPRE: { colonneXp: Number(await scalar(fb1, `SELECT count(*) FROM information_schema.columns WHERE table_name='CommunityMemberStats' AND column_name='xpBalance'`)), migrationsXp: Number(await scalar(fb1, `SELECT count(*) FROM _prisma_migrations WHERE migration_name = ANY(ARRAY['${EXPECTED_XP_MIGRATIONS.join("','")}'])`)) } });
    assert.notEqual(resumeMs, null);
    timings.push({ phase: "7i", step: "reprise des écritures de l'ancien writer après retrait", ms: resumeMs });
    op1.close(); ad1.close(); void tRevert;

    // =============================================================== Comparaison B (REASSIGN OWNED), propriétaire de test dédié
    console.log("\n== Comparaison A/B : REASSIGN OWNED (propriétaire de test dédié, jamais neondb_owner)");
    await comparisonB({ mk, created, baselineSchema, tpl, timings });
  } finally {
    await cleanup().catch((e) => console.error("Nettoyage :", e.message));
  }

  console.log("\n=== FAITS (JSON) ===");
  console.log(JSON.stringify(facts, null, 2));
  console.log("\n=== DURÉES MESURÉES (ms) : local, données synthétiques, non transposables à Production ===");
  console.log("| Phase | Étape | ms |\n|---|---|---|");
  for (const t of timings) console.log(`| ${t.phase} | ${t.step} | ${t.ms} |`);
}

async function comparisonB({ mk, created, baselineSchema, timings: tm }) {
  const name = mk("cmpb"); created.push(name);
  await admin("postgres", `CREATE ROLE gn_test_owner LOGIN NOSUPERUSER CREATEDB CREATEROLE REPLICATION BYPASSRLS PASSWORD '${PW.ownerOld}'`);
  await admin("postgres", `CREATE DATABASE "${name}" OWNER gn_test_owner`);
  const url = `postgresql://gn_test_owner:${PW.ownerOld}@${HOST}:${PG_PORT}/${name}`;
  const base = prisma(["migrate", "deploy"], url, baselineSchema, 540000);
  assert.equal(base.status, 0, base.output);
  await admin(name, seedSql(300));
  const w = startWriter({ label: "direct", path: "direct", database: name, user: "gn_test_owner" });
  await sleep(1800);
  const t0 = Date.now(); const p0 = performance.now();
  await admin(name, `REASSIGN OWNED BY gn_test_owner TO gn_migrator`);
  const ms = Math.round(performance.now() - p0);
  await sleep(2000);
  const res = {
    reassignMs: ms, ancienWriterAprès: tally(w.journal, t0 + 100, Date.now()),
    propriétaireBase: await scalar("postgres", `SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname='${name}'`),
    propriétaireTables: await scalar(name, `SELECT string_agg(DISTINCT pg_get_userbyid(relowner), ',') FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r'`),
    ancienPropriétaireADroitSurTables: await scalar(name, `SELECT has_table_privilege('gn_test_owner','public."XpEvent"','INSERT')`),
  };
  tm.push({ phase: "1", step: "méthode B : REASSIGN OWNED (base de test, 300 utilisateurs)", ms });
  await w.stop();
  fact("phase1_comparaison_B", res);
  await admin("postgres", `DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await admin("postgres", `DROP OWNED BY gn_test_owner`);
  await admin("postgres", `DROP ROLE gn_test_owner`);
}

if (process.argv.includes("--writer")) {
  await writerMain(JSON.parse(Buffer.from(process.argv[process.argv.indexOf("--writer") + 1], "base64").toString("utf8")));
} else if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(`Erreur : ${redact(error.stack ?? error.message)}`); process.exit(1); });
}
