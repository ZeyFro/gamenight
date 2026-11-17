# Décision — capitainerie d'équipe (17/11/2026)

Correctif du constat de recette : « capitaine » ne doit pas être déduit du
premier membre retourné, du premier affiché, de l'ancienneté, de l'ordre des
adhésions, ni d'un tri.

## Source qui fait autorité aujourd'hui

Vérifié dans `prisma/schema.prisma` : **il n'existe aucun champ ni rôle
« capitaine »** sur `CommunityTeam` ni sur `CommunityTeamMember`. Le seul
attribut de responsabilité est :

- `CommunityTeam.createdById` — le créateur de l'équipe, déjà affiché
  « Responsable » sur `/equipes` ;
- `leaveCommunityTeam` refuse déjà de faire quitter le créateur (code `leader`),
  ce qui confirme cette sémantique côté service.

Règle appliquée partout : **capitaine = `createdById`, à condition qu'il soit
encore membre actif de l'équipe.** Sinon : « Capitaine non renseigné », et
personne n'est promu à sa place.

Module unique : `src/lib/community-team-captain.ts`
(`resolveTeamCaptain`, `isTeamCaptain`, `teamCaptainId`,
`CAPTAIN_UNSET_LABEL`). Aucune permission, aucun droit de gestion n'en découle.

## Surfaces corrigées

| Surface | Avant | Après |
| --- | --- | --- |
| `/equipe liste` | « chef : » lu sur `createdBy` sans vérifier l'adhésion | « capitaine : » via la règle partagée |
| `/equipe moi` | `memberIds[0] === userId` (premier membre = capitaine) | `captainId === userId` |
| `/equipe voir` | « Chef d'équipe : » | « Capitaine : » ou « Capitaine non renseigné » |
| `/profil` Discord | `createdById === user.id` recopié | `isTeamCaptain(...)` |

## Nouvelle livraison liée (même logique métier)

`/equipe rejoindre` et `/equipe quitter` délèguent à `joinCommunityTeam` /
`leaveCommunityTeam` : recrutement, capacité, refus du capitaine et évolution
des règles (#370/#408) restent dans le service, jamais dupliqués dans le bot.
Interrupteur séparé `DISCORD_TEAM_WRITE_ENABLED`, fermé par défaut, et aucune
création d'équipe/salon/rôle.

## Limite connue, non corrigée ici

`src/app/equipes/page.tsx` (ligne concernant le repli sur le premier membre
actif) appartient aux PR **#370** et **#408** : il n'est pas modifié pour ne pas
écraser leur travail. La correction attendue y est : remplacer le repli par
`resolveTeamCaptain` et afficher « Capitaine non renseigné » quand
`createdById` n'est plus membre actif. Les PR apportent déjà la passation de
capitaine (`community-team-handover`) qui doit, à terme, rendre ce cas rare.

## Preuves

- `src/lib/community-team-captain.test.ts` (10 cas) : capitaine en dernière ou
  troisième position, réordonnancement des membres, capitaine non renseigné,
  membre ordinaire jamais capitaine, absence de permission dérivée, gardes
  anti-`members[0]` / anti-tri / anti-ancienneté, cohérence Discord ↔ GameNight.
- `src/lib/discord-team-commands.test.ts` : capitaine en dernière position,
  « Capitaine non renseigné » quand le créateur est parti, `moi` qui ne promeut
  jamais un membre ordinaire, adhésions déléguées au service, refus du capitaine
  lors d'un `quitter`.
- `src/lib/discord-community-commands.test.ts` : `/profil` capture la
  capitainerie via la règle partagée.

## Suite — gestion d'équipe depuis Discord

`/equipe creer` et `/equipe recrutement` réutilisent `createCommunityTeam` et
`setCommunityTeamRecruitment`. Le droit de gérer le recrutement est vérifié par
`teamCaptainId` **avant** l'appel au service : un membre ordinaire ne peut donc
jamais agir, même si le service réservé (#370/#408) conserve encore son repli
positionnel — repli supprimé par le patch `docs/patches/20261117-equipes-capitaine.md`.
