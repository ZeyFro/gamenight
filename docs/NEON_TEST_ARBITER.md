# Prévalidation Neon Test — arbitre fixe (#407)

## Périmètre

Le workflow manuel `neon-test-arbiter.yml` prépare uniquement le **dry-run** de
`20261106150000_tower_fixed_arbiter`. Il n'a aucun mode d'application, aucune
confirmation d'application et aucun déclenchement automatique. Il partage le
verrou de concurrence des opérations #370/#406, exige `main` et l'environnement
protégé existant `neon-migration-test`. Ne pas l'exécuter avant revue/fusion et
approbation humaine du déploiement protégé. Sa préparation n'autorise aucune
migration distante.

Le workflow précédent validé à la phase118 ne prouve pas la phase120. Le nouveau
contrôle exige exactement les118 migrations scellées, puis #370 et #406 terminées,
avec leurs empreintes exactes. Toute phase118/119/121, ligne inachevée, doublon,
checksum divergent ou migration supplémentaire est refusée avant le runner.
Seules les sept variantes historiques LF/CRLF déjà approuvées sont reconnues.
Les SQL publiés et le runner sont copiés depuis des SHA immuables ; les121 dossiers
et leurs empreintes sont vérifiés avant la connexion. Aucune migration #325 n'est
assemblée. Aucun secret n'est disponible pendant npm ci ou prisma generate.

## Contrôles effectués

Connexion native directe avec TLS strict ; projet `misty-tooth-45335023`, branche
`br-snowy-snow-b1cggq2w`, base `neondb`, rôle `gamenight_test_migrator` distinct du
rôle applicatif. Les gardes existants contrôlent l'endpoint, l'identité serveur,
les propriétés DDL, le rôle restreint et les privilèges. Aucun droit n'est ajouté.

Le snapshot phase120 réutilise le manifeste de schéma PostgreSQL16/18 et les
gardes d'intégrité existants, dont la table étrangère déclarée. **C'est une fenêtre
avant activation** : nouvelles tables/colonnes encore vides et capitaines issus
du backfill inchangés. Une fonctionnalité déjà activée peut donc provoquer un
refus légitime ; ne pas assouplir les gardes pour le contourner.

La nouvelle table comporte BIGSERIAL. Un contrôle de catalogue exige donc aussi
un droit USAGE explicitement prévu pour le rôle applicatif dans les privilèges
par défaut des séquences créées par le migrateur (globaux ou dans public). Cette
vérification conservatrice n'accepte pas un droit hérité/PUBLIC comme substitut
au droit dédié. En cas de refus, obtenir une revue du droit minimal nécessaire ;
aucun GRANT, création de sonde ou nextval() n'est exécuté par ce workflow.

Enfin le runner officiel épinglé est appelé avec seulement
`--expect=20261106150000_tower_fixed_arbiter`, sans `--execute`.
Le snapshot initial n'est **pas** une preuve d'intégrité après migration, ni une
preuve de restauration. Le workflow ne change pas la règle d'arbitre et ne résout
pas le cas d'un arbitre devenu indisponible.

## Application ultérieure : portes non franchies ici

1. Prouver une sauvegarde indépendante actuelle et un exercice de restauration
   autorisé, sans toucher à la sauvegarde d'origine ou à Production.
2. Faire valider le workflow distinct d'application et recueillir un accord
   spécifique ; ce workflow de dry-run ne pourra jamais appliquer le SQL.
3. Capturer avant application les compteurs/empreintes des données métier.
4. Après application, vérifier121 migrations terminées, aucune autre ligne,
   checksum407 exact, table et séquence possédées par le migrateur, FK et index
   valides, table d'audit initialement vide et données préexistantes inchangées.
5. Vérifier par catalogue les droits applicatifs sur la nouvelle table et USAGE
   sur `TowerArbiterConfigurationChange_id_seq`, sans appeler nextval(). Exécuter
   les tests locaux pertinents et une recette isolée distincte.

Aucune opération Production, restauration, migration distante, commande Discord
ou fusion de PR n'est autorisée par ce document.
