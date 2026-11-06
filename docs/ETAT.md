# État de reprise — 6 novembre 2026

Source de vérité : [issue #400](https://github.com/ZeyFro/gamenight/issues/400).
Les états CI ci-dessous sont des relevés ; consulter GitHub avant de reprendre.

## Travail vérifié

- #395 et #414 sont fermées sans fusion. L'exclusion des comptes de test des
  votes est retirée ; aucun pilote API payant ne doit être activé.
- #407 `6ec348d` : arbitre indépendant fixe configuré à l'avance, changements
  journalisés et gelés pendant une contestation ouverte ; cas OWNER réservé à
  cet arbitre. Délai de 24 h après annonce effective. 114 tests ciblés, suite
  locale 3 707/3 707, lint/typegen/tsc/build réussis ; CI et Preview vertes.
  Nouvelle migration `20261106150000_tower_fixed_arbiter` uniquement appliquée
  localement. PR toujours Draft.
- #396 `e582df3` : trois défauts corrigés ; contre-tests d'origine conservés.
  Revalidation indépendante PostgreSQL : 51/51, CI et Preview vertes, Draft.
- #370 `6cff66b` : réouverture après dissolution refusée, tests 3 créations/24 h,
  index Prisma aligné sans modifier le SQL. 23 tests ciblés, lint/tsc réussis.
- #406 `97353dc` : secours MP roulette sans mention publique du créateur ;
  27 tests PostgreSQL/Discord simulé réussis, lint/tsc réussis. #370 intégrée.
  B14 aligné sur 24 h et arbitre fixe. CI des nouvelles têtes en cours au relevé.
- #418 `05ccb6c` : workflow limité au dry-run, rôles runtime/migration distincts
  et paramétrés, runner chronologique #370, contrôle READ ONLY identité/DDL.
  16 tests, lint/tsc réussis, revue statique effectuée. Pas encore activé.
- #408 : intégration des parents #407/#406 corrigés en cours ; 60 tests ciblés
  déjà réussis. #413 porte ce point de reprise ; #416 attend cette intégration.

## Migrations et droits : distinguer local et distant

Répétitions PostgreSQL local isolé : 118 → 119 → 120 migrations terminées,
aucune inachevée ; répétition supplémentaire avec un rôle DDL restreint et DML
applicatif conservé. #407 porte une migration additionnelle 121 testée localement.
Ces résultats ne prouvent aucune exécution Neon.

Lecture seule de la connexion Cloud : projet et branche de test attendus,
historique 118 terminées, #370/#406 absentes, rôle dédié absent. L'endpoint ne
correspond pas à celui épinglé dans #418 ; l'essai READ ONLY de cet endpoint a
été refusé par le contrôle d'identité. Aucune écriture distante réalisée.

L'API GitHub refuse l'administration de `neon-migration-test` (403). Aucun
environnement, secret, rôle ou mot de passe distant créé par cette session.
La sauvegarde `backup-tower-migration-test-20261106` a été confirmée par le
propriétaire ; sa présence/exploitabilité reste à revalider avant exécution.
Procédure de rôle : branche de #418, `docs/operations/NEON_TEST_MIGRATION_ROLE.md`.

## Reprise et blocages

1. Vérifier le mapping indépendant endpoint → branche Neon de test et obtenir
   l'accès GitHub aux environnements/secrets, sans transmettre de secret au chat.
   Ensuite finaliser le rôle restreint et le secret ; aucun grant global.
2. Après fusion manuelle explicitement autorisée de #418, premier dry-run Actions.
   Toute migration, y compris test, attend son accord explicite, une sauvegarde
   validée et les précontrôles ; #370 puis #406 seulement. La migration #407 exige
   sa propre revue et autorisation. Production option B : préparation uniquement.
3. Finir la CI et les dépendances #408, #413, #416 ; vérifier les résultats distants
   des nouvelles têtes #370/#406/#418. Un push groupé par PR, aucun skip ci.
4. #325 exclusivement Claude Code. Prévenir le propriétaire seulement lorsque
   #370 ET #406 seront réellement fusionnées et leurs migrations appliquées ;
   ce jalon n'est pas atteint. Claude renommera alors ses migrations.
5. Recette isolée authentifiée, commandes/accueil/Atlas/rôles/bots Discord,
   catalogue, flags et kit bêta demandent configuration autorisée et/ou vrais
   membres. Tests simulés et Preview verte ne valent pas recette réelle.

Aucune fusion, passage Ready, migration distante, variable Vercel, flag,
modification Discord ou API payante effectuée. Quota réel non mesurable : cible
10 % non garantie ; poursuivre raisonnablement sans boucle ni relance inutile.
