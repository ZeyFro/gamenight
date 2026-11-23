/**
 * Logique PARTAGÉE d'enregistrement des commandes Discord de The Tower : validation du manifeste, comparaison
 * (absente / présente / différente) et appels Discord. Aucun effet de bord à l'import (ni lecture de fichier, ni code
 * de démarrage) : utilisée par le script `scripts/register-tower-guild-commands.mjs` ET par la route serveur
 * `POST /api/admin/discord-commands` (src/lib/discord-command-registration.ts).
 * Jamais de PUT global, jamais de suppression, aucune commande hors manifeste touchée. Aucun secret n'est retourné.
 */
export const EXPECTED_GUILD_ID = "553922938101825536";
const NAME_PATTERN = /^[-_\p{Ll}\p{N}]{1,32}$/u;
// Commandes contextuelles (type 3, message) : noms libres (majuscules, espaces), ni description ni options.
const MESSAGE_COMMAND_NAME_PATTERN = /^[\p{L}\p{N} _-]{1,32}$/u;
const OPTION_TYPES = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
const STRIPPED_FIELDS = ["integration_types", "contexts"];

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
  if (status === 429) return "Limite de débit Discord (429) : attendre le délai indiqué puis relancer ; les commandes déjà à jour sont sautées.";
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

/** Valide le manifeste puis retire les champs non envoyés. Lève une erreur (sans appel réseau) au moindre problème. */
export function prepareManifest(raw) {
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


/**
 * @typedef {"présente" | "absente" | "différente" | "enregistrée" | "déjà à jour" | "échec" | "en attente"} CommandState
 * @typedef {{ name: string, type: number, status: CommandState }} CommandStatus
 * @typedef {{
 *   stage: "config" | "read" | "write" | "network" | "rate_limit" | "outside_manifest",
 *   command?: string,
 *   http?: number,
 *   code?: string,
 *   hint?: string,
 *   errorName?: string,
 *   retryAfterSeconds?: number
 * }} RegistrationFailure
 * @typedef {{ ok: boolean, statuses: CommandStatus[], outsideManifest: number | null, failure: RegistrationFailure | null }} RegistrationResult
 */

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Délai demandé par Discord (en-tête Retry-After ou champ retry_after du corps), en millisecondes ; null si absent. */
async function retryAfterMs(response) {
  const header = Number(response.headers.get("retry-after"));
  let body = null;
  try {
    body = await response.clone().json();
  } catch {
    body = null;
  }
  const fromBody = Number(body?.retry_after);
  const seconds = Number.isFinite(fromBody) && fromBody >= 0 ? fromBody : Number.isFinite(header) && header >= 0 ? header : null;
  return seconds === null ? null : Math.ceil(seconds * 1000);
}

/** Attente imposée par le seau de débit après une écriture réussie (X-RateLimit-Remaining à 0), en millisecondes. */
function bucketWaitMs(response) {
  if (response.headers.get("x-ratelimit-remaining") !== "0") return 0;
  const resetAfter = Number(response.headers.get("x-ratelimit-reset-after"));
  return Number.isFinite(resetAfter) && resetAfter > 0 ? Math.ceil(resetAfter * 1000) : 0;
}

/**
 * Cœur commun (script et route) : `check` = un GET en lecture seule ; `execute` = ce GET puis un POST d'upsert pour
 * chaque commande ABSENTE ou DIFFÉRENTE (les commandes déjà identiques sont sautées : relancer reprend là où on s'est
 * arrêté). Jamais de PUT, de PATCH ni de DELETE. Limite de débit Discord : pause entre deux écritures, respect des
 * en-têtes X-RateLimit-* et de Retry-After (429), au plus `maxAttemptsPerCommand` essais par commande et un budget de
 * temps total : au-delà, arrêt propre avec les commandes restantes « en attente » (jamais de boucle sans fin).
 * En mode execute, le résultat donne TOUJOURS une ligne par commande du manifeste.
 * Mode `bulk` (« tout enregistrer d’un coup ») : le même GET, puis UN SEUL PUT sur le serveur The Tower
 * (`PUT /applications/{id}/guilds/{guild}/commands`, jamais l’URL globale) avec le manifeste complet. Un PUT remplace
 * l’ensemble des commandes de l’application sur ce serveur : il est donc REFUSÉ (aucune écriture, étape
 * `outside_manifest`) si le serveur porte une commande hors manifeste, qui serait supprimée. Tout est déjà à jour : aucune écriture.
 * Le résultat ne contient JAMAIS le jeton ni aucune valeur de l'environnement : seulement des noms de commandes,
 * des statuts, le statut HTTP, le code Discord numérique et le délai d'attente conseillé.
 * @param {{
 *   mode: "check" | "execute" | "bulk", commands: object[], env: Record<string, string | undefined>, fetchImpl?: typeof fetch,
 *   sleep?: (ms: number) => Promise<void>, now?: () => number, budgetMs?: number, pauseMs?: number,
 *   maxRetryAfterMs?: number, maxAttemptsPerCommand?: number
 * }} input
 * @returns {Promise<RegistrationResult>}
 */
export async function registerCommands({
  mode,
  commands,
  env,
  fetchImpl = fetch,
  sleep = defaultSleep,
  now = Date.now,
  budgetMs = 45_000,
  pauseMs = 1_000,
  maxRetryAfterMs = 30_000,
  maxAttemptsPerCommand = 3,
}) {
  /** @type {CommandStatus[]} */
  const statuses = [];
  const appId = env.DISCORD_CLIENT_ID?.trim();
  const guildId = env.TOWER_DISCORD_GUILD_ID?.trim();
  const token = env.DISCORD_BOT_TOKEN?.trim();
  if (!appId || !/^\d+$/.test(appId) || guildId !== EXPECTED_GUILD_ID || !token) {
    return { ok: false, statuses, outsideManifest: null, failure: { stage: "config" } };
  }
  const endpoint = `https://discord.com/api/v10/applications/${appId}/guilds/${guildId}/commands`;
  const headers = { Authorization: `Bot ${token}`, "Content-Type": "application/json" };
  const failureOf = async (stage, response, command) => {
    const code = await failureCode(response);
    return { stage, command, http: response.status, code, hint: explainFailure(response.status, code) };
  };
  const deadline = now() + budgetMs;
  let outsideManifest = null;

  try {
    const response = await fetchImpl(endpoint, { headers, signal: AbortSignal.timeout(10000) });
    if (!response.ok) return { ok: false, statuses, outsideManifest: null, failure: await failureOf("read", response) };
    const installed = await response.json();
    if (!Array.isArray(installed)) throw new Error("Réponse Discord inattendue.");
    const managed = new Set(commands.map((command) => command.name));
    outsideManifest = installed.filter((command) => !managed.has(command.name)).length;
    if (mode === "check") {
      for (const command of commands) statuses.push({ name: command.name, type: command.type ?? 1, status: classify(command, installed) });
      return { ok: true, statuses, outsideManifest, failure: null };
    }

    if (mode === "bulk") {
      for (const command of commands) {
        const upToDate = classify(command, installed) === "présente";
        statuses.push({ name: command.name, type: command.type ?? 1, status: upToDate ? "déjà à jour" : "en attente" });
      }
      // Garde-fou : un PUT supprimerait toute commande du serveur absente du manifeste.
      if (outsideManifest > 0) {
        return { ok: false, statuses, outsideManifest, failure: { stage: "outside_manifest", hint: `Le serveur porte ${outsideManifest} commande(s) hors manifeste : un enregistrement en bloc les supprimerait. Aucune écriture faite ; utilise « Enregistrer » (commande par commande), qui ne supprime rien.` } };
      }
      if (statuses.every((entry) => entry.status === "déjà à jour")) return { ok: true, statuses, outsideManifest, failure: null };
      let attempts = 0;
      for (;;) {
        attempts += 1;
        const result = await fetchImpl(endpoint, { method: "PUT", headers, body: JSON.stringify(commands), signal: AbortSignal.timeout(20000) });
        if (result.status === 429) {
          const retry = (await retryAfterMs(result)) ?? 5_000;
          if (attempts >= maxAttemptsPerCommand || retry > maxRetryAfterMs || now() + retry > deadline) {
            return { ok: false, statuses, outsideManifest, failure: { stage: "rate_limit", http: 429, retryAfterSeconds: Math.max(1, Math.ceil(retry / 1000)), hint: explainFailure(429, "0") } };
          }
          await sleep(retry);
          continue;
        }
        if (!result.ok) {
          for (const entry of statuses) if (entry.status === "en attente") entry.status = "échec";
          return { ok: false, statuses, outsideManifest, failure: await failureOf("write", result) };
        }
        for (const entry of statuses) if (entry.status === "en attente") entry.status = "enregistrée";
        return { ok: true, statuses, outsideManifest, failure: null };
      }
    }

    // Une ligne par commande dès le départ : « déjà à jour » (sautée) ou « en attente » (à écrire).
    for (const command of commands) {
      const upToDate = classify(command, installed) === "présente";
      statuses.push({ name: command.name, type: command.type ?? 1, status: upToDate ? "déjà à jour" : "en attente" });
    }
    let waitBeforeNext = 0;
    let written = 0;
    for (let index = 0; index < commands.length; index += 1) {
      if (statuses[index].status !== "en attente") continue;
      const command = commands[index];
      let attempts = 0;
      for (;;) {
        const wait = written > 0 || attempts > 0 ? Math.max(waitBeforeNext, pauseMs) : waitBeforeNext;
        if (now() + wait > deadline) {
          return {
            ok: false, statuses, outsideManifest,
            failure: { stage: "rate_limit", command: command.name, retryAfterSeconds: Math.max(1, Math.ceil(wait / 1000)), hint: explainFailure(429, "0") },
          };
        }
        if (wait > 0) await sleep(wait);
        attempts += 1;
        const result = await fetchImpl(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify(command),
          signal: AbortSignal.timeout(10000),
        });
        if (result.status === 429) {
          const retry = (await retryAfterMs(result)) ?? 5_000;
          if (attempts >= maxAttemptsPerCommand || retry > maxRetryAfterMs || now() + retry > deadline) {
            return {
              ok: false, statuses, outsideManifest,
              failure: { stage: "rate_limit", command: command.name, http: 429, retryAfterSeconds: Math.max(1, Math.ceil(retry / 1000)), hint: explainFailure(429, "0") },
            };
          }
          waitBeforeNext = retry;
          continue;
        }
        if (!result.ok) {
          statuses[index].status = "échec";
          return { ok: false, statuses, outsideManifest, failure: await failureOf("write", result, command.name) };
        }
        statuses[index].status = "enregistrée";
        written += 1;
        waitBeforeNext = bucketWaitMs(result);
        break;
      }
    }
    return { ok: true, statuses, outsideManifest, failure: null };
  } catch (error) {
    return { ok: false, statuses, outsideManifest, failure: { stage: "network", errorName: error instanceof Error ? error.name : "erreur inconnue" } };
  }
}
