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
| `DISCORD_WEBHOOK_URL` | Dans le salon Discord cible → **Modifier le salon** → **Intégrations** → **Webhooks** → **Créer un webhook**. Utilisée pour poster le résultat de clôture d'une soirée (F6) et les rappels avant session (F7) — voir les sections dédiées ci-dessous. |
| `STEAM_API_KEY` | [steamcommunity.com/dev/apikey](https://steamcommunity.com/dev/apikey) (nécessite un compte Steam ayant dépensé au moins 5$). Utilisée pour l'import de bibliothèque (`GetOwnedGames`). *(F8 — présence — pas encore implémentée.)* |
| `IGDB_CLIENT_ID` / `IGDB_CLIENT_SECRET` | Créer une application sur [dev.twitch.tv/console](https://dev.twitch.tv/console) (IGDB s'authentifie via l'API Twitch). Utilisées pour la recherche/enrichissement de jeux ajoutés manuellement, et la fiche jeu détaillée. |
| `DEEPL_API_KEY` | *(Optionnelle)* [deepl.com/pro-api](https://www.deepl.com/pro-api) → créer un compte gratuit (plan **Free**, 500k caractères/mois) → clé dans le compte, onglet API. Traduit en français la description IGDB de la fiche jeu. Sans cette variable : description affichée en anglais (VO), aucun crash. |
| `CRON_SECRET` | *(Optionnelle, recommandée en prod)* Valeur aléatoire au choix (ex. `openssl rand -hex 32`). Protège `/api/cron/reminders` (F7) — voir la section dédiée pour la configuration du cron externe. |

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
- **Édition d'un jeu déjà en biblio** : sur chaque carte de
  `/bibliotheque`, une icône crayon (à côté de la corbeille) ouvre un
  **panneau modal** (`EditGameDialog.tsx`, `@radix-ui/react-dialog` pour
  le focus trap/l'accessibilité clavier) — plein écran depuis le bas sur
  mobile, centré sur desktop. On y modifie `isCoop`, `minPlayers`,
  `maxPlayers` (mêmes validations que l'ajout manuel : 1-100,
  maximum ≥ minimum), et le **nom uniquement si `source = MANUAL`** (un
  jeu Steam/IGDB garde le nom de sa source — champ non affiché sinon).
  Toast `sonner` de confirmation à la sauvegarde, panneau qui se ferme
  automatiquement ; les erreurs de validation s'affichent inline dans le
  panneau (pas de rechargement de page, l'action serveur est appelée
  directement depuis le composant client et renvoie un résultat plutôt
  que de rediriger).

## Bibliothèque des potes

Deux façons de voir les jeux du groupe, en plus de sa propre biblio :

- **`/potes`** : une carte par membre du groupe (hors soi-même) — avatar
  Discord, pseudo, nombre de jeux possédés, et badge « Steam lié » /
  « Steam non lié ». Clic sur une carte → **`/potes/[id]`**, la biblio de ce
  pote en **lecture seule** (pas de bouton retirer/éditer — c'est le même
  composant de grille que la biblio perso mais sans les actions,
  `ReadOnlyGameGrid.tsx`).
- **`/bibliotheque/groupe`** : tous les jeux possédés par au moins un
  membre du groupe, avec les avatars des possesseurs empilés en bas de
  chaque cover. Trié par **nombre de possesseurs décroissant** par défaut
  (option `sortByOwners` de `ReadOnlyGameGrid`), avec le même champ de
  filtre par nom que la biblio perso. Un onglet `LibraryTabs.tsx`
  (« Ma bibliothèque » / « Groupe ») bascule entre les deux, affiché en
  haut de `/bibliotheque` et `/bibliotheque/groupe`.

Pas de nouveau modèle Prisma : ces deux vues ne font que ré-agréger
`User`/`Game`/`UserGame` existants (jointures en lecture seule, aucune
donnée dupliquée).

**Section « Dispos » sur `/potes/[id]`** : en plus de sa biblio, la fiche
d'un pote affiche maintenant son planning — les créneaux hebdo qu'il a
réglés sur `/disponibilites`, jour par jour (lundi → dimanche,
`AvailabilityView.tsx`), et ses exceptions ponctuelles des **14
prochains jours** (badge « ⭐ exception dispo » / « 🚫 exception
indispo »), toujours en lecture seule — aucune action de modification,
uniquement `WeeklyAvailability`/`AvailabilityOverride` déjà en base pour
ce `userId`. Réutilise `DAY_LABELS_MON_FIRST`/`formatDateFr` de
`wallclock.ts`, même identité visuelle (violet, `Stagger`/`StaggerItem`)
que le reste de l'app. **Ordre de la page (corrigé)** : header (avatar +
pseudo) → Dispos → Bibliothèque — les dispos étaient initialement tout en
bas, sous la biblio entière, ce qui les rendait quasi invisibles sur un
pote qui possède beaucoup de jeux ; remontées juste après le header, même
ordre en mobile qu'en desktop (pas de réorganisation par breakpoint).

## Fiche jeu détaillée

Clic sur un jeu (depuis `/bibliotheque`, `/bibliotheque/groupe`, ou la
biblio d'un pote) → **`/jeux/[id]`**, la fiche complète.

**Enrichissement IGDB à la demande, avec cache en base.** Contrairement à
l'ajout manuel/import Steam (F3, qui ne récupère que `cover`/`isCoop`/
`maxPlayers` à la création), la fiche jeu affiche le maximum de ce
qu'IGDB fournit — résumé, note globale (`total_rating`), captures d'écran,
trailer YouTube, plateformes, genres, date de sortie, développeur/éditeur.
Cet enrichissement est **volontairement différé** :

- Il ne se déclenche **jamais** à l'import Steam (importer toute une
  biblio d'un coup + un appel IGDB détaillé par jeu ferait dépasser le
  timeout d'une fonction Vercel, cf. discussion précédente sur F3).
- Il se déclenche **à la demande**, au premier affichage de `/jeux/[id]`
  (uniquement si le jeu a — ou peut obtenir, cf. ci-dessous — un `igdbId`
  connu ; un ajout manuel resté sans correspondance IGDB ne déclenche
  aucun appel, ce choix de ne pas lier à IGDB étant explicite).
- Le résultat est mis en cache dans `Game.igdbDetails` (JSON) +
  `Game.igdbDetailsFetchedAt`. Les ouvertures suivantes de la fiche sont
  instantanées (aucun appel IGDB), jusqu'à ce que quelqu'un clique sur
  **« Rafraîchir les infos »** (`refreshGameDetails`, `src/app/jeux/actions.ts`),
  qui force un nouvel appel et remplace le cache.
- Toute la logique cache-ou-fetch vit dans `src/lib/game-details.ts`
  (`getGameDetails`) ; `src/lib/igdb.ts` expose `fetchIgdbGameDetails`, qui
  ne fait qu'un appel réseau brut (pas de cache, pas de DB) — les deux
  responsabilités sont séparées.
- **Panne IGDB ou jeu introuvable** : si `fetchIgdbGameDetails` échoue
  (réseau, credentials, 404 IGDB) et qu'un cache existant est disponible
  (même périmé), on le sert quand même plutôt que de casser la fiche. Sans
  aucun cache, la fiche affiche juste les infos qu'on a déjà en base
  (cover, nom, min/max joueurs, source) avec le message
  *« Pas d'infos supplémentaires trouvées »* (ou un message dédié si
  l'erreur vient d'une panne réseau plutôt que d'un jeu inconnu d'IGDB).
- **Pour tester avec un jeu IGDB « propre »** (couverture complète :
  résumé, captures, trailer, plateformes…) : ajoute un jeu récent et connu
  depuis `/bibliotheque/ajouter` en utilisant la recherche IGDB (ex.
  *Hades*, *Hollow Knight*, *Portal 2*) — les jeux très récents ou de
  niche ont parfois des fiches IGDB incomplètes (pas de trailer/captures).
- **Bug corrigé : jeux Steam sans description.** L'import Steam
  (`src/lib/steam.ts`) crée les jeux avec `steamAppId` mais ne renseigne
  jamais `igdbId` — la fiche d'un jeu Steam ne "ratait" donc pas le
  match IGDB, elle ne le tentait jamais (`getGameDetails` s'arrêtait dès
  `!igdbId`, avant même d'essayer). `getGameDetails` tente maintenant une
  résolution à la demande pour tout jeu `source = STEAM` sans `igdbId` :
  `resolveIgdbIdForSteamGame` (`src/lib/igdb.ts`) interroge d'abord
  l'endpoint IGDB **`external_games`** (`uid = steamAppId`,
  `category = 1` = Steam — un AppID Steam ne correspond qu'à un seul jeu
  IGDB, c'est la méthode fiable), et à défaut retombe sur une recherche
  par nom (`searchIgdbGames`, même recherche que l'ajout manuel, premier
  résultat) — moins fiable (éditions/remakes), donc en dernier recours
  seulement. L'`igdbId` trouvé est persisté sur le `Game` pour les
  visites suivantes. Chaque tentative (succès par `external_games`,
  repli par nom avec ambiguïté notée, erreur réseau/API, ou échec
  complet) est loggée avec le préfixe `[igdb-match]`, pour identifier
  facilement les jeux qui restent sans fiche.

**Traduction FR de la description (DeepL, mise en cache).** IGDB ne
fournit `summary` qu'en anglais. Plutôt que de traduire à l'affichage
(coût + latence à chaque visite), la traduction se fait **une seule
fois, au même moment que le fetch IGDB**, et est mise en cache à côté de
l'original :

- `src/lib/deepl.ts` (`translateToFrench`) appelle l'API DeepL **Free**
  (`api-free.deepl.com`, plan gratuit — 500k caractères/mois, largement
  suffisant pour des résumés de jeux). Clé à récupérer sur
  [deepl.com/pro-api](https://www.deepl.com/pro-api) (compte gratuit,
  onglet API) → variable d'env `DEEPL_API_KEY` (voir `.env.example`).
- Appelée depuis `src/lib/game-details.ts` (`getGameDetails`), pas
  depuis `src/lib/igdb.ts` — même séparation des responsabilités que le
  reste de la fiche jeu : `igdb.ts` reste un client IGDB pur, sans
  dépendance à DeepL.
- Résultat stocké dans `Game.igdbDetails.descriptionFr`, à côté de
  `summary` (l'original) — pas de nouvelle colonne Prisma, c'est un
  sous-champ du même JSON déjà en cache.
- **Le bouton « Rafraîchir les infos » retraduit aussi** : un refresh
  forcé repasse par le même chemin de code (fetch IGDB + traduction),
  donc une nouvelle traduction est générée à chaque refresh — pas de
  traduction qui reste figée sur une ancienne version du résumé.
- **Sans `DEEPL_API_KEY` configurée : dégradation propre.**
  `translateToFrench` renvoie `null` (log `[deepl] DEEPL_API_KEY non
  configurée`), `descriptionFr` reste `null`, et la fiche affiche
  directement la version originale (anglaise) — aucun crash, aucun appel
  DeepL tenté. Pareil en cas d'échec réseau/API DeepL (log
  `[deepl] Traduction a échoué`).
- **UI** (`src/components/GameDescription.tsx`) : affiche la version FR
  par défaut si elle existe et diffère de l'original, avec un petit lien
  discret **« Voir la VO »** pour basculer sur l'anglais (et
  inversement). Sans traduction disponible, affiche directement
  l'anglais sans aucun toggle (rien à basculer).
- **Comment tester** : ajouter un jeu avec une description IGDB connue
  (ex. *Hades*, *Portal 2*) sans `DEEPL_API_KEY` configurée → la fiche
  affiche l'anglais, pas de toggle. Ajouter `DEEPL_API_KEY` puis cliquer
  « Rafraîchir les infos » sur cette même fiche → la description passe
  en français avec le lien « Voir la VO » qui bascule vers l'original.

**Nombre de joueurs éditable directement sur la fiche** : si tu possèdes
le jeu, le bouton crayon (`EditGameDialog`, déjà utilisé sur
`/bibliotheque`) est affiché à côté du nombre de joueurs — même
composant, même validations, pas de duplication.

**Actions rapides** :

- **« Proposer une soirée avec ce jeu »** → `/sessions?gameId=<id>`. Le
  formulaire de création de soirée (`/sessions`) affiche alors un bandeau
  « Cette soirée proposera automatiquement *{jeu}* » et transmet un champ
  caché `gameId` ; `createSession` (`src/app/sessions/actions.ts`) crée la
  `Proposal` correspondante juste après avoir créé la session, en plus du
  flux existant (proposer un jeu après coup depuis `/sessions/[id]`, qui
  continue de fonctionner normalement). Best-effort : un `gameId` invalide
  n'empêche pas la création de la session.
- **« Qui d'autre possède ce jeu »** : liste des membres du groupe qui
  l'ont dans leur biblio (avatar + pseudo, `(toi)` si c'est toi).

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
  serveur : la deadline doit toujours rester strictement avant l'heure de
  la session, sinon la création est rejetée avec un message clair
  (`/sessions?error=deadline_apres_session`).
- **Bug corrigé : deadline calculée déjà passée à la création.** Un
  preset comme « 6h avant » est *relatif à l'heure de la session*, pas à
  *maintenant* — une session créée l'après-midi pour le soir-même avec un
  preset trop large (ex. session 17h créée à 13h43, deadline 6h avant =
  11h) produisait une deadline **déjà dans le passé**. Conséquence en
  prod : la session se clôturait automatiquement dès la première visite
  de sa page (`closeSessionIfDue`), avec zéro fenêtre de vote — « Soirée
  annulée » immédiate, repéré via deux captures d'écran Discord à 13h43 et
  14h54 après un premier vrai test à deux utilisateurs.

  **Choix fait (parmi les deux proposés) : ajuster automatiquement plutôt
  que refuser.** `createSession` (`src/app/sessions/actions.ts`) détecte
  une deadline calculée (preset *ou* date/heure précise) déjà passée ou
  trop proche de « maintenant », et la repousse à *maintenant + 30 min*
  (`MIN_VOTING_BUFFER_MS`) — avec un bandeau explicite sur la page de la
  session qui suit (`?deadline=ajustee`, cf. `SessionDetailPage`) plutôt
  qu'un simple toast qui disparaîtrait avant la redirection. Si cet
  ajustement dépasserait l'heure de la session (session très proche), la
  deadline est recalée à 1 min avant la session au lieu de casser
  l'invariant « deadline < session ». Enfin, si même après ajustement il
  ne reste aucune fenêtre de vote viable — la session elle-même est à
  moins de 30 min (`MIN_SESSION_LEAD_MS`) ou déjà passée — la création est
  refusée avec un message clair
  (`/sessions?error=session_trop_proche`) : créer une "soirée" qu'il est
  structurellement impossible de voter sereinement n'aurait pas de sens,
  même en repoussant la deadline. Préféré à un refus systématique pour
  toute deadline passée : l'app est pensée pour des sessions créées à la
  dernière minute (c'est justement ce qui a déclenché le bug), et ajuster
  silencieusement-mais-visiblement coûte moins de friction qu'obliger à
  rouvrir le formulaire avec un preset différent.

  *Comment tester* : créer une session pour aujourd'hui dans 2-3h avec le
  preset « 6h avant la session » (deadline mécaniquement déjà passée) →
  la session se crée normalement et le bandeau jaune d'ajustement
  s'affiche. Créer une session dans 30 min pile avec le même preset → se
  crée avec une fenêtre de vote de ~29 min. Créer une session dans 10-20
  min → rejetée avec le message « trop proche ».
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
  de cron ici (F7 utilise un cron externe, voir plus bas — pas Vercel
  Cron), donc pas de clôture qui se déclenche vraiment "toute seule" en
  arrière-plan si personne ne consulte la page, mais c'est transparent dès
  qu'un membre du groupe rouvre l'app.
- **Un seul jeu gagnant par soirée — choix assumé** : à la clôture, le jeu
  retenu (`Session.decidedGameId`) est la proposition la plus votée (égalité
  → la plus ancienne proposition). C'est cohérent avec le schéma indicatif
  du §5 (`decidedGameId` est un champ unique, pas une liste) et avec le
  roadmap v2 du §7, qui traite explicitement la « file de jeux co-op »
  (plusieurs jeux à enchaîner) comme un sujet séparé, pas prévu en v1. Sans
  proposition à l'heure de la clôture, la session est automatiquement
  annulée (`CANCELLED`) plutôt que planifiée sans jeu.
- **Révision F6 : le gagnant doit être JOUABLE.** À l'introduction du
  webhook Discord (F6), le choix initial ci-dessus (« les votes restent
  souverains même si le badge n'est pas JOUABLE ») a été revu : la
  clôture ne retient désormais que les propositions **jouables** comme
  gagnantes possibles ; s'il y a des propositions mais qu'aucune n'est
  jouable, la session est annulée plutôt que planifiée avec un jeu que le
  groupe ne peut pas effectivement réunir. Annoncer dans Discord « soirée
  validée » pour un jeu injouable aurait été trompeur — le badge n'était
  plus seulement informatif à partir du moment où un message sort vers
  tout le monde.
- Cycle de vie complet : `VOTING → SCHEDULED` (clôture avec gagnant) ou
  `VOTING → CANCELLED` (clôture sans proposition, ou annulation manuelle) ;
  `SCHEDULED → DONE` (bouton « Marquer comme terminée », pratique après coup)
  ou `SCHEDULED → CANCELLED` (plans annulés).

## Résultat poussé dans Discord (F6)

À chaque clôture de session (manuelle **ou** automatique — les deux
passent par `closeSession` dans `src/lib/sessions.ts`, point d'entrée
unique), un embed est posté dans `DISCORD_WEBHOOK_URL`
(`src/lib/discord.ts` + `src/lib/discord-announce.ts`).

**Rendu de l'embed gagnant** (couleur violet `#8b5cf6`, un peu comme ceci) :

```
┌───────────────────────────────────────────┐
│ 🎮 Soirée validée : Valheim         [cover]│
│ dimanche 24 août 21:00                     │
│                                             │
│ Joueurs          3                         │
│ Qui vient        @Max @Sacha @Lea          │
└───────────────────────────────────────────┘
@Max @Sacha @Lea
```

(la ligne `@Max @Sacha @Lea` sous l'embed est le `content` brut du
message, séparé de l'embed — voir plus bas.)

**Rendu de l'embed « annulée »** (aucune proposition, ou aucune jouable —
couleur rouge `#ef4444`) :

```
┌───────────────────────────────────────────┐
│ ❌ Soirée annulée                          │
│ Soirée annulée, pas assez de joueurs pour  │
│ dimanche 24 août 21:00.                    │
└───────────────────────────────────────────┘
```

En cas d'égalité de votes entre plusieurs propositions jouables, l'embed
gagnant ajoute un champ `Note : Égalité de votes — choisi par ancienneté
de proposition.`

- **Titre** : `🎮 Soirée validée : {jeu}` ou `❌ Soirée annulée`.
- **Description** : date + heure en français (`formatDateTimeFr`).
- **Miniature** (`thumbnail`, coin haut-droit de l'embed) : `coverUrl` du
  jeu gagnant, si disponible.
- **Champs** : nombre de joueurs (= nombre de votes pour la proposition
  gagnante) et liste de leurs pseudos.
- **Détail technique important sur les pings** : Discord ne déclenche une
  vraie notification push que pour des mentions `<@discordId>` présentes
  dans le `content` **brut** du message webhook — une mention à
  l'intérieur d'un embed s'affiche (cliquable, résout le pseudo) mais ne
  notifie **personne**. Les mentions des votants sont donc envoyées à la
  fois dans le champ "Qui vient" de l'embed (lisible dans le contexte de
  la carte) et dans le `content` du message (déclenche la notif sur leur
  téléphone), pour satisfaire à la fois la lisibilité et le besoin de
  notification.
- **Jeu gagnant = doit être JOUABLE** (voir la révision documentée dans la
  section F5 ci-dessus) : aucune proposition jouable → embed rouge
  « annulée », jamais un jeu que le groupe ne peut pas réunir.

### Dégradation propre si `DISCORD_WEBHOOK_URL` n'est pas configurée

`postToDiscord` (`src/lib/discord.ts`) vérifie la variable d'abord : si
elle est absente, elle logue un `console.warn` (`[discord]
DISCORD_WEBHOOK_URL non configurée — message non envoyé.`) et renvoie
`{ ok: false, error: "not_configured" }` **sans jamais lever
d'exception**. `closeSession` (et son appelant `closeSessionAction`)
poursuivent normalement : le statut de la session est mis à jour en base
quoi qu'il arrive, l'envoi Discord est un effet secondaire best-effort qui
ne bloque jamais la clôture. Idem pour toute erreur réseau ou réponse HTTP
non-2xx du webhook (loggée en détail côté serveur). Sur une clôture
**manuelle**, si l'envoi Discord échoue, l'utilisateur voit un bandeau
discret sur la page de la session : « Résultat sauvegardé mais l'envoi
Discord a échoué. » — jamais un plantage. Sur une clôture **automatique**
(paresseuse, déclenchée par le chargement d'une page), l'échec est
seulement loggué côté serveur (pas d'utilisateur précis à qui l'afficher).

### Bonus : renvoyer l'annonce

Sur une session déjà clôturée (`SCHEDULED`, `DONE` ou `CANCELLED`), un
bouton **« Renvoyer dans Discord »** (`resendDiscordAction` →
`resendSessionAnnouncement` dans `src/lib/sessions.ts`) reconstruit et
reposte le même embed — pratique si le webhook a échoué la première fois
(ou si le message a été supprimé côté Discord). Un bandeau confirme
l'envoi ou l'échec, même mécanisme que la clôture manuelle.

## Rappels drôles avant session (F7)

Rappels automatiques envoyés dans Discord (même webhook que F6), à **24h**
et **2h** avant l'heure d'une soirée déjà planifiée (`Session.status =
SCHEDULED`, jeu décidé).

### Déclenchement : cron externe toutes les 15 min (pas Vercel Cron)

**Le plan Vercel Hobby n'autorise pas un cron toutes les 15 minutes** —
la fréquence minimale imposée est d'une exécution par jour (voir la
[doc officielle Vercel](https://vercel.com/docs/cron-jobs/usage-and-pricing)).
Un `vercel.json` déclarant `*/15 * * * *` fait donc **échouer le build**
au déploiement. F7 a besoin d'une vraie granularité de 15 min pour que les
fenêtres 24h/2h se déclenchent à temps (voir plus bas pourquoi), donc pas
de solution de repli côté Vercel Cron sans dégrader la fonctionnalité —
la route est appelée par un **cron externe** à la place (ex.
[cron-job.org](https://cron-job.org), gratuit, ou tout autre service de
cron HTTP équivalent — GitHub Actions `schedule`, EasyCron, etc.).

1. Créer un cron job pointant vers `https://ton-projet.vercel.app/api/cron/reminders`.
2. Fréquence recommandée : **toutes les 15 minutes** (`*/15 * * * *`) —
   c'est le pas de temps qui garantit qu'aucune fenêtre 24h/2h n'est
   "sautée" : la route calcule à chaque appel le temps restant avant
   chaque session et déclenche un rappel dès que le seuil est franchi et
   pas déjà envoyé (anti-doublon via `Session.remindersSent`) ; un
   intervalle plus large risquerait de rater la fenêtre 2h pour une
   session créée tardivement, un intervalle plus petit n'apporte rien vu
   la granularité des fenêtres elles-mêmes.
3. Méthode `GET`, en-tête `Authorization: Bearer <CRON_SECRET>` si la
   variable est configurée (fortement recommandé en prod — voir
   ci-dessous). Exemple d'appel :

   ```bash
   curl -X GET "https://ton-projet.vercel.app/api/cron/reminders" \
     -H "Authorization: Bearer $CRON_SECRET"
   ```

   La plupart des services de cron HTTP (dont cron-job.org) permettent de
   configurer un en-tête personnalisé sur la requête programmée — c'est
   là qu'ajouter `Authorization: Bearer <CRON_SECRET>`.

À chaque appel, la route (`src/app/api/cron/reminders/route.ts`) parcourt
les sessions `SCHEDULED` à jeu décidé et à venir, calcule le nombre
d'heures avant le début, et envoie le rappel **24h** et/ou **2h** dès que
le seuil est franchi *et* que la fenêtre n'a pas déjà été envoyée
(`Session.remindersSent`, tableau JSON du type `["24h"]` — évite les
doublons si le cron retombe plusieurs fois dans la même fenêtre, y
compris si le service externe déclenche un appel en double). Une session
créée très en retard (moins de 2h avant l'heure) peut recevoir les deux
rappels **dans le même appel** — les deux fenêtres sont vérifiées
indépendamment, pas de fenêtre "manquée" faute d'avoir été créée à temps.
Pas de rappel à 15 min avant la session elle-même (décidé volontairement,
cf. demande initiale — à ne pas confondre avec le pas de 15 min du cron).

**Sécurité optionnelle** : si `CRON_SECRET` est configurée (variable
d'env), la route exige l'en-tête `Authorization: Bearer <CRON_SECRET>` —
à renseigner manuellement dans la config du cron externe (contrairement à
Vercel Cron, un service tiers ne le fait pas tout seul). Sans
`CRON_SECRET` configurée, la route reste appelable par n'importe qui
connaissant l'URL — acceptable pour un usage perso/petit groupe, mais
`CRON_SECRET` est recommandée dès que l'URL est publique.

### Contenu du rappel

- **Message** : celui perso de la session (`Session.customReminderMessage`,
  champ optionnel du formulaire de création dans `/sessions`) s'il est
  renseigné ; sinon un **tirage aléatoire** parmi les `ReminderTemplate`
  actifs.
- **Variables supportées** : `{pote}` (mentions `<@discordId>` des
  joueurs qui ont voté pour le jeu gagnant, hors utilisateurs en
  silence), `{jeu}` (nom du jeu décidé), `{heure}` (format `HH:mm`).
- **Embed volontairement plus petit que F6** : juste titre (« ⏰ Rappel —
  dans 24h/2h ! »), le message tiré/perso en description, et un champ
  « Heure ». Pas de miniature, pas de liste détaillée des joueurs — pensé
  pour rester punchy, contrairement à l'embed de résultat (F6) qui est le
  message "officiel" de la soirée.
- **Ping réel = `content` brut, pas juste l'embed** (même détail
  technique que F6) : les mentions sont mises à la fois dans le `content`
  du webhook (seul canal qui déclenche une vraie notification push
  Discord) et implicitement dans le message via `{pote}` si le template
  les utilise.
- **Toggle silence par utilisateur** (`User.silenceReminders`, bouton
  « 🔕 Couper les rappels » sur `/profil`) : un utilisateur en silence
  n'est **jamais mentionné** (ni dans `{pote}`, ni dans le `content` du
  webhook) — mais le message est **quand même posté** dans le salon, il
  n'est simplement pas notifié personnellement.

### Interface d'admin des messages (`/admin/rappels`)

Accessible à tout utilisateur connecté (pas de rôle admin dédié dans ce
MVP, conformément à la demande). Ajouter/modifier le texte
inline/supprimer/désactiver-réactiver chaque message. `active = false`
est un fusible : le message reste en base (avec qui l'a créé) mais sort
du tirage aléatoire sans être perdu.

### Seed des 9 messages initiaux

```bash
npm run seed
```

Lance `prisma/seed.mjs` (script Node/ESM autonome, pas de dépendance
`ts-node`/`tsx` ajoutée juste pour ça). Idempotent : ne fait rien si des
`ReminderTemplate` existent déjà en base. Les messages sont attribués au
compte `User` le plus ancien (`createdAt` le plus bas) — connecte-toi au
moins une fois via Discord avant de lancer le seed.

### Comment tester sans attendre 24h

Crée une soirée depuis `/sessions` en choisissant **« Choisir une
date/heure précise à la place »** pour viser une heure ~2h30 dans le
futur, fais-la passer en `SCHEDULED` (clôture le vote avec un jeu
jouable), puis déclenche le cron manuellement : `GET
/api/cron/reminders` (en local, `curl http://localhost:3000/api/cron/reminders` —
ajoute l'en-tête `Authorization: Bearer <CRON_SECRET>` si tu l'as
configurée). La fenêtre 2h sera due immédiatement ; retente 15-20 min
plus tard une fois la session à moins de 2h pour voir la vraie temporalité,
ou ajuste directement `Session.date` en base pour un test instantané.

### Dégradation propre si le cron externe n'est pas configuré

Cette route n'est **jamais appelée toute seule** — c'est le cron externe
(cron-job.org ou équivalent) qui la déclenche, pas l'app elle-même. Sans
cron configuré (pas encore mis en place, service en panne, mauvaise URL) :
personne n'appelle jamais `/api/cron/reminders`, donc **aucun rappel ne
part**, mais rien d'autre dans l'app n'est affecté — la création de
session, le vote, la clôture et l'annonce Discord (F6) fonctionnent
normalement. On peut aussi déclencher la route manuellement à tout moment
(voir ci-dessus) pour vérifier qu'elle répond, indépendamment du cron.

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
5. **Rappels (F7)** : pas de Vercel Cron — le plan Hobby n'autorise pas
   une fréquence de 15 min (minimum imposé : 1 exécution/jour, voir « Rappels
   drôles avant session » ci-dessus). Configure plutôt un cron externe
   (ex. [cron-job.org](https://cron-job.org)) pointant vers
   `https://ton-projet.vercel.app/api/cron/reminders` toutes les 15 min,
   avec l'en-tête `Authorization: Bearer <CRON_SECRET>` si tu as défini
   `CRON_SECRET` dans les variables d'environnement du projet (recommandé,
   l'URL étant publique). Une fois déployé, lance `npm run seed` une fois
   (en local, pointé sur `DATABASE_URL` de prod, ou via `vercel env pull`)
   pour peupler les 9 messages de rappel initiaux.

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
- **500 avec `createMotionComponent() from the server`** (corrigé) : un
  composant utilisant `motion.xxx` de `framer-motion` (`<Badge animate>`
  notamment, sur `/sessions/[id]`) sans directive `"use client"` en tête de
  fichier plante en Server Component — l'accès à `motion.span` déclenche la
  création du composant animé, qui n'existe que côté client. `Badge.tsx`
  était le seul composant du projet dans ce cas (tous les autres —
  `Button`, `EditGameDialog`, `motion.tsx`, `PageTransition`, `VoteButton`,
  `VotingCountdown` — avaient déjà `"use client"`) ; il a maintenant la
  directive. `MotionConfig` dans `layout.tsx` n'a pas ce problème : c'est un
  vrai composant exporté (avec sa propre directive `"use client"` dans le
  paquet `framer-motion`), pas un accès dynamique `motion.xxx`.

## Scripts disponibles

| Commande | Description |
| --- | --- |
| `npm run dev` | Lance le serveur de dev Next.js |
| `npm run build` | Build de production |
| `npm run start` | Démarre le build de production |
| `npm run lint` | Lint ESLint |
| `npm run seed` | Seed des 9 messages de rappel initiaux (F7, idempotent) |
| `npx prisma studio` | Explorateur visuel de la base de données |
| `npx prisma migrate dev` | Applique les migrations en local (et en crée une nouvelle si le schéma a changé) |
| `npx prisma migrate deploy` | Applique les migrations existantes sans les modifier (Neon/CI/Vercel) |

## Structure du projet

```
prisma/schema.prisma        # Schéma de données complet (§5)
src/auth.ts                 # Config Auth.js (provider Discord, callbacks)
src/lib/prisma.ts           # Client Prisma (adapter Neon serverless)
src/lib/steam.ts            # OpenID 2.0 Steam + import GetOwnedGames
src/lib/igdb.ts             # Client IGDB (token Twitch caché, recherche + fiche détaillée)
src/lib/game-details.ts     # Cache-ou-fetch de la fiche IGDB (Game.igdbDetails)
src/lib/current-user.ts     # Session Auth.js → ligne User en base
src/lib/wallclock.ts        # Parsing/format date+heure (convention horloge-murale)
src/lib/availability.ts     # Calcul dispo (créneaux hebdo + exceptions)
src/lib/sessions.ts         # Clôture de session, deadline, calcul "jouable", annonce Discord
src/lib/session-status.ts   # Libellés/couleurs des statuts de session
src/lib/discord.ts          # postToDiscord (webhook, dégrade proprement si non configuré)
src/lib/discord-announce.ts # Construit l'embed de résultat de session (F6)
src/lib/discord-reminder.ts # Construit + envoie l'embed de rappel (F7, fenêtres 24h/2h)
src/lib/deepl.ts            # translateToFrench (API DeepL Free, dégrade sans DEEPL_API_KEY)
prisma/seed.mjs             # Seed des 9 messages de rappel initiaux (npm run seed)
src/components/ui/          # Button, ButtonLink, Card, Badge, Skeleton
src/components/motion.tsx   # Stagger, StaggerItem, PopIn (framer-motion)
src/components/PageTransition.tsx       # Fondu entre routes (AnimatePresence)
src/components/ActionForm.tsx           # Wrapper server action + toast (non redirigeant)
src/components/VoteButton.tsx           # Bouton de vote (bounce + compteur animé)
src/components/VotingCountdown.tsx      # Compte à rebours deadline de vote (client)
src/components/EditGameDialog.tsx       # Panneau modal d'édition d'un jeu (Radix Dialog)
src/components/ReadOnlyGameGrid.tsx     # Grille de jeux lecture seule (biblio pote / groupe)
src/components/AvailabilityView.tsx     # Dispos hebdo + exceptions lecture seule (biblio pote)
src/components/GameDescription.tsx      # Description FR/VO avec toggle (fiche jeu)
src/components/LibraryTabs.tsx          # Onglets "Ma bibliothèque" / "Groupe"
src/components/ui/Avatar.tsx            # Avatar circulaire (fallback initiale si pas d'avatar Discord)
src/components/Header.tsx / BottomNav.tsx / Logo.tsx  # Identité + nav
src/app/actions.ts          # Server actions bibliothèque (ajout/retrait/édition, réimport Steam)
src/app/page.tsx            # Page d'accueil (login / profil)
src/app/profil/page.tsx     # Profil + lien Steam + toggle silence rappels
src/app/profil/actions.ts   # Server action toggle silence rappels
src/app/admin/rappels/page.tsx    # CRUD des messages de rappel (F7)
src/app/admin/rappels/actions.ts  # Server actions messages de rappel
src/app/api/cron/reminders/route.ts # Envoie les rappels dus, appelée par un cron externe (F7)
src/app/potes/page.tsx                  # Liste des potes du groupe
src/app/potes/[id]/page.tsx             # Biblio d'un pote (lecture seule)
src/app/bibliotheque/page.tsx           # Liste des jeux possédés (perso)
src/app/bibliotheque/groupe/page.tsx    # Tous les jeux possédés par le groupe
src/app/bibliotheque/ajouter/page.tsx   # Ajout manuel + recherche IGDB
src/app/jeux/[id]/page.tsx              # Fiche jeu détaillée (IGDB à la demande, cache)
src/app/jeux/actions.ts                 # Server action "Rafraîchir les infos"
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
