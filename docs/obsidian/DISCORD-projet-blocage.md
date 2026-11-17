# /projet — état et premier incrément possible

Demande : permettre à un joueur d'organiser une aventure multigaming ou de
recruter des partenaires depuis Discord.

## Ce qui existe (vérifié dans le schéma)

- `CommunityTeam` / `CommunityTeamMember` : nom, jeu, description (1000),
  plateforme, `maxMembers`, `isRecruiting`, capitaine (`createdById`, passation
  en cours dans #370). C'est **déjà** le service d'équipes/aventures, exposé par
  `/equipe` (création, adhésion, recrutement) sur cette branche.
- `PlayerClassified` : annonces de joueurs (recherche de partenaires), mais
  `src/lib/player-classifieds*.ts` et `src/app/joueurs/**` sont **réservés par
  #408**.
- **Aucun modèle `Project`/`Projet`** : rien pour une aventure multigaming
  distincte d'une équipe.

## Décision

Aucun incrément `/projet` n'est codé ici, parce que les deux seules options
seraient des implémentations parallèles :

1. Dupliquer `/equipe` sous un autre nom → interdit (« n'accumule pas des
   implémentations parallèles »).
2. Écrire dans `PlayerClassified` → fichier réservé par #408.

## Premier incrément réel, dès déblocage

- **Option A (recommandée, sans migration)** : `/projet` = alias explicite de la
  gestion d'équipe existante, avec les options `plateforme` et `recrutement`
  mises en avant, **une fois #370 fusionnée** (passation, 2–8 joueurs, équipe
  unique). Aucun nouveau modèle, aucune duplication : le handler appellerait
  `createCommunityTeam` / `setCommunityTeamRecruitment`, comme `/equipe`.
- **Option B (migration)** : vrai modèle `Project` (titre, description courte,
  multigaming, joueurs recherchés, visibilité) + service dédié. Nécessite une
  migration Prisma → autorisation explicite requise.
- **Option C (partenaires)** : `/projet` adossé aux annonces `PlayerClassified`,
  à coordonner avec #408 (lecture seule possible dès que leurs fichiers sont
  fusionnés).

## Ce qui est déjà livré pour « recruter »

`/equipe creer` (jeu, nom, objectif, plateforme, places) et
`/equipe recrutement` couvrent aujourd'hui le recrutement d'une aventure autour
d'un jeu, avec la capitainerie officielle. `/projet` doit apporter le
multigaming, pas un second système d'équipes.
