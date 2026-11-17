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
