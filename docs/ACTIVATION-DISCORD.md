# Activation progressive des commandes Discord

Extraction de #444 vers `main` (branche `claude/extraction-freebuff-discord`). **Aucune commande n'est
activée sur le serveur réel** : les flags sont fermés et rien n'est enregistré auprès de Discord
(l'enregistrement reste soumis à accord explicite, #400).

| Commande | Code | Déclaration JSON | Migration | Flag |
|---|---|---|---|---|
| `/role` (chercher/attribuer/creer/retirer) | complet | oui | non | `DISCORD_ROLE_COMMAND_ENABLED` |
| `/aide` | complet | oui | non | aucun (toujours disponible) |
| `/profil` | complet | oui | non | `DISCORD_PROFILE_COMMAND_ENABLED` |
| `/boost` | complet | oui | non | `DISCORD_BOOSTER_ENABLED` |
| `/soiree` | complet | oui | non | `DISCORD_SESSION_COMMAND_ENABLED` + `DISCORD_SESSION_WRITE_ENABLED` |
| `/tournoi` | complet | oui | non | `DISCORD_TOURNAMENT_COMMAND_ENABLED` + `DISCORD_TOURNAMENT_WRITE_ENABLED` |
| `/joueurs` (annonces/boutons) | complet | oui | non | `DISCORD_PLAYER_COMMAND_ENABLED` + `DISCORD_PLAYER_WRITE_ENABLED` |
| `/equipe` liste/moi/rejoindre | déjà dans `main` (`discord-team-command.ts`, option `equipe_id`) | oui | non | communauté (`communityTeamsEnabled`) |

## Reste à réintégrer plus tard
- `/equipe` : sous-commandes `voir`, `quitter`, `creer`, `recrutement` et option `equipe` de #444, à porter
  dans `discord-team-command.ts` sans changer le contrat actuel.
- `/projet` (façade sur les équipes) et les espaces Discord d'équipe (`DiscordTeamSpace`, migration dédiée) :
  dépendent de la seconde implémentation de `/equipe`, volontairement écartée.
