# GameNight

Application web privée pour organiser les soirées jeux d'un groupe de potes
Discord : dispos, vote de jeu, résultat poussé dans Discord, rappels, et
présence Steam en direct.

Voir [`SPEC-gamenight.md`](./SPEC-gamenight.md) pour le cahier des charges
complet.

**État actuel : F1 — Auth Discord.** Login via Discord uniquement ; les
autres features (Steam, IGDB, dispos, vote, rappels, présence) arrivent dans
les prochaines étapes.

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
| `DATABASE_URL` | [console.neon.tech](https://console.neon.tech) → ton projet → **Connection string** (choisir la variante *pooled connection*, compatible avec l'adapter serverless). |
| `AUTH_SECRET` | Génère une valeur aléatoire avec `npx auth secret` (ou `openssl rand -base64 32`). |
| `AUTH_URL` | `http://localhost:3000` en local, l'URL de prod (ex. Vercel) en production. |
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` | [Discord Developer Portal](https://discord.com/developers/applications) → **New Application** → onglet **OAuth2** → *Client ID* / *Client Secret*. Ajouter l'URL de redirection `http://localhost:3000/api/auth/callback/discord` (et l'équivalent en prod) dans **Redirects**. |
| `DISCORD_WEBHOOK_URL` | Dans le salon Discord cible → **Modifier le salon** → **Intégrations** → **Webhooks** → **Créer un webhook**. *(Pas encore utilisée à ce stade — nécessaire pour F6/F7.)* |
| `STEAM_API_KEY` | [steamcommunity.com/dev/apikey](https://steamcommunity.com/dev/apikey) (nécessite un compte Steam ayant dépensé au moins 5$). *(Pas encore utilisée — nécessaire pour F2/F8.)* |
| `IGDB_CLIENT_ID` / `IGDB_CLIENT_SECRET` | Créer une application sur [dev.twitch.tv/console](https://dev.twitch.tv/console) (IGDB s'authentifie via l'API Twitch). *(Pas encore utilisée — nécessaire pour F3.)* |

## 3. Base de données

Appliquer le schéma Prisma sur la base Neon :

```bash
npx prisma migrate dev --name init
```

(Régénère aussi le client Prisma. En cas de besoin manuel : `npx prisma generate`.)

## 4. Lancer en local

```bash
npm run dev
```

Ouvrir [http://localhost:3000](http://localhost:3000), cliquer sur
**« Se connecter avec Discord »**. Une fois connecté, le pseudo et l'avatar
Discord s'affichent automatiquement, et un `User` correspondant est créé (ou
mis à jour) en base.

## Scripts disponibles

| Commande | Description |
| --- | --- |
| `npm run dev` | Lance le serveur de dev Next.js |
| `npm run build` | Build de production |
| `npm run start` | Démarre le build de production |
| `npm run lint` | Lint ESLint |
| `npx prisma studio` | Explorateur visuel de la base de données |
| `npx prisma migrate dev` | Applique les migrations en local |

## Structure du projet

```
prisma/schema.prisma        # Schéma de données (modèle User pour l'instant)
src/auth.ts                 # Config Auth.js (provider Discord, callbacks)
src/lib/prisma.ts           # Client Prisma (adapter Neon serverless)
src/app/page.tsx            # Page d'accueil (login / profil)
src/app/api/auth/[...nextauth]/route.ts   # Route handler Auth.js
```
