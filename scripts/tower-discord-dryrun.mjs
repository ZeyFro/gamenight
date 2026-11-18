#!/usr/bin/env node
/**
 * The Tower 2.0 — diff DRY-RUN serveur Discord. Il n'existe AUCUN mode d'écriture ici.
 *   node scripts/tower-discord-dryrun.mjs --inventory <fichier.json>   (hors ligne : {channels, roles})
 *   node scripts/tower-discord-dryrun.mjs --live                       (GET uniquement ; DISCORD_BOT_TOKEN + DISCORD_BOT_GUILD_ID)
 * Options : --json (sortie JSON), --strict (code 1 s'il reste des écarts bloquants ou à créer/corriger).
 * Le jeton n'est jamais affiché.
 */
import fs from "node:fs/promises";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { buildReport, formatReport } from "./tower-layout-diff.mjs";

const API = "https://discord.com/api/v10";

export async function fetchInventory({ guild, token, fetchImpl }) {
  const get = async (resource) => {
    const res = await fetchImpl(`${API}/guilds/${guild}/${resource}`, {
      method: "GET",
      headers: { Authorization: `Bot ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`Discord HTTP ${res.status} sur GET ${resource}`);
    return res.json();
  };
  const [channels, roles] = await Promise.all([get("channels"), get("roles")]);
  if (!Array.isArray(channels) || !Array.isArray(roles)) throw new Error("Réponse Discord inattendue");
  return { channels, roles };
}

export async function main({ argv, env, fetchImpl = fetch, readFile = (p) => fs.readFile(p, "utf8"), manifestPath = undefined, out = console.log, err = console.error }) {
  const flag = (name) => argv.includes(name);
  const inventoryIdx = argv.indexOf("--inventory");
  if (inventoryIdx === -1 && !flag("--live")) {
    err("Usage : --inventory <fichier.json> (hors ligne) ou --live (GET seulement). Aucun mode d'écriture n'existe.");
    return 2;
  }
  const manifest = JSON.parse(await readFile(manifestPath ?? fileURLToPath(new URL("../docs/tower-layout-approved.json", import.meta.url))));
  let inventory;
  if (inventoryIdx !== -1) {
    const file = argv[inventoryIdx + 1];
    if (!file) { err("--inventory demande un chemin de fichier."); return 2; }
    inventory = JSON.parse(await readFile(file));
  } else {
    const token = env.DISCORD_BOT_TOKEN;
    const guild = env.DISCORD_BOT_GUILD_ID;
    if (!token || !guild) { err("DISCORD_BOT_TOKEN et DISCORD_BOT_GUILD_ID requis pour --live ; aucun appel effectué."); return 1; }
    if (manifest.guild_id !== guild) { err("Le serveur configuré ne correspond pas au manifeste ; aucun appel effectué."); return 1; }
    inventory = await fetchInventory({ guild, token, fetchImpl });
  }
  if (!Array.isArray(inventory.channels) || !Array.isArray(inventory.roles)) { err("Inventaire invalide : channels[] et roles[] attendus."); return 1; }
  const report = buildReport({ manifest, channels: inventory.channels, roles: inventory.roles });
  out(flag("--json") ? JSON.stringify(report, null, 2) : formatReport(report));
  const c = report.counts;
  return flag("--strict") && (c.blocked + c.create + c.rename > 0) ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await main({ argv: process.argv.slice(2), env: process.env });
}
