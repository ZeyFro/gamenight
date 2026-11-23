/**
 * Enregistre TOUTES les commandes déclarées dans scripts/discord-commands.json dans le serveur The Tower
 * (route de serveur uniquement, jamais globale). Trois modes exclusifs :
 *   (défaut)   simulation locale : aucun appel réseau, affiche le plan.
 *   --check    un GET en lecture seule : chaque commande du manifeste est présente / absente / différente.
 *   --execute  un POST d'upsert par commande du manifeste, dans l'ordre du manifeste.
 * Jamais de PUT global, jamais de suppression, aucune commande hors manifeste touchée.
 * Aucun secret n'est affiché ; seuls le statut HTTP et le code Discord numérique le sont.
 * /gamenight setup (permission 32) fait partie du manifeste et est donc incluse telle que déclarée.
 * La logique (validation, comparaison, appels Discord) vit dans `discord-command-registration.mjs`, partagée avec la
 * route serveur `POST /api/admin/discord-commands` (DISCORD_COMMAND_REGISTRATION_ENABLED, docs/SOIREE_ACTIVATION.md).
 * Procédure : docs/DISCORD_COMMANDES.md
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  EXPECTED_GUILD_ID,
  classify,
  explainFailure,
  normalizeCommand,
  prepareManifest,
  registerCommands,
  validateCommand,
  validateManifest,
} from "./discord-command-registration.mjs";

export { EXPECTED_GUILD_ID, classify, explainFailure, normalizeCommand, validateCommand, validateManifest };

const MODES = ["--check", "--execute"];

/** Charge et valide tout le manifeste. Lève une erreur (sans appel réseau) au moindre problème. */
export function loadManifestCommands(path = new URL("./discord-commands.json", import.meta.url)) {
  return prepareManifest(JSON.parse(readFileSync(path, "utf8")));
}

function describePlan(command) {
  const subs = (command.options ?? []).filter((o) => o.type === 1).map((o) => o.name);
  const permission = command.default_member_permissions ? `permission ${command.default_member_permissions}` : "tous les membres";
  if (command.type === 3) return `« ${command.name} » (commande de message, ${command.default_member_permissions ? `permission ${command.default_member_permissions}` : "tous les membres"})`;
  return `/${command.name}${subs.length ? ` [${subs.join(", ")}]` : ""} (${permission})`;
}

/**
 * Retourne le code de sortie. Tout est injectable pour les tests (fetch simulé).
 * @param {{ argv?: string[], env?: Record<string, string | undefined>, fetchImpl?: typeof fetch, log?: (m: string) => void, fail?: (m: string) => void, commands?: object[], sleep?: (ms: number) => Promise<void> }} [options]
 */
export async function run({ argv = [], env = {}, fetchImpl = fetch, log = console.log, fail = console.error, commands, sleep } = {}) {
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
    toRegister = commands ? prepareManifest(commands) : loadManifestCommands();
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

  // En local, pas de limite de durée de fonction : budget de 10 minutes pour absorber les limites de débit Discord.
  const result = await registerCommands({ mode: execute ? "execute" : "check", commands: toRegister, env, fetchImpl, budgetMs: 600_000, ...(sleep ? { sleep } : {}) });
  for (const entry of result.statuses) log(entry.status === "enregistrée" ? `/${entry.name} : enregistrée sur The Tower.` : `/${entry.name} : ${entry.status}`);
  const failure = result.failure;
  if (!failure) {
    if (!execute) log(`${result.outsideManifest} commande(s) du serveur hors manifeste : non touchées.`);
    return 0;
  }
  if (failure.stage === "config") {
    fail("Configuration absente/invalide : application Discord (DISCORD_CLIENT_ID), guild The Tower (TOWER_DISCORD_GUILD_ID), autorisation bot (DISCORD_BOT_TOKEN).");
  } else if (failure.stage === "network") {
    fail(`Échec de communication avec Discord : ${failure.errorName}.`);
  } else if (failure.stage === "rate_limit") {
    fail(`Limite de débit Discord (429) atteinte avant /${failure.command} : relancer dans ${failure.retryAfterSeconds} s ; les commandes déjà à jour seront sautées.`);
  } else {
    const detail = `HTTP ${failure.http}, code ${failure.code}.${failure.hint ? ` ${failure.hint}` : ""}`;
    fail(failure.stage === "read" ? `Discord refuse la lecture : ${detail}` : `Échec d'enregistrement de /${failure.command} : ${detail}`);
    if (failure.stage === "read") fail("Aucune écriture.");
  }
  return 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(await run({ argv: process.argv.slice(2), env: process.env }));
}
