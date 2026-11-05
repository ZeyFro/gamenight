# État de reprise — 5 novembre 2026

## Fait

- Branche documentaire : `docs/readme-migration-runner-20261105`; PR #413 en brouillon, empilée sur `docs/plan-migrations-20261105`. Le README corrige l'affirmation obsolète sur les migrations automatiques; `docs/PLAN-MIGRATIONS.md` décrit le risque des migrations tardives et la garde ajoutée au runner.
- **#370**, tête `4a18b7491d1887cfc4fe38c7f1e68eb77a7571cb` : garde contre les migrations en attente plus anciennes, tests unitaires, précontrôle des doublons et des créateurs orphelins. CI générale run 764 entièrement verte (runner, Postgres de service jetable, tests, typegen, tsc, lint, build); Tower rules/storage run 210 verts. Preview Vercel limitée par le quota quotidien.
- **#406**, tête actuelle `1a495ede501784167b597c43438c1527b2d58082` : le CI précédent run 766 a échoué uniquement sur le budget webhook (33 requêtes au lieu de 32 dans deux cas); 3 614 tests passent. Le chemin Web Push saute désormais l'interrogation des préférences si la livraison est désactivée faute de configuration; le test ciblé couvre ce cas et les seuils restent inchangés. CI run 769 et Tower rules run 215 sont en cours. Vercel échoue par limite quotidienne de déploiements.
- **Neon test uniquement** : branche `tower-migration-test-20261105`, ID `br-snowy-snow-b1cggq2w`, parent exact `br-super-cell-b1ukvk08`; état Ready, ni primaire ni par défaut. Précontrôles lecture seule : 118 migrations réussies, aucune en cours, zéro doublon de membres, zéro créateur orphelin. Aucun SQL de migration exécuté.
- Issue #400 a reçu le suivi des checks et des précontrôles. Aucun changement Production/configuration, aucune action Discord, aucun essai réel, aucune fusion.

## Reste et blocages

- CI générale #406 run 769 et Tower rules run 215 doivent valider le correctif de budget; corriger tout échec concret.
- Le runner Prisma n'a pas été exécuté sur Neon test : aucun checkout du dépôt ni `MIGRATION_DATABASE_URL` injectée dans le shell de cette session. Ne pas envoyer d'URL ou de secret dans le chat et ne pas contourner le runner avec du SQL direct.
- #370 reste Draft malgré sa CI verte : migration non exercée par le runner sur Neon test et Preview Vercel bloquée par la limite de déploiements.
- #406 reste Draft et dépend de son contrôle CI général et du test runner sur Neon test.
- #325 reste gelée. #407 dépend de #406 et doit être revalidée avec #396; #408 dépend de #370 et #406. Aucune PR n'est fusionnée.

## Garde-fous

- Aucune migration de Production ni opération de suppression sur Production sans autorisation explicite et distincte.
- Aucune modification de configuration Production ou des variables d'environnement.
- Aucune modification Discord ni essai réel Discord sans autorisation.
- Ne publier aucun secret ni URL de connexion dans le chat.
- Ne fusionner aucune PR Draft, défaillante ou bloquée par une dépendance, migration ou revue.

## Prochaine action exacte

Relever la conclusion de CI générale #406 run 766. Puis, quand un checkout local est disponible avec `MIGRATION_DATABASE_URL` injectée hors chat, confirmer encore l'identité de la branche Neon test, lancer le dry-run exact du runner pour #370 puis #406 sans inclure d'autre migration, vérifier la liste d'attente et les précontrôles, et n'appliquer ces migrations que sur cette branche de test si ces contrôles passent. Ne toucher ni à Production ni à #325.
