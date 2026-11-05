# État de reprise — 5 novembre 2026

## Fait

- PR documentaire #413 reste en brouillon sur `docs/readme-migration-runner-20261105`, empilée sur la branche documentaire #411. Le README, le plan de migrations et ce suivi sont dans la PR; aucune fusion.
- **#370**, tête `4a18b7491d1887cfc4fe38c7f1e68eb77a7571cb` : garde chronologique fail-closed et tests dédiés présents. CI générale run 764 et Tower rules/storage run 210 entièrement verts. Preview Vercel en échec sur la limite quotidienne, sans action manuelle.
- **#406**, tête `1a495ede501784167b597c43438c1527b2d58082` : correction du budget de requêtes en évitant la lecture de préférence Web Push lorsque sa livraison est désactivée, sans relever le seuil. CI générale run 769 et Tower rules/storage run 215 verts. Preview Vercel limitée par le quota quotidien.
- **#396** CI générale run 754 et Preview Vercel vertes. **#397** et **#394** sont fusionnées; le catalogue v2 de 36 défis est déjà raccordé.
- Branche Neon test `tower-migration-test-20261105`, ID `br-snowy-snow-b1cggq2w`, parent `br-super-cell-b1ukvk08), revalidée Ready, non primaire et non par défaut. Contrôles antérieurs en lecture seule : 118 migrations réussies, aucune inachevée, zéro doublon membre et zéro créateur orphelin. Aucune migration exécutée.
- Inventaire de reprise : seule l'issue #400 est ouverte; sept PR ouvertes, toutes en Draft. #325 reste gelée.

## Reste et blocages

- **#370 puis #406** : l'application sur la branche de test n'est pas lancée. Ce workspace n'a pas de checkout git ni de `MIGRATION_DATABASE_URL`. Ne jamais envoyer cette URL dans le chat, ni contourner le runner par du SQL direct.
- **#407** échoue encore sur le test de stockage car le schéma `TowerChallengeAppeal` de #406 n'est pas dans sa base CI; **#408** échoue au typage/stockage en attendant les champs Prisma de #406 et les règles de #370.
- #396 dépend de #370 pour l'intégration; son workflow planifié n'est pas activé. #325 reste exclue des tests; sa migration plus ancienne serait refusée si présentée après #370/#406.
- Aucune modification de Production, configuration, Discord ou Neon; aucune fusion ni essai réel.

## Prochaine action exacte

Sur un checkout local de la branche #370, injecter secrètement `MIGRATION_DATABASE_URL` pointant exclusivement vers `br-snowy-snow-b1cggq2w`, puis exécuter le précontrôle et le dry-run du runner en vérifiant l'identité et la liste exacte des migrations. Si tout passe, appliquer uniquement #370 sur cette branche. Refaire ensuite le même contrôle avec la branche de #406 et n'appliquer que sa migration. En cas de cible ou migration inattendue, arrêter. Ne pas toucher à Production ni à #325.
