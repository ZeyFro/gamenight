# État de reprise — 5 novembre 2026

## Branche et PR en cours
- Branche courante : `docs/plan-migrations-20261105`.
- Nouvelle PR documentaire brouillon en préparation, empilée sur #410; #410 reste empilée sur #409 vers `main`.
- #409, #410 et la nouvelle PR sont à laisser en brouillon; aucune PR n'est fusionnée.
- Le document `docs/PLAN-MIGRATIONS.md` recense les huit migrations visibles dans les PR ouvertes #325, #370 et #406.

## Fait
- Inventaire des chemins de migration dans les fichiers modifiés par toutes les PR actuellement ouvertes : six dans #325, une dans #370, une dans #406; aucune autre migration n'est incluse dans les autres PR ouvertes examinées.
- Lecture des huit fichiers SQL et des définitions Prisma nécessaires pour nommer les tables, colonnes, types, contraintes, backfills, ordre et propositions de rollback.
- Aucun accès à Neon, Production, une base ou `_prisma_migrations); l'état réellement appliqué des fichiers reste non vérifié.
- Aucun SQL exécuté : ni migration, ni rollback, ni snapshot, ni écriture de base.

## Reste / limites
- Le plan décrit les migrations présentes dans les PR non fusionnées; ce n'est pas l'inventaire des migrations effectivement en attente sur une base réelle.
- Les ordres SQL de retour arrière sont des propositions à vérifier, plusieurs entraînent une perte de données après usage.
- Les contrôles de structure/données, de sauvegarde/restauration et post-application restent à effectuer par l'opérateur, avec autorisation distincte pour chaque migration.
- Aucune configuration, variable d'environnement, permission, rôle ou salon Discord n'a été modifié; aucun essai Discord n'a été fait.

## Garde-fous permanents
- Aucune migration ni opération Neon/Production sans accord explicite distinct pour chaque fichier de migration.
- Aucune modification de configuration Production ou de variables d'environnement.
- Aucune modification Discord sans autorisation; aucun essai réel Discord.
- Aucune fusion : les PR restent en brouillon.
- Ne jamais demander ni publier de secret dans le chat.

## Prochaine action exacte
Relire la PR documentaire et corriger le plan si nécessaire. Avant toute migration future, vérifier l'état de la cible et de `_prisma_migrations` en lecture seule, établir/restaurer une sauvegarde isolée, puis demander et consigner une autorisation spécifique pour le fichier exact et la cible; aucune opération n'est autorisée par la présente PR.
