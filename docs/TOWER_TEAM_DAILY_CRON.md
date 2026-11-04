# The Tower — cron défi d'équipe quotidien à 09:00 Europe/Paris

## État

Cette PR prépare uniquement le code. **Aucune tâche cron-job.org n'est créée.**

Route :

```text
GET /api/cron/tower-team-daily
```

Protections :
- `CRON_SECRET` obligatoire via `Authorization: Bearer …` ;
- refus automatique en Vercel Preview ;
- `TOWER_TEAM_DAILY_ENABLED=true` obligatoire, sinon réponse sans effet ;
- `TOWER_CHALLENGES_ENABLED=true` reste également nécessaire dans la logique Tower ;
- budget interne borné à environ 20 secondes ;
- attribution idempotente grâce à la clé quotidienne déjà utilisée par `getTeamDailyTowerChallenge`.

Le flag est donc **OFF par défaut** si la variable est absente.

## Tâche cron-job.org à créer après accord

À créer seulement après validation en recette :

- méthode : `GET` ;
- URL : `<URL_PRODUCTION_GAMENIGHT>/api/cron/tower-team-daily` ;
- relever l’alias Production réellement actif dans Vercel au moment de l’activation ; ne pas figer dans la doc un ancien alias du projet ;
- horaire : **09:00 chaque jour** ;
- fuseau : **Europe/Paris** afin de suivre automatiquement CET/CEST ;
- en-tête : `Authorization: Bearer <CRON_SECRET>` ;
- ne jamais copier le secret dans Git, Discord ou une documentation ;
- conserver la tâche désactivée jusqu'à l'accord d'activation.

Si l'ordonnanceur utilisé ne garantit pas le fuseau Europe/Paris et le changement heure d'été/hiver, ne pas programmer une heure UTC fixe toute l'année : choisir un ordonnanceur qui sait gérer le fuseau.

## Recette avant activation

1. brancher une Preview uniquement sur la base de recette isolée ;
2. confirmer que la route Preview répond 503, même avec un secret correct ;
3. tester la route hors Preview avec `TOWER_TEAM_DAILY_ENABLED` absent : aucune attribution ;
4. activer le flag uniquement sur l'environnement de recette ;
5. appeler deux fois la route le même jour et vérifier qu'une équipe conserve le même défi quotidien ;
6. vérifier qu'aucun message Discord n'est produit par cette route ;
7. seulement après accord, configurer la tâche externe Production.

## Coordination

`.env.example` n'est pas modifié tant que #370 le réserve. Avant fusion de ce lot, ajouter :

```text
TOWER_TEAM_DAILY_ENABLED=
```

La valeur vide maintient le comportement OFF.
