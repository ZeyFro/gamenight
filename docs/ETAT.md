# État de reprise — 5 novembre 2026

## Branche et sources
- Branche documentaire : `docs/tower-roadmap-global-20261105`, PR brouillon #409 vers `main`.
- Règles de travail lues depuis cette branche : `AGENTS.md` (boucle par PR empilées, tâches suivantes non bloquées, arrêts limités aux décisions/risques documentés).
- Cahier canonique confirmé sur le commit source `1f6329e` : `docs/CAHIER_DES_CHARGES.md`, commence par « # CAHIER DES CHARGES GLOBAL » et compte exactement 31 540 caractères.
- Le cahier déjà présent sur `main` est une édition de navigation enrichie : les exigences sont reprises, avec introduction opérationnelle, sommaire, ancres et décisions d'exploitation; le fichier canonique fourni reste la référence produit.
- #409 est toujours ouverte en brouillon; sa tête avant cette mise à jour était `05648dea0fdc272ce42378b082872a6f895070b9`.

## Avancement connu
- #395 : revue terminée; le contrôle est livré dans le code mais ne s'applique pas tant que l'ID n'est pas configuré en Production. Ne pas modifier la configuration Production; ne pas déclarer la fonctionnalité opérationnelle.
- #396 : correction publiée sur la branche `feat/tower-team-daily-cron-20261104`, commit `1f1136dc0a37fef6949052034e89214f8bafce9d`. Si une ou plusieurs équipes échouent, la route renvoie HTTP 503 et conserve le détail `checked/failed`; test unitaire ciblé ajouté. La CI de cette tête était en cours au dernier contrôle. Le test unitaire ajouté n'a pas été exécuté localement dans cette session.
- Idempotence de #396 vérifiée en lecture : clé `team-YYYY-MM-DD` issue du jour Europe/Paris, contrainte Prisma unique `(communityId, teamId, requestKey)` et `upsert`; le test d'intégration existant confirme deux appels retournent le même défi et qu'une seule tentative existe. Ce test d'intégration nécessite une base PostgreSQL isolée et n'a pas été exécuté ici.
- #406, #407 et #408 : PR brouillon ouvertes, non fusionnées. #407 dépend de #406; #408 dépend de #370 et #406. Les issues existantes sont conservées, aucune issue ou PR doublon ne doit être créée.
- #370 : aucun snapshot frais ni migration exécutés; la connexion directe `MIGRATION_DATABASE_URL` n'était pas présente dans le shell. Ne pas reprendre d'opération Neon sans accès disponible et autorisation distincte.
- Aucun changement sur `main`, Production, migration, snapshot, configuration/variables Vercel ou Discord dans cette reprise.

## Règles de sécurité applicables
- Pas de migration ni d'opération sur Production ou Neon sans accord explicite et séparé pour chaque migration.
- Pas de modification de la configuration Production ni de variables d'environnement.
- Pas de changement Discord ni d'essai réel sans accord explicite.
- Aucune PR ne doit être fusionnée; Maxime effectue les fusions.
- Ne jamais demander ni recopier de secret dans le chat.
- Le quota d'usage n'est pas visible dans cette session : après chaque PR terminée, consigner l'état et demander à Maxime s'il souhaite poursuivre.

## Prochaine action exacte
Attendre les contrôles automatiques de la nouvelle tête de #396; vérifier le résultat CI et Vercel sans changer leur configuration. Si tous les contrôles requis passent, résumer les preuves et limites de #396 puis demander si la suite doit continuer. Si un contrôle échoue, analyser le diagnostic ciblé et ne pas dépasser deux tentatives de correction. Aucun test Discord, aucune migration, opération Neon, changement Production ou fusion.
