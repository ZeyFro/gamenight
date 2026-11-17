# /joueurs — recherche de partenaires (v1)

Commandes : `chercher`, `annonces`, `mes-annonces`, `publier`, `retirer`.
Flags : `DISCORD_PLAYER_COMMAND_ENABLED`, `DISCORD_PLAYER_WRITE_ENABLED`
(fermés par défaut ; l'écriture est indépendante de la lecture).

## Un seul modèle

`PlayerClassified` — celui de la page `/joueurs`, avec les règles partagées
`playerClassifiedSchema` et `playerClassifiedExpiresAt` (24 h). Aucune table, aucun
stockage parallèle. Les annonces Discord apparaissent sur `/joueurs` et celles
publiées sur le site sont lisibles par `/joueurs annonces`.

Porte d'accès identique au site : `getPlayerClassifiedCommunityId` (membre actif +
`playerClassifiedsEnabled`), puis appartenance `ACTIVE` au serveur Discord.

## Limite de champs, assumée

Le modèle ne contient que `gameId` et `message` (240 caractères). Plateforme,
nombre de joueurs recherchés, niveau et disponibilités **n'ont pas de colonne** :
ils ne sont pas inventés et ne sont pas stockés. Le message libre peut les
contenir. Les ajouter demande une migration Prisma → accord explicite.

## Fichiers réservés #408

`src/lib/player-classifieds*.ts` et `src/app/joueurs/**` sont réservés : ce module
les **importe** sans les modifier. `publier`/`retirer` réimplémentent le minimum
d'écriture (schéma + expiration + propriété) parce qu'aucun service d'écriture
n'est exporté aujourd'hui. Quand #408 exposera `createPlayerClassified` /
`deletePlayerClassified`, ces deux fonctions devront les appeler : il ne doit
rester qu'une seule copie de la règle.

## Sécurité

- l'auteur est toujours l'utilisateur du contexte Discord (jamais une option) ;
- `retirer` refuse toute annonce dont `createdById` n'est pas l'appelant ;
- limite de 5 publications par fenêtre de rate-limit ;
- réponse privée, aucune mention, aucun identifiant Discord.
