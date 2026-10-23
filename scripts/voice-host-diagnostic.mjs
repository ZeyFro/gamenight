#!/usr/bin/env node
// Diagnostic d'hôte du worker vocal, LECTURE SEULE : à lancer par le propriétaire sur l'hôte.
// N'écrit rien, ne se connecte ni à une base ni à Discord (résolution DNS seulement),
// n'affiche jamais une valeur de variable : uniquement des NOMS présents ou absents.
//   node scripts/voice-host-diagnostic.mjs [--env-file <chemin>] [--unit <chemin>] [--image <nom>] [--json]
// Code de sortie : 0 aucun échec, 1 au moins un échec, 2 usage (dont toute option d'écriture refusée).
import { spawnSync } from "node:child_process";
import { lookup } from "node:dns/promises";
import { readFileSync, statSync, statfsSync, existsSync } from "node:fs";
import os from "node:os";
import { pathToFileURL } from "node:url";

export const MIN_NODE = [22, 15, 0];
export const GATEWAY_HOSTS = ["gateway.discord.gg", "discord.com"];
// Requis pour démarrer le serveur ; les autres ne le sont qu'à l'activation de la collecte.
export const REQUIRED_NAMES = ["DATABASE_URL", "VOICE_PRESENCE_ENABLED"];
export const ACTIVATION_NAMES = [
  "DISCORD_BOT_TOKEN", "DISCORD_BOT_GUILD_ID", "VOICE_PRESENCE_CONSENT_DECISION", "VOICE_PRESENCE_RETENTION_DECISION",
  "AUTH_SECRET", "CRON_SECRET",
];
export const OPTIONAL_NAMES = ["VOICE_PRESENCE_WORKER_MODE", "VOICE_PRESENCE_POLL_INTERVAL_MS", "VOICE_WORKER_SHUTDOWN_TIMEOUT_MS"];

const OPTIONS_WITH_VALUE = new Set(["--env-file", "--unit", "--image"]);
const DEFAULTS = { envFile: "/etc/gamenight/gamenight.env", unit: "/etc/systemd/system/gamenight.service", image: "gamenight-voice-worker:local", json: false };

export function parseArgs(argv) {
  const opts = { ...DEFAULTS };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") opts.json = true;
    else if (arg === "--help" || arg === "-h") opts.help = true;
    else if (OPTIONS_WITH_VALUE.has(arg)) {
      const value = argv[++i];
      if (!value || value.startsWith("--")) return { error: `valeur manquante pour ${arg}` };
      opts[arg === "--env-file" ? "envFile" : arg.slice(2)] = value;
    } else return { error: `option refusée : ${arg} (ce script est en lecture seule et n'accepte que --env-file, --unit, --image, --json)` };
  }
  return { opts };
}

const atLeast = (version, min) => {
  const [a, b, c] = version.replace(/^v/, "").split(".").map(Number);
  return [a, b, c].every(Number.isFinite) && (a !== min[0] ? a > min[0] : b !== min[1] ? b > min[1] : c >= min[2]);
};

/** Extrait les NOMS de variables d'un contenu d'environnement. Les valeurs ne quittent jamais cette fonction (sauf pour le drapeau, réduit à un booléen). */
export function parseEnvNames(content) {
  const counts = new Map();
  let flagIsFalse = false;
  for (const line of content.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) continue;
    counts.set(match[1], (counts.get(match[1]) ?? 0) + 1);
    if (match[1] === "VOICE_PRESENCE_ENABLED") flagIsFalse = match[2].trim() === "false";
  }
  return { counts, flagIsFalse };
}

const check = (id, status, detail) => ({ id, status, detail });

/** Logique de décision pure : faits collectés -> liste de contrôles (ok | warn | fail | info). */
export function evaluate(f) {
  const out = [];
  out.push(check("node", f.nodeVersion && atLeast(f.nodeVersion, MIN_NODE) ? "ok" : "fail", `Node ${f.nodeVersion ?? "absent"} (minimum ${MIN_NODE.join(".")})`));
  out.push(check("docker", f.dockerVersion ? "ok" : f.unitPresent ? "info" : "warn", f.dockerVersion ?? "Docker absent (inutile avec l'unité systemd seule)"));
  out.push(check("architecture", ["arm64", "x64"].includes(f.arch) ? "ok" : "warn", `${f.arch} (aarch64 attendu sur Raspberry Pi 64 bits)`));
  const freeMb = Math.round(f.freeMemBytes / 1048576);
  out.push(check("memoire", freeMb >= 256 ? "ok" : freeMb >= 128 ? "warn" : "fail", `${freeMb} Mo libres sur ${Math.round(f.totalMemBytes / 1048576)} Mo`));
  const freeDiskMb = f.diskFreeBytes === null ? null : Math.round(f.diskFreeBytes / 1048576);
  out.push(check("disque", freeDiskMb === null ? "warn" : freeDiskMb >= 1024 ? "ok" : freeDiskMb >= 256 ? "warn" : "fail", freeDiskMb === null ? "illisible" : `${freeDiskMb} Mo libres`));
  out.push(check("horloge", f.clockSynced === true ? "ok" : f.clockSynced === false ? "fail" : "warn",
    f.clockSynced === true ? "synchronisée (NTP)" : f.clockSynced === false ? "NON synchronisée : les baux et horodatages seraient faux" : "indéterminée (timedatectl indisponible)"));
  out.push(check("unite-systemd", f.unitPresent ? "ok" : "info", f.unitPresent ? `présente (${f.unitPath})` : `absente (${f.unitPath}) : normal avant l'installation systemd`));
  out.push(check("image", "info", f.imagePresent === null ? "non vérifiée (Docker absent)" : f.imagePresent ? `présente (${f.image})` : `absente (${f.image}) : normal avant la construction`));
  const env = f.env;
  if (!env.exists) {
    out.push(check("env-fichier", "fail", `absent (${f.envPath}) : à créer localement par le propriétaire, root:root 0600`));
  } else {
    if (env.mode === null) out.push(check("env-permissions", "info", "non applicable sur cette plateforme"));
    else out.push(check("env-permissions", env.mode === 0o600 && env.uid === 0 && env.gid === 0 ? "ok" : "fail",
      `mode ${env.mode.toString(8).padStart(4, "0")}, propriétaire ${env.uid}:${env.gid} (attendu 0600 root:root, soit 0:0)`));
    if (!env.names) out.push(check("env-variables", "warn", "contenu illisible (relancer avec sudo pour contrôler les noms)"));
    else {
      const present = (name) => (env.names.get(name) ?? 0) > 0;
      for (const name of REQUIRED_NAMES) out.push(check(`var:${name}`, present(name) ? "ok" : "fail", present(name) ? "présente" : "ABSENTE (requise)"));
      for (const name of ACTIVATION_NAMES) out.push(check(`var:${name}`, present(name) ? "ok" : "info", present(name) ? "présente" : "absente (requise seulement à l'activation de la collecte)"));
      for (const name of OPTIONAL_NAMES) out.push(check(`var:${name}`, "info", present(name) ? "présente" : "absente (optionnelle)"));
      const flagCount = env.names.get("VOICE_PRESENCE_ENABLED") ?? 0;
      out.push(check("collecte-eteinte", flagCount === 1 && env.flagIsFalse ? "ok" : "fail",
        flagCount === 1 && env.flagIsFalse ? "VOICE_PRESENCE_ENABLED défini une fois et éteint (false)" : `VOICE_PRESENCE_ENABLED ${flagCount === 1 ? "n'est pas éteint (false)" : `défini ${flagCount} fois (une seule attendue)`}`));
    }
  }
  for (const host of GATEWAY_HOSTS) {
    const r = f.dns[host];
    out.push(check(`dns:${host}`, r?.ok ? "ok" : "fail", r?.ok ? `résolu (${r.addresses} adresse(s))` : "non résolu"));
  }
  return out;
}

export function exitCodeFor(checks) {
  return checks.some((c) => c.status === "fail") ? 1 : 0;
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 8000, windowsHide: true });
  return r.error || r.status !== 0 ? null : r.stdout.trim();
}

export async function collectFacts(opts) {
  const dockerVersion = run("docker", ["--version"]);
  let envInfo = { exists: false, mode: null, uid: null, gid: null, names: null, flagIsFalse: false };
  if (existsSync(opts.envFile)) {
    const st = statSync(opts.envFile);
    envInfo = { exists: true, mode: process.platform === "win32" ? null : st.mode & 0o777, uid: st.uid, gid: st.gid, names: null, flagIsFalse: false };
    try {
      const parsed = parseEnvNames(readFileSync(opts.envFile, "utf8"));
      envInfo.names = parsed.counts;
      envInfo.flagIsFalse = parsed.flagIsFalse;
    } catch { /* illisible : signalé comme tel, sans détail */ }
  }
  let diskFreeBytes = null;
  try { const s = statfsSync(process.platform === "win32" ? os.homedir() : "/"); diskFreeBytes = s.bavail * s.bsize; } catch { /* signalé « illisible » */ }
  const ntp = process.platform === "linux" ? run("timedatectl", ["show", "-p", "NTPSynchronized", "--value"]) : null;
  const dns = {};
  for (const host of GATEWAY_HOSTS) {
    try { dns[host] = { ok: true, addresses: (await lookup(host, { all: true })).length }; } catch { dns[host] = { ok: false }; }
  }
  return {
    nodeVersion: process.version, dockerVersion, arch: os.arch(), freeMemBytes: os.freemem(), totalMemBytes: os.totalmem(), diskFreeBytes,
    clockSynced: ntp === "yes" ? true : ntp === "no" ? false : null,
    unitPresent: existsSync(opts.unit), unitPath: opts.unit,
    image: opts.image, imagePresent: dockerVersion ? run("docker", ["image", "inspect", "--format", "{{.Id}}", opts.image]) !== null : null,
    envPath: opts.envFile, env: envInfo, dns,
  };
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.error) { console.error(`voice-host-diagnostic : ${parsed.error}`); process.exit(2); }
  if (parsed.opts.help) { console.log("Usage : node scripts/voice-host-diagnostic.mjs [--env-file <chemin>] [--unit <chemin>] [--image <nom>] [--json]  (lecture seule)"); return; }
  const checks = evaluate(await collectFacts(parsed.opts));
  if (parsed.opts.json) console.log(JSON.stringify(checks, null, 2));
  else for (const c of checks) console.log(`[${c.status.toUpperCase().padEnd(4)}] ${c.id} : ${c.detail}`);
  process.exitCode = exitCodeFor(checks);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
