# Podium de la dernière saison Tower

Première tranche indépendante de P4-02 : `/tower/palmares`, accessible depuis l'onglet « Palmarès Tower » du profil. Lecture seule, sans migration ni activation de configuration.

Le podium concerne la dernière saison terminée, selon le calendrier Europe/Paris validé dans `TOWER_DECISIONS_26_20261104.md`. Pendant une intersaison, elle reste affichée ; une saison en cours n'est jamais présentée comme terminée. L'été est une saison à part entière.

Seules les récompenses effectivement créditées comptent : `rewardedAt` du défi solo approuvé, ou `rewardedAt` individuel du participant d'équipe approuvée. L'auteur d'un défi d'équipe n'obtient pas un crédit supplémentaire. Le barème est celui conservé dans la tentative, indépendamment des modifications du catalogue. Départage : étages gagnés, nombre de défis à trois étages, heure d'arrivée au total final, puis identifiant interne pour stabiliser une égalité exacte.

L'accès exige une session, une communauté sélectionnée, son adhésion active et une communauté active avec les défis Tower activés, même lorsque l'isolation est OFF. Le flag global `TOWER_CHALLENGES_ENABLED` reste requis. Le podium affiche seulement les membres encore actifs de ce serveur et ne publie ni identifiants Discord ni preuves privées.

Ce podium est calculé à la lecture : ce n'est pas une archive immuable ni une attribution de titre, badge ou droit du gagnant. Un départ de communauté retire le joueur de cet affichage. Les distinctions persistantes, le Hall of Fame historique et le droit du premier à proposer un défi restent à traiter dans la suite de P4-02, avec leur schéma et règles dédiés. Aucun rôle ni permission Discord n'est attribué.

## Validation locale

Sur un PostgreSQL jetable lié à `127.0.0.1`, déjà migré selon `CLAUDE.md` :

```sh
TEST_DATABASE_URL=postgresql://postgres:test@127.0.0.1:55439/gamenight_test npx vitest run --maxWorkers=1 src/lib/tower-season-podium-rules.test.ts src/lib/tower-season-podium.integration.test.ts src/components/ProfilTabs.podium.test.tsx src/app/tower/palmares/page.test.tsx src/lib/community-scope.test.ts src/lib/no-hosted-db-url.test.ts
```

Les tests sans `TEST_DATABASE_URL` ignorent explicitement l'intégration PostgreSQL ; ils ne suffisent pas à valider la requête. Les données de test utilisent des identifiants aléatoires propres au fichier et sont nettoyées uniquement dans cette base locale. Aucun réseau Discord, Neon, Vercel ou API OpenAI n'est utilisé par cette fonctionnalité.
