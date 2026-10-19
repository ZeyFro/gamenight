# Recette authentifiée isolée

Le serveur réel Next dev peut utiliser `TEST_DATABASE_URL` : uniquement hors production, PostgreSQL et boucle locale. Une valeur invalide arrête le démarrage du client Prisma, sans repli vers Neon. Sans cette variable, et toujours en production, le client Neon reste inchangé. Ce contrôle ne détecte pas un tunnel : vérifier le conteneur et son port avant toute écriture.

La recette utilise des comptes fictifs et des JWT Auth.js normaux signés avec un secret local éphémère. Aucun fournisseur d’authentification de secours, endpoint de connexion de test ou flag n’est ajouté. Elle valide l’application après authentification, pas le flux OAuth Discord ni les permissions d’un vrai serveur Discord.

## Préparer sur le portable 1

Dans `reprise-portable1`, préserver les modifications présentes. Aucun `npm ci` nécessaire si les dépendances de la reprise sont déjà installées. Docker dédié : `gamenight-portable1-pg`, PostgreSQL sur `127.0.0.1:55440`, base `gamenight_portable1_test`, migrations 109 déjà appliquées. Ne pas lancer de suite PostgreSQL pendant la recette.

Vérifier avant écriture :

```powershell
docker inspect gamenight-portable1-pg --format '{{json .HostConfig.PortBindings}}'
docker exec gamenight-portable1-pg psql -U postgres -d gamenight_portable1_test -Atc "SELECT current_database(), current_user;"
```

Edge doit être installé. `playwright-core` est un outil de recette hors dépôt, sans téléchargement de navigateur ni modification des dépendances du projet :

```powershell
$recetteTools = Join-Path $env:TEMP 'gamenight-browser-tools'
npm install --prefix $recetteTools --no-save --package-lock=false --ignore-scripts playwright-core
```

Dans un nouveau terminal PowerShell, ne charger aucun environnement Vercel. Refuser les fichiers d’environnement locaux avant de lancer Next; effacer les variables applicatives héritées sans en afficher les valeurs :

```powershell
foreach ($recetteFile in @('.env', '.env.local', '.env.development', '.env.development.local')) {
  if (Test-Path -LiteralPath $recetteFile) { throw "Environnement non isolé : $recetteFile" }
}
Get-Content .env.example | ForEach-Object {
  if ($_ -match '^([A-Z][A-Z0-9_]*)=') {
    Remove-Item -LiteralPath ('Env:' + $Matches[1]) -ErrorAction SilentlyContinue
  }
}
Get-ChildItem Env: | Where-Object Name -Match '_ENABLED$' | ForEach-Object {
  Set-Item -LiteralPath ('Env:' + $_.Name) -Value 'false'
}
$env:TEST_DATABASE_URL = 'postgresql://postgres:test@127.0.0.1:55440/gamenight_portable1_test'
$env:DATABASE_URL = $env:TEST_DATABASE_URL
$env:AUTH_SECRET = node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))"
$env:AUTH_URL = 'http://127.0.0.1:3101'
$env:DISCORD_CLIENT_ID = 'local-unused'
$env:DISCORD_CLIENT_SECRET = 'local-unused'
$env:NOTIFICATION_EXECUTOR_ENABLED = 'false'
$env:COMMUNITY_ISOLATION_ENABLED = 'false'
$recetteTools = Join-Path $env:TEMP 'gamenight-browser-tools'
$env:PLAYWRIGHT_MODULE_PATH = Join-Path $recetteTools 'node_modules/playwright-core'
New-Item -ItemType Directory -Path logs -Force | Out-Null
$recetteServer = Start-Process node -ArgumentList @('node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', '3101') -WindowStyle Hidden -PassThru -RedirectStandardOutput logs/recette-server.log -RedirectStandardError logs/recette-server-error.log
```

Attendre `Ready` dans `logs/recette-server.log`, puis dans le même terminal :

```powershell
try { node scripts/recette-locale.mjs }
finally {
  & taskkill.exe /PID $recetteServer.Id /T /F
  Remove-Item Env:AUTH_SECRET
}
```

## Ce qui est vérifié

Exécution complète réussie sur le portable 1 le 19 octobre 2026, Edge sans interface, base de code `139aaa9` avec ce lot. Dernières fixtures conservées sous `recette-a82ee8cf-023e-4f49-b2e2-b79b5c82c061`. Serveur arrêté après recette. Vingt-huit tests ciblés répartis sur cinq fichiers réussis; le nouveau test Header reproduit le défaut de clés avant correction.

Le script refuse toute destination autre que le port et la base dédiés ci-dessus, puis confirme `current_database()` avant création de données. Les fixtures ont un identifiant aléatoire par exécution; aucun TRUNCATE ni effacement d’autres données. Elles restent conservées pour inspection, donc les répétitions accumulent des comptes de recette.

- Hôte : création d’un sondage avec un seul invité sélectionné depuis le formulaire.
- Invité : réponse explicite persistée; tiers non invité : page introuvable, sans titre privé. Next peut avoir commencé une réponse HTTP 200 avant son `notFound()`; le contrôle porte sur le contenu rendu.
- Hôte : conversion du créneau en une soirée, identifiant vérifié dans la base.
- Bibliothèques : sélection réelle de deux comptes, exclusion du jeu possédé par un seul.
- Suggestions : exclusion du refus explicite et de la catégorie Horreur, sans assouplissement.
- Visiteur anonyme : retour à l’accueil. Aucune erreur JavaScript ni clé React dupliquée; aucune livraison Discord liée à la soirée.

Les requêtes externes du navigateur sont bloquées. Ce blocage ne couvre pas le serveur : garder les identifiants externes absents, les flags désactivés et ne pas démarrer de cron. La communauté par défaut et les statistiques locales peuvent être créées à la lecture. Ne jamais lancer ce script contre une Preview ou en production.

## Accès distant encore bloqué

Le nouvel outil Vercel `get_project`, avec les identifiants de projet et d’équipe connus, renvoie encore `403 forbidden`, scope `mpmaximeparisot-6230s-projects` : « You must re-authenticate to this scope or use a token with access to this scope ». Le CLI est absent selon le relevé conservé. Il faut une connexion Vercel ayant accès à ce projet pour inspecter sa configuration Preview. La branche Neon Preview était archivée; aucune destination distante de recette n’est prouvée. Aucun nouvel essai SQL ou de connexion distante n’a été fait.
