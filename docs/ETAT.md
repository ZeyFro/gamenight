# État de reprise — 5 novembre 2026

## Branche et PR en cours
- Branche courante : docs/plan-migrations-20261105.
- PR documentaire #411, brouillon, empilée sur #410 : https://github.com/ZeyFro/gamenight/pull/411
- #410 reste empilée sur #409 vers main; les PR sont à laisser en brouillon.
- Aucune PR n'est fusionnée.

## Fait
- docs/PLAN-MIGRATIONS.md recense les huit fichiers de migration présents dans les PR ouvertes #325 (six), #370 (une) et #406 (une); aucune autre PR ouverte examinée ne modifie de migration.
- Le document détaille tables, colonnes, types, écritures/backfills, caractère additif, SQL de rollback proposé, dépendances, contrôles avant/après, ordre et questions d'autorisation.
- Analyse faite sur les SQL, schéma Prisma et diffs GitHub uniquement. Aucun accès à Neon, Production, une base ou _prisma_migrations; l'état réellement appliqué sur une base reste non vérifié.
- Aucun SQL exécuté : ni migration, ni rollback, ni snapshot, ni écriture de base.

## Reste / limites
- Vérifier par revue que les rollbacks proposés concordent avec la cible et les dépendances réelles; plusieurs font perdre des données après usage.
- Avant toute opération future, l'opérateur doit établir l'état du schéma et de _prisma_migrations, une sauvegarde fraîche restaurée en isolation et des contrôles adaptés.
- Toute migration demande un accord explicite distinct, fichier par fichier et cible par cible.

## Garde-fous permanents
- Aucune migration ni opération Neon/Production sans accord explicite distinct pour chaque fichier de migration.
- Aucune modification de configuration Production ou de variables d'environnement.
- Aucune modification Discord sans autorisation; aucun essai réel Discord.
- Aucune fusion : les PR restent en brouillon.
- Ne jamais demander ni publier de secret dans le chat.

## Prochaine action exacte
Relire #411 et ses SQL de retour arrière. Si une migration est envisagée ultérieurement, confirmer d'abord la cible et son état en lecture seule, valider une restauration de sauvegarde sur cible isolée, puis demander l'autorisation spécifique du fichier exact; ne rien exécuter avant ces étapes et cet accord.
