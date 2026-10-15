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
sont pas présentés comme validés. La suite Postgres complète est encore en
cours : un dépassement de délai dans `onboarding-links.test.tsx` est signalé,
à diagnostiquer au bilan puis à relancer isolément. Le navigateur authentifié
et mobile n’est pas disponible ; le contrôle DOM ne remplace pas ce parcours.
La validation distante du commit publié reste à obtenir avant livraison.
