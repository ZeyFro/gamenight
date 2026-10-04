# Backlog auto-généré

Idées d'amélioration générées par Claude (session du 2026-10-04), classées selon les sources demandées :
1. demandes déjà exprimées dans le dépôt et les docs, 2. bugs connus, 3. audit du code, 4. UX.
Taille : XS < 1 h · S ≈ demi-journée · M ≈ 1 jour. Risque / valeur : faible · moyen · élevé.

Plafond de 20 PR Draft ouvertes : les idées 1 à 3 ont été réalisées d'emblée, les idées 4 et 5 dès qu'une place s'est libérée (PR #136 mergée, #137 passée en Ready). Une PR Draft par idée.

| # | Idée | Source | Taille | Risque | Valeur | Statut |
| - | ---- | ------ | ------ | ------ | ------ | ------ |
| 1 | **Route `/api/health` protégée par `CRON_SECRET`** (ping base), pour qu'un monitoring cron-job.org alerte si l'app ou Neon tombe | Bug connu : une coupure plateforme n'est visible que par un `début` sans `fin` dans les logs (README, « Référence : routes cron ») | S | faible (fail-closed 503 comme les crons, aucun secret exposé) | élevée | PR #152 |
| 2 | **Garde-fous de `/api/igdb/search`** : requête tronquée à 100 caractères, aucun appel IGDB pour une requête trop courte | Audit du code : route authentifiée mais sans borne sur `q`, relayée telle quelle à IGDB | XS | faible | moyenne | PR #153 |
| 3 | **Test de cohérence `.env.example` ↔ code** : échoue si une variable `process.env.X` utilisée dans `src` n'est pas documentée dans `.env.example` | Audit du code : le tableau des env et `.env.example` dérivent à chaque nouvelle variable (cf. phase 6 docs V2) | S | nul (test seul) | moyenne | PR #154 |
| 4 | **`robots.ts` « Disallow: / »** : l'app est réservée aux potes connectés, empêche l'indexation des pages publiques (connexion, profils partagés) | Audit du code : aucun `robots` ni `noindex` global | XS | faible | faible-moyenne | PR #155 |
| 5 | **Titres de page par route** (`metadata.title` via un gabarit `%s · GameNight`) sur les ~40 pages qui n'en ont pas : onglets lisibles, historique du navigateur, lecteurs d'écran | UX / accessibilité (WCAG 2.4.2) | M | faible, mais visible (titre d'onglet) : réalisée derrière le drapeau `PAGE_TITLES_ENABLED` (éteint par défaut) | moyenne | PR #156 |

## Deuxième série (générée quand une place s'est libérée)

| # | Idée | Source | Taille | Risque | Valeur | Statut |
| - | ---- | ------ | ------ | ------ | ------ | ------ |
| 6 | **Test de cohérence README « routes cron » ↔ routes API** : échoue si une route `/api/cron/*` ou `/api/backfill/*` n'est pas citée dans le tableau de référence du README | Demande déjà exprimée : le tableau des crons est tenu à la main depuis la phase 6 (docs V2) et dérive à chaque nouvelle route | S | nul (test seul) | moyenne | PR #157 |
| 7 | **Tests unitaires des modules `src/lib` encore sans test** (`superlative-voting`, `storage-audit`, `home`…) | Audit du code : classement de couverture du lot L2 | M | nul (tests seuls) | moyenne | PR en cours (`storage-audit` ; `superlative-voting` et `home` déjà testés) |
| 8 | **Collecte des violations CSP** : route `/api/csp-report` + `report-to`, derrière un nouveau drapeau `CSP_REPORT_ENABLED` éteint par défaut | Rapport L7 (`docs/rapport-csp-bloquant.md`, étape 1) | M | moyen (point d'entrée public : taille et débit à borner) | élevée | À faire |
| 9 | **Titres d'onglet dynamiques** (nom du jeu, de la soirée, du pote) pour les pages avec identifiant | UX, suite de #156 | S | faible (une requête de plus par page, derrière `PAGE_TITLES_ENABLED`) | moyenne | À faire, après #156 |
| 10 | **Lien d'évitement « Aller au contenu »** (visible seulement au focus clavier) | Accessibilité (WCAG 2.4.1) | XS | faible, mais visible au clavier : à valider avec Maxime ou derrière un drapeau | moyenne | À faire |

## Troisième série (générée le 2026-10-04, plus aucune idée libre)

| # | Idée | Source | Taille | Risque | Valeur | Statut |
| - | ---- | ------ | ------ | ------ | ------ | ------ |
| 11 | **Test garde-fou : toute route cron/backfill passe par `cron-auth`** (fail-closed 503) | Audit du code : une route copiée sans contrôle serait publique, invisible de tsc/lint/build | XS | nul (test seul) | moyenne | PR en cours |
| 12 | **Test : chaque variable de « Switches d'environnement » (CLAUDE.md) existe dans `.env.example`** | Audit du code : doc des drapeaux dérive | XS | nul (test seul) | faible-moyenne | PR en cours |
| 13 | **Page `/aide` (FAQ des potes)** : comment rejoindre une soirée, voter, lier Steam | UX : onboarding des nouveaux potes | M | faible (page nouvelle, lien discret) | moyenne | À faire |
| 14 | **Test : toute route `/api/*` hors cron exige `auth()` ou est listée en exception** | Audit du code (sécurité) | S | nul (test seul) | élevée | PR Draft |

## Idées écartées (à discuter)
- **Récaps et récompenses Discord via le bot** et **multi-serveur Discord** : déjà listés dans « Reporté après V2 » (README) ; touchent aux fonctions et drapeaux `DISCORD_*`, donc hors périmètre autonome.
- **Page d'état des interrupteurs d'environnement** : utile pour l'exploitation mais lirait les drapeaux `DISCORD_*` ; à décider avec Maxime.
- **`loading.tsx` sur les routes qui n'en ont pas** (tierlist, tournois, wishlist, roulette, jeux, dettes, saisons, recap) : changement visible pendant le chargement, non gérable derrière un drapeau.
