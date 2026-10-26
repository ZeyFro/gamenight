# The Tower — revue des rôles et permissions

Analyse de l’instantané REST du 26 octobre 2026. Ce résumé public n’expose pas l’identifiant du serveur ni les noms, identifiants ou réglages détaillés des rôles; le rapport complet reste local et est ignoré par Git.

## Constats vérifiés

- L’export contient **197 rôles**, dont **134 rôles Etage**. Le classificateur propose 49 `keep`, 145 `review`, trois rapprochements fondés sur les noms et aucun archivage ou retrait.
- **13 rôles** possèdent `ADMINISTRATOR`; quatre ne sont pas des rôles d’intégration gérés. Cette permission contourne les overwrites de salons. Les propriétaires et usages réels ne figurent pas dans l’export.
- Des droits de gestion de rôles, salons, messages et mentions sont accordés à certains rôles ou par overwrites ciblés. Trois overwrites font référence à un ID de rôle absent de la liste exportée.
- Trois rapprochements sont des suggestions de similarité textuelle seulement; l’un compare des niveaux de privilèges différents.

## Décision prudente

Conserver les 197 rôles et leurs permissions. Ne fusionner, renommer, archiver ou supprimer aucun rôle et ne modifier aucun overwrite sur la base de cette capture. L’export ne contient ni membres ni attributions, ne prouve pas qu’un rôle est inutilisé et ne permet pas de calculer les droits effectifs d’une personne.

Avant toute simplification, inventorier en privé les attributions, propriétaires, bots dépendants et permissions effectives; produire une correspondance réversible et vérifier les cas extrêmes. Les 134 rôles Etage restent intacts jusqu’à une correspondance testée avec la progression GameNight.
