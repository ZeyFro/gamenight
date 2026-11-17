# Activation progressive des commandes Discord

État au 17/11 (branche `agent/preflight-20261116`). **Aucune commande n'est
activée sur le serveur réel** : les flags sont fermés et les migrations ne sont
pas appliquées en Production.

| Commande | Code | JSON | Migration | PR | Testable en guilde test |
|---|---|---|---|---|---|
| `/role` (attribuer/chercher/creer/retirer + option racine) | complet | option racine à ajouter (#416) | non | — | oui, avec `DISCORD_ROLE_COMMAND_ENABLED=true` |
| `/equipe liste/moi/voir/creer/rejoindre/quitter/recrutement` | complet | existant | non | — | oui |
| `/equipe capitaine/membres/invitations` | complet | déclaration conditionnelle (voir EQUIPES-416) | non | — | oui |
| `/equipe exclure` | complet | déclaration conditionnelle (voir EQUIPES-416) | non | — | oui |
| `/equipe transferer` | codé, **fermé** | déclaration conditionnelle | après #370 (`captainId`) | #370/#408 | non : refuse sans source durable |
| `/equipe espace` (état) | complet | à ajouter (#416) | **oui** pour un espace géré | — | après migration test |
| `/equipe espace creer:true` | complet | à ajouter (#416) | **oui** | — | après migration test |
| Espaces automatiques (création/adhésion/départ/archivage) | complet | n/a | **oui** | — | après migration test |
| `/joueurs` (annonces/boutons) | complet | existant | non | — | oui |
| `/role nettoyer` (rôles obsolètes) | service de constat seulement | non | non | — | non (pas de commande) |

## Variables à ouvrir, dans cet ordre
1. `DISCORD_ROLE_COMMAND_ENABLED=true` (rôles de jeu, aucun salon).
2. `DISCORD_TEAM_COMMAND_ENABLED=true` puis `DISCORD_TEAM_WRITE_ENABLED=true`.
3. Migration `DiscordTeamSpace` seule
   (`docs/migrations/pending/20261117120000_discord_team_space/`). `captainId`
   est déjà fourni par `20261104140000_tower_team_membership_policy`
   (#370/#408/#416) : ne pas rejouer de migration capitaine.
4. `DISCORD_PLAYER_COMMAND_ENABLED=true` (+ `DISCORD_PLAYER_WRITE_ENABLED`).

## Ce qui reste bloqué
- Migration `DiscordTeamSpace` non appliquée : les espaces répondent
  `migration_required`.
- Invitations directes : modèle dédié absent (aucune interface fictive).
- Passation avec acceptation : modèle d'invitation absent.
- Déclaration JSON : patch consolidé vérifié sur #416 (`docs/patches/20261117-declarations-discord-416.patch`), à appliquer par son propriétaire.
- `/equipe transferer` : attend la fusion #370 (qui fournit `captainId` et son backfill) ; aucune écriture de `createdById`.
- Recette sur le vrai serveur : autorisation explicite (#400) requise.
