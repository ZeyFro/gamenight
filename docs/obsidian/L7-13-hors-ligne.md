# L7-13 — Mode hors ligne PWA (16/11/2026)

Branche locale `agent/preflight-20261116` (suite de [[P1-03-navigation]]), issue
de `origin/main` à `df2f3ed`. Aucun push, aucune PR, aucune migration.

## Règle appliquée

Shell public uniquement. Le service worker (`public/service-worker.js`)
précache une **liste blanche explicite** : `/offline.html`, `/manifest.json`,
`/icon-192.png`, `/icon-512.png`. Il ne met jamais en cache une page HTML, une
réponse `/api/`, une requête portant `Authorization`, ni une réponse avec
`Set-Cookie` ou `Cache-Control: private|no-store`. Une navigation hors ligne
échoue côté réseau et reçoit la page statique : aucun écran blanc.

## Ce qui est visible

- Page `/offline.html` refaite à l'identité GameNight : marque, titre « Hors
  connexion », explication, état « En attente de la connexion… », bouton
  **Réessayer**. Le lien « Retour à l'accueil » n'apparaît qu'après un
  événement `online` réel — l'accueil n'étant pas mis en cache, il n'est jamais
  proposé à tort.
- Bandeau discret dans l'application (`OfflineBanner`, rendu dans `layout.tsx`) :
  « Hors ligne — les pages non encore ouvertes sont indisponibles », puis
  « Connexion retrouvée » + bouton **Recharger**. Aucune action automatique.

## Preuves

- `src/lib/service-worker.test.ts` — 16 tests, dont : liste blanche précachée,
  refus `/api/`, refus des requêtes authentifiées, refus `Set-Cookie` et
  `no-store`, pages privées jamais stockées, **scénario appareil partagé**
  (connexion → page privée → API → déconnexion → hors ligne : le cache ne
  contient que les quatre ressources publiques).
- `src/components/OfflineBanner.test.tsx` — 3 tests (invisible en ligne, message
  hors ligne sans relance, retour réseau sans rechargement automatique).
- `src/components/offline-page.browser.test.tsx` — 3 tests Chrome réel à 390 et
  1280 px (aucun débordement, cible ≥ 44 px, accueil masqué hors ligne).
- **Recette réelle** : build de production + `next start`, Chrome piloté en
  CDP. Service worker installé, cache observé = les quatre ressources publiques,
  serveur arrêté, navigation vers `/sessions` → page hors ligne, « Réessayer »
  relance sans succès, serveur relancé → « Connexion retrouvée », accueil
  proposé, clic → page d'accueil chargée.
- Captures : `docs/captures-p1-03/offline-{mobile,desktop}.png` et
  `banner-offline-mobile.png`.

## Limites

- Le cache ne contient aucune page : hors ligne, l'application affiche la page
  statique, pas une version consultable des soirées. C'est la règle validée.
- Aucune recette sur un appareil mobile physique ni sur Vercel ; cache et
  service worker testés en localhost (contexte sécurisé).
- Le bandeau dépend de `navigator.onLine` ; un serveur injoignable alors que le
  réseau est annoncé « connecté » n'affiche pas le bandeau (la page hors ligne,
  elle, reste correcte).
- Aucun test PostgreSQL, aucune action Discord, aucune modification Production.
