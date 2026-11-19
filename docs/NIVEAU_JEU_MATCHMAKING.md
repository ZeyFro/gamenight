# Niveau par jeu : matchmaking et équilibrage de tournoi

Interrupteur : `GAME_LEVELS_MATCHMAKING_ENABLED` (OFF par défaut, valeur exacte `true`), qui exige aussi `GAME_LEVELS_ENABLED` (#468). **Aucune migration.**
À fusionner après #468 (`claude/niveaux-par-jeu`, migration `20261118123100_user_game_levels`) : cette branche l'inclut par fusion (la migration de #468 est corrigée à la source : elle n'était appliquée sur aucune base partagée).

- Libellés décidés : Débutant / Intermédiaire / **Confirmé** / **Compétitif**. Valeurs stockées : DEBUTANT / INTERMEDIAIRE / CONFIRME / COMPETITIF (enum renommée dans #468, décision du 19/11/2026).
- **Matchmaking** (`/joueurs`) : chaque annonce affiche le niveau déclaré de son auteur pour SON jeu ; filtre « niveau minimum » (un auteur sans niveau est écarté quand le filtre est actif). Filtre appliqué après lecture (la relation annonce→jeu→niveau n'est pas exprimable en SQL simple), sur au plus les annonces actives (24 h).
- **Tournois par équipes aléatoires** (format TEAMS, équipes de 2 tirées au lancement) : appariement fort avec faible selon le niveau pour le jeu du tournoi ; sans aucun niveau déclaré, tirage aléatoire inchangé. Les inscrits sans niveau comptent au milieu de l'échelle. Les tournois de PR « tournois par équipes » peuvent utiliser `seedByAverageLevel` pour répartir les têtes de série.
- **Vie privée** : les profils masqués (`PROFILE_VISIBILITY_ENABLED`) n'exposent ni ne filtrent leur niveau.
- **Rang importé (V2)** : `GameLevelSource = "DECLARED" | "IMPORTED"` et `resolveGameLevel(declared, imported?)` fixent l'interface (un niveau importé primerait). Rien n'est importé ni stocké : pas de colonne `source`, donc pas de migration ; elle viendra avec l'import.
