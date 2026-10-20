# Recette navigateur locale du bracket par équipes

Depuis ce worktree, lancer `scripts\recette-bracket-equipes.ps1` dans PowerShell. Le script exige le conteneur PostgreSQL dédié `gamenight-bracket-recipe-pg` déjà démarré avec le seul port `127.0.0.1:55441`, vérifie la base `gamenight_bracket_recipe` et compare son adresse IP à celle du conteneur PostgreSQL dédié, puis applique les migrations locales et lance Edge sans interface. Il utilise le `playwright-core` déjà présent dans le cache local; si son chemin diffère, définir `GAMENIGHT_PLAYWRIGHT_MODULE_PATH`.

Le navigateur bloque toute requête dont l'origine diffère de `http://127.0.0.1:3103`. Le script crée des identifiants et un tournoi uniques, teste l'affichage des équipes et des actions de score, refuse l'accès au tiers, vérifie le débordement mobile, puis contrôle le champion après rechargement. La fixture est conservée dans la base dédiée pour permettre l'examen; aucun nettoyage n'est effectué.

Exécutée le 20 octobre 2026 : `OK bracket équipes : membres, accès tiers refusé, mobile, champion persistant`. Une première passe a servi à corriger le délai de navigation (compilation initiale de 29 secondes), une seconde à resserrer un sélecteur ambigu; la passe finale a réussi. Cette preuve concerne le rendu local authentifié sur la base isolée, pas Production ni Discord.
