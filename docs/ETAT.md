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
  B14 aligné sur 24 h et arbitre fixe. CI et Preview vertes sur ces têtes.
- #418 `3cb3d00` : workflow limité au dry-run, rôles runtime/migration distincts
  et paramétrés, runner chronologique #370, contrôle READ ONLY identité/DDL.
  Endpoint direct confirmé par le connecteur Neon de ChatGPT puis corrigé dans
  les deux étapes ; 17 tests ciblés, cinq vérifications hors réseau du runner,
  lint/tsc réussis. CI de cette nouvelle tête en cours au relevé ; pas encore activé.
- #408 `0e9ff59` : parents corrigés intégrés ; 60 tests ciblés, typegen/tsc,
  lint et build réussis, npm ci complet (605 paquets, TLS actif).
- #416 `3f2702f` : #408 intégrée ; 81 tests ciblés, typegen/tsc et lint ciblé
  réussis. Aucun enregistrement Discord. CI dédiée et Preview vertes ; #408 verte.
- #413 porte ce point de reprise et un reciblage documentaire vers main.

## Migrations et droits : distinguer local et distant

Répétitions PostgreSQL local isolé : 118 → 119 → 120 migrations terminées,
aucune inachevée ; répétition supplémentaire avec un rôle DDL restreint et DML
applicatif conservé. #407 porte une migration additionnelle 121 testée localement.
Ces résultats ne prouvent aucune exécution Neon.

Relevé précédent en lecture seule : projet et branche de test attendus,
historique 118 terminées, #370/#406 absentes, rôle dédié absent. Ce relevé SQL
n'a pas été répété pendant la correction d'endpoint.

Le connecteur Neon de ChatGPT a confirmé le 6 novembre vers 18 h 35 Paris le
mapping exact vers l'endpoint direct
`ep-morning-wave-b1o2tpej.c-5.eu-central-1.aws.neon.tech` et la base `neondb` :
[preuve indépendante](https://github.com/ZeyFro/gamenight/pull/418#issuecomment-6691282780).
La cible obsolète a été corrigée dans #418 ; le blocage de mapping est levé.
Les contrôles d'identité, branche et rôles restent obligatoires. Cette preuve
ne remplace pas le premier dry-run Prisma. Aucune écriture distante réalisée.

L'API GitHub refuse l'administration de `neon-migration-test` (403). Aucun
environnement, secret, rôle ou mot de passe distant créé par cette session.
La sauvegarde `backup-tower-migration-test-20261106` (`br-purple-mud-b1nt0tfi`)
a été reconfirmée ready, enfant de la cible, no_compute et non par défaut par
le même contrôle indépendant ; aucun exercice de restauration n'est prouvé ici.
Revalider son exploitabilité avant une éventuelle exécution autorisée.
Procédure de rôle : branche de #418, `docs/operations/NEON_TEST_MIGRATION_ROLE.md`.

## Reprise et blocages

1. Le mapping endpoint est confirmé et corrigé : ne pas recommencer cet audit
   sans nouvelle divergence. Obtenir l'accès GitHub aux environnements/secrets,
   sans transmettre de secret au chat. La phase actuelle reste limitée au dry-run ;
   ne pas créer de rôle ni exécuter de migration dans le lot de correction.
   Préparation restreinte rôle/secret encore non réalisée ; aucun grant global.
2. Après fusion manuelle explicitement autorisée de #418, premier dry-run Actions.
   Toute migration, y compris test, attend son accord explicite, une sauvegarde
   validée et les précontrôles ; #370 puis #406 seulement. La migration #407 exige
   sa propre revue et autorisation. Production option B : préparation uniquement.
3. #370/#406/#407/#408/#416 et l'ancienne tête documentaire #413 ont leurs CI
   vertes. Relever seulement les nouvelles CI #418 et #413 de cette correction.
   Un push groupé par PR et par lot complet ; aucun skip ci.
4. #325 exclusivement Claude Code. Prévenir le propriétaire seulement lorsque
   #370 ET #406 seront réellement fusionnées et leurs migrations appliquées ;
   ce jalon n'est pas atteint. Claude renommera alors ses migrations.
5. Recette isolée authentifiée, commandes/accueil/Atlas/rôles/bots Discord,
   catalogue, flags et kit bêta demandent configuration autorisée et/ou vrais
   membres. Tests simulés et Preview verte ne valent pas recette réelle.

Aucune fusion, passage Ready, migration distante, variable Vercel, flag,
modification Discord ou API payante effectuée. Quota réel non mesurable : cible
10 % non garantie ; poursuivre raisonnablement sans boucle ni relance inutile.

Attention #410 : fusionnée historiquement dans l'ancienne branche documentaire,
ses points d'entrée UI ne sont pas dans main. Le reciblage documentaire #413
n'importe pas ces fichiers hérités ; #410 et son historique ne sont pas modifiés.
Préserver ce travail et prévoir sa réintégration séparée après libération d'une
place sous le plafond de dix PR de code. Ne pas annoncer sa livraison sur main.
