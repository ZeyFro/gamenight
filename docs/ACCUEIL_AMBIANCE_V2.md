# Accueil et décor V2

Base : `main` à `6c804d4` (PR #205).

Quand aucune soirée n’est prévue, l’accueil présentait une courte carte vide
face à une colonne XP/statistiques plus haute. « Jouer maintenant » était
repoussé sous les deux colonnes. Le décor global était très peu visible.

## Changements

- Halos violets/bleus plus visibles, grille étoilée et constellations SVG
  statiques ; toujours sept météores sur ordinateur, sans canvas ni WebGL.
- Colonne soirées complétée par le calendrier/disponibilités, la bibliothèque
  du groupe, la tierlist et « Jouer maintenant ». Ce dernier reste distinct de
  la roulette instantanée.
- État sans soirée illustré, invitation à proposer la première soirée.
- Défi hebdomadaire remonté ; sections secondaires sur deux colonnes dès
  1 024 px, une colonne sur téléphone/tablette. Accueil élargi à 1 280 px.
- GIFs/avatars, badges, XP, trophées, saisons, récaps, dettes et accès existants
  conservés. Aucun changement du chargement des données, des filtres ou des
  actions serveur ; aucune nouvelle requête SQL ni aucun nouveau polling.
- Préchargement désactivé pour les nouveaux liens afin de ne pas charger
  plusieurs pages et leurs requêtes avant un clic.

## Animation et validation

Le décor statique reste visible en pause. Les météores sont démontés avec la
préférence de pause, le mode mouvement réduit, un petit écran ou un onglet
caché. Les halos CSS sont arrêtés par la préférence, l’onglet caché, le mode
réduit et sur téléphone. Deux halos animés, un halo fixe, une grille et un
SVG seulement ; pas d’animation de `background-position` ou de flou continu.

Tests ciblés : pause persistée après remontage, mode réduit, changement de
taille et masquage/retour de l’onglet. Navigation et données d’accueil couvertes
par les tests existants exécutés avec eux.

Validation locale : 17 tests réussis dans quatre fichiers, TypeScript et
ESLint réussis ; `git diff --check` sans erreur. Build Webpack avec polices
locales de substitution réussi. Aucun test Postgres local exécuté : la suite
complète est confiée au Postgres isolé de CI.

Le navigateur distant n’accède pas au serveur de rendu local. La composition
connectée n’a donc pas été validée visuellement ici. À vérifier sur la Preview
après connexion : 390 px et ordinateur, avec/sans prochaine soirée, défi
présent/absent, animations activées/en pause et avatar GIF. Vérifier les quatre
nouveaux liens, le bouton de création et l’absence de débordement horizontal.

Google Fonts est inaccessible dans cet environnement. Le build normal local
est bloqué sur ce téléchargement ; la compilation locale utilise uniquement
pour validation les réponses de polices simulées de Next avec des polices
système et `next build --webpack`. Aucun mock de police ni fixture n’est
committé. CI/Vercel doivent valider le build normal sans ces substitutions.

Aucune migration, dépendance ajoutée, notification Discord réelle, modification
de flag ou activation en production.
