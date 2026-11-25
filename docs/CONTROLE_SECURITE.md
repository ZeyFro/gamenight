# Contrôle de sécurité passif — 22 novembre 2026

> Pour le propriétaire. **Contrôles passifs uniquement** : quelques requêtes de lecture (GET) sans identifiants sur le site public, et une lecture du code. Aucun outil de scan, aucune tentative d'intrusion, aucune écriture.
>
> **Limite de ce relevé.** Le réseau de cette session bloque l'accès direct au site. Les requêtes ont donc été faites par un service de lecture de pages (Firecrawl). Il donne le code de réponse et le contenu, mais **pas les en-têtes**. Les en-têtes et les cookies sont vérifiés dans le code, pas sur la réponse réelle.

## Mise à jour du 25 novembre 2026

- **CSP bloquante** : `Content-Security-Policy` remplace `Report-Only` depuis le 23/11 ; le point 1 et le constat T3 sont donc obsolètes. `'unsafe-inline'` reste nécessaire pour les scripts injectés par Next.js.
- **HSTS** : présent dans `next.config.ts` (`max-age=63072000; includeSubDomains`), le point 2 est obsolète.
- **Isolation de fenêtre** : `Cross-Origin-Opener-Policy: same-origin` ajouté sur toutes les routes. Pas de `Cross-Origin-Resource-Policy` global, qui aurait bloqué les applications de calendrier lisant `/api/calendrier/feed/[token]`.
- **Dépendances** : `npm audit --omit=dev` passe de 3 vulnérabilités hautes à **0** après l'override `effect@3.22.1` (GHSA-7589-6fvf-x4pw). `prisma validate` et `prisma generate` restent verts.
- **Toujours ouvert** : le bot Discord conserve le droit Administrateur (T1, action humaine sur Discord), et les en-têtes réellement servis en Production n'ont pas été relus depuis cette machine.

**Échelle de gravité**
- **Élevée** : à corriger avant l'ouverture.
- **Moyenne** : à prévoir rapidement.
- **Faible** : amélioration.
- **OK** : rien à faire.

---

## 1. Contrôles sur le site public

Adresse testée : `https://gamenight-zeyfro.vercel.app`.

| # | Point vérifié | Résultat | Gravité |
| --- | --- | --- | --- |
| 1 | **CSP** (règles qui disent au navigateur quels scripts et images il peut charger) | Définie dans `next.config.ts` et `src/lib/csp-policy.ts`, mais **en mode « observation » seulement** (`Content-Security-Policy-Report-Only`) : le navigateur signale sans rien bloquer. Elle autorise aussi les scripts « inline » (`'unsafe-inline'`). React échappe déjà les textes, ce qui limite le risque. | **Moyenne** |
| 2 | **HSTS** (forcer le HTTPS) | Le site ne l'envoie pas lui-même (absent de `next.config.ts`). L'adresse finit par `.app` : les navigateurs imposent toujours le HTTPS sur ce domaine. L'en-tête réel n'a pas pu être lu d'ici. | Faible |
| 3 | **X-Frame-Options** (empêcher d'afficher le site dans un cadre d'un autre site) | `DENY` sur toutes les pages. | OK |
| 4 | **Autres en-têtes** | `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` qui coupe caméra, micro, position, paiement et USB. | OK |
| 5 | **Cookies de connexion** | Gérés par Auth.js sans réglage personnalisé : `HttpOnly` (illisibles par les scripts), `Secure` en HTTPS, `SameSite=Lax`. Cookie de liaison Steam : `HttpOnly`, `Secure` en HTTPS, `SameSite=Lax`, limité à `/api/steam`, 10 minutes. Vérifié dans le code, pas sur la réponse réelle. | OK |
| 6 | **`/admin` sans connexion** | Renvoie à la page de connexion (code 200 de l'accueil). Aucune donnée. | OK |
| 7 | **`/admin/discord-commands` sans connexion** | 404 « page introuvable ». Cela confirme aussi que l'interrupteur est éteint en Production. | OK |
| 8 | **`/api/admin/discord-commands` en GET** | 405 « méthode refusée » (la route n'accepte que POST). Le code répond aussi 404 en POST tant que l'interrupteur est éteint. | OK |
| 9 | **`/api/compte/export` sans connexion** | 401 « refusé ». | OK |
| 10 | **`/api/cron/notification-executor` sans secret** | 401 `{"error":"unauthorized"}`. | OK |
| 11 | **`/tower-admin`** | Ce n'est pas une page : c'est une commande Discord, réservée au droit « Gérer le serveur ». | OK |
| 12 | **Limitation de débit sur la connexion** | Aucune dans l'application. La connexion passe par Discord : il n'y a pas de mot de passe à deviner chez GameNight, Discord protège sa propre page. | Faible |
| 13 | **Redirections OAuth** (retour après la connexion Discord) | Auth.js, sans réglage personnalisé : il ne renvoie que vers le site lui-même. Steam : un code aléatoire à usage unique (`state`) est vérifié au retour, ce qui bloque le rejeu et la connexion forcée. | OK |
| 14 | **Secrets dans le code envoyé au navigateur** | Aucune variable `NEXT_PUBLIC_*`. Aucun fichier côté navigateur ne lit une variable d'environnement, hormis `NODE_ENV`. Aucun jeton, mot de passe ou adresse de base trouvé dans le dépôt (seulement une URL factice dans un test). Aucun fichier `.env` versionné. | OK |
| 15 | **Adresse e-mail de contact** | Publiée en clair sur les trois pages légales. C'est voulu par la loi, mais elle recevra du spam et peut être réutilisée pour de l'hameçonnage. | Faible |

---

## 2. Lecture du code des routes sensibles

### Routes d'administration

| Route | Qui peut l'appeler | Contrôle des entrées | Gravité |
| --- | --- | --- | --- |
| `POST /api/admin/discord-commands` | Interrupteur + secret dédié comparé à temps constant + administrateur connecté + 5 appels par minute. Jamais sur Preview. | Seuls `check` ou `execute` sont acceptés. Aucune suppression ni réponse contenant un secret. | OK |
| `/api/admin/tower-archive`, `tower-content-audit`, `tower-layout`, `tower-preflight` | `requireAdmin` (liste `ADMIN_DISCORD_IDS`). | Lecture. | OK |
| `/api/admin/force-relogin` | Secret DÉDIÉ `FORCE_RELOGIN_SECRET` (jamais `CRON_SECRET` depuis l'audit du 23/11/2026 ; 503 sans lui). | — | OK |
| Actions des pages `/admin/*` (badges, messages, joueurs, communautés, jeux, nettoyage, réglages, superlatifs) | Chaque action vérifie l'administrateur. | Champs lus un à un. | OK |
| Contestations Tower (`/admin/tower-appeals`) | Membre ACTIVE du serveur, puis contrôle du rôle dans `decideTowerChallengeAppeal`. L'auteur du défi, ceux qui ont voté et les participants sont exclus. Si l'auteur est admin, l'arbitre configuré est obligatoire. | Schéma de validation (zod) ; requêtes paramétrées. | OK |

### Suppression et export du compte

| Route | Qui peut l'appeler | Contrôle des entrées | Gravité |
| --- | --- | --- | --- |
| `deleteMyAccountAction` (`/profil/compte`) | Interrupteur (sinon 404) + personne connectée + 3 essais par minute. | Confirmation forte : le pseudo exact ou « SUPPRIMER ». Refus s'il s'agit du dernier propriétaire d'un serveur. | OK |
| `GET /api/compte/export` | Interrupteur (sinon 404) + personne connectée + 3 par minute. | Ne renvoie que les données de la personne, sans jeton ni clé. Réponse non mise en cache. | OK |

### Webhooks et appels de Discord

| Route | Qui peut l'appeler | Contrôle des entrées | Gravité |
| --- | --- | --- | --- |
| `POST /api/discord/interactions` | Signature Ed25519 de Discord vérifiée sur le corps brut **avant** toute lecture. Clé absente : route coupée. | JSON lu seulement après la signature. | OK |
| `POST /api/discord/webhook-events` | Même vérification Ed25519. | Idem. | OK |
| Remarque | La date de la signature n'est pas comparée à l'heure. Une ancienne requête signée pourrait être rejouée. Discord ne l'exige pas ; l'effet d'un rejeu n'a pas été vérifié commande par commande. | — | Faible |

### Autres routes publiques

| Route | Contrôle | Gravité |
| --- | --- | --- |
| `/api/cron/*`, `/api/backfill/*`, `/api/health` | `CRON_SECRET` obligatoire : 503 sans secret configuré, 401 si faux. | OK |
| `/api/calendrier/feed/[token]` | Jeton secret, stocké brouillé (empreinte) et révocable ; membre et serveur actifs exigés à chaque lecture. | OK |
| `/api/igdb/search`, `/api/push/subscription`, `/api/steam/link`, `/api/steam/callback`, `/api/calendrier/export`, `/api/sessions/[id]/media/[id]` | Session valide exigée (sinon 401 ou retour à l'accueil). | OK |
| `/api/csp-report` | 404 si `CSP_REPORT_ENABLED` est éteint ; limite de débit. | OK |

---

## 3. Points transverses

| # | Constat | Gravité |
| --- | --- | --- |
| T1 | **Le bot a le droit Administrateur** sur le serveur Discord (rôles Workshop et AppBot, voir `docs/PHASE_TEST.md`). Si son jeton fuit, la personne qui l'a contrôle tout le serveur. Il faut lui retirer ce droit et lui laisser seulement les 13 permissions utiles (dont « Mentionner @everyone, @here et tous les rôles », voir PERMISSIONS_BOTS.md). | **Élevée** |
| T2 | **Les limites de débit sont gardées en mémoire, une par serveur Vercel.** Avec plusieurs serveurs en parallèle, elles se contournent en partie. Elles freinent sans empêcher. **Correctif (23/11)** : les actions sensibles (suppression et export de compte, reconnexion forcée, enregistrement des commandes) passent par un compteur partagé en base (`checkSharedRateLimit`), une fois la migration appliquée. | Moyenne → Faible |
| T3 | **CSP en mode observation** (voir le point 1). | Moyenne |
| T4 | **Journaux d'exécution gardés 1 heure** (offre Hobby) : on ne peut pas enquêter sur un incident plus ancien. | Moyenne |
| T5 | **Une seule personne détient tous les accès** (Vercel, Neon, Discord, GitHub). Une double authentification sur chaque compte est indispensable. Ce point n'est pas vérifiable d'ici. | Moyenne |
| T6 | Les jetons Discord des membres sont chiffrés en base (AES-256-GCM, clé dédiée dans Vercel). | OK |

## 4. Les 5 constats les plus graves

1. **T1** — Bot Administrateur sur Discord (élevée).
2. **Point 1 / T3** — CSP non bloquante, avec scripts « inline » autorisés (moyenne).
3. **T2** — Limites de débit contournables, aucune sur la connexion (moyenne).
4. **T4** — Journaux d'une heure seulement : pas d'enquête possible après coup (moyenne).
5. **T5** — Tous les accès sur un seul compte ; double authentification à confirmer (moyenne).

## 5. Ce qui n'a pas été vérifié

- Les en-têtes et cookies **réellement** renvoyés par le site (le réseau de cette session bloque l'accès direct). Ton navigateur bloque les outils de développement : utilise un autre appareil, ou un site public de lecture d'en-têtes (par exemple securityheaders.com, en lecture seule).
- La double authentification des comptes Vercel, Neon, Discord et GitHub.
- Le pare-feu et la protection anti-robots de Vercel.
