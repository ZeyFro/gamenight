/**
 * Enregistre TOUTES les commandes déclarées dans scripts/discord-commands.json dans le serveur The Tower
 * (route de serveur uniquement, jamais globale). Trois modes exclusifs :
 *   (défaut)   simulation locale : aucun appel réseau, affiche le plan.
 *   --check    un GET en lecture seule : chaque commande du manifeste est présente / absente / différente.
 *   --execute  un POST d'upsert par commande du manifeste, dans l'ordre du manifeste.
 * Jamais de PUT global, jamais de suppression, aucune commande hors manifeste touchée.
 * Aucun secret n'est affiché ; seuls le statut HTTP et le code Discord numérique le sont.
 * /gamenight setup (permission 32) fait partie du manifeste et est donc incluse telle que déclarée.
 * Procédure : docs/DISCORD_COMMANDES.md
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const EXPECTED_GUILD_ID = "553922938101825536";
const NAME_PATTERN = /^[-_\p{Ll}\p{N}]{1,32}$/u;
// Commandes contextuelles (type 3, message) : noms libres (majuscules, espaces), ni description ni options.
const MESSAGE_COMMAND_NAME_PATTERN = /^[\p{L}\p{N} _-]{1,32}$/u;
const OPTION_TYPES = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
const STRIPPED_FIELDS = ["integration_types", "contexts"];
const MODES = ["--check", "--execute"];

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

function validateOptions(options, where, depth, problems) {
  if (!Array.isArray(options) || options.length > 25) {
    problems.push(`${where} : options invalides (tableau de 25 au plus).`);
    return;
  }
  const seen = new Set();
  let optionalSeen = false;
  for (const option of options) {
    const label = `${where} ${option?.name ?? "?"}`;
    if (!option || typeof option !== "object" || !OPTION_TYPES.has(option.type)) {
      problems.push(`${label} : type d'option invalide.`);
      continue;
    }
    if (typeof option.name !== "string" || !NAME_PATTERN.test(option.name)) problems.push(`${label} : nom invalide.`);
    if (typeof option.description !== "string" || option.description.length < 1 || option.description.length > 100) {
      problems.push(`${label} : description invalide (1 à 100 caractères).`);
    }
    if (seen.has(option.name)) problems.push(`${label} : nom d'option en double.`);
    seen.add(option.name);
    if (option.type === 1 || option.type === 2) {
      if (depth >= 2) problems.push(`${label} : imbrication trop profonde.`);
      if (option.options !== undefined) validateOptions(option.options, label, depth + 1, problems);
    } else {
      if (option.required === true && optionalSeen) problems.push(`${label} : option requise après une option facultative.`);
      if (option.required !== true) optionalSeen = true;
    }
  }
}

/** Valide une entrée du manifeste avant tout appel. Retourne la liste des problèmes (vide si valide). */
export function validateCommand(command) {
  if (!command || typeof command !== "object") return ["entrée du manifeste invalide."];
  const problems = [];
  const where = `/${command.name ?? "?"}`;
  const isMessageCommand = command.type === 3;
  const namePattern = isMessageCommand ? MESSAGE_COMMAND_NAME_PATTERN : NAME_PATTERN;
  if (typeof command.name !== "string" || !namePattern.test(command.name)) problems.push(`${where} : nom invalide.`);
  if (command.type !== 1 && !isMessageCommand) problems.push(`${where} : seuls les types 1 (CHAT_INPUT) et 3 (MESSAGE) sont gérés.`);
  if (isMessageCommand) {
    if (command.description !== undefined && command.description !== "") problems.push(`${where} : une commande de message n'a pas de description.`);
    if (command.options !== undefined) problems.push(`${where} : une commande de message n'a pas d'options.`);
  } else if (typeof command.description !== "string" || command.description.length < 1 || command.description.length > 100) {
    problems.push(`${where} : description invalide (1 à 100 caractères).`);
  }
  const permissions = command.default_member_permissions;
  if (permissions !== null && permissions !== undefined && !(typeof permissions === "string" && /^\d+$/.test(permissions))) {
    problems.push(`${where} : default_member_permissions doit être null ou une chaîne numérique.`);
  }
  if (command.options !== undefined) validateOptions(command.options, where, 0, problems);
  return problems;
}

/** Valide un ensemble de commandes : chaque entrée, puis les doublons de nom. Retourne les problèmes. */
export function validateManifest(commands) {
  if (!Array.isArray(commands) || commands.length === 0) return ["Manifeste vide ou invalide."];
  const problems = commands.flatMap((command) => validateCommand(command));
  const names = commands.map((command) => `${command?.type ?? 1}:${command?.name}`);
  for (const name of new Set(names.filter((n, i) => names.indexOf(n) !== i))) problems.push(`/${String(name).replace(/^\d+:/, "")} : commande déclarée deux fois.`);
  return problems;
}

/** Charge et valide tout le manifeste. Lève une erreur (sans appel réseau) au moindre problème. */
export function loadManifestCommands(path = new URL("./discord-commands.json", import.meta.url)) {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const problems = validateManifest(raw);
  if (problems.length > 0) throw new Error(`Manifeste invalide :\n- ${problems.join("\n- ")}`);
  return raw.map((command) => Object.fromEntries(Object.entries(command).filter(([key]) => !STRIPPED_FIELDS.includes(key))));
}

function normalizeOption(option) {
  const out = { type: option.type, name: option.name, description: option.description };
  if (option.required === true) out.required = true;
  for (const key of ["min_length", "max_length", "min_value", "max_value", "choices"]) {
    if (option[key] !== undefined && option[key] !== null) out[key] = option[key];
  }
  if (Array.isArray(option.options) && option.options.length > 0) out.options = option.options.map(normalizeOption);
  return out;
}

/** Forme comparable : ignore les champs ajoutés par Discord (id, version, localisations, defaults). */
export function normalizeCommand(command) {
  return {
    type: command.type ?? 1,
    name: command.name,
    description: command.description ?? "",
    default_member_permissions: command.default_member_permissions ?? null,
    options: (command.options ?? []).map(normalizeOption),
  };
}

export function classify(command, installed) {
  const current = installed.find((c) => c.name === command.name && (c.type ?? 1) === (command.type ?? 1));
  if (!current) return "absente";
  return JSON.stringify(normalizeCommand(command)) === JSON.stringify(normalizeCommand(current)) ? "présente" : "différente";
}

function describePlan(command) {
  const subs = (command.options ?? []).filter((o) => o.type === 1).map((o) => o.name);
  const permission = command.default_member_permissions ? `permission ${command.default_member_permissions}` : "tous les membres";
  if (command.type === 3) return `« ${command.name} » (commande de message, ${command.default_member_permissions ? `permission ${command.default_member_permissions}` : "tous les membres"})`;
  return `/${command.name}${subs.length ? ` [${subs.join(", ")}]` : ""} (${permission})`;
}

/**
 * Retourne le code de sortie. Tout est injectable pour les tests (fetch simulé).
 * @param {{ argv?: string[], env?: Record<string, string | undefined>, fetchImpl?: typeof fetch, log?: (m: string) => void, fail?: (m: string) => void, commands?: object[] }} [options]
 */
export async function run({ argv = [], env = {}, fetchImpl = fetch, log = console.log, fail = console.error, commands } = {}) {
  if (argv.some((arg) => !MODES.includes(arg))) {
    fail("Argument inconnu : seuls --check et --execute sont acceptés.");
    return 1;
  }
  const execute = argv.includes("--execute");
  const check = argv.includes("--check");
  if (execute && check) {
    fail("Choisir soit --check, soit --execute.");
    return 1;
  }
  let toRegister;
  try {
    if (commands) {
      const problems = validateManifest(commands);
      if (problems.length > 0) throw new Error(`Manifeste invalide :\n- ${problems.join("\n- ")}`);
      toRegister = commands;
    } else {
      toRegister = loadManifestCommands();
    }
  } catch (error) {
    fail(error instanceof Error ? error.message : "Commandes illisibles.");
    return 1;
  }
  if (!execute && !check) {
    log(`Simulation (défaut) : ${toRegister.length} commandes du manifeste ciblées dans The Tower seulement. Aucun appel Discord.`);
    toRegister.forEach((command, index) => log(`${index + 1}. POST (upsert) ${describePlan(command)}`));
    log("Aucun PUT global, aucune suppression, aucune commande hors manifeste touchée. /gamenight setup est incluse telle que déclarée (voir docs/DISCORD_COMMANDES.md).");
    log("État réel (absente / présente / différente) : lancer --check dans un environnement autorisé.");
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
    if (check) {
      for (const command of toRegister) log(`/${command.name} : ${classify(command, installed)}`);
      const managed = new Set(toRegister.map((c) => c.name));
      log(`${installed.filter((c) => !managed.has(c.name)).length} commande(s) du serveur hors manifeste : non touchées.`);
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
