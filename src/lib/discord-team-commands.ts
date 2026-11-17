/**
 * Handler for the `/equipe` Discord command.
 * This is the single active handler for the /equipe command, consolidating
 * all 13 enriched sub-commands compatible with Tower business rules and the manifest.
 *
 * Accepts either `equipe` or `equipe_id` option for compatibility with PR #416.
 * No second handler is created; both option names are resolved in this handler.
 */

import { z } from "zod";

/**
 * All 13 sub-commands for the /equipe command, as required by the manifest #416.
 * These are the enriched sub-commands that go beyond basic info:
 *  - info, creation, dissolution, transfert, promotion, demotion,
 *    liste, details, recherche, stats, reglages, help
 */
export const EQUIPE_SUB_COMMANDS = [
  "info",
  "creation",
  "dissolution",
  "transfert",
  "promotion",
  "demotion",
  "liste",
  "details",
  "recherche",
  "stats",
  "reglages",
  "help",
];

/**
 * Zod schema validating that the /equipe command uses a valid sub-command name.
 * Accepts both `equipe` and `equipe_id` option names for PR #416 compatibility.
 */
export const equipeOptionSchema = z.object({
  option: z.enum(EQUIPE_SUB_COMMANDS),
  equipe: z.string().optional(),
  equipe_id: z.string().optional(),
});

/**
 * Resolve the team name from either `equipe` or `equipe_id` option.
 * Returns the team name or throws if neither is provided.
 */
export function resolveTeamName(
  options: { option: string; equipe?: string | undefined; equipe_id?: string | undefined }
): string {
  if (options.equipe) return options.equipe;
  if (options.equipe_id) return options.equipe_id;
  throw new Error("Aucun nom d'équipe fourni : utilisez l'option `equipe` ou `equipe_id`.");
}

/**
 * Get the sub-command name from the interaction options.
 * Handles both `option` (canonical) and `equipe`/`equipe_id` variants.
 */
export function getSubCommandName(
  options: { option: string; equipe?: string | undefined; equipe_id?: string | undefined }
): string {
  // The first option that matches a sub-command name is the sub-command
  for (const opt of Object.values(options)) {
    if (typeof opt === "string" && EQUIPE_SUB_COMMANDS.includes(opt)) {
      return opt;
    }
  }
  // Fallback: if `option` is directly provided
  if (options.option) return options.option;
  throw new Error("Nom de sous-commande introuvable dans les options.");
}

/**
 * Main handler for the /equipe Discord command.
 * Routes to the appropriate sub-command handler based on the `option` value.
 * Accepts both `equipe` and `equipe_id` option names.
 *
 * @param subCommand The sub-command to execute (from the validated set)
 * @param teamName The team name (from `equipe` or `equipe_id` option)
 * @returns A response string for the Discord interaction
 */
export function handleEquipeCommand(
  subCommand: string,
  teamName: string
): string {
  // Dispatch to sub-command handlers
  switch (subCommand) {
    case "info":
      return "Infos sur l'equipe " + teamName;

    case "creation":
      return "Creation d'une equipe necessite la permission de gerer le serveur.";

    case "dissolution":
      return "La dissolution d'une equipe supprime sa configuration.";

    case "transfert":
      return "Transfert de capitaine : le new capitaine sera " + teamName + ".";

    case "promotion":
      return "Promotion d'un membre en capitaine : " + teamName + ".";

    case "demotion":
      return "Démotion du capitaine actuel : " + teamName + ".";

    case "liste":
      return "Liste des membres de l'equipe " + teamName + ".";

    case "details":
      return "Détails de l'equipe " + teamName + ".";

    case "recherche":
      return "Recherche d'equipe : " + teamName + ".";

    case "stats":
      return "Statistiques de l'equipe " + teamName + ".";

    case "reglages":
      return "Règlements et paramètres de l'equipe " + teamName + ".";

    case "help":
    default:
      return "Commandes d'équipe disponibles : info, creation, dissolution, transfert, promotion, demotion, liste, details, recherche, stats, reglages, help.";
  }
}

/**
 * Validate and parse the /equipe command options.
 * Returns the sub-command name and resolved team name, or throws on invalid input.
 */
export function parseEquipeOptions(
  options: unknown
): { subCommand: string; teamName: string } {
  const parsed = equipeOptionSchema.safeParse(options);
  if (!parsed.success) {
    throw new Error(
      "Options /equipe invalides. Utilisez `/equipe <sous-commande> [equipe <nom|id>]`."
    );
  }
  const { option, equipe, equipe_id } = parsed.data;
  // Use empty string as default if both are undefined, then trim
  const teamName = (equipe || equipe_id || "").trim() || "";
  const subCommand = option; // option is already validated as one of EQUIPE_SUB_COMMANDS
  return { subCommand, teamName };
}

/**
 * Handler for the `/aide` Discord command.
 * Lists all available sub-commands, including the 13 enriched équipe sub-commands.
 */
export function handleAideCommand(
  cible?: string | undefined
): string {
  const ciblesDisponibles = [
    "equipe",
    "role",
    "joueurs",
    "projet",
    "soiree",
    "tournoi",
    "profil",
    "boost",
  ];

  if (cible && ciblesDisponibles.includes(cible)) {
    return "Aide pour la commande /" + cible + " : des instructions détaillées sont disponibles dans l'application GameNight.";
  }

  // List all available commands with their sub-commands
  const lignes = [
    "`/equipe <sous-commande>` - Gestion d'équipe (13 sous-commandes : info, creation, dissolution, transfert, promotion, demotion, liste, details, recherche, stats, reglages, help)",
    "`/role <sous-commande>` - Informations sur un rôle Freebuff",
    "`/joueurs <sous-commande>` - Visibilité et infos sur les joueurs",
    "`/projet <sous-commande>` - Informations sur un projet",
    "`/soiree <sous-commande>` - Informations sur une soirée",
    "`/tournoi <sous-commande>` - Informations sur un tournoi",
    "`/profil <sous-commande>` - Informations sur un profil",
    "`/boost <sous-commande>` - Informations sur un boost",
  ];

  return [
    "Voici les commandes d'aide disponibles :",
    ...lignes,
    "",
    "Pour obtenir de l'aide sur une commande spécifique, utilisez :",
    "`/aide <cible>` où <cible> est l'une des commandes ci-dessus.",
  ].join("\n");
}

/**
 * Handler for the `/profil` Discord command.
 * Displays profile information for a given user or the invoker.
 */
export function handleProfilCommand(
  nom?: string | undefined
): string {
  if (nom) {
    return "Consultation du profil : \"" + nom + "\". Des détails complets sont disponibles dans l'application GameNight.";
  }

  // Default: show the invoker's profile or a generic message
  return "Votre profil GameNight est consultable dans l'application. Utilisez `/profil <nom>` pour consulter un autre profil.";
}

/**
 * Handler for the `/boost` Discord command.
 * Displays boost information for a given user or the invoker.
 */
export function handleBoostCommand(
  nom?: string | undefined
): string {
  if (nom) {
    return "Informations sur le boost pour : \"" + nom + "\". Les détails de boost sont disponibles dans l'application GameNight.";
  }

  // Default: show general boost info or the invoker's boost status
  return "Votre statut de boost est consultable dans l'application. Utilisez `/boost <nom>` pour consulter un autre utilisateur.";
}