# Variables Vercel branch-scoped `preview-tower`

**VÉRIFIÉ le 4 novembre 2026** en interrogeant l'inventaire Vercel avec `decrypt=false` (noms, cibles, branche uniquement).

| Nom | Cible | Branche Git |
| --- | --- | --- |
| `AUTH_URL` | Preview | `preview-tower` |
| `AUTH_SECRET` | Preview | `preview-tower` |
| `DATABASE_URL` | Preview | `preview-tower` |

La branche Git `preview-tower` et la branche Neon correspondante ont été supprimées le 2 novembre selon le suivi du projet. Ces variables **semblent obsolètes**, mais ne constituent pas une preuve que d'anciennes Previews ne s'en servent plus.

## Avant suppression (accord séparé)
1. Relever les déploiements Vercel encore accessibles dont la référence Git est `preview-tower`.
2. Vérifier qu'aucun alias/domaine ne les cible et qu'aucune tâche cron-job.org ne les appelle.
3. Confirmer l'URL de branche fixe et la nouvelle base de recette.
4. Désactiver toute tâche externe pointant vers un déploiement périmé avant d'effacer des variables.
5. Supprimer les trois variables seulement après accord explicite du propriétaire, puis contrôler que la production conserve ses propres variables.

**Aucune valeur déchiffrée, aucune variable supprimée.**