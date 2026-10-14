# Rapport : passer la CSP en mode bloquant

> Rapport d'analyse, **docs seulement** : aucun changement de `next.config.ts` dans cette PR.
> État au 2026-10-04, branche `main`.

## 1. État actuel

`next.config.ts` envoie `Content-Security-Policy-Report-Only` sur `/:path*` :

| Directive | Valeur |
| --- | --- |
| `default-src` | `'self'` |
| `script-src` | `'self' 'unsafe-inline'` (+ `'unsafe-eval'` en dev) |
| `style-src` | `'self' 'unsafe-inline'` |
| `img-src` | `'self' data: blob: https:` |
| `font-src` | `'self' data:` |
| `connect-src` | `'self'` |
| `frame-src` | `https://www.youtube-nocookie.com` |
| `worker-src` | `'self' blob:` |
| `object-src` | `'none'` |
| `base-uri` | `'self'` |
| `form-action` | `'self' https://discord.com https://steamcommunity.com` |
| `frame-ancestors` | `'none'` |

En Report-Only, **rien n'est bloqué** et il n'y a **aucun `report-uri` / `report-to`** : les violations ne sont visibles que dans la console de chaque navigateur. Il n'existe donc aucune donnée agrégée sur les violations réelles.

## 2. Ce que l'application charge réellement (audit statique du code)

| Besoin | Où | Directive concernée | Couvert ? |
| --- | --- | --- | --- |
| Appels `fetch` côté client : `/api/igdb/search` (3 composants) | `AjouterJeuForm`, `WishlistProposeForm`, `TournamentGameField` | `connect-src` | Oui (`'self'`) |
| Trailer YouTube en `<iframe>` | `src/app/jeux/[id]/page.tsx` | `frame-src` | Oui (`youtube-nocookie.com`) |
| Sons `.wav` (`new Audio("/sounds/…")`) | `CelebrationConfetti`, `DrawSessionGameDialog` | `media-src` (repli `default-src`) | Oui (`'self'`) |
| Aperçu d'image locale (`URL.createObjectURL`) | `BannerForm` | `img-src` `blob:` | Oui |
| Images externes : covers IGDB/Steam, avatars Discord, bannières d'URL arbitraire (imgur, klipy, tenor, giphy…) | partout | `img-src` | Oui, **uniquement grâce à `https:`** (large) |
| Polices | `next/font` (auto-hébergées) | `font-src` | Oui |
| Manifest PWA | `/manifest.json` | `manifest-src` (repli `default-src`) | Oui |
| Connexion Discord / Steam (formulaires et redirections) | auth, `form-action` | `form-action` | Oui (Chrome applique `form-action` aussi aux redirections) |
| Scripts et styles inline de Next.js / `style={{…}}` (34 occurrences) | framework + composants | `script-src`, `style-src` | Oui, **uniquement grâce à `'unsafe-inline'`** |
| Aucun service tiers (analytics, Sentry, polices Google…) | `package.json` | — | n/a |

Constat : la politique **actuelle** ne casserait, d'après le code, aucune fonctionnalité si elle devenait bloquante. Mais ce constat est **statique** : il n'a pas été confirmé par des rapports de violation réels ni par un parcours complet des pages en navigateur.

## 3. Risques d'un passage direct en bloquant

1. **Pages jamais ouvertes pendant l'observation.** Une violation n'apparaît que si la page est visitée avec le navigateur ouvert sur la console. Les pages admin, tournois, roulette, import famille sont peu fréquentées.
2. **Ressources dépendant des données** : une bannière `User.bannerUrl` en `http://` (ancien enregistrement) serait bloquée par `img-src https:`. Le code actuel n'en accepte plus de nouvelles mais d'anciennes lignes peuvent exister.
3. **Extensions navigateur** : elles injectent scripts/styles et polluent les rapports (faux positifs en Report-Only, vrais blocages invisibles en bloquant, mais sans effet sur l'app).
4. **Mode développement** : `'unsafe-eval'` est nécessaire à `next dev` ; à conserver conditionnel.
5. **Régression silencieuse ensuite** : toute nouvelle intégration (nouvel hôte d'API appelé côté client, nouvelle iframe) cassera en production si la CSP n'est pas mise à jour dans la même PR.

## 4. Ce que la politique actuelle ne protège pas

`'unsafe-inline'` dans `script-src` annule l'essentiel de la protection anti-XSS de la CSP : un script injecté en ligne s'exécuterait. Passer en bloquant **sans** traiter ce point apporte donc surtout la protection de `frame-ancestors`, `object-src`, `base-uri`, `form-action` et `connect-src` (déjà utile), pas contre le XSS.

Pour le supprimer il faut des **nonces** (ou des hashes) :
- Next.js 16 supporte les nonces via un `proxy.ts` (ex-`middleware`) qui génère le nonce par requête et pose l'en-tête CSP ; Next l'applique à ses scripts inline.
- Contrepartie documentée par Next : les pages **doivent être rendues dynamiquement** (pas de rendu statique ni d'ISR pour les pages concernées) puisque le nonce change à chaque requête. Impact performance / coût Vercel à mesurer.
- `style-src 'unsafe-inline'` peut rester : le risque XSS par style est nettement plus faible, et les `style={{…}}` React + animations Framer Motion en dépendent.

> À vérifier avec la documentation Next.js 16 (Context7) avant toute implémentation : l'API exacte du nonce et ses limites n'ont pas été testées ici.

## 5. Plan recommandé (par étapes, chaque étape = une PR)

1. **Collecter** : ajouter `report-to` / `report-uri` vers une route `/api/csp-report` (journalise dans les logs Vercel, sans stockage de données personnelles, limitée en taille/débit). Garder Report-Only. *Drapeau désactivé par défaut recommandé.*
2. **Observer 1 à 2 semaines** en couvrant les pages rares (parcours manuel : admin, tournois, roulette, import famille, trailer, avatars, bannières).
3. **Corriger** les violations légitimes (ajouter l'hôte à la bonne directive, la plus étroite possible).
4. **Resserrer** : remplacer `img-src https:` par une liste d'hôtes si les rapports montrent un ensemble stable (attention aux bannières d'URL arbitraire : sans liste fermée, garder `https:`).
5. **Nonces** (étape optionnelle, la plus lourde) pour retirer `'unsafe-inline'` de `script-src`.
6. **Basculer** : doubler d'abord les deux en-têtes (bloquant sur une politique minimale + Report-Only sur la politique stricte), puis passer `Content-Security-Policy` seul. Prévoir un **retour arrière en une ligne** (remettre `-Report-Only`).

## 6. Recommandation

- **Ne pas** passer en bloquant maintenant : aucune donnée de violation réelle n'existe.
- Faire l'étape 1 (collecte) en premier : c'est faible risque et ça débloque toute la suite.
- Un passage en bloquant **sans nonces** est possible après l'étape 3 et apporte déjà `frame-ancestors`, `object-src`, `base-uri`, `form-action`, `connect-src` ; il faut juste ne pas le présenter comme une protection anti-XSS complète.

## 7. Limites de ce rapport

Audit statique du code uniquement : pas de capture de rapports navigateur, pas d'essai en mode bloquant, pas de test des nonces Next.js 16.
