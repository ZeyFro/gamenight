# Précontrôle Codex Cloud GameNight

Ce diagnostic local s'exécute dans l'environnement Codex publié `gamenight`, avec l'abonnement ChatGPT. Il n'appelle aucune API OpenAI et n'utilise ni clé API ni ordonnanceur GitHub payant. Il ne remplace pas les tâches de développement lancées dans Codex.

Activer Node.js 22 dans le terminal, puis, depuis la racine du dépôt :

```sh
npm ci
npx prisma generate
TEST_DATABASE_URL=postgresql://postgres:test@127.0.0.1:55439/gamenight_test node scripts/check-cloud-environment.mjs
```

L'URL ci-dessus vise uniquement la base locale jetable décrite dans `CLAUDE.md`. Démarrer PostgreSQL local avant le diagnostic. Ne jamais y substituer une URL Neon ou de Production. Les migrations locales et les tests restent des opérations distinctes ; le diagnostic ne lance aucune migration ni nettoyage.

Le script vérifie Node.js 22, le commit Git, la présence d'AGENTS.md et des documents de reprise, npm avec TLS actif, la CLI Prisma et ses moteurs, puis exécute `SELECT 1` par le client Prisma généré. Il refuse les cibles non loopback et les paramètres de redirection `host` avant de charger Prisma. Il utilise uniquement `TEST_DATABASE_URL`, jamais `DATABASE_URL` comme repli. Les erreurs externes ne sont pas reproduites dans la sortie pour éviter d'exposer des identifiants.

Un résultat réussi atteste ces prérequis, pas la cohérence du schéma, la lecture de l'issue #400, l'absence de réservations concurrentes, la CI ou le fonctionnement Discord. Chaque tâche doit encore lire les instructions, vérifier GitHub, choisir une tâche libre et exécuter ses contrôles ciblés. Aucune mesure de quota ChatGPT n'est disponible via ce script : enchaîner prudemment les tâches autorisées sans promettre une réserve de 10 %, sans boucle infinie ni appels IA inutiles.
