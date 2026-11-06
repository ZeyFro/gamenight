# État de reprise — 6 novembre 2026

## Dernier travail vérifié

- #396 : trois défauts corrigés sur la PR existante, `e582df3524bc005756540b779a1ab14c2aef95b2`. 51 tests ciblés PostgreSQL, lint/typegen/tsc/build verts ; CI générale, rules/storage et Preview verts. Toujours Draft.
- #407 : correction du délai après livraison effective, reprise des annonces différées, commit `06770d5a2f03def87498b280c93f91008fab7f41`. 75 tests ciblés, lint/typegen/tsc/build verts. Preview et rules verts ; storage échoue avec `TowerChallengeAppeal does not exist`, dépendance #406 absente du checkout CI. CI générale encore en cours au relevé. Aucun échec masqué ni relance inutile. Aucun nouveau schéma.
- #370 puis #406 : dry-runs exacts et exécutions du runner réussis sur PostgreSQL **local isolé** : 118 → 119 → 120 migrations terminées, zéro inachevée ; six tests du garde chronologique passent. Provenance, checksums et procédure option B dans `docs/PLAN-MIGRATIONS.md`.
- Aucune migration Neon/Production, fusion, passage Ready, variable/flag, modification Discord ou API payante effectuée. #325 gelée ; pilote #414 hors périmètre.

## Blocages et reprise exacte

1. Branche Neon test `tower-migration-test-20261105` (`br-snowy-snow-b1cggq2w`) : outil Neon et liaison secrète de migration indisponibles dans cette session. L’ancien relevé de 118 migrations reste historique, pas actuel. Accord requis avant toute migration sur cette branche ; revalider identité, état et sauvegarde avant exécution.
2. Production : seulement après recette de migration, revue indépendante, accord distinct et snapshot frais restaurable. Option B explicitement dégradée ; aucun merge automatique.
3. #407/#408/#416 : validation complète dépend du schéma #406 et des règles #370. Recette distante et intégration formelle restent à faire après autorisations.
4. Environnement de recette : historique `preview-gamenight` ancien et inachevé à rapprocher ; aucun `resolve` ou reset. Configuration Neon/Vercel/OAuth et essais authentifiés nécessitent accès et accords.
5. Discord / activation / bêta : plans existants, aucune validation réelle déduite des tests locaux. Commandes, accueil, Atlas, rôles et bots attendent accès de recette et accords explicites ; go/no-go attend preuves humaines.

L’issue #400 conserve la coordination et les liens CI actuels. Ne pas réouvrir un sujet déjà en PR ni dépasser dix PR de code ; suivre d’abord les contrôles de #407, puis la migration test #370/#406 après levée des blocages.
