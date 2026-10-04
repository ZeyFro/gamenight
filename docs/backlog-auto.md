# Backlog auto-généré

Idées d'amélioration générées par Claude (session du 2026-10-04), classées selon les sources demandées :
1. demandes déjà exprimées dans le dépôt et les docs, 2. bugs connus, 3. audit du code, 4. UX.
Taille : XS < 1 h · S ≈ demi-journée · M ≈ 1 jour. Risque / valeur : faible · moyen · élevé.

Plafond de 20 PR Draft ouvertes : seules les idées 1 à 3 ont été réalisées (une PR Draft chacune) ; les idées 4 et 5 restent à faire.

| # | Idée | Source | Taille | Risque | Valeur | Statut |
| - | ---- | ------ | ------ | ------ | ------ | ------ |
| 1 | **Route `/api/health` protégée par `CRON_SECRET`** (ping base), pour qu'un monitoring cron-job.org alerte si l'app ou Neon tombe | Bug connu : une coupure plateforme n'est visible que par un `début` sans `fin` dans les logs (README, « Référence : routes cron ») | S | faible (fail-closed 503 comme les crons, aucun secret exposé) | élevée | PR #152 |
| 2 | **Garde-fous de `/api/igdb/search`** : requête tronquée à 100 caractères, aucun appel IGDB pour une requête trop courte | Audit du code : route authentifiée mais sans borne sur `q`, relayée telle quelle à IGDB | XS | faible | moyenne | PR #153 |
| 3 | **Test de cohérence `.env.example` ↔ code** : échoue si une variable `process.env.X` utilisée dans `src` n'est pas documentée dans `.env.example` | Audit du code : le tableau des env et `.env.example` dérivent à chaque nouvelle variable (cf. phase 6 docs V2) | S | nul (test seul) | moyenne | PR #154 |
| 4 | **`robots.ts` « Disallow: / »** : l'app est réservée aux potes connectés, empêche l'indexation des pages publiques (connexion, profils partagés) | Audit du code : aucun `robots` ni `noindex` global | XS | faible | faible-moyenne | À faire |
| 5 | **Titres de page par route** (`metadata.title` via un gabarit `%s · GameNight`) sur les ~40 pages qui n'en ont pas : onglets lisibles, historique du navigateur, lecteurs d'écran | UX / accessibilité (WCAG 2.4.2) | M | faible, mais visible (titre d'onglet) : à mettre derrière un drapeau ou à valider avec Maxime | moyenne | À faire |

## Idées écartées (à discuter)
- **Récaps et récompenses Discord via le bot** et **multi-serveur Discord** : déjà listés dans « Reporté après V2 » (README) ; touchent aux fonctions et drapeaux `DISCORD_*`, donc hors périmètre autonome.
- **Page d'état des interrupteurs d'environnement** : utile pour l'exploitation mais lirait les drapeaux `DISCORD_*` ; à décider avec Maxime.
- **`loading.tsx` sur les routes qui n'en ont pas** (tierlist, tournois, wishlist, roulette, jeux, dettes, saisons, recap) : changement visible pendant le chargement, non gérable derrière un drapeau.
