# Podium de la dernière saison Tower

Première tranche indépendante de P4-02 : `/tower/palmares`, accessible depuis l'onglet « Palmarès Tower » du profil. Lecture seule, sans migration ni activation de configuration.

Le podium concerne la dernière saison terminée, selon le calendrier Europe/Paris validé dans `TOWER_DECISIONS_26_20261104.md`. Pendant une intersaison, elle reste affichée ; une saison en cours n'est jamais présentée comme terminée. L'été est une saison à part entière.

Seules les récompenses effectivement créditées comptent : `rewardedAt` du défi solo approuvé, ou `rewardedAt` individuel du participant d'équipe approuvée. L'auteur d'un défi d'équipe n'obtient pas un crédit supplémentaire. Le barème est celui conservé dans la tentative, indépendamment des modifications du catalogue. Départage : étages gagnés, nombre de défis à trois étages, heure d'arrivée au total final, puis identifiant interne pour stabiliser une égalité exacte.

L'accès exige une session, une communauté sélectionnée, son adhésion active et une communauté active avec les défis Tower activés, même lorsque l'isolation est OFF. Le flag global `TOWER_CHALLENGES_ENABLED` reste requis. Le podium affiche seulement les membres encore actifs de ce serveur et ne publie ni identifiants Discord ni preuves privées.

Ce podium est calculé à la lecture : ce n'est pas une archive immuable ni une attribution de titre, badge ou droit du gagnant. Un départ de communauté retire le joueur de cet affichage. Les distinctions persistantes, le Hall of Fame historique et le droit du premier à proposer un défi restent à traiter dans la suite de P4-02, avec leur schéma et règles dédiés. Aucun rôle ni permission Discord n'est attribué.

## Co-lauréats et progression personnelle (décisions du propriétaire du 9 novembre 2026, issue #400)

- **Co-lauréats (Q7).** Le départage reste : étages remportés, puis défis à 3 étages, puis heure d'arrivée au total. Des joueurs strictement égaux sur ces trois critères partagent la même place et sont affichés « ex æquo » ; l'identifiant ne sert plus qu'à un ordre d'affichage stable. Les places suivent l'ordre du classement (deux premiers ex æquo, puis une 3e place) et aucun ex æquo d'une place du podium n'est écarté : le podium peut donc afficher plus de trois joueurs (`src/lib/tower-standings.ts`, `groupCoWinners`).
- **Progression personnelle (Q1, Q2).** La page affiche « Ta progression » : étages gagnés avec les défis (`TowerChallengeProgress.floorsClimbed`, jamais l'XP), nombre de saisons terminées et rang (`src/lib/tower-ranks.ts` : Irregular, Ranker à 30 étages gagnés, High Ranker à 100 étages gagnés et au moins une saison terminée). Une saison est terminée pour un joueur quand sa date de fin est passée et qu'au moins un étage lui a été crédité pendant cette saison ; un crédit appartient à la saison de son `rewardedAt`, un crédit d'intersaison à aucune (`src/lib/tower-personal-progress-rules.ts`).
- **Fiche d'un pote.** `/potes/[id]` affiche le rang Tower du membre dans la communauté active du lecteur (`src/lib/tower-personal-progress.ts`). Les deux doivent y être membres actifs ; aucune requête n'est faite tant que `TOWER_CHALLENGES_ENABLED` est éteint. Le rang est cosmétique : aucun rôle Discord, aucune permission.
- **Limites.** Tout reste calculé à la lecture, sans migration : ni palmarès publié et validé par un administrateur, ni titre ou badge de champion, ni historique figé (décisions Q4, Q5 et Q8, qui exigent une persistance). La page `/tower` affiche encore l'ascension issue de l'XP. Les teintes de la pastille pour Irregular (bleu) et High Ranker (or) sont provisoires : seule la valeur du violet du Ranker est décidée.

Tests ajoutés : `src/lib/tower-personal-progress-rules.test.ts`, `src/lib/tower-personal-progress.test.ts`, `src/lib/tower-personal-progress.integration.test.ts`, `src/lib/tower-season-podium.bounds.integration.test.ts`, `src/components/TowerRankBadge.test.tsx`, `src/app/potes/[id]/tower-rank.test.tsx`.

## Validation locale

Sur un PostgreSQL jetable lié à `127.0.0.1`, déjà migré selon `CLAUDE.md` :

```sh
TEST_DATABASE_URL=postgresql://postgres:test@127.0.0.1:55439/gamenight_test npx vitest run --maxWorkers=1 src/lib/tower-season-podium-rules.test.ts src/lib/tower-season-podium.integration.test.ts src/components/ProfilTabs.podium.test.tsx src/app/tower/palmares/page.test.tsx src/lib/community-scope.test.ts src/lib/no-hosted-db-url.test.ts
```

Les tests sans `TEST_DATABASE_URL` ignorent explicitement l'intégration PostgreSQL ; ils ne suffisent pas à valider la requête. Les données de test utilisent des identifiants aléatoires propres au fichier et sont nettoyées uniquement dans cette base locale. Aucun réseau Discord, Neon, Vercel ou API OpenAI n'est utilisé par cette fonctionnalité.
