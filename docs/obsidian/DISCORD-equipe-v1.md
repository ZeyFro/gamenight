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
