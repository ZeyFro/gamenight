# Activation progressive des commandes Discord

État au 17/11 (branche `agent/preflight-20261116`). **Aucune commande n'est
activée sur le serveur réel** : les flags sont fermés et les migrations ne sont
pas appliquées en Production.

| Commande | Code | JSON | Migration | PR | Testable en guilde test |
|---|---|---|---|---|---|
| `/role` (attribuer/chercher/creer/retirer + option racine) | complet | option racine à ajouter (#416) | non | — | oui, avec `DISCORD_ROLE_COMMAND_ENABLED=true` |
| `/equipe liste/moi/voir/creer/rejoindre/quitter/recrutement` | complet | existant | non | — | oui |
| `/equipe capitaine/membres/invitations` | complet | à ajouter (#416) | non | — | oui |
| `/equipe transferer/exclure` | complet | à ajouter (#416) | non | — | oui |
| `/equipe espace` (état) | complet | à ajouter (#416) | **oui** pour un espace géré | — | après migration test |
| `/equipe espace creer:true` | complet | à ajouter (#416) | **oui** | — | après migration test |
| Espaces automatiques (création/adhésion/départ/archivage) | complet | n/a | **oui** | — | après migration test |
| `/joueurs` (annonces/boutons) | complet | existant | non | — | oui |
| `/role nettoyer` (rôles obsolètes) | service de constat seulement | non | non | — | non (pas de commande) |

## Variables à ouvrir, dans cet ordre
1. `DISCORD_ROLE_COMMAND_ENABLED=true` (rôles de jeu, aucun salon).
2. `DISCORD_TEAM_COMMAND_ENABLED=true` puis `DISCORD_TEAM_WRITE_ENABLED=true`.
3. Migration `DiscordTeamSpace` sur la base cible (jamais Neon sans accord),
   puis `DISCORD_TEAM_SPACES_ENABLED=true`.
4. `DISCORD_PLAYER_COMMAND_ENABLED=true` (+ `DISCORD_PLAYER_WRITE_ENABLED`).

## Ce qui reste bloqué
- Migration `DiscordTeamSpace` non appliquée : les espaces répondent
  `migration_required`.
- Invitations directes : modèle dédié absent (aucune interface fictive).
- Passation avec acceptation : modèle d'invitation absent.
- Déclaration JSON : fichier `scripts/discord-commands.json` réservé #416.
- Recette sur le vrai serveur : autorisation explicite (#400) requise.
