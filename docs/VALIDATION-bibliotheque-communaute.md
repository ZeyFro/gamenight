# Bibliothèque de la communauté active

## Comportement

Avec `COMMUNITY_ISOLATION_ENABLED=true`, la bibliothèque de groupe et la tierlist utilisent uniquement les jeux possédés par au moins un membre actif du serveur affiché. Les possesseurs, leurs avatars, les compteurs par jeu et la borne des filtres utilisent le même périmètre. La bibliothèque personnelle garde les jeux du joueur ; ses compteurs de groupe et ceux de la wishlist sont restreints au serveur affiché.

Sans appartenance active, avec une communauté suspendue, ou avec plusieurs serveurs sans choix valide : aucun jeu collectif, aucun possesseur et des compteurs nuls. Le changement de serveur relit la préférence et les appartenances. Isolation OFF : comportement global historique conservé.

Aucune nouvelle migration, dépendance ou variable. Le correctif n'active aucun flag.

## Validation

- TypeScript et ESLint ciblé : réussis localement.
- Huit scénarios Postgres ajoutés : jeux et avatars isolés, compteurs cohérents, changement de serveur, absence de communauté, membre retiré, communauté suspendue, choix invalide et isolation OFF.
- Pas de Postgres opérationnel dans le runtime local : ces scénarios doivent être exécutés par le service Postgres isolé de la CI, en série. Un test ignoré localement ne constitue pas une validation.
- Compilation et suite unitaire locales en cours au moment de l'ouverture ; résultats finaux dans la PR et son check `verify` sur le dernier commit.
- Relecture React : lectures parallèles conservées, aucun changement des interactions ni des composants clients ; seules les données autorisées sont transmises à la grille.

## Vérification utilisateur après déploiement

1. Avec deux serveurs possédant des jeux différents, vérifier les jeux, avatars et compteurs de la bibliothèque de groupe.
2. Changer de serveur : vérifier bibliothèque, tierlist, filtre des possesseurs et compteur wishlist.
3. Retirer un membre : ses avatars et possessions ne doivent plus contribuer au serveur quitté.
4. Isolation OFF : vérifier le comportement global historique.

## État de la chaîne

- #227 : CI et preview vertes sur `85edd3993f36f2697251401a6859b71b2abd0700` ; passage en Ready effectué. Merge refusé par le contrôle automatique d'approbation, qui demande une autorisation explicite du mainteneur dans ce fil.
- Bibliothèque : correctif et tests dans cette PR indépendante de #227.
- Prochain lot : rappels après changement de date, y compris idempotence des livraisons Discord et concurrence avec le cron.
- Aucun test Neon ni notification Discord réelle. Accès Vercel direct refusé 403 ; état des previews consulté via GitHub.

Plugins et skills utilisés : GitHub, Vercel (inspection refusée), Vercel Deployments/CI-CD, Vercel React Best Practices. Développement et relecture réalisés par l'agent principal ; aucun sous-agent lancé.
