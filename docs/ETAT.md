# État de reprise — 5 novembre 2026

## Branche et sources
- Branche documentaire : `docs/tower-roadmap-global-20261105`, PR brouillon #409 vers `main`.
- Règles de travail lues depuis cette branche : `AGENTS.md` (boucle par PR empilées, tâches suivantes non bloquées, arrêts limités aux décisions/risques documentés).
- Cahier canonique confirmé sur le commit source `1f6329e` : `docs/CAHIER_DES_CHARGES.md`, commence par « # CAHIER DES CHARGES GLOBAL » et compte exactement 31 540 caractères.
- Le cahier déjà présent sur `main` est une édition de navigation enrichie : les exigences sont reprises, avec introduction opérationnelle, sommaire, ancres et décisions d'exploitation; le fichier canonique fourni reste la référence produit.

## Avancement connu
- #395 : revue terminée; le contrôle est livré dans le code mais ne s'applique pas tant que l'ID n'est pas configuré en Production. Ne pas modifier la configuration Production; ne pas déclarer la fonctionnalité opérationnelle.
- #396 : revue en cours. Une réponse HTTP 200 peut masquer une attribution partielle au planificateur. Vérifier d'abord l'idempotence et le modèle de résultat avant de modifier le code.
- #406, #407 et #408 : PR brouillon ouvertes, non fusionnées. #407 dépend de #406; #408 dépend de #370 et #406. Les issues existantes sont conservées, aucune issue ou PR doublon ne doit être créée.
- #370 : aucun snapshot frais ni migration exécutés; la connexion directe `MIGRATION_DATABASE_URL` n'était pas présente dans le shell. Ne pas reprendre d'opération Neon sans accès disponible et autorisation explicite.
- État rapporté au début de cette reprise : aucun changement sur `main`, Production, migration, snapshot, configuration Vercel ou Discord.

## Prochaine action exacte
Lire le code et les tests de #396 pour établir si une attribution partielle suivie d'une relance est idempotente. Ajouter ou ajuster un test ciblé qui prouve ce comportement avant toute correction; corriger la réponse HTTP seulement si l'analyse confirme qu'elle masque une erreur exploitable. Mettre à jour la roadmap et ouvrir une PR empilée sur la pointe documentaire #409, sans fusionner ni toucher à Neon, Production ou Discord. Après chaque PR terminée, consigner les preuves et limites puis demander si la suite doit continuer, car le quota restant n'est pas visible dans cette session.
