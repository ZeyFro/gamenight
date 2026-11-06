# The Tower — workflow de défi d'équipe quotidien à 09:00 Europe/Paris

## État

La PR prépare le workflow `.github/workflows/tower-team-daily.yml`. Il est inactif tant qu'il n'est pas fusionné dans la branche par défaut. GitHub Actions n'exécute les workflows planifiés que depuis cette branche; la présence du fichier sur cette branche de PR ne déclenche aucun appel.

Aucune URL d'hôte de production ni valeur de secret n'est stockée dans le dépôt ou dans cette documentation.

## Fonctionnement préparé

- Route appelée : `GET /api/cron/tower-team-daily`.
- Authentification : `Authorization: Bearer` avec le secret GitHub Actions `CRON_SECRET), dont la valeur devra correspondre à celle déjà acceptée par l'endpoint.
- Hôte : variable GitHub Actions `GAMENIGHT_CRON_BASE_URL`, origine HTTPS uniquement; aucun hôte n'est codé en dur.
- Calendrier GitHub, en UTC : `0 7,8 * * *`.
  - été : 07:00 UTC correspond à 09:00 Paris; 08:00 UTC est ignoré;
  - hiver : 08:00 UTC correspond à 09:00 Paris; 07:00 UTC est ignoré.
- Le workflow vérifie l'heure Europe/Paris et appelle l'endpoint uniquement pendant l'heure locale 09.
- Deux déclencheurs UTC couvrent les changements CET/CEST. La clé d'idempotence de l'endpoint est fondée sur la date Europe/Paris; elle évite une nouvelle attribution si un appel est rejoué ou si deux exécutions atteignent le même jour.
- HTTP 503 signifie que le lot est incomplet ou qu’au moins une attribution a échoué : le workflow retente jusqu'à 3 appels au total, avec une attente croissante. Tout statut différent de 200 ou toute réponse non confirmée `enabled=true, failed=0, complete=true` fait échouer l'exécution.
- Une route désactivée renvoie 200 avec `enabled=false`; le workflow traite ce cas comme un échec visible, sans le présenter comme une attribution réussie.
- `TOWER_TEAM_DAILY_ENABLED=true` et `TOWER_CHALLENGES_ENABLED=true) restent nécessaires dans l'environnement de l'application. Ce PR ne les active ni ne les modifie.

## Activation par le propriétaire, après revue

1. Dans les paramètres du dépôt GitHub, créer le secret Actions `CRON_SECRET` avec la valeur déjà configurée pour authentifier l'endpoint. Ne jamais la publier dans une issue, une PR ou le chat.
2. Créer la variable Actions `GAMENIGHT_CRON_BASE_URL` avec l'origine HTTPS de l'application prise depuis la source de déploiement autorisée; ne pas la mettre dans le code.
3. Confirmer séparément que les interrupteurs d'application sont déjà activés et que l'endpoint est disponible. Si ce n'est pas le cas, arrêter ici : cela requiert une décision de configuration distincte.
4. Fusionner la PR dans la branche par défaut. Le schedule devient alors actif automatiquement; aucun workflow planifié ne s'exécute depuis la branche de PR.
5. Contrôler la première exécution planifiée : un seul slot doit appeler l'endpoint à 09:00 Paris, le résultat doit confirmer `enabled=true`, `failed=0` et `complete=true), et l'autre slot UTC doit être ignoré. Examiner tout échec avant de modifier une configuration.

Aucun workflow n'est déclenché manuellement par cette PR. Aucun secret, hôte de production, changement de configuration, appel HTTP réel, action Discord ou migration n'est effectué pendant sa préparation.

## Reprise et budget du lot

Chaque appel sélectionne au plus 101 équipes sans attribution pour la date Europe/Paris et en traite au plus 100. Une page supplémentaire ou un budget expiré donne `complete=false` et HTTP 503, même sans erreur d’attribution. La reprise ignore les attributions du jour déjà présentes ; la clé unique reste le filet contre les appels concurrents.

Le budget restant borne l’attente de connexion et la transaction Prisma ; PostgreSQL reçoit aussi un statement_timeout réactualisé avant chaque instruction de l’attribution. Aucun Promise.race ne laisse une écriture continuer après retour. Les appels interactifs sans échéance conservent leurs budgets précédents.

Le workflow retente les HTTP 503/504 et les erreurs de transport, trois appels au total, sans dupliquer les attributions déjà effectuées. Il n’accepte un succès que si enabled=true, failed=0 et complete=true. Au-delà de trois lots ou d’un échec persistant, il échoue explicitement ; aucun succès partiel silencieux. Aucune activation externe n’est réalisée par ce changement.
