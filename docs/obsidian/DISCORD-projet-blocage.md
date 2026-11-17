# /projet — état, décision et limites

Demande d'origine : permettre à un joueur d'organiser une aventure multigaming ou
de recruter des partenaires depuis Discord.

## Décision (17/11/2026, sprint)

`/projet` est livré comme **façade sur les équipes existantes** (`CommunityTeam` /
`CommunityTeamMember`) : `creer`, `liste`, `voir`, `rejoindre`, `quitter`,
`recrutement` appellent `createCommunityTeam`, `joinCommunityTeam`,
`leaveCommunityTeam`, `setCommunityTeamRecruitment` — exactement les services de
`/equipe` et de la page `/equipes`.

Conséquences tenues :

- un projet créé sur Discord apparaît dans `/equipes` et inversement ;
- une seule règle de capacité (2–20), de recrutement, de quota (3 créations/24 h),
  d'équipe unique par joueur et de capitainerie (`createdById`) ;
- aucun modèle Prisma, aucune migration, aucune duplication de stockage ;
- `/projet` n'ajoute qu'un vocabulaire (`objectif`, affichage « qui recrute ») ;
- aucune création de salon, de rôle ou de permission Discord.

Code : `src/lib/discord-project-commands.ts`, flags `DISCORD_PROJECT_COMMAND_ENABLED`
et `DISCORD_PROJECT_WRITE_ENABLED` (fermés par défaut).

## Ce qui reste bloqué

- **Vrai modèle `Project`** (multigaming, plusieurs jeux par projet, joueurs
  recherchés, visibilité) : nécessite une migration Prisma → accord explicite.
- **Annonces de partenaires** (`PlayerClassified`) : fichiers réservés par #408
  (voir `DISCORD-joueurs-v1.md`).
- **Salon Discord par projet** : dépend des quotas et de la PR salons ; non ouvert.

## Premier incrément suivant, sans migration

Une fois #370 fusionnée : équipe unique par joueur confirmée et passation de
capitaine exposée côté Discord (`/projet transfert`), puis rattachement de
plusieurs jeux par projet seulement si un champ dédié est approuvé.
