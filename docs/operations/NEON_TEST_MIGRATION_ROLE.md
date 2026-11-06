# Rôle de migration Neon Test — préparation #418

Cible exclusive : projet `misty-tooth-45335023`, branche
`tower-migration-test-20261105` (`br-snowy-snow-b1cggq2w`), base `neondb`.
Aucune autorisation Production. #325 reste réservée à Claude Code.

## Séparation des identités

`GAMENIGHT_RUNTIME_ROLE` désigne le rôle applicatif, utilisé par le runner pour
refuser une connexion de migration partagée. Il ne doit pas être remplacé par le
login de migration. `GAMENIGHT_MIGRATION_ROLE` désigne ce dernier ; le précontrôle
vérifie sa correspondance avec le secret et exige des identités distinctes.
Ces deux noms sont des variables de l'environnement GitHub `neon-migration-test`.
`MIGRATION_DATABASE_URL` est exclusivement un secret de cet environnement.

## Périmètre DDL minimal vérifié localement

Le rôle dédié ne reçoit ni SUPERUSER, CREATEDB, CREATEROLE, REPLICATION, BYPASSRLS,
ni appartenance à un rôle privilégié. NOINHERIT et une limite de connexions sont
prévus. Une préparation interrompue avant l'enregistrement sécurisé du secret
laisse le rôle NOLOGIN et sans mot de passe.

Les migrations nécessitent la propriété de `Membership`, `CommunityTeam`,
`CommunityTeamMember`, `TowerChallengeAttempt`, `PlayerClassified` et du type
`UserNotificationCategory`, pour ALTER TABLE, contraintes, index et ALTER TYPE.
Une simple permission DML ne suffit pas. Elles nécessitent également :

- CONNECT à la base et USAGE/CREATE sur le schéma public ;
- SELECT et REFERENCES sur User.id, REFERENCES sur Community.id ;
- SELECT/INSERT sur _prisma_migrations, UPDATE sur logs, finished_at et
  applied_steps_count ;
- conservation du DML applicatif sur les objets transférés et droits DML par
  défaut pour le rôle applicatif sur les nouvelles tables.

Ne pas accorder de rôle propriétaire global ou de droits sur toutes les tables
pour résoudre un échec. Vérifier les effets exacts du transfert de propriété et
les ACL avant toute opération distante. Le précontrôle vérifie les propriétés,
les droits nécessaires et l'absence de privilèges globaux ; il ne provisionne rien.

## Verrous avant activation

1. Mapping endpoint → projet/branche confirmé en lecture seule par le connecteur
   Neon de ChatGPT le 6 novembre vers 18 h 35 Paris :
   [preuve indépendante](https://github.com/ZeyFro/gamenight/pull/418#issuecomment-6691282780).
   Endpoint direct : `ep-morning-wave-b1o2tpej.c-5.eu-central-1.aws.neon.tech`,
   base `neondb`, projet et branche exactement ceux indiqués en tête.
   Le workflow épingle cette cible ; ses contrôles projet/branche/base/login et
   séparation des rôles restent obligatoires à chaque dry-run. Ne publier aucune
   URL de connexion ni confondre cette preuve avec un dry-run Prisma réussi.
2. Obtenir un accès GitHub autorisé à créer l'environnement, sa restriction à
   main et son secret : l'intégration actuelle renvoie 403. Ne pas utiliser un
   secret de dépôt comme remplacement plus large.
3. Vérifier de nouveau la sauvegarde indépendante
   `backup-tower-migration-test-20261106` (`br-purple-mud-b1nt0tfi`) et préparer
   une procédure de restauration séparée, sans l'exécuter ni toucher à la sauvegarde.
4. Finaliser et revoir la préparation du rôle puis enregistrer le secret par un
   canal sécurisé, sans valeur dans les journaux, arguments shell ou fichiers.
5. Après fusion manuelle explicitement autorisée, lancer le premier workflow
   GitHub Actions en dry-run et vérifier son résultat. Cette révision ne contient
   aucun chemin apply/--execute.
6. Toute exécution des migrations exige une nouvelle autorisation explicite,
   dans l'ordre #370 puis #406 avec validations intermédiaires. Aucun autre
   répertoire de migration ne doit être ajouté.

## Preuves et limites

Les tests ciblés vérifient la séparation des rôles, le refus d'identités et de
privilèges incorrects, la propriété nécessaire et l'absence de mode d'écriture.
Un exercice PostgreSQL local isolé a appliqué successivement #370 puis #406 avec
un rôle restreint : 120 migrations terminées, aucune inachevée, DML du rôle
applicatif conservé. Cela ne prouve pas une exécution Neon ou GitHub Actions.
Aucun rôle, secret ou environnement distant n'a été créé par cette préparation.
