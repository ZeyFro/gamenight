# Développement local

Cette procédure utilise PostgreSQL 16 dans Docker, attaché à l’interface loopback. Elle ne demande aucun compte Neon ni aucune base distante.

## Prérequis

- Node.js 22 et npm ;
- Docker avec le service Docker démarré ;
- le dépôt cloné à la racine.

## PostgreSQL de développement

Depuis PowerShell ou un terminal :

    docker run --name gamenight-local-postgres -e POSTGRES_PASSWORD=local-dev-only -e POSTGRES_DB=gamenight_dev -p 127.0.0.1:55439:5432 -d postgres:16-alpine

Le mot de passe ci-dessus est un exemple local jetable, pas un secret à réutiliser. Le port n’écoute que sur la machine locale.

Depuis la racine, copie l’exemple puis édite `.env` :

    cp .env.example .env

Renseigne les deux URLs suivantes avec la même adresse de développement :

    DATABASE_URL=postgresql://postgres:local-dev-only@127.0.0.1:55439/gamenight_dev
    TEST_DATABASE_URL=postgresql://postgres:local-dev-only@127.0.0.1:55439/gamenight_dev

TEST_DATABASE_URL est employée par l’application hors production uniquement si l’hôte est 127.0.0.1, localhost ou [::1]. Cette garde empêche cette voie de recette de viser une base hébergée. Garde .env local et ne copie aucune vraie valeur dans .env.example.

## Installer, migrer et démarrer

    npm ci
    npx prisma migrate deploy
    npm run dev

La migration s’applique à l’URL DATABASE_URL. Vérifie qu’elle désigne bien gamenight_dev avant de lancer la commande.

L’application démarre sans identifiants Discord, mais il faut configurer OAuth pour tester la connexion. Dans .env, renseigne AUTH_SECRET, DISCORD_CLIENT_ID et DISCORD_CLIENT_SECRET. Génère un secret local avec :

    node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"

Renseigne aussi `AUTH_URL=http://localhost:3000`. Dans le portail Discord, ajoute `http://localhost:3000/api/auth/callback/discord` comme URL de retour. Pour ouvrir une session, le compte doit appartenir à une communauté ACTIVE ou figurer dans `ADMIN_DISCORD_IDS`. N’utilise pas de vrai secret dans un exemple ou une capture publiée.

## Tests

Les tests sans base s’exécutent avec :

    npm test

Pour les tests d’intégration, crée une base distincte ; le script peut supprimer des lignes de test :

    docker exec gamenight-local-postgres createdb -U postgres gamenight_test

Modifie temporairement DATABASE_URL et TEST_DATABASE_URL pour qu’ils pointent tous deux vers gamenight_test, applique ses migrations, puis exécute les tests en série :

    npx prisma migrate deploy
    npm run test:postgres

Ne configure pas ces URLs vers Neon, Preview ou Production. Après les tests, remets l’URL de développement dans .env.

## Compilation

npm run build ne migre plus (prisma generate puis next build); les migrations s'appliquent avec `node scripts/db-migrate.mjs` ou `npx prisma migrate deploy` en local. Pour compiler localement, garde donc DATABASE_URL dirigée vers la base locale. La CI lance directement npx next build après avoir préparé sa base PostgreSQL de service.
