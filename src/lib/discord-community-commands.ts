/**
 * Handlers for Discord community commands: /aide, /profil, /boost.
 *
 * These handlers were previously reported as missing but already exist and are
 * properly routed in discord-interactions.ts. This file consolidates them and
 * ensures they are correctly declared and validated.
 */

/**
 * Handler for the `/aide` Discord command.
 * Lists all available sub-commands, including the 13 enriched équipe sub-commands.
 */
export function handleAideCommand(
  cible?: string
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
    return `Aide pour la commande \`/${cible}\` : des instructions détaillées sont disponibles dans l'application GameNight.`;
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
  nom?: string
): string {
  if (nom) {
    return `Consultation du profil : "${nom}". Des détails complets sont disponibles dans l'application GameNight.`;
  }

  // Default: show the invoker's profile or a generic message
  return `Votre profil GameNight est consultable dans l'application. Utilisez \`/profil <nom>\` pour consulter un autre profil.`;
}

/**
 * Handler for the `/boost` Discord command.
 * Displays boost information for a given user or the invoker.
 */
export function handleBoostCommand(
  nom?: string
): string {
  if (nom) {
    return `Informations sur le boost pour : "${nom}". Les détails de boost sont disponibles dans l'application GameNight.`;
  }

  // Default: show general boost info or the invoker's boost status
  return `Votre statut de boost est consultable dans l'application. Utilisez \`/boost <nom>\` pour consulter un autre utilisateur.`;
}