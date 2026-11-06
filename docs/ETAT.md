# État de reprise — 5 novembre 2026

## Branche et sources
- Branche documentaire : `docs/tower-roadmap-global-20261105`, PR brouillon #409 vers `main`.
- Règles de travail lues depuis cette branche : `AGENTS.md` (boucle par PR empilées, tâches suivantes non bloquées, arrêts limités aux décisions/risques documentés).
- Cahier canonique confirmé sur le commit source `1f6329e` : `docs/CAHIER_DES_CHARGES.md`, commence par « # CAHIER DES CHARGES GLOBAL » et compte exactement 31 540 caractères.
- Le cahier déjà présent sur `main` est une édition de navigation enrichie : les exigences sont reprises, avec introduction opérationnelle, sommaire, ancres et décisions d'exploitation; le fichier canonique fourni reste la référence produit.
- #409 est ouverte en brouillon, tête actuelle `2bf2dabc3af6345befd1ca46b03455973cce1ef2`.

## Avancement connu
- #395 : revue terminée; le contrôle est livré dans le code mais ne s'applique pas tant que l'ID n'est pas configuré en Production. Ne pas modifier la configuration Production; ne pas déclarer la fonctionnalité opérationnelle.
- #396 : correction publiée sur `feat/tower-team-daily-cron-20261104`, commit `1f1136dc0a37fef6949052034e89214f8bafce9d). Une attribution partiellement échouée renvoie maintenant HTTP 503 avec les compteurs `checked/failed`; un test de route cible ce cas.
- Idempotence de #396 confirmée par le code et les tests existants : clé `team-YYYY-MM-DD` calculée sur le jour Europe/Paris, contrainte unique Prisma `(communityId, teamId, requestKey)` et `upsert`. Le test d'intégration vérifie que deux appels produisent le même défi et une seule tentative.
- CI de #396 réussie : `test:postgres` 3 606/3 606; `npm test` 2 414 réussis et 1 189 ignorés; typegen, TypeScript, lint et build réussis. Vercel Preview est verte. Les tests distants ont été exécutés en CI; aucun test n'a été lancé localement dans cette session.
- #396 est en brouillon, ouverte et non fusionnée.
- #406, #407 et #408 : PR brouillon ouvertes, non fusionnées. #407 dépend de #406; #408 dépend de #370 et #406. Les issues existantes sont conservées, aucune issue ou PR doublon ne doit être créée.
- #370 : aucun snapshot frais ni migration exécutés; `MIGRATION_DATABASE_URL` n'était pas présente dans le shell. Ne pas reprendre d'opération Neon sans accès disponible et autorisation distincte.
- Aucun changement sur `main`, Production, migration, snapshot, configuration/variables Vercel ou Discord dans cette reprise.

## Règles de sécurité applicables
- Pas de migration ni d'opération sur Production ou Neon sans accord explicite et séparé pour chaque migration.
- Pas de modification de la configuration Production ni de variables d'environnement.
- Pas de changement Discord ni d'essai réel sans accord explicite.
- Aucune PR ne doit être fusionnée; Maxime effectue les fusions. Toute PR travaillée reste en brouillon.
- Ne jamais demander ni recopier de secret dans le chat.
- Le quota d'usage n'est pas visible dans cette session : après chaque PR terminée, consigner l'état et demander à Maxime s'il souhaite poursuivre.

## Prochaine action exacte
Présenter le compte rendu de #396 et demander à Maxime s'il souhaite poursuivre avec la première tâche non bloquée de la roadmap. Si oui, lire son état à jour et travailler sur une branche empilée conforme aux règles; ne pas fusionner. Aucune migration, opération Neon/Production, modification de configuration ou essai Discord sans les accords distincts précisés ci-dessus.
