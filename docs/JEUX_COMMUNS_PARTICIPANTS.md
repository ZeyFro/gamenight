# Jeux communs aux participants — O06

Dans `/bibliotheque/groupe`, choisir des personnes conserve uniquement les jeux
déclarés possédés (`owned:true`) par chacune d’elles. Le visiteur ne participe
pas implicitement : il se coche s’il joue. Sans sélection, l’union historique
des bibliothèques du groupe est conservée. Les filtres de genre, nombre de
joueurs et source du jeu restent combinables ; leur remise à zéro conserve la
sélection des personnes. Un lien distinct efface cette sélection.

Le serveur déduplique les identifiants et revalide la totalité de la sélection
(100 personnes maximum). Une personne inconnue, extérieure ou révoquée refuse
tout le résultat ; elle n’est jamais supprimée silencieusement de l’intersection.
Le sélecteur, chaque condition de possession et les avatars utilisent le même
périmètre de communauté active. Une communauté suspendue ne donne aucun accès.
Isolation OFF conserve le périmètre global et l’intersection explicitement
demandée. Aucun nouveau modèle, migration, service ou changement de flag.

Les données proviennent des bibliothèques existantes, pas d’une vérification de
licence en direct. Posséder un jeu ne garantit ni son installation ni la
présence en ligne. Les liens existants vers les fiches permettent ensuite de
préparer une soirée. Ce lot ne modifie ni les votes ni les tirages de roulette.

## Validation

Les nouveaux cas ont d’abord reproduit le manque (7 échecs métier, 8 tests
existants réussis) sur le Postgres local dédié `gamenight_o06_test`, après
application des 79 migrations. Aucun accès aux autres bases, à Neon ou à
Discord réel. Les 17 intégrations de bibliothèque et les 21 tests de filtres et
paramètres passent ensuite (38/38). Deux tests DOM supplémentaires passent :
conservation des champs GET répétés et des filtres, effacement séparé et alerte
de sélection inaccessible. TypeScript, lint complet, `git diff --check` et build
direct Webpack réussissent. Relecture indépendante sans défaut P0–P2 identifié.

La suite sans Postgres rapporte 1 552 réussis et 944 ignorés ; ces derniers ne
sont pas présentés comme validés. La suite Postgres complète, exécutée seule sur
`gamenight_o06_test`, termine avec 2 498 réussis et un échec sur 2 499 tests
(224 fichiers réussis, un en échec). Cet échec est le timeout de 5 000 ms du
cas planning/OAuth de `onboarding-links.test.tsx` pendant le chargement du module.
Son ciblage isolé passe 3/3 en 1,7 seconde, sans modifier le code ni les délais.
La suite complète n’est donc pas présentée comme entièrement verte. Les deux
tests DOM O06, ajoutés après le démarrage de cette suite, passent séparément.
Après la fin de la suite complète, le ciblage commun `onboarding-links` + DOM
O06 passe également 5/5 (exit 0).

Le navigateur authentifié et mobile n’est pas disponible ; le contrôle DOM ne
remplace pas ce parcours. La validation distante du commit publié reste à
obtenir avant livraison. Aucun flag de production n’a été activé.

## Reprise après arrêt demandé

Branche : `feat/jeux-communs-participants`. Ce document, le code et tous les tests
du lot sont versionnés ensemble. Les journaux bruts locaux ne sont nécessaires
ni à la reprise ni à la reproduction des résultats ci-dessus.

1. Consulter les contrôles de la PR brouillon et leur SHA : `gh pr checks`, puis
   `gh pr view --json headRefOid,statusCheckRollup,mergeable,isDraft` depuis cette
   branche. La CI et Vercel doivent réussir sur le dernier commit avant fusion.
2. Si la CI échoue, lire son journal et corriger uniquement le défaut démontré.
   Pour reproduire localement, utiliser une base Postgres dédiée, migrée depuis
   les migrations du dépôt, et `TEST_DATABASE_URL` vers `127.0.0.1` uniquement.
   Une seule suite Postgres à la fois : `npm run test:postgres`.
3. Pour le timeout isolé : sans `TEST_DATABASE_URL`, lancer
   `npx vitest run src/app/onboarding-links.test.tsx --maxWorkers=1`.
4. Après revue des contrôles et des limitations, sortir la PR du brouillon et
   fusionner avec `--match-head-commit` sur le SHA validé, si cette action est
   de nouveau autorisée. Le travail autonome a été arrêté à la demande du
   propriétaire ; aucun lot suivant n’est engagé.
