# Défi d'équipe quotidien — préparation technique 18:00 Europe/Paris

**Objectif validé :** un défi quotidien par équipe à 18:00 heure de Paris (décision du 17/11/2026, ancien horaire 09:00). Aucun cron n'a été ajouté dans cron-job.org.

## Route dédiée souhaitée (à coder sans toucher au cron existant)
- `GET /api/cron/tower-team-daily`, protégée par `verifyCronRequest` et par `TOWER_TEAM_DAILY_ENABLED=false` défaut OFF ; répondre HTTP 503 en Preview.
- Exécuter uniquement la fonction d'attribution quotidienne, **pas** le règlement des votes ou les annonces.
- Verrou par communauté/date Paris (transactions Serializable + clé idempotente existante), éviter deux attributions sur deux déclencheurs.
- Retour JSON : date Paris, équipes éligibles, attributions, déjà attribuées, échecs ; aucune donnée personnelle.
- Ne rien envoyer vers The Tower avant validation séparée du flag Discord d'annonces.

## Configuration cron-job.org à créer APRÈS accord
- URL de production de la route, méthode GET, en-tête Authorization Bearer `CRON_SECRET` déjà stocké dans le service (jamais dans le chat).
- Fuseau **Europe/Paris** et horaire **18:00 chaque jour**, pour le passage automatique CET/CEST. Si le service n'offre pas la bonne gestion DST, utiliser un ordonnanceur qui la garantit ; ne jamais fixer un seul horaire UTC toute l'année (16:00 UTC en été, 17:00 UTC en hiver).
- Retry contrôlé à 18:05 seulement si l'endpoint est idempotent ; surveillance des retours 2xx/503/5xx.
- Vérifier les premières attributions en recette isolée.

## Blocage
La fonction `assignDailyTowerTeamChallenges` est aujourd'hui **privée** dans `src/lib/tower-challenges.ts`, fichier réservé par #373. Une route ne peut pas l'appeler proprement avant extraction/revue ; ne pas contourner avec `settleDueTowerChallenges`, qui règle aussi les votes. Aucune route ni tâche externe créée par cette PR.
