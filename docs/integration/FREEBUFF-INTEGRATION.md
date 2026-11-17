# Intégration des travaux Freebuff — ensembles et dépendances (17/11)

Branche `agent/preflight-20261116`, dernier commit de référence `16b8610`.
Chaque ensemble est indépendant des autres, sauf mention contraire.

## Où récupérer le travail (source de vérité : GitHub)

| Objet | Référence distante |
| --- | --- |
| PR #444 (Draft) | `ZeyFro:agent/preflight-20261116`, base `main` |
| Branche d'intégration Discord complémentaire | `origin/integ/freebuff-discord-commands` (`3e35e74`) — **ne pas fusionner telle quelle** : elle porte un second handler `/equipe` (voir § Commandes communautaires) |
| Déclarations prêtes pour #416 | `docs/patches/20261117-declarations-discord-416.patch` — fournies, **non appliquées** |

Le SHA exact publié de la PR est celui de la description de #444 et de l'issue
#400 : ne jamais se fier à un SHA recopié dans une note. Pour récupérer :

```bash
git fetch origin agent/preflight-20261116
git switch -c agent/preflight-20261116 --track origin/agent/preflight-20261116
```

État vérifié le 17/11/2026 : `npx tsc --noEmit` sans erreur, tests Discord
ciblés verts (interactions, équipes, commandes communautaires, manifeste),
ESLint ciblé propre, `npx next build` réussi. Aucune CI de la PR n'est validée à
ce stade : le build local n'est pas une preuve de déploiement.

## 1. Navigation mobile et PWA — indépendant
Commits : `02764b2`, `9d80e8c`, `495a7a4`, `a7536fb`.
Fichiers : barre de navigation basse, layout applicatif, `public/manifest.json`,
service worker hors ligne (shell public), tests de navigation responsive.
Dépendances : aucune PR. Risque : conflits de layout avec les PR UI récentes ;
à intégrer seul, sans migration.

## 2. Commandes communautaires — dépend de #416 (déclarations)
Commits : `10f24e8` (`/aide`, `/profil`), `daa40f9` + `48c560c` (`/boost`),
`2c85bf9`, `41c22d9`, `56b691a`, `882f068` (`/role`), `88a6a7a`, `110e970`,
`4c9a3e3`, `1a24475` (soirée/tournoi/autocomplétion).
Dépendances : patch `docs/patches/20261117-declarations-discord-416.patch`
pour les déclarations ; #408 pour les annonces interactives.
Tests : `discord-community-commands.test.ts`,
`discord-community-registration.test.ts`, `discord-role-*`.

## 3. Recrutement et annonces — dépend de #408
Commits : `5112c30`, `ef02c58`, `f751f14`, `379b611`.
Fichiers : `discord-player-commands.ts`, `discord-player-listing-*`,
service d'écriture unique des annonces.
Dépendances : #408 fournit le service partagé et le routage ; ne pas réintroduire
un second chemin d'écriture.

## 4. Équipes et rôles — dépend de #370/#408/#416
Commits : `4bca857`, `171e779`, `9b6f136`, `2c1af19`, `086d1a0`, `02b89a8`,
`1eef966`, `76cf51c`.
Dépendances : `createdById`/`captainId` de #370 ; handler `/equipe` de
#408/#416 (voir `EQUIPES-416.md`) ; déclarations #416.
Point dur : ne pas fusionner `discord-team-command.ts` (singulier) et
`discord-team-commands.ts` (pluriel).

## 5. Espaces Discord et capitainerie — dépend de #370 et de la migration espace
Commits : `a642a95`, `8660d62`, `9eb8f81`, `773da73`, `76cf51c`, `ecf6d68`.
Fichiers : `discord-team-space*.ts`, `community-team-captain*.ts`,
`prisma/migrations/20261117120000_discord_team_space/` (migration intégrée à la
branche : la CI la joue sur un PostgreSQL jetable, jamais sur Neon).
Dépendances : migration `20261104140000_tower_team_membership_policy` (#370/
#408/#416) pour `captainId`, puis migration espace `20261117120000`.
La migration capitaine préparée est **annulée** (colonne déjà fournie).

## Ordre recommandé
1. PWA/navigation (sans dépendance).
2. #370 puis #408 fusionnés (services équipes/annonces).
3. #416 + patch de déclarations (commande par commande).
4. Équipes complètes via `EQUIPES-416.md`.
5. Migration espace sur guilde de test, puis activation progressive.

## Réservations
Vérifier l'issue #400 et le plafond de PR avant toute ouverture. Ici : aucun
merge, aucun force-push, aucune ressource Discord réelle, aucune migration
distante. Les patchs sont FOURNIS, pas appliqués aux branches propriétaires.
