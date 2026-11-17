# Espaces Discord des équipes et projets — planificateur vérifié

Code : `src/lib/discord-team-spaces.ts` · flag `DISCORD_TEAM_SPACES_ENABLED`
(fermé par défaut) · **aucune ressource réelle créée sur The Tower**.

## Correctif du 17/11 — l'archivage cible le bon salon

L'archivage utilisait la clé de l'espace (`gn-team-<id>`) comme identifiant de
salon. C'était une confusion entre identifiant d'équipe et identifiant Discord.

Désormais :

- un identifiant de salon n'est **résolu** que par le lien persisté
  (`managedSpaces: [{ teamId, channelId, roleId? }]`) ou par un salon dont le nom
  est le nom **exact** dérivé de l'équipe (`<slug>-<teamId>`, donc unique) ;
- l'archivage n'est planifié que si cet identifiant est connu et présent dans le
  serveur ; sinon le plan est refusé (`unmanaged`) — **aucune action** ;
- une ressemblance de nom, un salon historique ou un salon d'une autre équipe ne
  sont jamais ciblés ;
- aucune suppression : uniquement un renommage `archive-…` (ou `restore-…` pour
  revenir) ;
- `applyTeamSpacePlan` refuse toute étape `archive`/`restore` sans `targetId`.

## Capitaine et membres

- Capitaine = `createdById` s'il est membre actif (`teamCaptainId`), **jamais** le
  premier de la liste. Sans capitaine valide, le plan n'en invente pas.
- `previousMemberDiscordIds` sert à calculer les **départs** ; ce sont les seules
  permissions à retirer, dans le seul salon de cette équipe.
- Réactivation : `previousArchived` + lien vérifié → étape `restore` (renommage
  vers le nom actuel), pas de nouvelle ressource.

## Reste bloqué (identique et assumé)

Persistance de `channelId`/`roleId` (migration Prisma) → sans elle, les liens
doivent être fournis par l'appelant, et aucun retrait de permission automatique
n'est planifié en production. Le code ne simule aucun stockage.

## Service de gestion réelle (17/11, sprint automatisation)

`src/lib/discord-team-space-service.ts` raccorde le planificateur à une API
Discord injectable (`discord-team-space-api.ts` → `discord-rest`) et à une
association persistée `DiscordTeamSpace`.

| Opération | Fonction | Effet réel |
|---|---|---|
| Création d'équipe | `provisionTeamSpace` | rôle privé + salon privé + rôles des membres, lien persisté |
| Rejeu | `provisionTeamSpace` | `reused` : aucune création (lien trouvé) |
| Adhésion | `syncTeamSpaceMember(join)` | ajout du seul rôle de cette équipe |
| Départ | `syncTeamSpaceMember(leave)` | retrait du rôle ; XP et étages non touchés |
| Inactivité | `archiveInactiveTeamSpace` | renommage `archive-…` du salon lié uniquement |
| Réactivation | `reactivateTeamSpace` | renommage retour, même salon vérifié |

- Quota par communauté (5 espaces), `teamId`/`channelId` uniques en base.
- Aucune fonction de suppression de salon ou de rôle n'existe dans le service.
- `/equipe creer|rejoindre|quitter` ajoutent une ligne **seulement** si le flag
  est ouvert, et cette ligne reflète le statut réel (`créés`, `non créé :
  quota`, `partiellement créé`, `association non migrée`…).
- **Prérequis d'activation** : appliquer
  `docs/migrations/pending/20261117_discord_team_space/migration.sql` sur la base
  cible, puis `DISCORD_TEAM_SPACES_ENABLED=true`. Sans table, le service répond
  `migration_required` ; sans flag, aucune écriture Discord.

## Captain (service)

`src/lib/community-team-captain-service.ts` : `getTeamCaptain`, `canManageTeam`,
`transferTeamCaptain` (capitaine actuel → membre actif, conditionnel et
idempotent). Une passation **avec acceptation** du destinataire exige un modèle
d'invitation (migration) : elle n'est pas simulée. Aucun premier membre promu.
