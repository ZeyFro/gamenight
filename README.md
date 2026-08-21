# GameNight

Application web privée pour organiser les soirées jeux d'un groupe de potes
Discord : dispos, vote de jeu, résultat poussé dans Discord, rappels, et
présence Steam en direct.

Voir [`SPEC-gamenight.md`](./SPEC-gamenight.md) pour le cahier des charges
complet.

**État actuel : F1 (Auth Discord) + F2/F3 (lien Steam, biblio, ajout manuel,
enrichissement IGDB).** Les autres features (dispos, vote, rappels,
présence) arrivent dans les prochaines étapes.

## Stack

- [Next.js](https://nextjs.org) (App Router, TypeScript)
- [Tailwind CSS](https://tailwindcss.com)
- [Auth.js (NextAuth v5)](https://authjs.dev) — provider Discord
- [Prisma](https://www.prisma.io) + [Neon](https://neon.tech) (Postgres
  serverless, via l'adapter `@prisma/adapter-neon`)

## Prérequis

- Node.js 20+
- Un projet [Neon](https://neon.tech) (base Postgres serverless, offre
  gratuite suffisante)
- Une application Discord (Developer Portal)

## 1. Installation

```bash
npm install
```

## 2. Configurer les variables d'environnement

Copier le fichier d'exemple :

```bash
cp .env.example .env.local
```

Puis remplir chaque variable :

| Variable | Où la récupérer |
| --- | --- |
| `DATABASE_URL` | [console.neon.tech](https://console.neon.tech) → ton projet → **Connection string**. Utiliser la variante **directe/non-poolée** (sans `-pooler` dans l'hostname) : l'adapter `@neondatabase/serverless` gère déjà son propre pooling via WebSocket, et `prisma migrate deploy` (verrou d'avisory lock) est plus fiable sans PgBouncer devant. |
| `AUTH_SECRET` | Génère une valeur aléatoire avec `npx auth secret` (ou `openssl rand -base64 32`). |
| `AUTH_URL` | `http://localhost:3000` en local, l'URL de prod (ex. Vercel) en production. |
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` | [Discord Developer Portal](https://discord.com/developers/applications) → **New Application** → onglet **OAuth2** → *Client ID* / *Client Secret*. Ajouter l'URL de redirection `http://localhost:3000/api/auth/callback/discord` (et l'équivalent en prod) dans **Redirects**. |
| `DISCORD_WEBHOOK_URL` | Dans le salon Discord cible → **Modifier le salon** → **Intégrations** → **Webhooks** → **Créer un webhook**. *(Pas encore utilisée à ce stade — nécessaire pour F6/F7.)* |
| `STEAM_API_KEY` | [steamcommunity.com/dev/apikey](https://steamcommunity.com/dev/apikey) (nécessite un compte Steam ayant dépensé au moins 5$). Utilisée pour l'import de bibliothèque (`GetOwnedGames`). *(F8 — présence — pas encore implémentée.)* |
| `IGDB_CLIENT_ID` / `IGDB_CLIENT_SECRET` | Créer une application sur [dev.twitch.tv/console](https://dev.twitch.tv/console) (IGDB s'authentifie via l'API Twitch). Utilisées pour la recherche/enrichissement de jeux ajoutés manuellement. |

## 3. Base de données

Le dossier `prisma/migrations/` contient déjà la migration initiale (table
`User`). Pour l'appliquer sur ta base Neon :

```bash
npx prisma migrate deploy
```

- En local, `npx prisma migrate dev` fonctionne aussi (applique les
  migrations existantes, et t'en fait créer une nouvelle si tu modifies le
  schéma).
- `migrate deploy` est la commande recommandée pour un environnement
  serverless/CI (Vercel, etc.) : elle ne crée pas de base de données
  *shadow* et n'est jamais interactive, contrairement à `migrate dev`. On
  évite volontairement `prisma db push`, qui ne garde pas d'historique de
  migrations versionné.
- Le client Prisma se régénère automatiquement après chaque `npm install`
  grâce au script `postinstall` (`prisma generate`) — utile en local comme
  sur Vercel.
- La commande `npm run build` lance `prisma migrate deploy` avant `next
  build` : toute migration ajoutée au repo est donc appliquée
  automatiquement à chaque déploiement Vercel (voir §5).

## 4. Lancer en local

```bash
npm run dev
```

Ouvrir [http://localhost:3000](http://localhost:3000), cliquer sur
**« Se connecter avec Discord »**. Une fois connecté, le pseudo et l'avatar
Discord s'affichent automatiquement, et un `User` correspondant est créé (ou
mis à jour) en base.

Depuis **Mon profil** (`/profil`), tu peux lier ton compte Steam et
consulter ta **bibliothèque** (`/bibliotheque`), qui liste tes jeux et
permet d'en ajouter/retirer.

## Lien Steam & import de bibliothèque (F2)

- **Lien Steam** : OpenID 2.0 (`/api/steam/link` → redirige vers Steam →
  `/api/steam/callback` vérifie la réponse signée et stocke le
  `SteamID64` sur `User.steamId64`). Contrairement à Discord, Steam OpenID
  n'a **pas** besoin d'être enregistré/configuré dans un portail développeur
  — aucune URL de redirection à whitelister.
- **Import automatique** : déclenché juste après le lien (et ré-exécutable
  depuis `/profil` via « Réimporter ma bibliothèque Steam »). Utilise
  `IPlayerService/GetOwnedGames` (nécessite `STEAM_API_KEY`) ; chaque jeu
  est upserté dans `Game` (`source = STEAM`) puis associé à l'utilisateur
  via `UserGame(owned = true)`.
- **Profil Steam privé** : `GetOwnedGames` renvoie une réponse vide dans ce
  cas (aucun crash côté app) — un message explicite s'affiche sur
  `/profil` avec un lien direct vers les réglages de confidentialité
  Steam du compte lié.
- **Cover des jeux Steam** : construite depuis l'URL CDN standard
  `https://cdn.akamai.steamstatic.com/steam/apps/{appid}/library_600x900.jpg`
  (pas d'appel API supplémentaire ; certains jeux plus anciens peuvent ne
  pas avoir cette image).

## Ajout manuel & enrichissement IGDB (F3)

- Depuis `/bibliotheque/ajouter` : formulaire nom + recherche optionnelle
  IGDB (`/api/igdb/search`). En sélectionnant un résultat, la cover,
  `isCoop` et `maxPlayers` sont pré-remplis (`minPlayers` reste éditable,
  IGDB ne le fournit pas de façon fiable) ; tout reste modifiable avant
  validation.
- Sans correspondance IGDB (ou jeu hors Steam type Minecraft/ATM11) :
  `source = MANUAL`, `minPlayers = 2` par défaut, tous les champs éditables.
- **Token IGDB (OAuth Twitch)** : mis en cache en mémoire du process
  (`src/lib/igdb.ts`) entre les appels, régénéré uniquement à expiration —
  pas d'appel `id.twitch.tv` à chaque recherche.

## 5. Déploiement Vercel

1. Importer le repo sur [vercel.com](https://vercel.com), renseigner les
   mêmes variables d'environnement que dans `.env.local` (Project Settings →
   Environment Variables) : `DATABASE_URL`, `AUTH_SECRET`, `AUTH_URL`
   (l'URL de prod, ex. `https://ton-projet.vercel.app`),
   `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`.
2. Ajouter l'URL de callback de prod
   (`https://ton-projet.vercel.app/api/auth/callback/discord`) dans les
   **Redirects** de l'application Discord.
3. `npm install` régénère automatiquement le client Prisma (script
   `postinstall`) — rien à configurer côté build command pour ça.
4. `npm run build` (la build command par défaut, utilisée par Vercel) lance
   `prisma migrate deploy` avant `next build` : les migrations du dossier
   `prisma/migrations/` sont donc appliquées automatiquement sur
   `DATABASE_URL` à chaque déploiement — aucune étape manuelle nécessaire
   après le premier déploiement avec les bonnes variables d'environnement.
   Si `DATABASE_URL` est injoignable ou mal configurée, le build échoue
   (volontairement, plutôt que de déployer une app qui pointerait vers une
   base sans les bonnes tables).

## Scripts disponibles

| Commande | Description |
| --- | --- |
| `npm run dev` | Lance le serveur de dev Next.js |
| `npm run build` | Build de production |
| `npm run start` | Démarre le build de production |
| `npm run lint` | Lint ESLint |
| `npx prisma studio` | Explorateur visuel de la base de données |
| `npx prisma migrate dev` | Applique les migrations en local (et en crée une nouvelle si le schéma a changé) |
| `npx prisma migrate deploy` | Applique les migrations existantes sans les modifier (Neon/CI/Vercel) |

## Structure du projet

```
prisma/schema.prisma        # Schéma de données (User, Game, UserGame)
src/auth.ts                 # Config Auth.js (provider Discord, callbacks)
src/lib/prisma.ts           # Client Prisma (adapter Neon serverless)
src/lib/steam.ts            # OpenID 2.0 Steam + import GetOwnedGames
src/lib/igdb.ts             # Client IGDB (token Twitch caché, recherche jeux)
src/lib/current-user.ts     # Session Auth.js → ligne User en base
src/app/actions.ts          # Server actions (ajout/retrait jeu, réimport Steam)
src/app/page.tsx            # Page d'accueil (login / profil)
src/app/profil/page.tsx     # Profil + lien Steam
src/app/bibliotheque/page.tsx           # Liste des jeux possédés
src/app/bibliotheque/ajouter/page.tsx   # Ajout manuel + recherche IGDB
src/app/api/auth/[...nextauth]/route.ts # Route handler Auth.js
src/app/api/steam/link/route.ts         # Redirige vers Steam (OpenID)
src/app/api/steam/callback/route.ts     # Vérifie le retour Steam, importe
src/app/api/igdb/search/route.ts        # Recherche IGDB (utilisée par le form)
```
