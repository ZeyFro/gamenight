# /equipe v1 — lecture seule

Commande Discord `/equipe` livrée le 17/11/2026, **désactivée par défaut**
(`DISCORD_TEAM_COMMAND_ENABLED=false`).

## Portée

| Sous-commande | Contenu |
| --- | --- |
| `/equipe liste` | Les équipes de la communauté (nom, jeu, membres/max, recrutement, chef) |
| `/equipe moi` | Uniquement les équipes dont l'appelant est membre actif |
| `/equipe voir equipe:<nom>` | Détail : jeu, plateforme, description, chef, membres |

Tout est **privé** (réponse éphémère) et **en lecture seule**.

## Règles réutilisées, pas réinventées

- Données : `CommunityTeam` / `CommunityTeamMember` via `listCommunityTeams`
  (mêmes règles d'accès et même calcul de score que `/equipes` sur le site).
- Accès : communauté `ACTIVE` par `discordGuildId`, `Membership` `ACTIVE`,
  puis `Community.communityTeamsEnabled` — sinon « les équipes ne sont pas
  activées ». Serveur inconnu et non-membre donnent la même réponse.
- Identité : `discordId` de l'interaction → `User.id` en base. Aucun identifiant
  fourni par l'utilisateur n'est utilisé comme preuve d'appartenance.

## Ce que la commande ne fait pas

- Aucune écriture : ni `createCommunityTeam`, ni `joinCommunityTeam`, ni
  `leaveCommunityTeam`, ni `setCommunityTeamRecruitment` (vérifié par test).
- Aucun salon, aucun rôle, aucune permission Discord.
- Aucune donnée privée : ni identifiant Discord, ni e-mail, ni jeton. La
  description est tronquée à 400 caractères, la liste à 12 équipes et 15 membres.

## Objectif final, non simulé

Création automatique d'équipes, de salons et de rôles : toujours visée, mais
**rien dans cette v1 ne la simule**. `/aide` l'annonce en préparation et
`/equipe liste` le rappelle quand la communauté n'a encore aucune équipe.
La création réelle dépend de #370/#408 (règles et espaces d'équipe).

## Vérifications

`distribute-commands` : `/equipe` déclarée avec trois sous-commandes, routée vers
un handler différé (`after(runTeams)`), interrupteur documenté dans `.env.example`.
Tests : `src/lib/discord-team-commands.test.ts` (13 cas) +
`src/lib/discord-community-registration.test.ts` (garde de déclaration).

## Correctif capitainerie (17/11/2026)

« Capitaine » n'est plus déduit de l'ordre des membres. Source unique :
`CommunityTeam.createdById` (le créateur, déjà « Responsable » sur `/equipes`),
et seulement s'il est encore membre actif — sinon « Capitaine non renseigné ».

- Règle partagée : `src/lib/community-team-captain.ts` (utilisée par
  `/equipe liste|moi|voir` et par `/profil`).
- `moi` compare désormais `captainId === userId` (avant : premier membre).
- Détail : `docs/DECISIONS_CAPITAINERIE_20261117.md`.

**À corriger dans #370/#408** (fichier réservé, non modifié ici) :
`src/app/equipes/page.tsx` promeut encore le premier membre actif quand le
créateur a quitté. Remplacer ce repli par `resolveTeamCaptain` et afficher
« Capitaine non renseigné ».

## Adhésions depuis Discord

`/equipe rejoindre equipe:<nom>` et `/equipe quitter equipe:<nom>` délèguent à
`joinCommunityTeam` / `leaveCommunityTeam` : une seule logique métier, aucune
règle recopiée. Interrupteur séparé `DISCORD_TEAM_WRITE_ENABLED` (fermé par
défaut). Le capitaine ne peut pas quitter son équipe : la passation reste en
préparation. Aucune création d'équipe, de salon ou de rôle.

## `/equipe creer` et `/equipe recrutement` (17/11/2026)

- `/equipe creer jeu:<nom> nom:<…> objectif:<…> plateforme:<…> [places:2-20]`
  délègue à `createCommunityTeam` : quota 3/24 h, validation du jeu et
  capitainerie (`createdById`) restent dans le service. Le jeu est résolu avec
  les règles du sélecteur du site (`uniqueTeamGameOptions`,
  `filterTeamGameOptions`) ; une correspondance ambiguë n'est jamais tranchée.
- `/equipe recrutement equipe:<nom> ouvert:<true|false>` : seul le capitaine
  (règle partagée) peut agir, puis `setCommunityTeamRecruitment` fait l'écriture.
- Les deux restent derrière `DISCORD_TEAM_WRITE_ENABLED`, fermé par défaut.
- Aucune ressource Discord créée, aucune permission accordée, aucune migration.

## Espaces et capitaine (17/11)

- `creer` provisionne l'espace Discord si `DISCORD_TEAM_SPACES_ENABLED=true` ;
  message honnête selon `describeSpaceOutcome` (jamais de création inventée).
- `rejoindre` / `quitter` synchronisent le rôle d'espace de la seule équipe
  concernée ; le départ ne touche ni XP ni étages (aucune écriture XP).
- `recrutement` reste réservé au capitaine officiel.
- Passation : service `transferTeamCaptain` prêt, **pas encore exposé** en
  sous-commande (JSON de commandes réservé #416). En attendant, `/equipe voir`
  affiche le capitaine ou « Capitaine non renseigné ».

## Nouvelles sous-commandes (17/11)

| Commande | Droit | Effet |
|---|---|---|
| `/equipe capitaine` | tous | affiche le capitaine officiel ou « non renseigné » |
| `/equipe membres` | tous | liste les membres, 👑 sur le capitaine |
| `/equipe transferer membre:<nom>` | capitaine actuel | passation explicite vers un membre actif |
| `/equipe exclure membre:<nom>` | capitaine actuel | retire l'adhésion + l'accès Discord ; XP/étages conservés |
| `/equipe espace [creer:true]` | lecture tous / création capitaine | état de l'association, création contrôlée |
| `/equipe invitations` | tous | état du recrutement ; **aucune invitation directe inventée** |
| `/equipe recrutement ouvert:<bool>` | capitaine actuel | existant, inchangé |

- Le membre est résolu par nom Discord exact ou mention (identifiant) ; un
  homonyme exige une précision.
- Un membre ordinaire ne peut ni exclure, ni transférer, ni ouvrir le recrutement,
  ni créer l'espace : refus explicite, sans écriture.
- **Coexistence `createdById` / `captainId`** : ce dépôt n'a pas encore de champ
  `captainId` (PR #370/#408). Toute la capitainerie lit `createdById` via
  `community-team-captain` ; quand #370 introduira `captainId`, le résolveur
  devra le préférer **uniquement** s'il désigne un membre actif, sans remplacer
  silencieusement le créateur historique. Aucun code parallèle n'est créé ici.
- Déclaration JSON des nouvelles sous-commandes : voir
  `docs/patches/20261117-equipe-nouvelles-sous-commandes.md` (fichier #416).

## Correction capitainerie (17/11)

- `createdById` = créateur historique, **jamais réécrit** (l'ancien transfert le
  remplaçait : corrigé).
- `captainId` = capitaine responsable, lu via `community-team-captain-store`.
- Sans colonne `captainId` : capitaine effectif = créateur actif (transition),
  et `transferTeamCaptain` renvoie `captain_source_unavailable` ; `/equipe
  transferer` explique que la passation n'est pas encore disponible.
- Si `captainId` désigne un non-membre : **aucun** capitaine, pas de repli
  silencieux sur le créateur.
- Migration isolée : `docs/migrations/pending/20261117_team_captain/`.
- Recette SQL réelle : voir `DISCORD-recette-postgres.md`.

## Migration capitaine : annulée (17/11)

La colonne `captainId` est déjà créée et backfillée par
`20261104140000_tower_team_membership_policy` dans #370/#408/#416. Le SQL
`20261117_team_captain` préparé localement est donc retiré. La seule migration
en attente est `20261117120000_discord_team_space`, à ordonner après
`20261106150000_tower_launch_channels_appeals_matchmaking`.
