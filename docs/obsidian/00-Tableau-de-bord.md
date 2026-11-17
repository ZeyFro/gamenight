# Tableau de bord

Sources de vérité, par ordre : issue GitHub #400 (réservations et priorités), [[REPRISE_AUTONOME]], [[ETAT]], [[ROADMAP]].

## Priorités (relevé du 17/11/2026)
1. Pile Tower : dry-run Neon Test **réussi** le 17/11 (run 44077998286, deux migrations en attente, cible et rôles conformes) et fusions locales sans conflit avec `tsc` à 0. Reste la preuve de restauration puis l'accord d'application — voir [[PLAN-J14-20261201]] et [[NEON_TEST_ETAT_20261117]].
2. Recette réelle de l'accueil sans compte et des trois forums Discord — voir [[TOWER_ONBOARDING_PANEL_SETUP]] et [[TOWER_RECETTE_SCENARIOS]].
3. Preuve de restauration Neon avant toute application — voir [[TOWER_SNAPSHOT_RESTORE_PROCEDURE]] ; aucune restauration n'a encore été exécutée.
4. #439 et #396 : ouvertes et **gelées** à la demande du propriétaire (la boucle de fusion a été arrêtée). #440 a été fusionnée par cette boucle avant l'arrêt.
5. #325 (XP, vocal, migrations) : réservée à Claude Code, hors périmètre du 1er décembre.

## Cibles
- Ouverture publique : 04/01/2027, repli 01/02/2027 (voir [[TOWER_DECISIONS_26_20261104]]).

## Garde-fous permanents
- Pas de fusion, de migration réelle ni d'action Production sans accord explicite.
- Ne jamais pousser sur `main`, ne jamais forcer un push.
- Les données de Production ne servent jamais aux tests.

## Où regarder
- [[05-Backlog-et-fonctionnalites]] · [[06-Bugs-et-incidents]] · [[07-Decisions-techniques]]
