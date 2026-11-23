# Audit sécurité OWASP — 23/11/2026

Périmètre : routes `src/app/api/**`, server actions (225 fonctions, 82 fichiers « use server »), gardes d'accès, redirections, XSS, SQL brut. Lecture statique seulement ; aucune écriture Discord/Vercel/Neon. Aucun constat Critique ni Haute.

| Gravité | Où | Catégorie OWASP | Preuve | Correctif proposé |
|---|---|---|---|---|
| Moyenne | `src/app/api/cron/force-relogin` (et crons à effet global) | A01 Contrôle d'accès | Protégée par le seul `CRON_SECRET`, partagé avec tous les crons : une fuite du secret permet de déconnecter tout le monde | Secret dédié par route sensible ; rotation documentée |
| Moyenne | `src/app/api/igdb/search/route.ts` | A04 Conception / abus | Aucun `checkRateLimit` (seul `csp-report` en a un) : un membre connecté peut épuiser le quota IGDB | Limite par utilisateur (ex. 30/min) |
| Moyenne | `src/app/api/push/subscription/route.ts` | A04 | Pas de limite de débit sur l'enregistrement d'abonnements | Limite par utilisateur + plafond d'abonnements par compte |
| Moyenne | `src/app/api/discord/interactions` | A05 Mauvaise configuration | Corps lu en entier avant la vérification de signature Ed25519 (pas de plafond de taille) | Refuser > 64 Ko avant lecture, vérifier l'en-tête de signature d'abord |
| Basse | `src/app/api/steam/callback` | A07 Authentification | Le nonce OpenID à usage unique repose sur Steam, pas de table locale | Accepté (cookie de liaison temporaire) ; documenter |
| Basse | Server actions de délégation (`equipes/candidatures`, `equipes/recruteurs`, `tournois/equipes`, `family-import-actions`, `calendrier/actions`, `charte/actions`) | A01 | Le scan automatique n'y voit pas toujours l'identité dans le corps ; contrôle fait par des services appelés | Test d'accès par action sur un tiers non membre (à écrire), sur le modèle de `admin-guards.test.ts` |
| Basse | Server actions en écriture sans `checkRateLimit` visible | A04 | Scan : écritures sans débit dans une partie des 225 fonctions | Limite générique par utilisateur sur les écritures publiques |
| Info | Redirections | A01 | `safeNextPath` (`community-picker.ts`) refuse `//hôte`, `\\`, caractères de contrôle, boucle `/serveurs` ; `callbackUrl` jamais lu côté app | Aucun |
| Info | XSS | A03 | `dangerouslySetInnerHTML` interdit dans `src` par `no-dangerous-html.test.ts` ; aucun `eval`/`new Function` | Aucun |
| Info | SQL brut | A03 | `$queryRawUnsafe`/`$executeRawUnsafe` uniquement dans des fichiers `*.test.*` (TRUNCATE) | Aucun |
| Info | Variables publiques | A02 | Aucune `NEXT_PUBLIC_*` portant un secret dans `src` | Aucun |

## Routes sans constat

Crons et backfills (tous via `verifyCronRequest`, testé, 503 sans `CRON_SECRET`), flux iCal (jeton privé révocable, membre ACTIVE à chaque lecture), `media`, `compte/export` (sa personne seulement), `health`, `admin/*` (`requireAdmin`, 404 éteint), routes Tower admin.

## Tests à écrire

Aucun constat Critique/Haute. Recommandés : (1) limite de débit IGDB et push ; (2) taille maximale du corps de `/api/discord/interactions` ; (3) accès d'un tiers non membre aux actions de délégation listées.
