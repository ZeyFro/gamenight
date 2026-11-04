/**
 * Enregistre UNIQUEMENT les commandes /tower et /tower-admin dans The Tower.
 * Sans option : simulation locale. --check : lecture seule chez Discord.
 * --execute : deux POST d'upsert dans le serveur cible (jamais de PUT global).
 * Aucun secret n'est affiché.
 */
import { readFileSync } from "node:fs";

const EXPECTED_GUILD_ID = "553922938101825536";
const mode = process.argv.includes("--execute") ? "execute" : process.argv.includes("--check") ? "check" : "dry-run";
if (process.argv.includes("--execute") && process.argv.includes("--check")) {
  console.error("Choisir soit --check, soit --execute.");
  process.exit(1);
}
const commands = JSON.parse(readFileSync(new URL("./discord-commands.json", import.meta.url), "utf8"))
  .filter((command) => ["tower", "tower-admin"].includes(command.name))
  .map((command) => Object.fromEntries(Object.entries(command).filter(([key]) => !["integration_types", "contexts"].includes(key))));
if (commands.length !== 2 || new Set(commands.map((c) => c.name)).size !== 2) {
  console.error("Les deux commandes Tower attendues doivent être présentes une seule fois.");
  process.exit(1);
}
if (mode === "dry-run") {
  console.log("Simulation : /tower et /tower-admin seraient ciblées dans The Tower seulement.");
  process.exit(0);
}

const appId = process.env.DISCORD_CLIENT_ID?.trim();
const guildId = process.env.TOWER_DISCORD_GUILD_ID?.trim();
const token = process.env.DISCORD_BOT_TOKEN?.trim();
if (!appId || !/^\d+$/.test(appId) || guildId !== EXPECTED_GUILD_ID || !token) {
  console.error("Configuration absente/invalide : application Discord, guild The Tower, autorisation bot.");
  process.exit(1);
}
const endpoint = `https://discord.com/api/v10/applications/${appId}/guilds/${guildId}/commands`;
const headers = { Authorization: `Bot ${token}`, "Content-Type": "application/json" };
const timeout = AbortSignal.timeout(10000);

async function failureCode(response) {
  try {
    const body = await response.json();
    return Number.isInteger(body?.code) ? String(body.code) : "indisponible";
  } catch {
    return "indisponible";
  }
}

try {
  const response = await fetch(endpoint, { headers, signal: timeout });
  if (!response.ok) {
    console.error(`Discord refuse la lecture : HTTP ${response.status}, code ${await failureCode(response)}. Aucune écriture.`);
    process.exit(1);
  }
  const installed = await response.json();
  if (!Array.isArray(installed)) throw new Error("Réponse Discord inattendue.");
  const installedNames = new Set(installed.map((c) => c.name));
  if (mode === "check") {
    console.log(`/tower : ${installedNames.has("tower") ? "présente" : "absente"}`);
    console.log(`/tower-admin : ${installedNames.has("tower-admin") ? "présente" : "absente"}`);
    process.exit(0);
  }
  for (const command of commands) {
    const result = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(command),
      signal: AbortSignal.timeout(10000),
    });
    if (!result.ok) {
      console.error(`Échec d'enregistrement de /${command.name} : HTTP ${result.status}, code ${await failureCode(result)}.`);
      process.exit(1);
    }
    console.log(`/${command.name} : enregistrée sur The Tower.`);
  }
} catch (error) {
  console.error(`Échec de communication avec Discord : ${error instanceof Error ? error.name : "erreur inconnue"}.`);
  process.exit(1);
}
