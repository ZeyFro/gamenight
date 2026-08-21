# GameNight

Application web privée pour organiser les soirées jeux d'un groupe de potes
Discord : dispos, vote de jeu, résultat poussé dans Discord, rappels, et
présence Steam en direct.

Voir [`SPEC-gamenight.md`](./SPEC-gamenight.md) pour le cahier des charges
complet.

**État actuel : F1 (Auth Discord) + F2/F3 (lien Steam, biblio, ajout manuel,
enrichissement IGDB) + F4/F5 (dispos récurrentes + exceptions, proposition
et vote de soirée).** Les autres features (notification Discord, rappels,
présence) arrivent dans les prochaines étapes.

## Stack

- [Next.js](https://nextjs.org) (App Router, TypeScript)
- [Tailwind CSS](https://tailwindcss.com)
- [Auth.js (NextAuth v5)](https://authjs.dev) — provider Discord
- [Prisma](https://www.prisma.io) + [Neon](https://neon.tech) (Postgres
  serverless, via l'adapter `@prisma/adapter-neon`)
- [Framer Motion](https://motion.dev) pour les animations, [sonner](https://sonner.emilkowal.ski)
  pour les toasts — voir « Identité visuelle » ci-dessous.

## Identité visuelle

Refonte visuelle (niveau 1 — identité + animations, aucune fonctionnalité
ajoutée). Toujours sombre : pas de bascule clair/sombre, c'est le thème de
l'app (référence Linear/Vercel/Raycast).

- **Palette** (`src/app/globals.css`) : fond `#0a0a0a`, surfaces `#161616`
  / `#1f1f1f` au hover, bordures `#2a2a2a` / `#3a3a3a` au hover, texte
  `#f5f5f5` (principal) / `#9a9a9a` (meta). **Accent : violet électrique
  `#8b5cf6`** (hover `#a78bfa`, pressed `#7c3aed`) — boutons primaires,
  liens actifs, badge JOUABLE, états positifs. Rouge `#ef4444` réservé au
  destructif/erreur ; ambre `#f59e0b` pour l'urgence (deadline de vote
  < 1h).
- **Typo** : Geist Sans (déjà chargée via `next/font/google`, aucune
  dépendance supplémentaire), corps de texte à 15px.
- **Composants partagés** (`src/components/ui/`) : `Button`/`ButtonLink`
  (micro-interaction `whileTap` scale 0.97), `Card` (avec variante `glow`
  — bordure qui s'illumine en violet au survol, `.card-glow` dans
  `globals.css`), `Badge` (JOUABLE animé au changement d'état), `Skeleton`.
- **Animations** (`src/components/motion.tsx`, `framer-motion`) :
  `Stagger`/`StaggerItem` pour les listes (délai croissant ~40ms/élément,
  utilisés sur la bibliothèque, les soirées, les propositions, les
  disponibilités), `PopIn` pour l'apparition d'une nouvelle puce de
  créneau. Transition de page en fondu (`PageTransition.tsx`,
  `AnimatePresence` + `usePathname`). Vote : bounce léger sur le bouton +
  compteur animé (`VoteButton.tsx`). Countdown de deadline : pulse ambre
  sous 1h (`VotingCountdown.tsx`). `<MotionConfig reducedMotion="user">`
  dans `layout.tsx` + repli CSS `prefers-reduced-motion` dans
  `globals.css` : toute animation se coupe si l'utilisateur l'a désactivé
  au niveau OS.
- **Toasts** (`sonner`) : confirmation sur vote, ajout de dispo/exception,
  proposition d'un jeu — via `ActionForm.tsx`, qui appelle la server
  action directement (au lieu de `<form action=…>`) pour pouvoir déclencher
  un toast au succès. **Choix assumé** : les actions qui redirigent après
  coup (ajout manuel d'un jeu, création de session) n'ont pas de toast — la
  redirection vers la nouvelle page est déjà un feedback fort, un toast
  juste avant de la quitter n'aurait pas le temps de s'afficher
  proprement.
- **Chargement** : `loading.tsx` (squelettes `Skeleton`) sur les routes qui
  interrogent la base (bibliothèque, dispos, soirées), plutôt qu'un texte
  « Chargement… » — géré nativement par le Suspense de l'App Router.
- **Identité** : wordmark `GameNight` (icône lune en accent, `Logo.tsx`),
  favicon `app/icon.svg` (un « G » sur fond violet). Header sticky avec nav
  desktop, barre de navigation fixe en bas sur mobile
  (`Header.tsx`/`BottomNav.tsx`, liens vers bibliothèque/dispos/soirées/
  profil, affichés uniquement connecté).
- **3 pages les plus retravaillées** :
  1. **Page d'accueil** (`src/app/page.tsx`) — avant : juste des liens de
     nav et le pseudo Discord ; après : un vrai tableau de bord pour
     l'utilisateur connecté (prochaine soirée avec statut, aperçu de la
     bibliothèque avec mini-covers empilées, CTA clair), et un écran de
     login avec dégradé radial discret d'accent en fond pour l'utilisateur
     déconnecté.
  2. **Détail d'une soirée** (`src/app/sessions/[id]/page.tsx`) — avant :
     badges plats, bouton de vote statique ; après : badge JOUABLE avec
     glow animé, bouton de vote avec bounce + compteur qui s'anime,
     countdown de deadline qui pulse en ambre sous 1h, propositions qui
     apparaissent en cascade.
  3. **Bibliothèque** (`src/components/BibliothequeGrid.tsx`) — avant :
     grille plate ; après : cartes avec bordure qui s'illumine en violet au
     survol, apparition en cascade, cohérent avec le nouveau design system
     partagé (`Card`/`Badge`).
- Mobile-first maintenu : boutons ≥44px, champs en 16px (évite le zoom
  Safari iOS), inchangé par rapport aux features précédentes.

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
- **`minPlayers` par défaut = 2, pas 1** (bug corrigé) : Steam ne fournit
  pas le nombre de joueurs, donc rien n'était renseigné à la création du
  `Game` (`minPlayers`/`maxPlayers` restaient `null`). Le calcul « jouable »
  de F5 traitait alors `minPlayers` absent comme `1` (`?? 1`), donc un jeu
  4 joueurs comme *Content Warning* s'affichait JOUABLE avec une seule
  personne dispo. Corrigé à deux niveaux : `minPlayers: 2` est désormais
  explicitement posé à la création d'un `Game` importé de Steam (comme
  pour l'ajout manuel) *et* le calcul « jouable »
  (`getProposalAvailability` dans `src/lib/sessions.ts`) retombe sur `2`
  plutôt que `1` quand `minPlayers` est `null` — ce deuxième point corrige
  aussi rétroactivement les jeux **déjà importés** avant ce fix, sans
  migration de données ni réimport nécessaire.
  **Enrichissement IGDB automatique à l'import Steam — évalué, pas fait** :
  interroger IGDB par jeu à chaque import ferait un appel externe séquentiel
  par jeu (potentiellement 100+ pour une première import) ; sur une
  fonction serverless Vercel, le risque réel de dépasser le timeout
  d'exécution (et de casser l'import en cours de route) l'a emporté sur le
  gain. `minPlayers = 2` reste un défaut sûr entre-temps ; l'enrichissement
  IGDB reste possible à la main via `/bibliotheque/ajouter` (F3), et un vrai
  enrichissement en masse mériterait un traitement en arrière-plan plutôt
  qu'un blocage de l'import (sujet à creuser avec F7, qui introduira déjà
  l'infra de tâches planifiées).
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
- **Validation ajoutée (bug corrigé)** : une saisie manuelle sans borne
  avait laissé un Minecraft avec `minPlayers = 999` en base, faussant son
  statut JOUABLE pour toute soirée. `minPlayers` doit désormais être entre
  1 et 100 (attributs HTML `min`/`max` côté client, revalidé côté serveur
  dans `addManualGame`), et `maxPlayers` (si renseigné) doit être ≥
  `minPlayers` — sinon rejet clair (`?error=joueurs_invalide`). La donnée
  existante a été corrigée par une migration ciblée
  (`prisma/migrations/20260821090859_fix_minecraft_minplayers`, ne touche
  que `Minecraft` avec `minPlayers > 100`).
- **Token IGDB (OAuth Twitch)** : mis en cache en mémoire du process
  (`src/lib/igdb.ts`) entre les appels, régénéré uniquement à expiration —
  pas d'appel `id.twitch.tv` à chaque recherche.

## Disponibilités & exceptions (F4)

- `/disponibilites` : un éditeur par jour de la semaine (`WeeklyAvailability`,
  `dayOfWeek` 0-6 selon la convention JS `Date.getUTCDay()` — 0 = dimanche).
  Chaque jour accepte 0, 1 ou plusieurs créneaux (`startTime`/`endTime` au
  format `HH:mm`), ajoutés/retirés indépendamment. Le bouton « Dispo en
  soirée (20h–00h) en un clic » couvre le cas « je coche dispo mardi soir
  sans horaire précis » demandé au §6 : il ajoute directement un créneau
  20h–00h par défaut, sans étape de saisie manuelle.
- Un créneau dont `endTime <= startTime` (ex. 21:00–00:00) est traité comme
  traversant minuit (`src/lib/availability.ts`).
- **Exceptions ponctuelles** (`AvailabilityOverride`, une par date et par
  utilisateur) : indisponibilité ou disponibilité exceptionnelle sur une
  date précise, avec horaire optionnel (vide = toute la journée). Une
  exception prime toujours sur le planning hebdo ce jour-là.
- **Aucune gestion de fuseau horaire réelle** : les dates/heures saisies
  sont stockées et relues telles quelles (convention détaillée en tête de
  `src/lib/wallclock.ts`), en supposant que tout le groupe est dans le même
  fuseau — pragmatique pour une soirée entre potes, mais à revoir avec une
  vraie lib de fuseaux si le groupe se disperse géographiquement (même sujet
  pour les rappels F7).

## Proposition & vote de soirée (F5)

- `/sessions` : liste des soirées (à venir puis historique), + formulaire de
  création (date + heure). `/sessions/[id]` : détail d'une soirée — proposer
  un jeu, voter, et clôturer.
- **Catalogue de proposition** : n'importe quel jeu que **quelqu'un dans le
  groupe possède** (pas seulement la biblio du proposeur) est proposable —
  c'est utile pour suggérer un jeu qu'un pote a et que le groupe pourrait
  jouer ensemble. Un même jeu ne peut être proposé qu'une fois par soirée
  (contrainte `@@unique([sessionId, gameId])`), pour ne pas fragmenter les
  votes entre deux propositions identiques.
- **Calcul « jouable »** (`src/lib/sessions.ts` → `getProposalAvailability`) :
  pour chaque jeu proposé, parmi les utilisateurs qui le possèdent
  (`UserGame.owned=true`), on ne garde que ceux dispos à la date/heure de la
  session (croisement `WeeklyAvailability` + `AvailabilityOverride`) ; le
  badge est **JOUABLE** (vert) si ce nombre est compris entre `minPlayers`
  et `maxPlayers` du jeu, sinon **PAS ASSEZ DE JOUEURS** (gris) — avec le
  décompte et la liste nominative affichés dans les deux cas pour que le
  badge reste compréhensible même quand la raison est « trop de monde »
  plutôt que « pas assez ».
- **Vote** : un utilisateur peut voter pour autant de propositions qu'il
  veut (`Vote` unique par `(proposalId, userId)`) ; revoter annule le vote
  (toggle). Le badge JOUABLE est purement informatif — il n'empêche pas de
  voter pour un jeu qui l'est pas, les votes des potes restent souverains.
- **Deadline de vote** (`Session.votingDeadline`, nullable) : forcer une
  échéance claire plutôt que de laisser le vote traîner jusqu'à l'heure de
  la session. **Format choisi — presets fixes (6h/12h/24h/48h avant la
  session, défaut 6h) plutôt qu'un champ libre**, pour rester mobile-first :
  un `<select>` se choisit en un tap, alors qu'un date/heure précis demande
  plusieurs interactions sur un petit écran et risque plus l'erreur de
  saisie. Une option avancée repliée (`<details>`, sans JS) permet quand
  même de saisir une date/heure précise pour qui le veut. Contrainte
  serveur : la deadline doit être strictement avant l'heure de la session,
  sinon la création est rejetée avec un message clair
  (`/sessions?error=deadline_apres_session`) — impossible à violer avec les
  presets (toujours *avant* l'heure choisie par construction), donc ce cas
  ne peut se produire qu'avec l'option date/heure précise.
- Affichage en temps réel sur `/sessions/[id]` (« Vote fermé dans 3h » /
  « Vote fermé depuis 1h », composant client `VotingCountdown`, rafraîchi
  toutes les 30s — pas besoin de la seconde près).
- Une fois la deadline dépassée : les actions `proposeGame`/`toggleVote`
  la revérifient côté serveur avant d'écrire quoi que ce soit (pas
  seulement un formulaire caché côté UI, pour éviter la fenêtre de course
  où quelqu'un aurait la page ouverte au moment où la deadline tombe).
- **Clôture — choix assumé (créateur manuel + auto paresseuse, les deux)** :
  n'importe quel utilisateur connecté peut cliquer « Clôturer le vote
  maintenant » à tout moment tant que la session est en vote (le schéma §5
  ne définit pas de notion de « créateur » de session, donc pas de
  restriction de propriétaire — cohérent avec le reste de l'app, pensée
  pour un petit groupe de confiance). Sans action manuelle, la clôture se
  déclenche automatiquement **à la lecture** (chargement de `/sessions` ou
  `/sessions/[id]`) dès que la deadline de vote — ou, à défaut pour les
  sessions créées avant son ajout, l'heure de la session — est passée ; pas
  de Vercel Cron ici (F7 uniquement), donc pas de clôture qui se déclenche
  vraiment "toute seule" en arrière-plan si personne ne consulte la page,
  mais c'est transparent dès qu'un membre du groupe rouvre l'app.
- **Un seul jeu gagnant par soirée — choix assumé** : à la clôture, le jeu
  retenu (`Session.decidedGameId`) est la proposition la plus votée (égalité
  → la plus ancienne proposition). C'est cohérent avec le schéma indicatif
  du §5 (`decidedGameId` est un champ unique, pas une liste) et avec le
  roadmap v2 du §7, qui traite explicitement la « file de jeux co-op »
  (plusieurs jeux à enchaîner) comme un sujet séparé, pas prévu en v1. Sans
  proposition à l'heure de la clôture, la session est automatiquement
  annulée (`CANCELLED`) plutôt que planifiée sans jeu.
- Cycle de vie complet : `VOTING → SCHEDULED` (clôture avec gagnant) ou
  `VOTING → CANCELLED` (clôture sans proposition, ou annulation manuelle) ;
  `SCHEDULED → DONE` (bouton « Marquer comme terminée », pratique après coup)
  ou `SCHEDULED → CANCELLED` (plans annulés).

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

## Dépannage

- **Erreur de connexion Discord (« Server error » / `error=Configuration`)** :
  Auth.js masque volontairement la vraie cause derrière ce message
  générique pour ne rien exposer côté client. Le détail (type d'erreur +
  stack de la cause d'origine) est loggé côté serveur avec les préfixes
  `[auth][error]` et `[auth][cause]` — cherche-les dans les logs Vercel de
  la fonction pour diagnostiquer précisément (échec de connexion à la base,
  vérification OAuth échouée, etc.). La page d'accueil affiche aussi un
  message en français adapté au type d'erreur (`?error=...`) plutôt que la
  page blanche par défaut d'Auth.js.
- **Recherche IGDB qui échoue** : vérifie dans les logs Vercel la ligne
  `[igdb] Recherche échouée` (route `/api/igdb/search`), qui contient le
  statut HTTP et le corps de la réponse Twitch/IGDB — utile pour repérer un
  problème de credentials (`IGDB_CLIENT_ID`/`IGDB_CLIENT_SECRET`, espaces
  parasites en copier-coller) ou de requête (le format Apicalypse est
  strict : un champ inexistant dans `fields` fait échouer toute la
  requête, quel que soit le terme recherché).

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
prisma/schema.prisma        # Schéma de données complet (§5)
src/auth.ts                 # Config Auth.js (provider Discord, callbacks)
src/lib/prisma.ts           # Client Prisma (adapter Neon serverless)
src/lib/steam.ts            # OpenID 2.0 Steam + import GetOwnedGames
src/lib/igdb.ts             # Client IGDB (token Twitch caché, recherche jeux)
src/lib/current-user.ts     # Session Auth.js → ligne User en base
src/lib/wallclock.ts        # Parsing/format date+heure (convention horloge-murale)
src/lib/availability.ts     # Calcul dispo (créneaux hebdo + exceptions)
src/lib/sessions.ts         # Clôture de session, deadline, calcul "jouable" par jeu
src/lib/session-status.ts   # Libellés/couleurs des statuts de session
src/components/ui/          # Button, ButtonLink, Card, Badge, Skeleton
src/components/motion.tsx   # Stagger, StaggerItem, PopIn (framer-motion)
src/components/PageTransition.tsx       # Fondu entre routes (AnimatePresence)
src/components/ActionForm.tsx           # Wrapper server action + toast (non redirigeant)
src/components/VoteButton.tsx           # Bouton de vote (bounce + compteur animé)
src/components/VotingCountdown.tsx      # Compte à rebours deadline de vote (client)
src/components/Header.tsx / BottomNav.tsx / Logo.tsx  # Identité + nav
src/app/actions.ts          # Server actions bibliothèque (ajout/retrait, réimport Steam)
src/app/page.tsx            # Page d'accueil (login / profil)
src/app/profil/page.tsx     # Profil + lien Steam
src/app/bibliotheque/page.tsx           # Liste des jeux possédés
src/app/bibliotheque/ajouter/page.tsx   # Ajout manuel + recherche IGDB
src/app/disponibilites/page.tsx         # Planning hebdo + exceptions
src/app/disponibilites/actions.ts       # Server actions dispos
src/app/sessions/page.tsx               # Liste des soirées + création
src/app/sessions/[id]/page.tsx          # Détail : proposer, voter, clôturer
src/app/sessions/actions.ts             # Server actions soirées
src/app/api/auth/[...nextauth]/route.ts # Route handler Auth.js
src/app/api/steam/link/route.ts         # Redirige vers Steam (OpenID)
src/app/api/steam/callback/route.ts     # Vérifie le retour Steam, importe
src/app/api/igdb/search/route.ts        # Recherche IGDB (utilisée par le form)
```
