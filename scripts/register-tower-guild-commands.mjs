/**
 * Enregistre UNIQUEMENT les commandes /tower et /tower-admin dans The Tower.
 * Sans option : simulation locale (aucun appel réseau). --check : lecture seule chez Discord.
 * --execute : deux POST d'upsert dans le serveur cible (jamais de PUT global).
 * Aucun secret n'est affiché ; seuls le statut HTTP et le code Discord numérique le sont.
 * Procédure : docs/DISCORD_COMMANDES.md
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const EXPECTED_GUILD_ID = "553922938101825536";
const MANAGED = ["tower", "tower-admin"];

/** Explication actionnable d'un refus Discord, sans jamais citer de secret. */
export function explainFailure(status, code) {
  if (code === "50001" || (status === 403 && code === "indisponible")) {
    return "Application non autorisée sur ce serveur avec le scope applications.commands (code 50001) : réinviter l'application avec scope=bot applications.commands (voir docs/DISCORD_COMMANDES.md).";
  }
  if (code === "50013") return "Permissions insuffisantes pour cette opération (code 50013).";
  if (status === 401) {
    return "Jeton refusé (401) : DISCORD_BOT_TOKEN absent, périmé, ou d'une autre application que DISCORD_CLIENT_ID.";
  }
  if (status === 403) {
    return "Accès refusé (403) : vérifier l'installation de l'application sur le serveur et que le jeton correspond à DISCORD_CLIENT_ID.";
  }
  if (status === 404) return "Ressource introuvable (404) : identifiant d'application ou de serveur incorrect, ou application absente du serveur.";
  if (status === 429) return "Limite de débit Discord (429) : ne pas réessayer en boucle, attendre.";
  return "";
}

async function failureCode(response) {
  try {
    const body = await response.json();
    return Number.isInteger(body?.code) ? String(body.code) : "indisponible";
  } catch {
    return "indisponible";
  }
}

export function loadTowerCommands(path = new URL("./discord-commands.json", import.meta.url)) {
  const commands = JSON.parse(readFileSync(path, "utf8"))
    .filter((command) => MANAGED.includes(command.name))
    .map((command) => Object.fromEntries(Object.entries(command).filter(([key]) => !["integration_types", "contexts"].includes(key))));
  if (commands.length !== 2 || new Set(commands.map((c) => c.name)).size !== 2) {
    throw new Error("Les deux commandes Tower attendues doivent être présentes une seule fois.");
  }
  return commands;
}

/**
 * Retourne le code de sortie. Tout est injectable pour les tests (fetch simulé).
 * @param {{ argv?: string[], env?: Record<string, string | undefined>, fetchImpl?: typeof fetch, log?: (m: string) => void, fail?: (m: string) => void, commands?: object[] }} [options]
 */
export async function run({ argv = [], env = {}, fetchImpl = fetch, log = console.log, fail = console.error, commands } = {}) {
  const execute = argv.includes("--execute");
  const check = argv.includes("--check");
  if (execute && check) {
    fail("Choisir soit --check, soit --execute.");
    return 1;
  }
  let toRegister;
  try {
    toRegister = commands ?? loadTowerCommands();
  } catch (error) {
    fail(error instanceof Error ? error.message : "Commandes illisibles.");
    return 1;
  }
  if (!execute && !check) {
    log("Simulation (défaut) : /tower et /tower-admin seraient ciblées dans The Tower seulement. Aucun appel Discord.");
    return 0;
  }

  const appId = env.DISCORD_CLIENT_ID?.trim();
  const guildId = env.TOWER_DISCORD_GUILD_ID?.trim();
  const token = env.DISCORD_BOT_TOKEN?.trim();
  if (!appId || !/^\d+$/.test(appId) || guildId !== EXPECTED_GUILD_ID || !token) {
    fail("Configuration absente/invalide : application Discord (DISCORD_CLIENT_ID), guild The Tower (TOWER_DISCORD_GUILD_ID), autorisation bot (DISCORD_BOT_TOKEN).");
    return 1;
  }
  const endpoint = `https://discord.com/api/v10/applications/${appId}/guilds/${guildId}/commands`;
  const headers = { Authorization: `Bot ${token}`, "Content-Type": "application/json" };
  const report = async (prefix, response) => {
    const code = await failureCode(response);
    const hint = explainFailure(response.status, code);
    fail(`${prefix} : HTTP ${response.status}, code ${code}.${hint ? ` ${hint}` : ""}`);
  };

  try {
    const response = await fetchImpl(endpoint, { headers, signal: AbortSignal.timeout(10000) });
    if (!response.ok) {
      await report("Discord refuse la lecture", response);
      fail("Aucune écriture.");
      return 1;
    }
    const installed = await response.json();
    if (!Array.isArray(installed)) throw new Error("Réponse Discord inattendue.");
    const installedNames = new Set(installed.map((c) => c.name));
    if (check) {
      for (const name of MANAGED) log(`/${name} : ${installedNames.has(name) ? "présente" : "absente"}`);
      return 0;
    }
    for (const command of toRegister) {
      const result = await fetchImpl(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(command),
        signal: AbortSignal.timeout(10000),
      });
      if (!result.ok) {
        await report(`Échec d'enregistrement de /${command.name}`, result);
        return 1;
      }
      log(`/${command.name} : enregistrée sur The Tower.`);
    }
    return 0;
  } catch (error) {
    fail(`Échec de communication avec Discord : ${error instanceof Error ? error.name : "erreur inconnue"}.`);
    return 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(await run({ argv: process.argv.slice(2), env: process.env }));
}
