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
- [Vercel Blob](https://vercel.com/docs/storage/vercel-blob) (optionnel) —
  upload de bannière de profil, voir « Upload de bannière (Vercel Blob) »
  plus bas.

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
| `CRON_SECRET` | *(Recommandée en prod)* Valeur aléatoire au choix (ex. `openssl rand -hex 32`). Protège toutes les routes `/api/cron/*`/`/api/backfill/*` — **absente = routes désactivées (503)**, voir la section dédiée pour la configuration du cron externe. |
| `ADMIN_DISCORD_IDS` | Ton `discordId` (mode développeur Discord → clic droit sur ton profil → **Copier l'ID utilisateur**), et ceux d'autres admins si besoin, séparés par des virgules. Donne accès à `/admin` — voir la section « Rôle admin » ci-dessous. |

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
- **PR "build ne fait plus que compiler"** : `npm run build` ne fait
  désormais QUE `prisma migrate deploy && next build` — aucune écriture de
  données métier (seeds/backfills) au build. Ces 11 tâches (seed des
  messages Discord, badges, tags, trophées de groupe, superlatifs,
  stats jeux, saison 1 ; backfills XP, couleurs, badges, templates
  invalides), auparavant chaînées dans `npm run build`, vivent maintenant
  dans `src/lib/seed-*.ts`/`backfill-*.ts` et sont déclenchées via
  `POST /api/backfill/seed-reconcile` (cron quotidien + curl manuel) —
  voir « Seeds & backfills en tâche de fond » plus bas.

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
**Section compactée (corrigé)** : une carte par jour de la semaine, même
vide, faisait dépasser 700px sur mobile. `AvailabilityView` n'affiche
maintenant une carte que pour les jours qui ont réellement un créneau ;
les jours sans créneau sont regroupés dans une seule ligne texte discrète
(« Pas dispo : Mer, Jeu, Ven, Sam, Dim ») plutôt que 5 cartes vides.

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
- **Bug corrigé : traduction qui ne se déclenchait jamais.** Un jeu dont
  `igdbDetails` avait déjà été mis en cache par une version de l'app
  antérieure au champ `descriptionFr` (fiche jeu déployée avant la
  traduction DeepL) n'avait tout simplement pas cette clé dans son JSON —
  `undefined`, pas `null`. Une visite normale servait ce cache pour
  toujours sans jamais retenter de traduction, même après avoir configuré
  `DEEPL_API_KEY` : la description restait en anglais indéfiniment.
  `getGameDetails` distingue maintenant explicitement `undefined`
  (cache antérieur à la fonctionnalité → retraduction rattrapée une
  fois, sans refaire l'appel IGDB) de `null` (traduction déjà tentée,
  échouée ou clé absente → pas de nouvelle tentative à chaque page vue,
  comportement inchangé). Logging ajouté à chaque étape
  (`[deepl] Appel traduction…`, `[deepl] Traduction reçue avec succès`,
  `[igdb] Fiche … mise en cache — descriptionFr présente/absente`) pour
  diagnostiquer un futur souci sans deviner. Vérifié aussi que la clé
  DeepL **Free** se termine bien par `:fx` (sinon avertissement explicite
  dans les logs) — une clé Pro sur `api-free.deepl.com` (ou l'inverse)
  répond 403 sans autre indice, cause n°1 des échecs DeepL en prod.
- **Chargement en streaming avec skeleton.** Tout ce qui dépend de
  `getGameDetails` (note, description, captures, trailer,
  plateformes/éditeur) est isolé dans un composant serveur async séparé
  (`GameIgdbSection`), rendu sous `<Suspense>` — le reste de la fiche
  (cover, nom, joueurs, actions rapides, qui possède le jeu) s'affiche
  immédiatement, et cette section arrive en streaming une fois l'appel
  IGDB/DeepL terminé, avec un skeleton (`GameIgdbSectionSkeleton`)
  pendant l'attente plutôt qu'un chargement bloquant de toute la page.
  `getGameDetails` n'est appelée qu'une seule fois par rendu (dans ce
  composant, nulle part ailleurs sur la page) pour ne jamais déclencher
  deux traductions DeepL sur un même chargement.

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
  historiquement (v1 de F5) n'importe quel utilisateur connecté pouvait
  cliquer « Clôturer le vote maintenant », le schéma ne définissant alors
  aucune notion de « créateur » de session. **Révisé** depuis l'ajout de
  `Session.createdById` (voir « Créateur de session, permissions &
  suppression » plus bas) : la clôture **manuelle** est désormais réservée
  au créateur. Sans action manuelle, la clôture se déclenche toujours
  automatiquement **à la lecture** (chargement de `/sessions` ou
  `/sessions/[id]`) dès que la deadline de vote — ou, à défaut pour les
  sessions créées avant son ajout, l'heure de la session — est passée, et
  ça reste ouvert à tout le monde puisque ça n'a pas de bouton donc pas de
  notion de « qui clique » ; pas de cron ici (F7 utilise un cron externe,
  voir plus bas — pas Vercel Cron), donc pas de clôture qui se déclenche
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
l'envoi ou l'échec, même mécanisme que la clôture manuelle. Réservé au
créateur de la session ou à un admin (PR "Accès & secrets" — jusqu'ici
ouvert à tout le monde, voir la section « Rôle admin »).

## Rôle admin (PR « Accès & secrets »)

`/admin` (messages, badges, superlatifs, stats jeux, reconnexion globale)
n'était protégé que par « être connecté » — n'importe quel pote du groupe
pouvait tout modifier. Deux mécanismes cumulatifs décident maintenant qui
est admin (`src/lib/admin.ts`, `requireAdmin()`) :

- **`ADMIN_DISCORD_IDS`** (env, CSV de `discordId`) — bootstrap : garantit
  un accès admin dès le premier déploiement, avant même une première
  connexion, sans dépendre d'une ligne en base.
- **`User.role`** (`UserRole.ADMIN`, colonne en base) — modifiable ensuite
  (Prisma Studio ou SQL direct) sans redéploiement pour ajouter/retirer des
  admins au fil de l'eau.

Un `discordId` listé dans `ADMIN_DISCORD_IDS` est **toujours** traité comme
admin, même si `role` dit `USER` en base (filet anti-verrouillage : l'env
reste un accès de secours indépendant de la base).

**Devenir admin au premier déploiement** : pose `ADMIN_DISCORD_IDS` sur
Vercel (Project → Settings → Environment Variables) avec ton `discordId`
(mode développeur Discord → clic droit sur ton profil → **Copier l'ID
utilisateur**, pas ton pseudo). Ça fonctionne immédiatement, avant même ta
première connexion à l'app.

## Messages Discord personnalisables (MessageTemplate)

Refonte : au lieu d'un modèle dédié aux seuls rappels (F7), **un seul
modèle de messages texte tirés au hasard, catégorisé** —
`MessageTemplate` (renommé depuis `ReminderTemplate`, migration
`20260821144022_rename_reminder_to_message_template`, qui **renomme** la
table au lieu de la recréer : les 9 messages de rappel existants ne sont
pas perdus, ils sont automatiquement re-tagués `REMINDER_24H` +
`REMINDER_2H` par la migration — comportement F7 identique à avant).

**Le résultat de vote (F6) reste hors de ce système** : c'est un embed
structuré (jeu gagnant, joueurs, etc.), pas un message perso tiré au
hasard — rien à catégoriser là-dedans.

### Catégories et variables

| Catégorie | Déclenchée quand | Variables |
| --- | --- | --- |
| `SESSION_CREATED` | Une soirée est créée | `{heure}`, `{date}`, `{createur}` |
| `SESSION_MODIFIED` | Une soirée est modifiée *(chantier suivant, catégorie déjà en place)* | `{heure}`, `{date}`, `{createur}`, `{ancienne_heure}`, `{ancienne_date}` |
| `REMINDER_24H` | Rappel 24h avant une soirée planifiée | `{pote}`, `{jeu}`, `{heure}` |
| `REMINDER_2H` | Rappel 2h avant une soirée planifiée | `{pote}`, `{jeu}`, `{heure}` |

Un même message peut appartenir à **plusieurs catégories** (`categories`,
array Postgres de l'enum `MessageCategory`) — utile pour un message
générique valable pour les deux fenêtres de rappel, par exemple. Le champ
`variables` (array de strings) est **purement informationnel** : calculé
automatiquement depuis les catégories cochées (`variablesForCategories`,
`src/lib/message-templates.ts`), jamais saisi à la main — pas de risque
qu'il parte en désync avec les vraies catégories du message.

### Runtime : tirage + repli

`pickMessageTemplate(category, vars)` (`src/lib/message-templates.ts`)
est le point d'entrée unique pour les 4 catégories : tire un message
actif au hasard parmi ceux dont `categories` contient la catégorie
demandée, puis substitue les variables (`{clé}` → valeur). **Sans
message actif pour cette catégorie** (avant le premier seed, ou si tous
les messages d'une catégorie ont été désactivés/supprimés), un texte de
repli hardcodé prend le relais — jamais d'envoi vide ni d'exception :

```ts
const FALLBACKS: Record<MessageCategory, string> = {
  SESSION_CREATED: "📣 Nouvelle soirée créée pour {date} à {heure}",
  SESSION_MODIFIED: "⚠️ Soirée décalée : nouveau créneau {date} à {heure}",
  REMINDER_24H: "🎮 Rappel : {jeu} à {heure} ! {pote}",
  REMINDER_2H: "🎮 Rappel : {jeu} à {heure} ! {pote}",
};
```

Comme pour F6/F7, les mentions concernées sont toujours mises à la fois
dans l'embed (lisible) et dans le `content` brut du webhook — seul canal
qui déclenche une vraie notification push Discord.

### Interface d'admin (`/admin/messages`, renommée depuis `/admin/rappels`)

Accessible à tout utilisateur connecté (pas de rôle admin dédié dans ce
MVP). Pour chaque message : texte éditable, **cases à cocher pour choisir
les catégories** où il peut être tiré, actif/désactivé (fusible qui garde
le message sans le supprimer), suppression. Chaque case à cocher affiche
directement sous son libellé la liste des variables de sa catégorie (ex.
« Création de soirée — Variables : {heure}, {date}, {createur} ») plutôt
qu'un résumé séparé qui se recalculerait au survol — plus simple, pas de
JS nécessaire, et l'info reste juste même sans interaction. Le bouton
« Nouveau message » propose un template vide avec les mêmes cases.

### Seed idempotent par catégorie

```bash
npm run seed
```

`prisma/seed.mjs` (Node/ESM autonome) peuple trois groupes indépendamment
— chaque groupe n'est inséré que si **aucun** message existant ne porte
déjà une de ses catégories, pour rester idempotent *et* pour que
relancer le seed sur une base déjà migrée (9 rappels existants) ajoute
quand même les nouveaux messages de création/modification au lieu d'être
bloqué par un check global :

- **`REMINDER_24H` + `REMINDER_2H`** : les 9 messages historiques F7
  (inchangés).
- **`SESSION_CREATED`** (4 messages, style hype/Discord énervé) :
  1. « 📣 OUVREZ LES YEUX. {createur} vient de créer une soirée pour
     {date} à {heure}. VOTEZ MAINTENANT, pas dans 3 jours. »
  2. « 🚨 SOIRÉE INCOMING : {date} à {heure}. {createur} a posé le truc,
     à vous de jouer — littéralement. »
  3. « Yo tout le monde, {createur} vient de sortir une soirée le {date}
     à {heure}. Qui vote pas, qui joue pas, qui se plaint pas après. »
  4. « NOUVELLE SOIRÉE DÉTECTÉE 🎮 {date} à {heure}, merci {createur}.
     Direction l'app, TOUT DE SUITE. »
- **`SESSION_MODIFIED`** (3 messages, style « soirée décalée ») :
  1. « ⚠️ Soirée décalée par {createur} : nouveau rendez-vous {date} à
     {heure} (c'était {ancienne_date} à {ancienne_heure}). »
  2. « ⚠️ Changement de programme : {createur} a bougé la soirée à
     {date}, {heure}. Notez bien le nouveau créneau. »
  3. « ⚠️ Ancien créneau ({ancienne_date} à {ancienne_heure}) annulé,
     nouveau créneau : {date} à {heure}. Merci {createur}. »

Les messages sont attribués au compte `User` le plus ancien (`createdAt`
le plus bas) — connecte-toi au moins une fois via Discord avant de
lancer le seed.

## Notification à la création d'une soirée

Manque le plus remonté à l'usage : jusqu'ici, créer une session ne
poussait rien dans Discord (seule la clôture, F6, ou les rappels, F7, le
faisaient). `announceSessionCreated` (`src/lib/discord-session-created.ts`)
est appelée à la fin de `createSession` — jamais bloquante : `postToDiscord`
ne lève jamais, un échec n'empêche pas la session d'être créée (le
créateur voit juste un bandeau « L'action a bien été enregistrée, mais
l'envoi Discord a échoué » sur la page de la session, même mécanisme que
F6/le renvoi manuel).

- **Message hype** en `content` brut : tiré via `pickMessageTemplate("SESSION_CREATED", …)`.
- **Embed structuré** : titre « 📣 Nouvelle soirée », date/heure, deadline
  de vote, et un **lien absolu** vers la page de la session (construit
  depuis `AUTH_URL` — indispensable pour que le lien fonctionne
  correctement une fois cliqué depuis Discord, contrairement à une URL
  relative).
- **Qui est pingué — choix assumé : mentions individuelles, pas
  `@everyone`.** Tous les membres du groupe sauf le créateur (qui vient
  de cliquer le bouton) sont mentionnés individuellement dans le
  `content`, en respectant `User.silenceReminders` (cohérence avec F7 : un
  utilisateur qui a coupé les rappels ne veut probablement pas non plus
  être pingué à chaque création de soirée). Choisi plutôt que `@everyone`
  pour deux raisons : cohérence avec F6/F7 qui ne l'utilisent jamais, et
  fiabilité — un webhook mentionnant `@everyone` dépend d'une permission
  Discord spécifique sur le salon (« Mentionner @everyone »/`@here` et
  tous les rôles ») qui peut être désactivée sans que l'app le sache,
  auquel cas la mention serait silencieusement ignorée par Discord.

### Bug corrigé : le seed des messages par défaut ne tournait jamais en prod

En prod, `pickMessageTemplate("SESSION_CREATED", …)` retombait
systématiquement sur son texte de secours (« 🔔 Nouvelle soirée créée
pour... ») au lieu de tirer parmi les 4 messages seedés, et
`/admin/messages` ne listait que les 9 rappels F7 — aucun
`SESSION_CREATED`/`SESSION_MODIFIED`. Cause : `prisma/seed.mjs` n'était
déclenché que manuellement (`npm run seed`), jamais par le build Vercel —
personne ne l'avait relancé après la migration qui a introduit ces deux
catégories. (`/admin/messages` lui-même n'a jamais filtré par catégorie —
vérifié, la requête n'a pas de `where` — ce n'était pas la cause.)

Corrigé en ajoutant le seed au script `build` de `package.json` :
`prisma migrate deploy && node prisma/seed.mjs && next build`, donc
exécuté à **chaque** déploiement Vercel. Pour rester sûr à rejouer
indéfiniment dans ce contexte :

- **Idempotent par groupe de catégories**, pas par un seul check global —
  `seedCategoryGroup` (`prisma/seed.mjs`) ne (re)crée un groupe que si
  aucun `MessageTemplate` existant ne porte déjà une de ses catégories.
  Une base déjà seedée avec les 9 rappels F7 reçoit quand même les
  `SESSION_CREATED`/`SESSION_MODIFIED` manquants ; les futurs groupes de
  catégories bénéficieront du même mécanisme sans toucher aux messages
  existants.
- **Tout premier déploiement, avant toute connexion Discord** : il n'y a
  encore aucun `User` pour porter `createdById`. Dans ce cas précis le
  script logue un avertissement et ne fait rien pour ce groupe, sans faire
  échouer le build (`process.exitCode` reste à `0`) — il se rattrapera
  tout seul au déploiement suivant.

## Créateur de session, permissions & suppression

`Session.createdById` (`prisma/schema.prisma`) introduit une notion de
créateur, absente du schéma indicatif du §5. Détermine désormais qui peut
gérer le cycle de vie d'une soirée ; proposer un jeu et voter restent
ouverts à tout le groupe.

- **Backfill (migration
  `prisma/migrations/20260821150558_add_session_created_by`)** : colonne
  ajoutée nullable, puis backfillée avant d'être passée `NOT NULL`, faute
  d'avoir jamais enregistré qui cliquait « Créer » avant cette migration.
  Stratégie à deux niveaux, dans l'ordre : (1) le membre du groupe le plus
  récemment arrivé mais déjà présent avant la création de la session
  (`User.createdAt <= Session.createdAt`, le plus récent de ceux-là) —
  meilleure estimation possible après coup ; (2) à défaut (aucun
  utilisateur connu avant cette session), le compte le plus ancien du
  groupe. Toute nouvelle session passe par `createSession`, qui renseigne
  `createdById` dès la création — le backfill ne concerne que l'historique.
- **Actions désormais réservées au créateur** (gardées côté serveur dans
  `src/app/sessions/actions.ts`, jamais seulement côté UI) : clôturer
  manuellement le vote (`closeSessionAction`), annuler la soirée
  (`cancelSessionAction`), la marquer comme terminée
  (`markSessionDoneAction` — pas listée explicitement dans la demande
  initiale, mais même famille de gestion du cycle de vie que
  clôturer/annuler, donc alignée par cohérence), et la supprimer (voir
  ci-dessous). Un utilisateur qui n'est pas le créateur voit ces boutons
  masqués sur `/sessions/[id]`, et l'action serveur correspondante est un
  no-op silencieux si jamais elle est appelée directement — la vraie
  protection est côté serveur, pas le masquage UI. Proposer un jeu et voter
  restent ouverts à tout le monde ; renvoyer l'annonce Discord
  (`resendDiscordAction`, non destructif) est réservé au créateur ou à un
  admin depuis la PR "Accès & secrets" (ouvert à tout le monde avant). La
  clôture **automatique**
  (`closeSessionIfDue`, à la lecture) reste elle aussi ouverte à tout le
  monde — voir la révision dans la section F5 ci-dessus.
- **Suppression (`DeleteSessionDialog.tsx` + `deleteSessionAction`)** :
  bouton visible uniquement pour le créateur, sur `/sessions/[id]`, derrière
  une modal de confirmation (Radix Dialog, même pattern que
  `EditGameDialog`). Suppression définitive de la session ; les
  `Proposal`/`Vote` associés disparaissent automatiquement via les cascades
  déjà en place dans le schéma (`onDelete: Cascade` sur `Proposal.session`
  et `Vote.proposal`) — rien à nettoyer à la main pour eux, ni pour
  `remindersSent` (simple champ JSON sur la ligne `Session` elle-même,
  supprimée avec elle). **Aucune notification Discord** : contrairement à
  l'annulation (qui reste annoncée, F6), supprimer une session est traité
  comme du ménage silencieux, pas un événement à communiquer au groupe.
- Le bouton « Modifier » est arrivé dans une PR séparée (voir juste
  ci-dessous) — au moment de l'écriture de la section ci-dessus, seul le
  champ `createdById` était en place pour le porter.

## Édition de session & notification SESSION_MODIFIED

Bouton « Modifier » (`EditSessionDialog.tsx`), visible uniquement pour le
créateur, sur `/sessions/[id]` tant que la session est `VOTING` ou
`SCHEDULED` (modifier une soirée déjà `DONE` ou `CANCELLED` n'a pas de
sens — rien à reprogrammer). Modal Radix Dialog, même pattern que
`DeleteSessionDialog`, avec les champs date/heure/deadline de vote
préremplis avec les valeurs actuelles (contrairement au formulaire de
création, pas de préréglages "6h avant" ici : on édite un créneau déjà
choisi, donc on montre directement ses valeurs réelles plutôt que de
reproposer des raccourcis relatifs).

- **Mutualisation demandée** : la validation (deadline strictement avant
  la session, ajustement auto si elle tombe dans le passé, refus si la
  session devient trop proche/passée) vit maintenant dans
  `resolveSessionSchedule` (`src/lib/session-schedule.ts`), extraite du
  code de `createSession` sans changement de comportement, et réutilisée
  telle quelle par `editSessionAction`. Les messages d'erreur FR associés
  (`SESSION_SCHEDULE_ERROR_MESSAGES`) sont eux aussi mutualisés et
  affichés aussi bien sur `/sessions` (création) que sur `/sessions/[id]`
  (édition, nouveau `?error=` sur cette page).
- Si la session avait déjà un `decidedTime` renseigné (session déjà
  clôturée avec un gagnant, donc `SCHEDULED`), il est resynchronisé sur la
  nouvelle date — c'est une simple copie de `date` (cf. commentaire dans le
  schéma), les laisser diverger n'aurait pas de sens.
- **Notification `SESSION_MODIFIED`** (`announceSessionModified` dans
  `src/lib/discord-session-modified.ts`), calquée sur
  `announceSessionCreated` (F6/notif de création) avec deux différences
  volontaires :
  - **Ping ciblé, pas tout le groupe** : seuls les membres ayant déjà voté
    sur une proposition de cette session sont mentionnés individuellement
    (`<@id>` dans le `content` brut, en respectant
    `User.silenceReminders`) — ce sont eux qui ont un intérêt direct à
    savoir que le créneau a bougé ; quelqu'un qui n'a pas encore voté
    découvrira le nouveau créneau normalement en votant.
  - **Embed ancien vs nouveau créneau** : l'ancien est barré (markdown
    Discord `~~texte~~`, supporté dans les champs d'embed) à côté du
    nouveau, pour voir l'écart en un coup d'œil plutôt qu'un simple
    horodatage de dernière modif.
  - Variables substituées : `{createur}`, `{date}`, `{heure}`,
    `{ancienne_date}`, `{ancienne_heure}` — tirées au hasard parmi les
    `MessageTemplate` actifs de la catégorie `SESSION_MODIFIED` (seedés
    depuis PR 1/3, cf. section MessageTemplate plus haut), avec le même
    mécanisme de repli/dégradation propre que F6/F7/la notif de création
    (`postToDiscord` ne lève jamais, un échec d'envoi n'empêche jamais la
    modification d'être enregistrée — bandeau `?discord=echec` identique
    aux autres actions).

## Petits fixes UX (PR 18)

Quatre ajustements ponctuels, groupés dans la même PR que l'édition de
session ci-dessus.

- **Bibliothèque : bouton « + » par carte, pas un bouton flottant.**
  *(Corrigé en PR 19, voir section dédiée plus bas : ce bouton n'a de sens
  que sur la biblio d'un pote — pas sur la sienne, où le jeu est déjà
  possédé.)* Ajouté à côté du stylo et de la corbeille sur chaque `GameCard`
  (`BibliothequeGrid.tsx`), il ouvre `/bibliotheque/ajouter?name=<nom du
  jeu>` — le formulaire d'ajout manuel préremplit son champ nom avec cette
  valeur (`AjouterJeuForm` accepte maintenant un `initialName`), utile
  pour enchaîner l'ajout d'un jeu similaire (DLC, suite, autre jeu du même
  univers) sans retaper le nom. **Un bouton flottant global a été écarté**
  volontairement : la page a déjà un CTA « + Ajouter un jeu » bien visible
  en haut, donc un FAB aurait fait doublon pour le cas générique — et
  surtout n'aurait eu aucun contexte à partir duquel préremplir un nom,
  qui est précisément la valeur ajoutée demandée ici. Le bouton par carte,
  lui, porte ce contexte nativement.
- **Combobox recherche pour « Proposer un jeu »**
  (`src/components/ProposeGameForm.tsx`), à la place du `<select>` natif
  devenu pénible passé une grosse quarantaine de jeux. **Composant maison,
  pas de nouvelle dépendance** (pas cmdk, pas de Combobox Radix — qui
  n'existe pas dans leur catalogue) : cohérent avec le reste de l'app, qui
  n'utilise aucun kit UI et construit toutes ses primitives à la main
  (`Button`, `Card`, `EditGameDialog`…), et l'interaction voulue ici reste
  simple — filtrer une liste et choisir un item, sans multi-select ni
  chargement asynchrone. Champ texte + liste déroulante filtrée en temps
  réel (substring, insensible à la casse), navigation clavier
  (flèches/Entrée/Échap), tap targets ≥44px (`min-h-11`) et police d'entrée
  16px (`text-base`) pour rester mobile-first (évite le zoom auto iOS sur
  focus). Le bouton « Proposer » reste désactivé tant qu'aucun jeu de la
  liste n'est sélectionné — pas de `required` sur un champ caché, qui
  n'est pas fiable sur un `<input type="hidden">` selon la spec HTML.
- **Retirer sa propre proposition** (`withdrawProposalAction` +
  `WithdrawProposalDialog.tsx`) : visible uniquement pour
  `proposedById === user.id`, jamais pour le créateur de la session sur les
  propositions des autres (lui gère la session dans son ensemble via la
  suppression complète, pas les propositions individuelles). Modal de
  confirmation (même pattern que `DeleteSessionDialog`), cascade
  automatique sur les votes via le schéma (`onDelete: Cascade` sur
  `Vote.proposal`). Restreint au vote encore ouvert, comme
  `proposeGame`/`toggleVote` : après clôture, le gagnant est déjà figé
  dans `Session.decidedGameId` (indépendant de la ligne `Proposal`), donc
  retirer une proposition n'aurait plus d'effet utile.
- **Cartes de proposition cliquables** vers `/jeux/[id]` : seuls la cover
  et le nom du jeu (+ la ligne "Proposé par") sont enveloppés dans un
  `<Link>`, pas toute la carte — le bouton Voter et le lien "Retirer ma
  proposition" restent des éléments frères en dehors de ce `<Link>`,
  plutôt que imbriqués dedans (imbriquer un `<button>`/`<form>` interactif
  dans un `<a>` est invalide en HTML et aurait fait naviguer au clic sur
  le bouton). Résout proprement l'exigence "clic sur le jeu → fiche, mais
  Voter/Retirer ne doivent pas déclencher la navigation".

## Fixes préliminaires (PR 19)

Deux corrections livrées en amont du chantier XP/niveaux/rangs (voir plus
bas) — sans lien direct avec lui, mais regroupées dans la même première
PR de ce chantier plutôt que traitées à part.

- **FIX 1 — bouton « + » retiré de sa propre bibliothèque.** Le bouton
  ajouté en PR 18 sur `/bibliotheque` n'avait pas de sens : le jeu y est
  déjà possédé. Retiré de `BibliothequeGrid.tsx`. `ReadOnlyGameGrid.tsx`
  (composant partagé par `/potes/[id]` **et** `/bibliotheque/groupe`)
  gagne un prop `showAddButton` opt-in, activé uniquement depuis
  `/potes/[id]` — c'est le seul contexte où « ce pote a ce jeu, je veux
  l'ajouter à la mienne » a un sens univoque (sur la biblio de groupe, un
  jeu a souvent plusieurs possesseurs, dont potentiellement soi-même déjà).
  Le clic ouvre toujours `/bibliotheque/ajouter?name=<nom>` prérempli,
  comme avant. Au passage, la carte est restructurée (le lien vers
  `/jeux/[id]` ne couvre plus que cover + infos, le bouton « + » devient un
  élément frère positionné en absolu) pour éviter d'imbriquer un lien
  interactif dans un autre — même raison que les cartes de proposition en
  PR 18.
- **FIX 2 — variables Discord inconnues.** Un message `SESSION_MODIFIED`
  contenant `{jeu}`/`{pote}` (variables qui n'existent que pour les
  rappels F7, cf. `CATEGORY_VARIABLES`) partait tel quel dans Discord avec
  le texte `{jeu}` littéral, faute de variable à substituer.
  - **Runtime** (`substituteVariables`, `src/lib/message-templates.ts`) :
    après substitution des variables connues, toute `{variable}` restante
    est retirée silencieusement (regex) — filet de sécurité qui s'applique
    même à un message déjà mal configuré avant ce fix.
  - **Admin** (`MessageTemplateForm.tsx`, nouveau composant client qui
    remplace les `<form>` inline de `/admin/messages` — nécessaire pour
    porter de l'état réactif là où il n'y en avait pas) : bandeau rouge
    live sous le texte si une variable utilisée n'est fournie par aucune
    des catégories cochées, **sans bloquer la sauvegarde** (l'utilisateur
    peut choisir d'ignorer, comme demandé). Bonus : taper `{` propose une
    autocomplétion des variables disponibles pour les catégories cochées
    (liste filtrée en live, insertion au curseur).

## Chantier XP / niveaux / rangs — fondations (PR 2/9)

Premier étage du chantier XP/niveaux/rangs/superlatifs/tierlist (découpage
en 9 PR successives, validé avec l'utilisateur avant de commencer). Cette
PR pose uniquement les fondations : XP participation (Axe 1), niveaux,
rangs, streak, backfill, notif `LEVEL_UP`. Pas de résultats de soirée
(podium), pas de superlatifs, pas de tierlist, pas de refonte visuelle du
profil — ce sont les PR 3/9 à 9/9 suivantes.

### Modèle de données

- `User.xpTotal` (cache dénormalisé, indexé pour le tri de `/classement`,
  PR 9/9), `User.streakCount`/`streakLastActiveAt`.
- **`XpEvent`** : ledger append-only plutôt qu'un simple compteur, pour deux
  raisons — (1) idempotence via `@@unique([userId, reason, sourceId])`,
  qui permet au chemin "live" (`awardXp`) et au script de backfill de
  tourner tous les deux indéfiniment sans jamais doubler une même
  récompense (même prudence que le bug de seed corrigé dans une PR
  précédente) ; (2) `/classement` (PR 9/9) filtre "ce mois"/"cette
  semaine" en sommant les `XpEvent` de la période plutôt que le total
  unique, ce qu'un simple compteur n'aurait pas permis (`XpEvent` est
  indexé sur `createdAt` pour ça).
- `MessageCategory` gagne `LEVEL_UP`, avec ses propres variables
  (`{user}`, `{ancien_niveau}`, `{nouveau_niveau}`, `{titre}`, `{rang}`) et
  4 messages seedés.

### Barème XP (Axe 1 — validé)

| Action | XP | Remarque |
|---|---|---|
| Créer une soirée | 30 | `createSession`, sourceId = session.id |
| Voter | 5 | `toggleVote` (création du vote uniquement), sourceId = **proposalId** (pas l'id du vote — un aller-retour vote/dévote/revote sur la même proposition ne recrédite pas) |
| Participer à une soirée | 20 | à la clôture (`closeSession`), tous les users ayant voté pour la proposition **gagnante** — même définition que "présents" pour l'écran de résultats de la PR 3/9, volontairement unifiée pour n'avoir qu'une seule notion de "présence" dans tout le chantier |
| Régler ses dispos hebdo (1ère fois) | 15 | `addWeeklySlot`, détecté via un count avant insertion |
| Lier son compte Steam (1ère fois) | 15 | callback Steam, détecté via l'ancien `steamId64` avant update |
| Profil complet (1ère fois) | 25 | **pas encore actif** — le trigger est ajouté en PR 8/9, une fois que bannière et tierlist existent réellement |

Constantes centralisées dans `XP_AMOUNTS` (`src/lib/xp.ts`).

### Courbe de niveau, titres, rangs

XP cumulé requis pour atteindre le niveau N : **`50 × (N-1)²`** (niveau 1 =
0 XP). Repères concrets : niveau 2 → 50 XP · niveau 5 → 800 XP · niveau 10
→ 4 050 XP · niveau 20 → 18 050 XP · niveau 50 → 120 050 XP · niveau 100 →
490 050 XP.

Titres (`titleForLevel`) : 1 Victime · 5 Noob · 10 PAPED · 15 Habitué · 20
Try-hard · 30 Vétéran · 40 Acharné · 50 No-life · 70 Possédé · 85 Légende
vivante · 100 Sans-vie.

Rangs (`rankForLevel`, `RANKS` dans `src/lib/xp.ts`) : Bronze (1-10) ·
Argent (11-25) · Or (26-50) · Platine (51-75) · Diamant (76-99) · Légende
(100+). Couleurs prévues pour un badge, affinées visuellement en PR 8/9.

### Streak

Fenêtre glissante de 24h (pas de notion de "jour calendaire") : `touchStreak`,
appelée depuis `getCurrentUser()` à chaque page protégée, incrémente le
streak si le dernier passage remonte à moins de 24h, le remet à 1 sinon —
avec un throttle de 12h minimum entre deux incréments pour qu'une série de
clics dans la même journée ne fasse pas gonfler le compteur. Aucune
requête d'écriture supplémentaire dans le cas commun (< 12h depuis le
dernier passage), donc pas de coût perf notable malgré l'appel systématique.

**Bonus streak sur l'XP gagnée** : +5 %/jour consécutif, plafonné à +50 %
— atteint concrètement au jour 11 (le jour 1 lui-même n'apporte pas encore
de bonus), légèrement différent du "jour 10" évoqué à l'oral mais c'est la
conséquence directe et assumée de cette règle-là. Le multiplicateur ne
s'applique **qu'à l'XP gagnée en direct** — jamais au backfill (voir plus
bas), où il n'aurait pas de sens.

### Notification Discord `LEVEL_UP`

`announceLevelUp` (`src/lib/discord-level-up.ts`), déclenchée automatiquement
par `awardXp` dès qu'un gain d'XP fait franchir un seuil de niveau.
Contrairement aux notifs de session (plusieurs personnes concernées,
mentions conditionnelles selon `silenceReminders`), une seule personne est
concernée ici : `{user}` est donc toujours un mention `<@id>`, sans
condition de silence — même logique que `{createur}` dans la notif de
création de soirée, qui n'est jamais masqué non plus (ce n'est pas "un
rappel dont on peut se couper", c'est l'identité de la personne dont on
parle).

### Backfill (`prisma/backfill-xp.mjs`)

**Important — pas d'accès à la vraie base de prod depuis ce sandbox** :
impossible de connaître à l'avance les chiffres exacts d'XP pour toi ou
pour qui que ce soit d'autre. Le script est conçu pour s'auto-documenter à
l'exécution plutôt que de te demander de me faire confiance sur des
chiffres inventés :

- **Wired dans `npm run build`**, juste après le seed des messages —
  idempotent via la même contrainte unique que `awardXp`, donc sûr à
  rejouer à **chaque** déploiement (pas juste une fois). Concrètement, ça
  fait converger le chemin "live" et le backfill vers le même ledger : un
  événement déjà crédité par l'un est un no-op pour l'autre.
- **Ne déclenche jamais de notif Discord** — contrairement à `awardXp`
  (chemin live), le script écrit directement en base sans passer par la
  détection de passage de niveau. Un backfill qui spammerait le salon de
  dizaines de "level up" rétroactifs au premier déploiement aurait été
  absurde.
- **Imprime un récapitulatif détaillé par user à chaque exécution** (XP
  par type d'action, total, niveau/titre/rang) — visible dans les logs de
  build Vercel (Dashboard → ton déploiement → Building). **C'est là que tu
  dois vérifier que le backfill colle à ton historique réel**, comme
  demandé, avant qu'on enchaîne sur la PR 3/9.
- **Limite assumée et documentée** : seuls les votes *encore présents* en
  base sont visibles au backfill. Un vote posé puis retiré avant ce
  déploiement (`toggleVote` supprime la ligne `Vote` en base — aucune
  trace ne subsiste) ne peut pas être crédité rétroactivement. Le chemin
  live, lui, capte tout vote posé à partir de maintenant. Concrètement, si
  tu as voté puis changé d'avis sur d'anciennes sessions, ce compte de
  votes précis ne sera visible qu'à partir d'aujourd'hui.
- Duplique volontairement les formules pures de `src/lib/xp.ts`
  (`XP_AMOUNTS`, `levelForXp`, `titleForLevel`, `rankForLevel`) plutôt que
  de les importer — un module TypeScript avec alias `@/...` n'est pas
  exécutable tel quel par ce script Node/ESM autonome (même contrainte que
  `prisma/seed.mjs`, qui ne dépend pas non plus de `ts-node`/`tsx`). À
  garder en sync si le barème ou la courbe changent.

Script manuel équivalent : `npm run backfill-xp`.

### Aperçu XP minimal sur `/profil`

En attendant la vraie refonte (PR 8/9), `/profil` affiche juste niveau +
titre + rang + barre de progression XP + streak — le strict nécessaire
pour permettre la vérification manuelle du backfill demandée avant de
continuer le chantier.

## Résultats de soirée & XP performance (PR 3/9)

Deuxième étage du chantier XP (Axe 2). Une fois une session `DONE`, son
créateur — et lui seul — peut saisir un résultat générique : podium
1er/2e/3e facultatif, ou simple confirmation coop selon le jeu retenu.

- **Participants** (`/sessions/[id]/resultats`) : users ayant voté pour la
  proposition **gagnante** — même définition que l'XP `PARTICIPATE` déjà
  attribué à la clôture (PR 2/9), volontairement unifiée pour n'avoir
  qu'une seule notion de "présence" dans tout le chantier plutôt que deux
  qui pourraient diverger.
- **`Game.isCoop` détermine l'affichage** : jeu coop → pas de podium, un
  bouton unique "Confirmer la participation" donne `COOP_BONUS` (15 XP) à
  tout le monde à égalité. Jeu compétitif → un sélecteur 🥇/🥈/🥉 par
  participant (`SessionResultsForm.tsx`, state React plutôt que des
  `<input type="radio">` : choisir un placement déjà pris par quelqu'un
  d'autre le lui retire automatiquement, plus simple qu'un groupe de
  radios exclusif par placement qui n'empêcherait pas nativement "un seul
  1er au total"). Podium facultatif — un participant peut rester sans
  place.
- **Barème** : 1er = 50 XP, 2e = 25 XP, 3e = 10 XP (`XP_AMOUNTS.PODIUM_*`),
  en plus des 20 XP `PARTICIPATE` déjà acquis à la clôture — pas un
  remplacement. Un seul événement `XpReason.SESSION_RESULT` par user et
  par session (contrainte unique du ledger), donc pas de double
  comptabilisation possible même en cas de nouvel appel.
- **Choix assumé — pas de ré-édition des résultats.** Dès qu'au moins une
  ligne `SessionResult` existe pour une session, `submitSessionResultsAction`
  devient un no-op et la page bascule en lecture seule. Un podium corrigé
  après coup pourrait créditer un deuxième 1er sans jamais retirer le
  bonus déjà versé à l'ancien — `XpEvent` est un ledger append-only, pas
  conçu pour être annulé. Plutôt que construire un mécanisme de correction
  pour une fonctionnalité ludique, la saisie est verrouillée après le
  premier envoi. Une saisie malformée/dupliquée côté client (placement
  choisi deux fois) est de toute façon neutralisée côté serveur en ne
  retenant que la première occurrence rencontrée.
- **Page dédiée, pas une modal** (contrairement à `EditSessionDialog`/
  `DeleteSessionDialog`) : ce formulaire va grandir en PR 5/9 avec les
  champs de stats spécifiques au jeu (superlatifs) — une modal serait vite
  à l'étroit sur mobile pour ça.
- Aucune notification Discord pour l'instant — celle des superlatifs
  ("🏆 Awards de la soirée", catégorie `SESSION_AWARDS`) arrive en PR 5/9,
  une fois qu'il y a vraiment quelque chose à annoncer.

## Superlatifs par jeu — configuration (PR 4/9)

Troisième étage du chantier XP (Axe 3, partie 1 : uniquement la
configuration ici).

**Changement de plan en PR 5/9** : la saisie manuelle de stats chiffrées
(kills, morts…) après chaque soirée s'est révélée trop lourde à l'usage
pour un groupe de potes flemmards. Abandonnée au profit d'un système de
**vote de superlatifs entre potes** (voir la section dédiée plus bas) —
`GameStatType`/`Superlative` et `/admin/jeux-stats` restent dans le code
et fonctionnels (accessibles par URL directe), juste retirés du lien de
navigation sur `/profil` au profit de `/admin/superlatifs`. Choix assumé
de ne pas supprimer le code/schéma : garder la porte ouverte à une
réintroduction plus tard sans tout refaire.

### Modèle

- **`GameStatType`** : une stat saisissable après une soirée pour un jeu
  donné (ex. "morts" pour Lethal Company), typée `INT`/`FLOAT`/`BOOL`.
  `higherIsBetter` est purement cosmétique (couleur d'affichage en PR
  5/9) — ce n'est **pas** ce qui détermine qui gagne un superlatif, c'est
  `rule` sur chaque `Superlative` qui s'en charge. Une même stat peut
  porter plusieurs superlatifs avec des règles différentes.
- **`Superlative`** : `MAX`/`MIN` (stats numériques, le plus haut/bas
  gagne) ou `TRUE_COUNT` (stats `BOOL`, gagné par qui a `true` cette
  soirée-là). `xpReward` éditable par superlatif, 20 XP par défaut.

### `/admin/jeux-stats`

Réservé aux admins (voir « Rôle admin » ci-dessous). Liste des jeux de la biblio commune →
`/admin/jeux-stats/[gameId]` pour ajouter/éditer/supprimer ses stats et,
pour chaque stat, ses superlatifs (formulaires imbriqués mais jamais des
`<form>` HTML imbriqués — chaque ligne éditable et son bouton de
suppression sont deux formulaires frères, même contrainte déjà rencontrée
sur `/admin/messages` et les cartes de proposition en PR 18).

### Seed — 3-4 jeux populaires

**Je n'ai pas d'accès à la vraie base de prod depuis ce sandbox** (même
limite que le backfill XP de PR 2/9) : impossible de littéralement
"regarder la bibliothèque commune" avant de choisir. `prisma/seed-game-stats.mjs`
est donc conçu pour être **piloté par les vraies données au moment du
déploiement**, pas deviné à l'avance :

- Contenu sur-mesure préparé pour 4 jeux (dans cet ordre de priorité) :
  **Lethal Company** (🐛 Bouffé par le grouille · 💰 Le rat · 😱 First
  blood), **Content Warning** (🎬 Meilleur cameraman · 😱 Le crieur · 🌟
  Star du web, ce dernier en `TRUE_COUNT` pour exercer cette règle),
  **Counter-Strike 2** (🏆 MVP · 💀 Baby-sitter · 🐔 Feeder), **Apex
  Legends** (🎯 Killer · 💥 Dégâts) — utilisé **uniquement si un jeu
  correspondant existe vraiment** dans la biblio commune (au moins un
  `UserGame.owned`), matché par nom de façon tolérante (insensible à la
  casse, "CS2"/"Counter-Strike 2" acceptés tous les deux).
- S'il manque des jeux sur-mesure (moins de 4 trouvés), les places
  restantes sont comblées par les jeux **réellement** les plus possédés
  du groupe, avec un petit set générique (Score + Morts) — mieux que rien
  pour un jeu que je ne connais pas.
- **Idempotent par jeu** : un jeu déjà configuré (au moins une
  `GameStatType`) n'est jamais réécrasé.
- Wired dans `npm run build`, juste après le backfill XP. **Imprime un
  récapitulatif à chaque run** (jeux sélectionnés, popularité, origine du
  contenu sur-mesure/générique) — visible dans les logs de build Vercel,
  même endroit que le récapitulatif du backfill XP, pour vérifier que la
  sélection colle à la vraie bibliothèque commune.

Script manuel équivalent : `npm run seed-game-stats`.

## Audit trail sur /admin/messages et /admin/jeux-stats

Ajusté avant PR 5/9, à la demande de l'utilisateur : sans rôle admin
dédié, n'importe qui peut modifier un superlatif — crainte concrète
qu'un pote règle discrètement "MIN kills = MVP" pour se farmer de l'XP.
**Pas de blocage pour l'instant** (tout le monde peut toujours modifier),
juste une trace de qui a touché quoi en dernier, affichée discrètement.

- `MessageTemplate`, `GameStatType` et `Superlative` gagnent chacun
  `modifiedById` (FK `User`) + `modifiedAt` (`@updatedAt`, géré
  automatiquement par Prisma à chaque `update`/`create`, jamais fixé à la
  main). Pour `GameStatType`/`Superlative` (modèles neufs, aucune notion
  d'auteur avant cet ajout), un seul champ suffit — "dernière modif"
  couvre aussi "création" nativement. Pour `MessageTemplate`, qui avait
  déjà `createdById`/`createdAt` (qui l'a créé, inchangé), ces deux
  nouveaux champs s'ajoutent à côté plutôt que de les remplacer — d'où
  deux relations `User` distinctes et nommées explicitement
  (`MessageTemplateCreatedBy`/`MessageTemplateModifiedBy`), Prisma exige
  un nom dès qu'un modèle a plusieurs FK vers la même table.
- **Backfill dans la migration** (pas de script séparé, directement en
  SQL) : `MessageTemplate` reprend son propre `createdById`/`createdAt`
  (cohérent : "dernière modif" = "création" tant que personne n'y a
  retouché depuis) ; `GameStatType`/`Superlative` (déjà seedées par PR
  4/9) reprennent le compte le plus ancien du groupe, même repli que
  l'auteur par défaut dans `prisma/seed.mjs`.
- **Affichage** : `AuditLine.tsx`, composant partagé — "Modifié par
  {avatar} {pseudo} le {date}" en pleine taille sur chaque message et
  chaque stat, version compacte (juste avatar + date, infobulle avec le
  texte complet) sur chaque superlatif individuellement pour ne pas
  surcharger des lignes déjà denses.
- Toutes les actions de création/modification (et la bascule
  actif/inactif d'un message, qui modifie bien la ligne) mettent à jour
  `modifiedById` avec le user courant.

## Vote de superlatifs entre potes (PR 5/9)

Remplace la saisie manuelle de stats chiffrées initialement prévue (voir
plus haut) : 30 secondes de tap par participant, zéro chiffre à saisir.

### Flow

1. Une soirée passe `DONE` (via "Marquer comme terminée") →
   `markSessionDone` ouvre automatiquement une fenêtre de vote de 24h
   (`openSuperlativeVotingWindow`, `src/lib/superlative-voting.ts`). Moins
   de 2 participants (personne d'autre à désigner, se voter soi-même étant
   impossible) : la fenêtre se ferme directement, sans awards.
2. Un badge accent **"🏆 Vote les superlatifs !"** apparaît sur la carte de
   la session dans `/sessions` et sur `/sessions/[id]`, pour chaque
   participant qui n'a pas encore voté (participants = users ayant voté
   pour la proposition **gagnante**, même définition unifiée que l'XP
   `PARTICIPATE` et `/sessions/[id]/resultats` dans tout le chantier).
3. Clic → `/sessions/[id]/vote-superlatifs` : une rangée par superlatif
   actif, avatar de chaque autre participant en bouton (soi-même exclu de
   la liste, impossible de voter pour soi). "Valider mes votes" est
   désactivé tant qu'il manque un choix, et envoie tout d'un coup —
   formulaire tout-ou-rien, pas de vote partiel enregistré côté serveur.
   Une fois voté : verrouillé, pas de re-vote (même rationale que
   `/sessions/[id]/resultats` — `XpEvent` est un ledger append-only, pas
   fait pour être corrigé).
4. Clôture automatique (déclenchée en lecture, sur `/sessions`,
   `/sessions/[id]` et `/sessions/[id]/vote-superlatifs`, même schéma
   paresseux que `closeSessionIfDue` pour F7) dès que **tous les
   participants ont voté OU que 24h se sont écoulées**, whichever comes
   first : calcul du gagnant par catégorie (le plus de votes ; égalité →
   tirage aléatoire parmi les ex-aequo), attribution de l'XP bonus, et
   annonce Discord (catégorie `SESSION_AWARDS`, message aléatoire +
   embed listant chaque superlatif/gagnant/nombre de voix).
5. **Bouton créateur "Forcer la clôture des votes maintenant"** sur
   `/sessions/[id]/vote-superlatifs`, visible tant que le vote n'est pas
   clos — pour ne pas attendre 24h quand tout le monde a déjà voté ou est
   déjà reparti. Ignore la deadline et le "tout le monde a voté".
6. **0 vote sur la session au bout de 24h** (ou fenêtre jamais ouverte,
   moins de 2 participants) : session marquée close silencieusement,
   aucun award créé, **aucun embed Discord envoyé**, aucune XP distribuée
   — pas de notif "on n'a rien à annoncer".

### Les 6 superlatifs seedés

Configurables (icône, nom, description, XP, actif) sur `/admin/superlatifs`
— réservé aux admins (voir « Rôle admin »), traçabilité en plus via
`AuditLine` (crainte déjà documentée plus haut : un pote pourrait truquer
un superlatif pour se farmer de l'XP — désormais bloqué pour un
non-admin, et de toute façon tracé).

| Superlatif | XP |
| --- | --- |
| 🏆 MVP de la soirée | +30 |
| 💀 Le plus mort / Le nul | +15 |
| 😂 Le plus drôle | +15 |
| 🔥 Le sweaty | +20 |
| 🐢 Le plus lent / Le boomer | +10 |
| 👻 Le fantôme (le plus absent / afk) | +10 |

Seedés par `prisma/seed-superlatives.mjs` (idempotent par nom, wired dans
`npm run build` juste après `seed-game-stats.mjs` ; base neuve sans
utilisateur encore connecté → seed reporté au prochain build, même
philosophie que `prisma/seed.mjs`). Script manuel équivalent :
`npm run seed-superlatives`.

### Schéma

- **`SuperlativeCategory`** : la définition d'un superlatif (icône, nom,
  description, `xpReward`, `active`, audit `modifiedById`/`modifiedAt`).
  Générique, pas de config par jeu — contrairement à
  `GameStatType`/`Superlative` (PR 4/9, désormais dormants).
- **`SuperlativeVote`** : un vote d'un participant pour un autre, par
  catégorie et par soirée (`@@unique([sessionId, categoryId,
  voterUserId])` — un seul vote par catégorie et par votant).
- **`SuperlativeAward`** : le résultat final par catégorie et par soirée
  (`@@unique([sessionId, categoryId])`), avec `voteCount` (nombre de voix
  du gagnant). Pas de ligne créée pour une catégorie sans aucun vote.
- **`Session`** gagne `superlativeVotingDeadline` (deadline des 24h,
  `null` si la fenêtre n'a jamais été ouverte) et
  `superlativeVotingClosed` (booléen distinct plutôt que déduit de
  l'existence d'`SuperlativeAward` — "clos avec 0 award" est un état
  valide, différent de "pas encore clos").

### Discord — catégorie `SESSION_AWARDS`

Nouvelle catégorie `MessageTemplate`, 3 messages seedés par défaut :
"🏆 Les awards tombent :\n{gagnants}", "⚡ Voici les vainqueurs :\n{gagnants}
Applaudissez.", "Palmarès de la soirée :\n{gagnants} Bravo les gars." —
variable `{gagnants}` = liste formatée
`🏆 MVP : @Kévin\n💀 Le plus mort : @Slime\n...`. Embed structuré en
complément (titre "🏆 Awards de la soirée — [nom du jeu]", un champ par
superlatif). **Pas d'avatar par superlatif dans l'embed** (simplification
assumée) : le modèle de champ d'un embed Discord n'affiche que du texte
(name/value), une image par champ n'existe pas — le nom du gagnant est
affiché en texte à la place.

## Tierlist perso (PR 6/9)

Chaque user classe la bibliothèque commune dans une tierlist S/A/B/C/D par
glisser-déposer, sur `/tierlist` (3e onglet à côté de "Ma bibliothèque" /
"Groupe", via `LibraryTabs`).

### Décisions prises avec l'utilisateur

- **Périmètre = toute la biblio commune**, pas seulement les jeux que le
  user possède lui-même — même définition que `/bibliotheque/groupe`
  (tous les jeux avec au moins un `UserGame.owned` quelque part dans le
  groupe). Permet de classer un jeu essayé chez un pote sans le posséder.
- **Visible par tous les potes**, pas privé : `/potes/[id]` gagne une
  section "Tierlist" en lecture seule, même esprit que la bibliothèque et
  les dispos déjà exposées là.
- **Glisser-déposer**, pas un tap-to-assign — choisi explicitement pour le
  rendu "vraie tierlist" (cartes qu'on fait physiquement glisser entre les
  rangées), plutôt qu'un bouton de rang par carte.

### Implémentation du drag & drop

Nouvelle dépendance **`@dnd-kit/core`** (seul le package `core`, pas
`@dnd-kit/sortable` : l'ordre *dans* une rangée n'a pas de sens pour une
tierlist, seule la rangée compte, pas besoin de tri interne). Choisi
plutôt qu'une implémentation maison en HTML5 Drag and Drop API : cette
dernière ne fonctionne quasiment pas au toucher sur mobile (elle repose
sur les événements souris), inacceptable pour une app mobile-first.
`@dnd-kit` utilise les Pointer Events (souris **et** tactile) via son
`PointerSensor`.

- `PointerSensor` avec un seuil d'activation (`distance: 6`) : sans lui,
  le moindre tap sur une carte déclencherait un drag et casserait le
  scroll tactile de la page. `touch-none` (CSS `touch-action: none`) sur
  chaque carte est requis en complément, sinon le navigateur capte le
  geste comme un scroll natif avant que dnd-kit ne le voie.
- 5 rangées droppables (S à D) + un pool "Non classé" en bas (jeux sans
  ligne `TierlistEntry`) — glisser une carte vers "Non classé" supprime sa
  ligne plutôt que d'écrire une 6e valeur d'enum qui ne serait qu'un
  "null" déguisé.
- Mise à jour optimiste côté client + `setGameTierAction` en
  arrière-plan (même philosophie que `VoteButton`), mais **sans toast à
  chaque dépose** : sur une bibliothèque de plusieurs dizaines de jeux, un
  toast par carte déplacée serait du bruit — le déplacement visuel de la
  carte est déjà le retour immédiat.
- `DragOverlay` (fourni par dnd-kit) pour une carte flottante bien visible
  pendant le drag, cohérent avec le niveau de polish (Framer Motion,
  `card-glow`) déjà présent ailleurs.

### Modèle

- **`Tier`** (enum `S`/`A`/`B`/`C`/`D`).
- **`TierlistEntry`** (`userId`, `gameId`, `tier`, `@@unique([userId,
  gameId])`) : un seul classement par jeu et par joueur, reclasser un jeu
  déjà classé fait un `upsert` plutôt que d'empiler une nouvelle ligne.
  Pas d'entrée = "non classé".
- Une seule teinte (l'accent violet de l'app) déclinée en intensité
  décroissante de S à D (`TIER_INTENSITY_CLASSES`, `src/lib/tierlist.ts`)
  plutôt que 5 couleurs arbitraires — le rouge/destructive reste réservé
  aux actions destructives ailleurs dans l'app.
- Migration purement additive (nouvel enum, nouvelle table vide).

**Pas d'XP pour l'instant** : le bonus "Profil complet" (§ chantier XP,
tableau du barème) reste désactivé jusqu'à la PR 8/9, qui l'activera une
fois que bannière **et** tierlist existent réellement — cette PR pose
juste la tierlist, sans toucher au barème XP.

## Fixes UX préliminaires (avant PR 7/9)

Deux frictions remontées après test en prod de la tierlist (PR 6/9),
corrigées dans la même PR que les badges plutôt qu'à part.

- **`/potes/[id]` en onglets** (Dispos / Bibliothèque / Tierlist /
  Badges) plutôt que tout empilé sur une seule page — la tierlist d'un
  pote était en bas d'un scroll interminable. Restructuré en
  `layout.tsx` (en-tête + `PoteTabs`, partagés) + 4 sous-routes réelles
  (`/potes/[id]`, `/potes/[id]/bibliotheque`, `/potes/[id]/tierlist`,
  `/potes/[id]/badges`) — même approche que `LibraryTabs` (navigation par
  vrais liens, pas un état client qui masque/affiche), `PoteTabs`
  détermine juste l'onglet actif via `usePathname()` (comme `BottomNav`)
  plutôt qu'une prop `active` explicite, un seul composant sert les 4
  sous-routes.
- **Filtre par nom sur `/tierlist`** — la zone "Non classé" peut contenir
  50+ jeux, impossible d'en retrouver un précis. Même pattern que le
  filtre de `/bibliotheque` (`BibliothequeGrid`) : un `<input
  type="search">` en haut, filtrage en temps réel côté client. Le filtre
  ne masque que l'affichage des cartes — l'état de classement
  (`tierByGameId`, source de vérité pour le drag & drop) n'est jamais
  touché, donc filtrer puis effacer la recherche ne fait perdre aucun
  classement.

## Badges automatiques (PR 7/9)

Système d'achievements 100% passif : l'app détecte et attribue, aucune
action volontaire de l'utilisateur. Débloqués soit en direct (juste après
l'action concernée : créer une soirée, voter, gagner un superlatif,
ajouter un jeu), soit au prochain chargement de page protégée pour les
critères "temporels" (streak, ancienneté du compte) — même schéma que le
streak de connexion déjà en place.

### Les 15 badges seedés

XP dérivé de la rareté plutôt que fixé badge par badge (la demande
initiale ne précisait pas de montant explicite, contrairement aux
superlatifs) : COMMON = 20 XP, RARE = 40 XP, EPIC = 75 XP, LEGENDARY = 150
XP (`BADGE_XP_BY_RARITY`, `src/lib/badge-rarity.ts`).

| Badge | Catégorie | Rareté | Critère exact | XP |
|---|---|---|---|---|
| 🎉 First Blood | Participation | Commun | 1 soirée créée | 20 |
| 🎮 Habitué | Participation | Commun | 10 soirées participées | 20 |
| 🏆 GOAT | Participation | Rare | 50 soirées participées | 40 |
| 👑 LÉGENDE | Participation | Légendaire | 100 soirées participées | 150 |
| ⚡ Marathon | Engagement | Rare | streak 7 jours | 40 |
| 🔥 Insomniaque | Engagement | Épique | streak 30 jours | 75 |
| 💎 Ancien | Engagement | Rare | 182 jours (~6 mois) sur l'app | 40 |
| 🌟 Vétéran | Engagement | Épique | 365 jours (1 an) sur l'app | 75 |
| 📚 Bibliophile | Bibliothèque | Commun | 30+ jeux dans sa biblio | 20 |
| 🎯 Collectionneur | Bibliothèque | Rare | 100+ jeux dans sa biblio | 40 |
| 🗳️ Citoyen | Vote | Commun | 20 votes émis | 20 |
| 📣 Meneur | Vote | Commun | 5 soirées créées | 20 |
| 🎤 Community leader | Vote | Rare | 20 soirées créées | 40 |
| 🥇 Compétiteur | Superlatifs | Rare | 5 superlatifs gagnés | 40 |
| 🌟 Star | Superlatifs | Épique | 20 superlatifs gagnés | 75 |

"Soirées participées" = même définition unifiée que tout le chantier XP
(users ayant voté pour la proposition gagnante) : compté via les
`XpEvent` `PARTICIPATE` déjà en base (pas de recalcul indépendant).
"Votes émis" = `XpEvent` `VOTE` (cumul historique, jamais décrémenté si
un vote est retiré depuis — un badge ne doit pas se reverrouiller).
"Soirées créées" sert **deux** badges de catégories différentes (Meneur
5 / Community leader 20 côté "Vote & démocratie", mais aussi la base de
First Blood/GOAT/LÉGENDE via `SESSIONS_PARTICIPATED` côté Participation)
— reflète fidèlement la répartition demandée, pas une erreur de doublon.

Seedés par `prisma/seed-badges.mjs` (idempotent par `Badge.name`, unique
en base — wired dans `npm run build`, juste après
`seed-superlatives.mjs`). Script manuel équivalent : `npm run
seed-badges`.

### Détection et attribution

- **`src/lib/badges.ts`** : `BadgeCriteria` (union discriminée `{ type,
  count }`, 7 types) + une fonction de check par déclencheur, chacune ne
  calculant QUE la statistique concernée (une requête `count()` ciblée,
  pas un recalcul complet à chaque fois) :
  - `checkSessionsCreatedBadges` — après `createSession`.
  - `checkVotesCastBadges` — après un nouveau vote (`toggleVote`, pas un
    dévote).
  - `checkSessionsParticipatedBadges` — après chaque crédit XP
    `PARTICIPATE` à la clôture d'une session (`closeSession`), un check
    par voteur de la proposition gagnante.
  - `checkSuperlativesWonBadges` — après chaque award de superlatif
    (`finalizeSuperlativeVoting`).
  - `checkLibraryBadges` — après `addManualGame` et `importSteamLibrary`
    (import initial **et** réimport, un seul point d'entrée partagé).
  - `checkTemporalBadges` — streak et ancienneté, appelée depuis
    `getCurrentUser()`, **throttlée sur le même signal que
    `touchStreak`** : ne relance le check que si `touchStreak` a
    réellement écrit cette fois-ci (vraie nouvelle visite, pas un
    rechargement dans les 12h) — sinon chaque page protégée ferait une
    requête badges en plus.
- **`unlockBadge`** (privée) : crée le `UserBadge` (idempotent via
  `@@unique([userId, badgeId])`, retombe silencieusement sur la
  violation de contrainte en cas de course), accorde `xpReward` via
  `awardXp` (raison `BADGE_UNLOCKED`, `sourceId` = `badge.id`) si défini,
  et annonce dans Discord (`announceBadgeUnlocked`).

### Notif Discord — catégorie `BADGE_UNLOCKED`

Même schéma que `announceLevelUp` (une seule personne concernée, `{user}`
toujours une mention, pas de condition de silence). 3 messages seedés par
défaut :

- "🏆 {user} vient de débloquer {badge_icon} {badge_name} — {rarity} !"
- "🎉 Nouveau badge pour {user} : {badge_icon} {badge_name}"
- "⚡ {user} unlock {badge_icon} {badge_name}, {rarity} édition !"

Variables : `{user}`, `{badge_name}`, `{badge_icon}`, `{rarity}`. Embed
structuré en complément (titre `{icon} {nom}`, description, champ
Rareté).

### Backfill — décision sur les notifs Discord

`prisma/backfill-badges.mjs` (idempotent via `@@unique([userId,
badgeId])`, wired dans `npm run build` juste après `seed-badges.mjs`)
recalcule pour chaque user existant les 7 statistiques (soirées créées,
participées, votes, superlatifs gagnés, taille de biblio, streak actuel,
ancienneté du compte) et débloque rétroactivement tout badge déjà mérité.

**Décision (demandée explicitement par l'utilisateur) : ce backfill ne
déclenche JAMAIS de notif Discord**, contrairement au chemin live. Un
premier déploiement où plusieurs users méritent déjà GOAT/Bibliophile/
Citoyen etc. spammerait le salon de 20-30 messages "vient de débloquer"
pour des exploits vieux de plusieurs mois — même logique déjà appliquée
au backfill XP (PR 2/9), qui ne déclenche jamais de "level up"
rétroactif. **L'XP, en revanche, est accordée rétroactivement**
(silencieusement) : un badge mérité doit compter dans le total, même
sans annonce.

**Limite assumée et documentée** (comme pour le backfill XP) : Marathon
(streak 7j) et Insomniaque (streak 30j) ne peuvent être détectés
rétroactivement QUE si le streak **actuel** d'un user dépasse déjà le
seuil au moment du backfill — `User.streakCount` est une valeur
courante, pas un historique des pics jamais atteints. Un user qui a déjà
tenu 30 jours puis cassé son streak (>24h sans connexion) ne peut pas
être détecté ici ; il débloquera le badge naturellement en live la
prochaine fois qu'il retteint le seuil. Pas de contournement possible
sans historiser le streak jour par jour, hors scope.

Récapitulatif détaillé imprimé par user à chaque run (stats + badges
nouvellement débloqués), visible dans les logs de build Vercel — même
format que le backfill XP. Script manuel équivalent : `npm run
backfill-badges`.

### Si un critère est modifié après coup

Les `UserBadge` déjà créés restent — **jamais de retrait rétroactif**.
Un badge gagné reste gagné, même si le seuil de son critère est relevé
plus tard (ex. "GOAT" repassé à 60 soirées) : cohérent avec le principe
déjà appliqué au streak (le badge "Marathon" ne se reverrouille jamais
si le streak retombe ensuite). Documenté directement dans le commentaire
du modèle `UserBadge` (schema.prisma).

### Affichage

- **`src/components/BadgeGrid.tsx`** : grille partagée entre `/profil`
  (les siens) et `/potes/[id]/badges` (ceux d'un pote, lecture seule dans
  les deux cas). Badges non débloqués grisés (icône en niveaux de gris,
  pas de bordure/glow de rareté — annoncer une rareté pas encore méritée
  serait trompeur).
- **Style par rareté** : COMMON = bordure neutre standard, RARE =
  `.badge-glow` (déjà existant, réutilisé), EPIC = `.badge-glow-epic`
  (nouveau, glow plus large + halo), LEGENDARY = halo **pulsant en
  continu** via Framer Motion (`useReducedMotion`-aware — pas
  d'animation JS continue si l'utilisateur a demandé moins de
  mouvement). Volontairement discret (une seule couche d'opacité qui
  respire, pas un scintillement) pour rester dans l'esprit "attention à
  ne pas surcharger".
- **`/profil`** : nouvelle section "Badges" (une `Card` de plus dans
  l'empilement existant, **pas un vrai système d'onglets** — voir le
  commentaire dans le code : `/profil` reste une page plate jusqu'à sa
  refonte visuelle prévue en PR 8/9, en ajouter un maintenant pour une
  seule section aurait anticipé cette refonte pour un gain nul). Les 3
  badges les plus récents sont affichés en petit à côté du rang, dans
  l'en-tête "Niveau X — Titre".
- **`/potes/[id]/badges`** : même `BadgeGrid`, lecture seule, couvert par
  le FIX 1 ci-dessus.

  Note (PR 8/9) : le paragraphe ci-dessus ("les 3 badges les plus récents
  affichés à côté du rang dans l'en-tête") décrivait `/profil` **avant**
  la refonte profil rich — cet en-tête a été entièrement remplacé, voir
  la section suivante.

## Hub admin & refonte profil rich (PR 8/9)

Retour d'usage après test en prod des PR 6/9 et 7/9 : `/admin/messages`
devenait long à scroller (30+ messages, 7 catégories actives). Corrigé
en même temps que la refonte profil déjà prévue pour cette PR.

### Hub `/admin`

Les 4 pages individuelles (`/admin/messages`, `/admin/superlatifs`,
`/admin/jeux-stats`, et le tout nouveau `/admin/badges`, qui n'avait
encore aucune interface avant cette PR) fusionnent en un seul hub
`/admin`, à onglets pilotés par `?tab=` plutôt que par de vraies
sous-routes (`AdminTabs`, `src/components/admin/`) — permet aux
anciennes URLs de rediriger proprement sans reconstruire une
arborescence de routes.

- **Ordre des onglets** (au choix, décision) : Messages Discord →
  Superlatifs → Badges → Jeux-stats — les deux premiers sont les
  systèmes actifs les plus utilisés au quotidien, Jeux-stats est en
  dernier car dormant depuis la PR 5/9.
- **Bonus demandé** : sous-filtres par catégorie dans l'onglet Messages
  (`MessagesList.tsx`, pastilles cliquables, une catégorie sans aucun
  message n'apparaît pas) — même souci de scroll infini réglé à
  l'intérieur même de cet onglet.
- **`/admin/badges`** (nouveau CRUD) : formulaire structuré (select type
  de critère + seuil numérique) plutôt qu'un textarea JSON libre pour
  `criteria` — un badge a désormais aussi `active`/`modifiedById`/
  `modifiedAt` (audit trail, aligné sur `SuperlativeCategory`), migration
  avec backfill (les 15 badges déjà seedés par la PR 7/9 reprennent le
  compte le plus ancien du groupe, même schéma que la migration d'audit
  trail de la PR 5/9). Un badge désactivé n'est plus jamais débloqué
  (`unlockMatchingBadges` filtre dessus) mais reste visible dans
  `BadgeGrid` (encyclopédique) et les `UserBadge` déjà attribués restent.
- **Redirections** (`permanentRedirect`, 308) :

  | Ancienne URL | Nouvelle URL |
  |---|---|
  | `/admin/messages` | `/admin?tab=messages` |
  | `/admin/superlatifs` | `/admin?tab=superlatifs` |
  | `/admin/jeux-stats` | `/admin?tab=jeux-stats` |

  `/admin/jeux-stats/[gameId]` (CRUD détaillé d'un jeu) reste une route
  indépendante, pas absorbée dans le hub — seule la page d'index l'était.

### Refonte profil rich (inspiration mangas-origines.fr)

`/profil` passe d'une page plate (empilement de cartes) à un
`layout.tsx` partagé (bannière + avatar à anneau + stats + onglets) + 6
sous-routes.

**Bannière : URL ou upload direct (Vercel Blob).** `User.bannerUrl` reste
une simple URL absolue en base — ce qui change (fix UX PR 9/9, suite au
test prod de la PR 8/9 : "chiant si on a une image perso") c'est comment
elle y arrive. `BannerForm.tsx` propose un toggle **URL / Uploader une
image** :
- **URL** : champ texte + preview live, comportement inchangé depuis la
  PR 8/9 (`setBannerUrlAction`).
- **Uploader une image** : sélection d'un fichier (jpg/png/webp/gif, 5 Mo
  max, validé côté client *et* côté serveur), preview live via
  `URL.createObjectURL`, upload vers Vercel Blob (`uploadBannerAction`,
  `src/app/profil/actions.ts`) qui renvoie une URL publique stockée telle
  quelle dans `bannerUrl` — pas de nouveau champ, pas de migration.
  Détails complets (pourquoi Vercel Blob, comment obtenir le token,
  limites) dans « Upload de bannière (Vercel Blob) » plus bas.

Vide → bannière par défaut (`.profile-banner-default`, dégradé CSS
violet). Affichée en `background-image` CSS (pas `next/image`), pour
l'URL saisie à la main **comme** pour l'URL Vercel Blob renvoyée par
l'upload : `next/image` exige une liste blanche de domaines dans
`next.config.ts`, incompatible avec une URL externe arbitraire — le CSS
gère aussi nativement le "cover center" demandé pour tolérer d'autres
ratios que 1500×500, donc aucune modification de `next.config.ts` n'a
été nécessaire pour l'upload.

**En-tête (`src/app/profil/layout.tsx`)** :
- Bannière (h-40 mobile → h-64 desktop).
- `RankAvatar` (`src/components/RankAvatar.tsx`, partagé avec
  `/potes/[id]`) : avatar avec anneau coloré selon le rang
  (`Rank.ringClass`, nouveau champ sur `xp.ts`) + pastille de niveau
  collée en bas à droite. Rang Légende : halo pulsant continu (même
  technique que `LegendaryPulse` de `BadgeGrid` — anime l'opacité d'une
  couche `box-shadow` statique, `useReducedMotion`-aware) plutôt qu'un
  dégradé arc-en-ciel littéral — réutilise le langage visuel déjà établi
  pour "légendaire" dans l'app plutôt que d'introduire un nouvel effet.
- Pseudo + badge de rang textuel + titre de niveau.
- "Membre depuis {mois année} · Rang global #N sur X" — `getGlobalRank`
  (`src/lib/profile-stats.ts`) reste une simple requête de comptage
  (users avec plus d'XP + 1), **pas** `getScoreboard` : afficher sa
  propre position ne justifie pas de calculer le classement complet du
  groupe pour une seule ligne. Le texte est un lien cliquable vers
  `/classement` (PR 9/9, voir plus bas) depuis cette PR.
- Barre XP inline.
- **5 cartes stats** : soirées jouées, jeux en biblio, soirées créées,
  superlatifs gagnés, streak (flamme animée si > 0, `StreakFlame.tsx`,
  `useReducedMotion`-aware).
- **"Copier le lien de mon profil"** copie `/potes/{userId}`, **pas**
  `/profil` littéral — `/profil` affiche toujours les données du user
  connecté quelle que soit l'URL (aucune notion de "profil de qui"
  dedans), donc partager ce lien montrerait à chaque destinataire SON
  PROPRE profil. `/potes/{userId}` est la route qui affiche réellement
  les infos de ce user pour n'importe quel autre membre du groupe.
- **"Modifier"** renvoie directement vers l'onglet Réglages (pas de
  modal séparée).

**Onglets `/profil`** (`ProfilTabs.tsx`, même pattern que `PoteTabs` —
actif déterminé par `usePathname()`) :

| Onglet | Route | Contenu |
|---|---|---|
| Aperçu | `/profil` | Prochaine soirée du groupe, dernière activité XP, 3 dernières récompenses gagnées |
| Historique soirées | `/profil/historique` | Sessions participées (`XpEvent` PARTICIPATE), jeu + date + placement si résultats saisis |
| Récompenses gagnées | `/profil/superlatifs` | `SuperlativesWonGrid` (nouveau composant partagé avec `/potes/[id]`) |
| Badges | `/profil/badges` | `BadgeGrid` réutilisé tel quel (PR 7/9) |
| Tierlist | `/profil/tierlist` | `TierlistBoard` affiché inline dans le profil (fix UX PR 9/9 — pointait vers `/tierlist` en PR 8/9, ce qui faisait sortir du profil au clic ; `/tierlist` reste utilisable en parallèle depuis `LibraryTabs`, même composant et même action serveur des deux côtés) |
| Rappels perso | `/profil/parametres` | En réalité tous les réglages de compte : bannière, Steam (lien/réimport, déplacé depuis l'ancienne page plate), silence des rappels, liens vers les 3 onglets `/admin` |

Les redirections Steam (`/api/steam/callback`, `reimportSteamLibrary`)
pointent désormais vers `/profil/parametres?steam=...` au lieu de
`/profil?steam=...` — sinon le statut d'import atterrirait sur l'onglet
Aperçu, qui ne le gère pas.

**`/potes/[id]`** gagne un 5e onglet **Superlatifs** (`/potes/[id]/superlatifs`,
même `SuperlativesWonGrid`) et son en-tête utilise désormais `RankAvatar`
+ un badge de rang textuel à côté du badge Steam — pas de bannière ici
(pas demandé pour la fiche d'un pote, réservé au profil personnel).

### Preview (pas de capture d'écran possible dans ce sandbox)

```
┌─────────────────────────────────────────┐
│▓▓▓▓▓▓▓▓ dégradé violet / image ▓▓▓▓▓▓▓▓▓▓│  ← bannière
│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│                    [🔗 Copier] [⚙️ Modifier]
│      ╭────╮                              │
└──────│ 😀 │──────────────────────────────┘
       │ 12 │  ← anneau coloré par rang + pastille niveau
       ╰────╯
  Kévin
  🥇 Or · Try-hard
  Membre depuis janvier 2026 · Rang global #3 sur 8
  ████████████░░░░░░░░  62 % vers le niveau 13

  ┌────┐┌────┐┌────┐┌────┐┌────┐
  │ 24 ││ 87 ││  5 ││  3 ││ 7🔥│
  │Soir││Jeux││Créé││Sup.││Str.│
  └────┘└────┘└────┘└────┘└────┘

  Aperçu │ Historique │ Superlatifs │ Badges │ Tierlist │ Rappels perso
  ───────
  (contenu de l'onglet actif)
```

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
les sessions `SCHEDULED` à jeu décidé et à venir, et envoie un rappel pour
chaque timing de `Session.reminderTimings` dès que le seuil est franchi
*et* que ce timing n'a pas déjà été envoyé (`Session.remindersSent`,
tableau JSON de minutes en string, ex. `["1440", "120"]` — évite les
doublons si le cron retombe plusieurs fois sur le même timing, y compris
si le service externe déclenche un appel en double). Une session créée
très en retard peut recevoir plusieurs rappels **dans le même appel** —
chaque timing est vérifié indépendamment. **Depuis PR 31 (2/4, Bloc A),
`reminderTimings` est configurable par le créateur à la création** (24h +
2h par défaut, comme avant cette PR) — voir la section dédiée plus bas
pour le détail complet (préréglages, rappels custom, max 5).

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
  renseigné ; sinon un **tirage aléatoire** via `pickMessageTemplate`
  parmi les `MessageTemplate` actifs de la catégorie `REMINDER_24H`
  ("loin") ou `REMINDER_2H` ("proche"), choisie selon le timing exact
  du rappel (voir PR 31, Bloc A, plus bas).
- **Variables supportées** : `{pote}` (mentions `<@discordId>` des
  joueurs qui ont voté pour le jeu gagnant, hors utilisateurs en
  silence), `{jeu}` (nom du jeu décidé), `{heure}` (format `HH:mm`).
- **Embed volontairement plus petit que F6** : juste titre (« ⏰ Rappel —
  dans {timing} ! », ex. "24h"/"45 min"/"1h30"), le message tiré/perso en
  description, et un champ « Heure ». Pas de miniature, pas de liste
  détaillée des joueurs — pensé pour rester punchy, contrairement à
  l'embed de résultat (F6) qui est le message "officiel" de la soirée.
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

Interface d'admin et seed : voir « Messages Discord personnalisables »
ci-dessus (`/admin/messages`, `npm run seed`) — communs aux 4 catégories,
pas dupliqués ici.

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

## Backfills coop en tâche de fond (Optimisation build)

**Incident remonté après le merge de PR 32 (2.5/4 + 2.6/4)** : le build de
prod a mis **14 minutes** au lieu des ~5 min estimées. Cause identifiée :
le backfill Steam Store API (PR 32.6, Bloc A), lancé à chaque build via
`npm run build`, s'est révélé beaucoup plus lent que prévu depuis l'IP de
build Vercel (Steam Store lente et/ou qui rate-limite cette IP — pas de
moyen de le confirmer précisément depuis ce sandbox, sans accès réseau).

Un backfill réseau ne devrait jamais faire partie du chemin critique d'un
déploiement : un build qui dépend de la disponibilité/latence d'une API
tierce est fragile par construction (et coûte du temps de build à chaque
déploiement, pour tous les futurs PR).

### Ce qui reste dans `npm run build`, ce qui en sort

Chaîne du script `build` (`package.json`) avant cette PR :

```
prisma migrate deploy → seed messages → fix templates invalides →
backfill XP → backfill IGDB coop → backfill Steam Store → seed game-stats →
seed superlatifs → seed badges → backfill badges → next build
```

- **Gardés dans le build** (migrations obligatoires, ou seeds/backfills
  rapides car purement en base, sans appel réseau externe bloquant) :
  `prisma migrate deploy`, seed messages, fix templates invalides,
  backfill XP, seed game-stats, seed superlatifs, seed badges, backfill
  badges, `next build`.
- **Sortis du build** : backfill IGDB coop et backfill Steam Store — les
  deux seuls à dépendre d'une API externe *par jeu* de la bibliothèque
  (potentiellement des dizaines d'appels réseau, chacun sujet à la
  latence/rate limit du service tiers). Remplacés par 2 endpoints HTTP
  déclenchés par cron externe (voir ci-dessous). Le build repasse ainsi à
  un temps dominé par `next build` lui-même (~1-2 min, sans plus dépendre
  d'IGDB/Steam Store).

### `POST /api/backfill/igdb-coop` et `POST /api/backfill/steam-store`

Même mécanisme de protection que `/api/cron/reminders` (F7, voir plus
haut) : si `CRON_SECRET` est configurée, la route exige l'en-tête
`Authorization: Bearer <CRON_SECRET>` (401 sinon) ; sans `CRON_SECRET`
configurée, la route reste appelable par n'importe qui connaissant l'URL
(acceptable pour un usage perso/petit groupe, recommandé de la configurer
dès que l'URL est publique).

**Réponse immédiate, traitement en tâche de fond** : la route répond
`202 Accepted` (`{ "status": "accepted", "message": "..." }`) dès que
l'authentification est validée, sans attendre la fin du backfill — via
[`after()`](https://nextjs.org/docs/app/api-reference/functions/after)
(Next.js) : le code de backfill continue de s'exécuter après l'envoi de
la réponse, donc l'appelant (cron externe ou `curl` manuel) n'attend
jamais 14 minutes. `export const maxDuration = 60` sur les deux routes —
le plafond du plan Vercel Hobby (même contrainte que le cron F7, voir
plus haut) ; les deux backfills s'arrêtent volontairement avant cette
échéance (`TIME_BUDGET_MS`, marge de sécurité) plutôt que de risquer une
coupure brutale par la plateforme en plein appel réseau/écriture.

**Idempotents** : même portée qu'avant (jeux avec `playInfoManual =
false` — jamais un jeu confirmé par un humain), qu'avant cette PR — voir
PR 32 (2.5/4) et PR 32.6 pour le détail des critères exacts par backfill.
Rejouer un backfill sur un jeu déjà à jour est un no-op (juste une
vérification, pas d'écriture).

**Logs précis** (`src/lib/backfill-igdb-coop.ts` /
`src/lib/backfill-steam-coop.ts`), consultables dans les logs de fonction
Vercel :

```
[igdb-coop] Processing 12/48: Overcooked! 2...
[steam-store] Processing 8/48: Terraria...
```

**Limite honnête assumée — couverture par bibliothèque, pas par appel**
Sans marqueur de progression persisté en base (aucune nouvelle migration
pour ça, comme le reste du chantier coop), un seul appel ne garantit pas
de traiter TOUTE la bibliothèque si elle est plus grande que ce qui tient
dans la fenêtre de 60s (à ~1,5s/jeu pour Steam Store, ça plafonne autour
d'une trentaine de jeux par appel). Pour éviter de retraiter indéfiniment
les mêmes premiers jeux à chaque appel sans jamais atteindre les
suivants, l'ordre de traitement est **mélangé aléatoirement** à chaque
invocation (`src/lib/shuffle.ts`) : un jeu qui n'a pas été atteint cette
fois a de bonnes chances de l'être au prochain appel (cron quotidien, ou
relance manuelle). Pour une bibliothèque de groupe de la taille visée par
cette app (quelques dizaines de jeux), la convergence est rapide ;
documenté ici comme limite assumée plutôt que silencieusement caché.

### Configurer le cron externe (cron-job.org ou équivalent)

Même service que celui déjà utilisé pour les rappels F7 (voir plus haut) —
ajouter 2 nouveaux cron jobs :

1. URL : `https://ton-projet.vercel.app/api/backfill/igdb-coop`
2. URL : `https://ton-projet.vercel.app/api/backfill/steam-store`
3. Méthode `POST` pour les deux, en-tête `Authorization: Bearer <CRON_SECRET>`
   si configurée.
4. Fréquence recommandée : **une fois par jour** — largement suffisant, ces
   backfills corrigent des jeux ajoutés/importés depuis le dernier passage,
   pas une fonctionnalité temps-réel.

### Déclenchement manuel (une fois, après le déploiement de cette PR)

Pour catégoriser les jeux déjà en base sans attendre le premier passage du
cron quotidien :

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
  https://gamenight-zeyfro.vercel.app/api/backfill/igdb-coop

curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
  https://gamenight-zeyfro.vercel.app/api/backfill/steam-store
```

Chaque appel répond `202` en quelques millisecondes ; le vrai travail
continue côté serveur — suivre la progression dans les logs de la
fonction Vercel correspondante (Vercel Dashboard → Deployments → Functions,
ou `vercel logs`). Si la bibliothèque est assez grande pour dépasser la
fenêtre de 60s d'un seul appel (voir limite ci-dessus), relance
simplement la même commande `curl` une seconde fois — idempotent, sans
risque à répéter.

## Seeds & backfills en tâche de fond (build ne fait plus que compiler)

**Problème identifié à l'audit (item #06)** : `npm run build` enchaînait
`prisma migrate deploy` avec 11 scripts `prisma/*.mjs` (seeds de
référentiel + backfills de réconciliation) avant `next build`. Un simple
déploiement pouvait donc muter des données, et un bug dans n'importe
lequel de ces 11 scripts bloquait `next build` — donc le déploiement
entier — même si la migration s'était bien passée. Contrairement aux
backfills IGDB/Steam Store (section précédente), ces 11 scripts n'ont
jamais eu de problème de LENTEUR (aucun appel réseau, purement en base,
coût négligeable pour la taille de ce groupe) : le problème ici est la
DISPONIBILITÉ du déploiement, pas la vitesse du build.

`prisma migrate deploy` reste dans `npm run build` — c'est la pratique
recommandée pour un plan Vercel Hobby (pas d'étape de release séparée) :
la seule alternative réaliste (route dédiée aux migrations) demande de
lancer la CLI Prisma depuis une fonction serverless, jamais fait ailleurs
dans ce repo, et ouvre une fenêtre où le nouveau code tourne contre
l'ancien schéma tant que la migration n'a pas été déclenchée à la main —
un risque pire que celui qu'on cherche à corriger. Seuls les 11
seeds/backfills, eux, sortent du build.

### Ce qui a changé

`npm run build` :

```
prisma migrate deploy && next build
```

Les 11 anciens scripts (`prisma/seed.mjs`, `fix-invalid-templates.mjs`,
`backfill-xp.mjs`, `backfill-user-colors.mjs`, `seed-game-stats.mjs`,
`seed-superlatives.mjs`, `seed-badges.mjs`, `backfill-badges.mjs`,
`seed-tags.mjs`, `seed-group-achievements.mjs`, `seed-season.mjs`) sont
convertis en fonctions `src/lib/seed-*.ts`/`backfill-*.ts` (même logique,
aucune régression de comportement — voir le détail ci-dessous), et
regroupés dans `runSeedReconciliation()` (`src/lib/seed-reconciliation.ts`),
appelée par une route unique :

### `POST /api/backfill/seed-reconcile`

Même protection `CRON_SECRET` que le reste des routes `/api/cron/*` et
`/api/backfill/*`. Contrairement à `igdb-coop`/`steam-store` (traitement
en tâche de fond via `after()` + réponse `202` immédiate, nécessaire
parce qu'elles appellent des API externes lentes) : ici, traitement
**synchrone** — les 11 tâches sont 100% lecture/écriture base, largement
sous la seconde pour ce groupe, donc la réponse contient directement le
résultat réel par tâche :

```json
{
  "ok": true,
  "results": {
    "seedDefaultMessages": "ok",
    "fixInvalidMessageTemplates": "ok",
    "backfillXp": "ok",
    "backfillUserColors": "ok",
    "seedGameStats": "ok",
    "seedSuperlatives": "ok",
    "seedBadges": "ok",
    "backfillBadges": "ok",
    "seedTags": "ok",
    "seedGroupAchievements": "ok",
    "seedInitialSeason": "ok"
  }
}
```

**Best-effort strict** : chaque tâche dans son propre `try`/`catch` (voir
`src/lib/seed-reconciliation.ts`) — un échec de l'une (`"error"` dans
`results`, détail dans les logs Vercel) n'empêche JAMAIS les 10 autres de
s'exécuter, et cette route répond toujours `200` (jamais de 5xx qui
pourrait faire croire à un cron externe que "tout" a échoué). Contraste
volontaire avec le comportement précédent, où une exception importait
tout le build.

**Ordre figé, identique à l'ancien `npm run build`** : les 11 tâches
tournent dans la même fonction plutôt que dans des routes séparées, à
cause d'une dépendance réelle entre deux d'entre elles — `backfillBadges`
a besoin que `seedBadges` ait déjà créé les 15 `Badge` en base. Pas de
découpage "seeds de référentiel vs backfills" en plusieurs routes : ça
aurait recréé le risque d'un appel dans le mauvais ordre.

**Dédoublonnage au passage** : converties en `src/lib/*.ts`, ces
fonctions importent maintenant directement les constantes/fonctions
canoniques (`@/lib/xp`, `@/lib/user-color`, `@/lib/badge-rarity`,
`@/lib/message-templates`, `@/lib/group-achievements`, `@/lib/wallclock`)
au lieu de les dupliquer — impossible depuis un script Node/ESM autonome
(alias `@/...` non résolu), plus un problème une fois dans `src/lib/`.
Seule exception volontaire : `backfillBadges` garde sa propre logique de
calcul de stats et d'attribution silencieuse (`src/lib/backfill-badges.ts`)
plutôt que de réutiliser le chemin live (`unlockBadge`,
`src/lib/badges.ts`), qui déclenche systématiquement une notif Discord —
un comportement que ce backfill doit explicitement ne jamais avoir
(décision produit historique, PR 7/9 : pas de spam rétroactif de "badge
débloqué" pour des exploits vieux de plusieurs mois).

### Configurer le cron externe (cron-job.org ou équivalent)

Même compte que les autres crons de ce projet — ajouter un nouveau cron
job :

```
URL     : https://ton-projet.vercel.app/api/backfill/seed-reconcile
Méthode : POST
Header  : Authorization: Bearer <CRON_SECRET>
Fréquence : 1x par jour
```

Fréquence quotidienne délibérément choisie plutôt que le cron 15 min déjà
utilisé pour `close-sessions`/`reminders` : les 11 tâches sont déjà
idempotentes par construction (contrainte unique, `findFirst`/`count`
avant écriture, `upsert`) — pas besoin d'un marqueur "déjà fait"
supplémentaire — donc le seul coût d'un passage à vide est 9-11 petites
lectures, mais les payer 96 fois par jour (cron 15 min) au lieu d'une
seule aurait été du gaspillage pour un gain nul (aucune de ces tâches
n'a besoin d'une réconciliation à la minute près).

### Déclenchement manuel (re-seed à la demande)

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
  https://gamenight-zeyfro.vercel.app/api/backfill/seed-reconcile
```

Une seule commande pour tout re-seeder/backfiller — utile après un
déploiement qui ajoute un nouveau badge/tag/message par défaut, sans
attendre le prochain passage du cron quotidien. Idempotent, sans risque à
répéter.

### ⚠️ Procédure de bascule au merge de cette PR (à ne pas oublier)

Le danger n'est pas le régime permanent (tout idempotent, base déjà
seedée) mais l'INSTANT du merge : dès que cette PR est déployée, le build
ne lance plus les 11 seeds/backfills, mais le cron externe ci-dessus
n'existe pas encore tant qu'il n'a pas été créé à la main sur
cron-job.org. Fenêtre où plus rien ne réconcilie automatiquement — sans
conséquence pratique (base déjà seedée par les anciens passages du build,
rien ne manque à cet instant précis), mais à fermer explicitement plutôt
que de compter dessus par hasard :

1. **Merger la PR.**
2. **Vérifier que le déploiement Vercel passe au vert** (build =
   `prisma migrate deploy && next build`, plus aucune écriture de données
   métier dedans).
3. **Créer le cron sur cron-job.org** — voir « Configurer le cron
   externe » ci-dessus (URL `/api/backfill/seed-reconcile`, `POST`,
   header `Authorization: Bearer <CRON_SECRET>`, 1x/jour).
4. **Lancer le curl manuel une fois** (voir « Déclenchement manuel »
   ci-dessus) pour confirmer que la route répond
   `{ "ok": true, "results": {...} }` avec les 11 tâches à `"ok"`.
5. Seulement à ce stade, c'est fini — plus aucune manip requise pour les
   déploiements suivants.

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
   base sans les bonnes tables). Depuis la PR "build ne fait plus que
   compiler", `npm run build` ne fait QUE `prisma migrate deploy && next
   build` — aucune écriture de données métier (seeds/backfills) au build,
   voir le point 8 ci-dessous.
5. **Rappels (F7)** : pas de Vercel Cron — le plan Hobby n'autorise pas
   une fréquence de 15 min (minimum imposé : 1 exécution/jour, voir « Rappels
   drôles avant session » ci-dessus). Configure plutôt un cron externe
   (ex. [cron-job.org](https://cron-job.org)) pointant vers
   `https://ton-projet.vercel.app/api/cron/reminders` toutes les 15 min,
   avec l'en-tête `Authorization: Bearer <CRON_SECRET>` si tu as défini
   `CRON_SECRET` dans les variables d'environnement du projet (recommandé,
   l'URL étant publique). Les 9 messages de rappel initiaux (et tout le
   reste des seeds) sont peuplés via le point 8 ci-dessous
   (`/api/backfill/seed-reconcile`), pas par un `npm run seed` local (qui
   n'existe plus).
6. **Backfills coop (IGDB + Steam Store)** : ne tournent plus pendant le
   build (voir « Backfills coop en tâche de fond » ci-dessous) — configure
   un cron externe (même service que les rappels ci-dessus, ou un second
   cron job sur le même compte cron-job.org) pointant vers
   `https://ton-projet.vercel.app/api/backfill/igdb-coop` et
   `https://ton-projet.vercel.app/api/backfill/steam-store`, en `POST`,
   une fois par jour, avec l'en-tête `Authorization: Bearer <CRON_SECRET>`.
   Après le tout premier déploiement de cette PR, déclenche les deux une
   fois manuellement (`curl`, détail plus bas) pour catégoriser les jeux
   déjà en base.
7. **Clôture automatique des sessions** (fix PR 3.5/4) : configure un
   3ᵉ cron job (même compte cron-job.org) pointant vers
   `https://ton-projet.vercel.app/api/cron/close-sessions`, en `GET`,
   toutes les 15 min, avec l'en-tête `Authorization: Bearer <CRON_SECRET>`
   si configurée — voir « PR 3.5/4 » plus bas pour le détail. Sans ce
   cron, la clôture reste fonctionnelle mais redevient "paresseuse"
   (déclenchée seulement au chargement d'une page), exactement le bug
   remonté en prod.
8. **Seeds & backfills** (PR "build ne fait plus que compiler") : ne
   tournent plus pendant le build — configure un cron externe (même
   compte cron-job.org) pointant vers
   `https://ton-projet.vercel.app/api/backfill/seed-reconcile`, en
   `POST`, une fois par jour, avec l'en-tête
   `Authorization: Bearer <CRON_SECRET>`. Voir « Seeds & backfills en
   tâche de fond » ci-dessous pour le détail et la procédure de bascule
   au merge (checklist à suivre une fois, à ne pas oublier).

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
| `npm run seed` | Seed des messages Discord par défaut (rappels + création/modification de soirée + level up, idempotent par catégorie) |
| `npm run fix-invalid-templates` | Désactive (silencieusement) les `MessageTemplate` en base avec une variable invalide pour l'une de leurs catégories — idempotent, aussi lancé automatiquement à chaque build (Fix 4, PR 30, bug "texte à trous") |
| `npm run backfill-xp` | Backfill XP manuel (sessions créées, votes, participations, dispos/Steam) — idempotent, aussi lancé automatiquement à chaque build |
| `npm run backfill-coop` | Resynchronise `isCoop`/`maxPlayers` depuis IGDB pour les jeux avec cache existant, jamais confirmés manuellement — idempotent, lancement **local uniquement** depuis PR "Optimisation build" (plus wired dans `npm run build`, voir § dédiée — en prod, cron externe vers `/api/backfill/igdb-coop`) |
| `npm run backfill-steam-coop` | Resynchronise `isCoop` depuis Steam Store API pour les jeux `source=STEAM` jamais confirmés manuellement — idempotent, lancement **local uniquement** depuis PR "Optimisation build" (en prod, cron externe vers `/api/backfill/steam-store`) |
| `npm run seed-game-stats` | Seed manuel des stats/superlatifs pour les jeux populaires de la biblio commune — idempotent, aussi lancé automatiquement à chaque build (chantier dormant depuis PR 5/9, laissé fonctionnel) |
| `npm run seed-superlatives` | Seed manuel des 6 superlatifs génériques par défaut (vote entre potes) — idempotent par nom, aussi lancé automatiquement à chaque build |
| `npm run seed-badges` | Seed manuel des 15 badges par défaut — idempotent par nom, aussi lancé automatiquement à chaque build |
| `npm run backfill-badges` | Backfill badges manuel (attribution rétroactive) — idempotent, jamais de notif Discord (voir § Badges automatiques), aussi lancé automatiquement à chaque build |
| `npm run backfill-user-colors` | Backfill manuel de `User.color` pour les comptes jamais personnalisés (`colorCustomized=false`), assignation déterministe par ordre de création sur la palette 10 couleurs — idempotent, aussi lancé automatiquement à chaque build (PR 4/4, sous-PR 1) |
| `npx prisma studio` | Explorateur visuel de la base de données |
| `npx prisma migrate dev` | Applique les migrations en local (et en crée une nouvelle si le schéma a changé) |
| `npx prisma migrate deploy` | Applique les migrations existantes sans les modifier (Neon/CI/Vercel) |

## Structure du projet

```
prisma/schema.prisma        # Schéma de données complet (§5)
src/auth.ts                 # Config Auth.js (provider Discord, callbacks)
src/lib/prisma.ts           # Client Prisma (adapter Neon serverless)
src/lib/steam.ts            # OpenID 2.0 Steam + import GetOwnedGames
src/lib/igdb.ts             # Client IGDB (token Twitch caché, recherche + fiche détaillée + multiplayer_modes)
src/lib/game-details.ts     # Cache-ou-fetch de la fiche IGDB (Game.igdbDetails) + sync isCoop/maxPlayers (PR 32)
src/lib/steam-store.ts      # Client Steam Store API (categories → isCoop, SteamStoreHttpError), duplique sa logique dans prisma/backfill-steam-coop.mjs (PR 32.6, Bloc A)
src/lib/shuffle.ts          # Mélange Fisher-Yates, utilisé par les 2 libs de backfill coop pour couvrir toute la liste sur plusieurs appels (PR "Optimisation build")
src/lib/backfill-igdb-coop.ts   # Boucle de backfill IGDB réutilisable (réutilise fetchIgdbGameDetails), appelée par /api/backfill/igdb-coop — plus wired dans npm run build
src/lib/backfill-steam-coop.ts  # Boucle de backfill Steam Store réutilisable (réutilise fetchSteamStoreDetails), appelée par /api/backfill/steam-store — plus wired dans npm run build
src/lib/family-import.ts    # Parsing du texte collé + matching IGDB fuzzy (stringSimilarity, seuil 85%) — PR "Import biblio Steam Family"
src/app/profil/family-import-actions.ts # matchFamilyImportBatch — upsert Game/UserGame(source=FAMILY), dédoublonnage
src/lib/current-user.ts     # Session Auth.js → ligne User en base
src/lib/wallclock.ts        # Parsing/format date+heure (convention horloge-murale)
src/lib/availability.ts     # Calcul dispo (créneaux hebdo + exceptions)
src/lib/sessions.ts         # Clôture de session, deadline, calcul "jouable", annonce Discord
src/lib/session-status.ts   # Libellés/couleurs des statuts de session
src/lib/discord.ts          # postToDiscord (webhook, dégrade proprement si non configuré)
src/lib/discord-announce.ts # Construit l'embed de résultat de session (F6)
src/lib/discord-reminder.ts # Construit + envoie l'embed de rappel (F7, timings configurables — PR 31)
src/lib/reminder-timings.ts # Préréglages, parsing FormData, libellés FR (PR 31, Bloc A)
src/lib/game-filters.ts     # Parsing/matching des 6 filtres biblio + traduction genres (PR 31, Bloc B)
src/lib/game-library.ts     # getGameOwnerCounts, getTotalUserCount, toFilterableGame (PR 31, Bloc B)
src/lib/discord-session-created.ts # Notif Discord à la création d'une soirée
src/lib/discord-session-modified.ts # Notif Discord à la modification d'une soirée
src/lib/session-schedule.ts # resolveSessionSchedule : validation date/deadline mutualisée création+édition
src/lib/message-templates.ts # pickMessageTemplate + catégories/variables + findInvalidCategoryVariables (Fix 4, PR 30)
src/lib/deepl.ts            # translateToFrench (API DeepL Free, dégrade sans DEEPL_API_KEY)
src/lib/xp.ts                # Formules pures XP : XP_AMOUNTS, courbe de niveau, titres, rangs, streak
src/lib/xp-actions.ts        # awardXp (idempotent) + touchStreak (I/O Prisma + notif level up)
src/lib/discord-level-up.ts  # Notif Discord de passage de niveau
prisma/seed.mjs             # Seed des messages Discord par défaut (npm run seed)
prisma/fix-invalid-templates.mjs # Désactive les MessageTemplate invalides en base, idempotent (Fix 4, PR 30)
prisma/backfill-xp.mjs      # Backfill XP idempotent, wired dans npm run build (npm run backfill-xp en manuel)
prisma/backfill-coop.mjs    # Resynchronise isCoop/maxPlayers depuis IGDB, wired dans npm run build (PR 32, Bug 2A)
prisma/backfill-steam-coop.mjs # Resynchronise isCoop depuis Steam Store API, tourne après backfill-coop.mjs (PR 32.6, Bloc A)
prisma/seed-game-stats.mjs  # Seed stats/superlatifs des jeux populaires, idempotent, piloté par les vraies données (dormant depuis PR 5/9)
prisma/seed-superlatives.mjs # Seed des 6 superlatifs génériques par défaut, idempotent par nom
src/lib/superlative-voting.ts       # Participants, ouverture/clôture de la fenêtre de vote, calcul des gagnants
src/lib/discord-session-awards.ts   # Notif Discord des awards votés (catégorie SESSION_AWARDS)
src/lib/tierlist.ts                 # TIER_ORDER + intensité de couleur partagées (édition + lecture seule)
src/lib/badges.ts                   # BadgeCriteria + check*Badges (déclencheurs live) + unlockBadge
src/lib/badge-rarity.ts             # BADGE_XP_BY_RARITY, RARITY_LABELS, CATEGORY_LABELS (neutre, casse le cycle badges.ts ↔ discord-badge-unlocked.ts)
src/lib/discord-badge-unlocked.ts   # Notif Discord de badge débloqué (catégorie BADGE_UNLOCKED)
prisma/seed-badges.mjs              # Seed des 15 badges par défaut, idempotent par nom
prisma/backfill-badges.mjs          # Backfill badges idempotent, jamais de notif Discord
src/lib/profile-stats.ts            # getProfileStats (5 cartes) + getGlobalRank (#N sur X)
src/lib/scoreboard.ts               # getScoreboard (PR 9/9) — classement Global/Mois/Semaine
src/components/ui/          # Button, ButtonLink, Card, Badge, Skeleton
src/components/motion.tsx   # Stagger, StaggerItem, PopIn (framer-motion)
src/components/PageTransition.tsx       # Fondu entre routes (AnimatePresence)
src/components/ActionForm.tsx           # Wrapper server action + toast (non redirigeant)
src/components/VoteButton.tsx           # Bouton de vote (bounce + compteur animé)
src/components/VoterAvatars.tsx         # Pile d'avatars des voteurs d'une proposition + popup liste complète (Fix 1, PR 30)
src/components/VotingCountdown.tsx      # Compte à rebours deadline de vote (client)
src/components/EditGameDialog.tsx       # Panneau modal d'édition d'un jeu (Radix Dialog)
src/components/DeleteSessionDialog.tsx  # Confirmation de suppression d'une session (créateur only)
src/components/EditSessionDialog.tsx    # Modal d'édition date/heure/deadline d'une session (créateur only)
src/components/WithdrawProposalDialog.tsx # Confirmation de retrait de sa propre proposition
src/components/ProposeGameForm.tsx      # Combobox recherche pour "Proposer un jeu" (remplace le <select>)
src/components/MessageTemplateForm.tsx  # Form message Discord : validation variables inconnues + autocomplétion "{"
src/components/AuditLine.tsx            # "Modifié par {avatar} {pseudo} le {date}" (messages, stats, superlatifs)
src/components/SuperlativeVoteForm.tsx  # Formulaire de vote de superlatifs (avatar-tap par catégorie)
src/components/SuperlativeCategoryForm.tsx # Form d'ajout/édition d'un superlatif (/admin/superlatifs)
src/components/TierlistBoard.tsx        # Tierlist éditable (@dnd-kit, glisser-déposer S/A/B/C/D, filtre par nom)
src/components/ReadOnlyTierlist.tsx     # Tierlist lecture seule (biblio pote)
src/components/BadgeGrid.tsx            # Grille de badges (déblocables/débloqués), rareté visuelle
src/components/PoteTabs.tsx             # Onglets Dispos/Bibliothèque/Tierlist/Badges/Superlatifs de /potes/[id]
src/components/ProfilTabs.tsx           # Onglets Aperçu/Historique/Superlatifs/Badges/Tierlist/Réglages de /profil
src/components/RankAvatar.tsx           # Avatar à anneau coloré par rang + pastille de niveau (partagé profil/pote)
src/components/StreakFlame.tsx          # Flamme animée (carte stat streak)
src/components/BannerForm.tsx           # Formulaire bannière de profil (toggle URL / upload Vercel Blob, preview live)
src/components/CopyProfileLinkButton.tsx # Copie /potes/{userId} + "Message Discord" pré-formaté dans le presse-papier
src/components/SuperlativesWonGrid.tsx  # Grille des superlatifs gagnés (partagée profil/pote)
src/components/admin/AdminTabs.tsx      # Onglets du hub /admin, pilotés par ?tab=
src/components/admin/MessagesTab.tsx    # Onglet Messages (contenu déplacé depuis l'ancien /admin/messages)
src/components/admin/MessagesList.tsx   # Liste + sous-filtres par catégorie (client)
src/components/admin/SuperlativesTab.tsx # Onglet Superlatifs (contenu déplacé)
src/components/admin/JeuxStatsTab.tsx   # Onglet Jeux-stats (contenu déplacé)
src/components/admin/BadgesTab.tsx      # Onglet Badges (nouveau CRUD)
src/components/admin/BadgeForm.tsx      # Form structuré (select critère + seuil, pas de JSON libre)
src/components/ReadOnlyGameGrid.tsx     # Grille de jeux lecture seule (biblio pote / groupe)
src/components/AvailabilityView.tsx     # Dispos hebdo + exceptions lecture seule (biblio pote)
src/components/GameDescription.tsx      # Description FR/VO avec toggle (fiche jeu)
src/components/LibraryTabs.tsx          # Onglets "Ma bibliothèque" / "Groupe" / "Tierlist" / "À vérifier" (badge compteur, PR 32.6, Bloc B)
src/components/GameFilterDrawer.tsx     # Panneau des filtres biblio, sync URL (PR 31, Bloc B) — sliders année remplacés par des <select> (PR 32, Bug 1), filtre "Provenance" (personal only, PR "Import biblio Steam Family")
src/components/CoopEnrichmentTrigger.tsx # Déclenche l'enrichissement IGDB à la demande quand le filtre Coop est actif (PR 32, Bug 2B)
src/components/ToVerifierList.tsx       # Liste "À vérifier" : toggle rapide Coop/Multijoueur/Solo + Ignorer, sortie animée (PR 32.6, Bloc B)
src/components/MarkAllCoopButton.tsx    # Bonus /bibliotheque : confirme en coop tous les jeux affichés quand seul le filtre Coop est actif (PR 32.6, Bloc B)
src/components/FamilyImportForm.tsx     # Textarea copier-coller + progress bar + sections Importés/Non trouvés/Doublons — PR "Import biblio Steam Family"
src/app/bibliotheque/actions.ts         # enrichGamesForCoopFilter (Bug 2B) + setToVerifierGamePlayInfo/ignoreToVerifierGame/batchMarkGamesCoop (PR 32.6, Bloc B)
src/app/bibliotheque/a-verifier/page.tsx # Onglet "À vérifier" : jeux isCoop=false && playInfoManual=false (PR 32.6, Bloc B)
src/components/ReminderTimingsField.tsx # Champ "Rappels" (préréglages + custom) du formulaire de création (PR 31, Bloc A)
src/components/ui/Avatar.tsx            # Avatar circulaire (fallback initiale si pas d'avatar Discord)
src/components/Header.tsx / BottomNav.tsx / Logo.tsx  # Identité + nav
src/app/actions.ts          # Server actions bibliothèque (ajout/retrait/édition, réimport Steam)
src/app/page.tsx            # Page d'accueil (login / profil)
src/app/profil/layout.tsx   # En-tête profil rich (bannière, RankAvatar, stats, ProfilTabs) — PR 8/9
src/app/profil/page.tsx     # Onglet Aperçu (route par défaut)
src/app/profil/historique/page.tsx  # Onglet Historique soirées
src/app/profil/superlatifs/page.tsx # Onglet Superlatifs gagnés
src/app/profil/badges/page.tsx      # Onglet Badges
src/app/profil/parametres/page.tsx  # Onglet Rappels perso (bannière, Steam, silence, liens admin)
src/app/profil/actions.ts   # Server actions toggle silence rappels + setBannerUrlAction + uploadBannerAction (Vercel Blob)
src/app/profil/tierlist/page.tsx    # Onglet Tierlist inline (fix UX PR 9/9, réutilise TierlistBoard)
src/app/admin/page.tsx                      # Hub /admin (Messages/Superlatifs/Badges/Jeux-stats), piloté par ?tab=
src/app/admin/messages/page.tsx             # Redirige (308) vers /admin?tab=messages
src/app/admin/messages/actions.ts           # Server actions messages Discord (inchangé, importé par le hub)
src/app/admin/superlatifs/page.tsx          # Redirige (308) vers /admin?tab=superlatifs
src/app/admin/superlatifs/actions.ts        # Server actions superlatifs (inchangé, importé par le hub)
src/app/admin/badges/actions.ts             # Server actions badges (nouveau CRUD)
src/app/admin/jeux-stats/page.tsx           # Redirige (308) vers /admin?tab=jeux-stats
src/app/admin/jeux-stats/[gameId]/page.tsx  # CRUD stats + superlatifs pour un jeu — reste une route indépendante
src/app/admin/jeux-stats/actions.ts         # Server actions stats/superlatifs (dormant depuis PR 5/9)
src/app/api/cron/reminders/route.ts # Envoie les rappels dus, appelée par un cron externe (F7)
src/app/api/cron/close-sessions/route.ts # Clôture les sessions dues immédiatement, cron externe (fix PR 3.5/4)
src/app/api/backfill/igdb-coop/route.ts    # POST, 202 + after(), backfill IGDB en tâche de fond (PR "Optimisation build")
src/app/api/backfill/steam-store/route.ts  # POST, 202 + after(), backfill Steam Store en tâche de fond (PR "Optimisation build")
src/app/potes/page.tsx                  # Liste des potes du groupe
src/app/potes/[id]/layout.tsx           # En-tête (RankAvatar/nom/rang/Steam) + PoteTabs, partagés par les 5 sous-routes
src/app/potes/[id]/page.tsx             # Onglet Dispos (route par défaut)
src/app/potes/[id]/bibliotheque/page.tsx # Onglet Bibliothèque (lecture seule)
src/app/potes/[id]/tierlist/page.tsx    # Onglet Tierlist (lecture seule)
src/app/potes/[id]/badges/page.tsx      # Onglet Badges (lecture seule)
src/app/potes/[id]/superlatifs/page.tsx # Onglet Superlatifs gagnés (lecture seule) — PR 8/9
src/app/bibliotheque/page.tsx           # Liste des jeux possédés (perso)
src/app/bibliotheque/groupe/page.tsx    # Tous les jeux possédés par le groupe
src/app/bibliotheque/ajouter/page.tsx   # Ajout manuel + recherche IGDB
src/app/tierlist/page.tsx               # Tierlist perso éditable (glisser-déposer)
src/app/tierlist/actions.ts             # Server action setGameTierAction
src/app/jeux/[id]/page.tsx              # Fiche jeu détaillée (IGDB à la demande, cache) — "Qui possède ce jeu" scindé perso/famille (PR "Import biblio Steam Family")
src/app/jeux/actions.ts                 # Server action "Rafraîchir les infos"
src/app/disponibilites/page.tsx         # Planning hebdo + exceptions
src/app/disponibilites/actions.ts       # Server actions dispos
src/app/sessions/page.tsx               # Liste des soirées + création
src/app/sessions/[id]/page.tsx          # Détail : proposer, voter, clôturer
src/app/sessions/[id]/resultats/page.tsx # Saisie/consultation du podium ou du bonus coop (Axe 2)
src/app/sessions/[id]/vote-superlatifs/page.tsx # Vote de superlatifs entre potes (PR 5/9)
src/app/sessions/actions/session-lifecycle.ts # Server actions : cycle de vie session (create/edit/close/cancel/delete/markDone/resendDiscord)
src/app/sessions/actions/proposals-votes.ts   # Server actions : proposer un jeu, voter, retirer une proposition
src/app/sessions/actions/results.ts           # Server actions : saisie résultats, défi hebdo complété
src/app/sessions/actions/superlatives.ts      # Server actions : vote de superlatifs
src/app/sessions/actions/predictions.ts       # Server actions : pronostics, paris XP
src/components/SessionResultsForm.tsx   # Formulaire podium/coop de la page résultats
src/app/api/auth/[...nextauth]/route.ts # Route handler Auth.js
src/app/api/steam/link/route.ts         # Redirige vers Steam (OpenID)
src/app/api/steam/callback/route.ts     # Vérifie le retour Steam, importe
src/app/api/igdb/search/route.ts        # Recherche IGDB (utilisée par le form)
src/app/classement/page.tsx             # Podium + tableau complet, filtres Global/Mois/Semaine (PR 9/9)
src/lib/user-color.ts                   # USER_COLOR_PALETTE (10 couleurs), validation hex, conversions RGB, dégradé bannière fallback recoloré (PR 4/4, sous-PR 1)
prisma/backfill-user-colors.mjs         # Backfill User.color idempotent, assignation déterministe par ordre de création, wired dans npm run build (PR 4/4, sous-PR 1)
src/components/ColorPickerField.tsx     # Palette rapide (10 couleurs) + color picker avancé (hex + sliders RGB + preview live) (PR 4/4, sous-PR 1)
src/components/ColorDot.tsx             # Petite pastille de couleur perso, réutilisée partout où le ring RankAvatar ne convient pas (PR 4/4, sous-PR 1)
src/lib/calendar.ts                     # getCalendarData : grille horaire de dispo (réutilise isAvailableAt), sessions et meilleur créneau sur une plage de dates (PR 4/4, sous-PR 1)
src/lib/calendar-dates.ts               # Helpers de date + navigation purs (addDays, getMonthGridRange, buildCalendarHref) — séparés de calendar.ts pour rester importables depuis les composants client (PR refonte /calendrier)
src/components/calendar/MiniMonthCalendar.tsx # Mini-mois compact repliable (pattern Outlook mobile), pastille collectif ≥50% (PR refonte /calendrier) — remplace l'ancien MonthGrid.tsx
src/components/calendar/DayTimeline.tsx # Timeline verticale 24h de la journée sélectionnée, auto-scroll ~18h, swipe jour (PR refonte /calendrier) — remplace l'ancien WeekGrid.tsx
src/components/calendar/SessionBlock.tsx # Bloc session tappable (calendrier) → panneau résumé lecture seule (Radix Dialog) (PR 4/4, sous-PR 1)
src/components/calendar/PoteFilterDrawer.tsx # Panneau "potes affichés" en vue Collective (PR 4/4, sous-PR 1)
src/app/calendrier/page.tsx             # Vue calendrier (mini-mois + timeline jour, Collectif/Individuel) — PR 4/4, sous-PR 1 (refondu en PR "refonte /calendrier")
```

## 5 corrections UX post-prod PR 8/9 (avant le classement)

Petite PR de fixes après le test en prod de la refonte profil rich (PR
8/9), avant d'attaquer le scoreboard final (PR 9/9, section suivante).
Aucune migration requise — que du code applicatif.

**FIX1 — Onglet Tierlist de `/profil` restait sur `/tierlist`.** Cliquer
dessus sortait du profil (page top-level sous `LibraryTabs`) au lieu de
rester dans `/profil?tab=tierlist`. Nouvelle route
`src/app/profil/tierlist/page.tsx`, qui réutilise tel quel
`TierlistBoard` (même composant, même `setGameTierAction`) — pas de
logique dupliquée, juste un deuxième `revalidatePath("/profil/tierlist")`
ajouté dans `src/app/tierlist/actions.ts`. `/tierlist` reste fonctionnelle
en parallèle (accessible depuis `LibraryTabs`), non-régression.

**FIX2 — "Superlatif" → "Récompense" partout côté utilisateur.** Le mot
était jugé trop technique. Renommés : onglets (`ProfilTabs`, `PoteTabs`,
`AdminTabs`), titres de page, boutons, messages vides, la catégorie
Discord `SESSION_AWARDS` ("Awards de superlatifs" → "Awards de
récompenses" dans `CATEGORY_LABELS`), les libellés de badges liés
(`CATEGORY_LABELS.SUPERLATIFS`, `CRITERIA_TYPE_LABELS.SUPERLATIVES_WON`
dans `src/lib/badge-rarity.ts`). **Volontairement inchangé** (demande
explicite : "change UNIQUEMENT les labels utilisateur") : les modèles
Prisma (`Superlative`, `SuperlativeCategory`, `SuperlativeVote`,
`SuperlativeAward`), les routes (`/admin/superlatifs`,
`/sessions/[id]/vote-superlatifs`, `/potes/[id]/superlatifs`,
`/profil/superlatifs`), les clés `?tab=superlatifs`, et les commentaires
de code décrivant l'historique des PR — pur sucre visuel, aucune
migration. Le contenu réel des messages Discord seedés
(`SESSION_AWARDS_MESSAGES` dans `prisma/seed.mjs`, l'embed de
`discord-session-awards.ts`) n'employait déjà pas le mot "superlatif"
("awards"/"vainqueurs"/"palmarès") — rien à changer là.

**FIX3 — Tooltip sur l'anneau coloré de `RankAvatar`.** L'anneau (couleur
= rang) n'expliquait pas ce qu'il représentait. `RankAvatar.tsx` (déjà
`"use client"`) affiche maintenant "Rang : {nom} — accédé au niveau
{minLevel}" au hover (desktop, `group-hover`) ou au tap (mobile, un
`useState` local togglé au clic puisqu'il n'y a pas de vrai `:hover`
tactile). Pas de nouvelle dépendance (pas de Radix Tooltip) pour un seul
usage — le `title` HTML natif était insuffisant (peu fiable au tap-hold
selon les navigateurs mobiles, pas stylable).

**FIX4 — Upload de bannière (Vercel Blob).** Voir la section dédiée
juste en dessous.

**FIX5 — Contexte de connexion + partage rapide.** `/potes/[id]/layout.tsx`
redirige désormais un visiteur non connecté vers `/?redirect=/potes/{id}`
(au lieu de `/` nu). `src/app/page.tsx` valide ce paramètre avec un
regex strict (`^\/potes\/([a-zA-Z0-9]+)$`, jamais une URL absolue — pas
d'open redirect possible) puis vérifie que l'id correspond à un vrai
`User` avant d'afficher "Tu vas voir le profil de {pseudo} après
connexion." et de passer `redirectTo` à `signIn("discord", ...)` pour
atterrir directement sur le bon profil après l'OAuth Discord — plutôt que
sur l'accueil générique. Un id invalide ou introuvable retombe
silencieusement sur le comportement précédent (pas de message, pas de
`redirectTo`). Bonus demandé : `CopyProfileLinkButton.tsx` a un second
bouton **"📋 Message Discord"** qui copie "Yo, regardez mon profil
GameNight : {lien}" dans le presse-papier, prêt à coller — même lien
`/potes/{userId}` que "Copier le lien", juste pré-formaté. Le conteneur
des boutons du header profil (`src/app/profil/layout.tsx`) passe en
`flex-wrap` pour ne pas déborder de la bannière sur mobile avec 3
boutons désormais présents.

### Upload de bannière (Vercel Blob)

FIX4 ajoute un deuxième moyen de définir sa bannière de profil : uploader
un fichier directement, en plus du champ URL existant (PR 8/9).

**Pourquoi Vercel Blob.** Simple stockage objet géré par Vercel,
directement intégré au déploiement (pas de compte tiers séparé à créer
comme S3/Cloudinary), lit son token depuis l'environnement automatiquement
(`put()` n'a besoin d'aucune configuration manuelle de client). Le plan
Hobby inclut **5 Go de stockage gratuit** — source :
[vercel.com/docs/storage/vercel-blob/usage-and-pricing](https://vercel.com/docs/storage/vercel-blob/usage-and-pricing)
— largement suffisant pour des bannières de profil (quelques centaines de
Ko à quelques Mo chacune, un utilisateur par membre du groupe).

**Obtenir `BLOB_READ_WRITE_TOKEN` (pas à pas) :**
1. Sur le [dashboard Vercel](https://vercel.com/dashboard), ouvrir le
   projet GameNight.
2. Onglet **Storage** → **Create Database** → choisir **Blob**.
3. Nommer le store (ex. `gamenight-blob`) → **Create**.
4. Une fois créé, onglet **Quickstart** ou **.env.local** du store :
   copier la valeur de `BLOB_READ_WRITE_TOKEN`.
5. Coller cette valeur dans les variables d'environnement du projet
   Vercel (**Settings → Environment Variables**, pour Production/Preview/
   Development selon besoin) et/ou dans `.env.local` en dev — voir
   `.env.example`.
6. Si le store est bien lié au projet via "Connect Project" au moment de
   sa création, Vercel injecte la variable automatiquement dans les
   déploiements — l'étape 5 n'est alors nécessaire qu'en local.

**Dégradation propre sans le token.** `uploadBannerAction`
(`src/app/profil/actions.ts`) vérifie `process.env.BLOB_READ_WRITE_TOKEN`
en tout premier et redirige vers `?upload=desactive` si absent, plutôt que
de laisser `put()` lever une exception non gérée. Côté UI,
`ProfilParametresPage` calcule `uploadEnabled` côté serveur (même
vérification) et le passe à `BannerForm` : l'onglet "Uploader une image"
affiche alors directement "Fonctionnalité désactivée, contacte l'admin."
au lieu du champ fichier — jamais de crash, jamais d'erreur opaque.
L'onglet **URL** reste utilisable dans tous les cas, avec ou sans Blob
configuré.

**Limites et validation.** 5 Mo max, formats jpg/png/webp/gif — vérifiés
côté client (`BannerForm.tsx`, feedback immédiat + désactivation du
bouton submit) *et* côté serveur (`uploadBannerAction`, jamais de
confiance aveugle dans le client). Pas de compression automatique
(bonus explicitement optionnel dans la demande, non implémenté en v1 —
un fichier de 5 Mo reste raisonnable pour une bannière). Preview
immédiate avant validation via `URL.createObjectURL` sur les deux
onglets.

## Classement (PR 9/9 — dernière étape du chantier XP)

`/classement` : podium des 3 premiers + tableau complet, filtrable
Global / Ce mois / Cette semaine. Aucune migration — `User.xpTotal` et
`XpEvent.createdAt` étaient déjà indexés pour cette page depuis les PR
précédentes du chantier (voir les commentaires historiques sur
`schema.prisma`).

**Données (`src/lib/scoreboard.ts`, `getScoreboard(period)`)** :
- **Global** : trie directement sur `User.xpTotal` (cache dénormalisé
  déjà maintenu par `awardXp`, pas besoin de resommer `XpEvent`).
- **Ce mois / Cette semaine** : `prisma.xpEvent.groupBy` sommant
  `amount` pour les événements dont `createdAt` tombe dans la fenêtre
  (lundi 00:00 pour la semaine, 1er du mois pour le mois — même
  convention horloge-murale UTC que le reste de l'app, voir
  `wallclock.ts`). Tous les users apparaissent sur les 3 filtres, y
  compris à 0 XP sur la période — un classement qui ferait disparaître
  les inactifs serait moins lisible qu'un classement complet où chacun
  retrouve sa place.
- **Niveau / rang / titre restent toujours calculés sur l'XP total à
  vie** (`levelForXp(user.xpTotal)`), quel que soit le filtre actif —
  décision assumée : un "niveau hebdomadaire" n'a pas de sens pour un
  jalon cumulatif, seuls la position et l'XP affiché changent selon la
  période. **"Soirées jouées" en revanche est filtré par la même
  période** que l'XP affiché (compte de `XpEvent` PARTICIPATE dans la
  fenêtre) plutôt que laissé en cumul à vie sur les 3 filtres : un
  classement "Cette semaine" est plus cohérent si son propre compteur de
  soirées reflète l'activité de cette semaine-là.

**Page (`src/app/classement/page.tsx`)** :
- Filtre `?periode=global|month|week`, en 3 liens (pas de state client :
  rendu serveur simple, rechargement des données à chaque changement de
  toute façon, même raisonnement que `AdminTabs`/`?tab=`).
- **Podium** : positions 2/1/3 dans cet ordre visuel (1er au centre, plus
  grand avatar, socle le plus haut), `RankAvatar` réutilisé tel quel
  (anneau coloré + tooltip de rang inclus gratuitement).
- **Tableau complet** en dessous : liste `Card` par `Stagger`/`StaggerItem`
  (même pattern que `/potes`), position + avatar + pseudo + niveau/titre/
  rang + XP de la période + soirées jouées. Le top 3 y réapparaît
  (pas retiré après le podium) : se retrouver dans le classement reste un
  simple scan de haut en bas, sans logique "en dehors du top 3" à
  comprendre. Ligne de l'utilisateur connecté marquée d'un badge "Toi".

**Navigation** : `/classement` ajouté en 6e item de `NAV_LINKS`
(`src/components/nav-links.tsx`), assez central (consulté régulièrement,
comme un classement de jeu) pour mériter la nav principale plutôt qu'un
lien secondaire — contrairement à `/tierlist`, plus ponctuel, réservé à
`LibraryTabs`. `BottomNav` passe de `grid-cols-5` à `grid-cols-6` en
conséquence (nouvelle icône `TrophyIcon`, même style outline que les
autres icônes de `icons.tsx`). Le texte "Rang global #N sur X" sur
`/profil` devient un lien cliquable vers `/classement`, pour ceux qui
veulent voir le classement complet en un tap depuis leur propre profil.

## PR 1/4 — Fixes ciblés UX + bugs notifs Discord (PR 30)

Suite au test en prod des 9 PR du chantier XP, 8 demandes remontées et
découpées en 4 PR successives (validé avec l'utilisateur) : PR 1/4
(celle-ci, fixes ciblés + bug notifs), PR 2/4 (timing des rappels
choisi par le créateur + filtres biblio style Steam), PR 3/4 (comptes
familiaux Steam), PR 4/4 (refonte planning/dispos en vue calendrier
collectif). Aucune migration Prisma dans cette PR — que du code
applicatif.

### Fix 1 — Voir qui a voté quoi

**Avant** : sous chaque proposition, seul le compteur ("3 votes")
était visible — impossible de savoir qui sans demander dans Discord.

```
Voter          3 votes
```

**Après** : une pile d'avatars empilés (façon Discord reactions,
28px) apparaît sous le bouton de vote dès qu'il y a au moins un
voteur.

```
Voter          3 votes
[👤][👤][👤]
```

Nouveau composant `src/components/VoterAvatars.tsx`, branché sur
`/sessions/[id]/page.tsx` (la requête Prisma des propositions inclut
maintenant `votes: { include: { user: true } }`, pas juste `votes:
true`). **Visible par tout le monde**, pas juste le créateur — décision
assumée, cohérente avec le reste de l'app où rien n'est caché entre
membres du groupe (dispos, biblio du groupe, tierlist, votes de
récompenses…), pas de raison de traiter ce vote-ci différemment.

Deux interactions distinctes plutôt qu'une seule : chaque avatar porte
un `title` natif (déjà géré par le composant `Avatar` partagé) qui
donne un vrai tooltip par pseudo au survol desktop, sans rien
construire de plus. Le tap (mobile **et** desktop) sur la pile ouvre
une popup (Radix Dialog, même pattern que `DeleteSessionDialog`)
listant tout le monde — un tooltip par avatar individuel n'a pas de
sens au tactile (pas de `:hover`, et les avatars empilés à 28px sont
trop petits pour un tap précis par personne), donc la pile entière est
le déclencheur d'une seule liste complète. Au-delà de 5 voteurs, un
badge "+N" résume le reste (toujours cliquable, la popup liste tout le
monde).

**Tester en prod** : voter sur une proposition avec 2-3 comptes
différents, ouvrir `/sessions/[id]`, vérifier que les avatars
apparaissent sous le bouton de vote, survoler un avatar sur desktop
(tooltip pseudo), taper la pile sur mobile (popup liste complète).

### Fix 2 — Créateur visible dans la notif Discord

`{createur}` résolvait déjà correctement vers `<@discordId>` (rien à
câbler côté substitution) — le problème était que ce ping n'apparaissait
que noyé dans le texte "hype" tiré au hasard dans `MessageTemplate`, pas
toujours présent selon le message pioché, et jamais mis en avant.

**Avant** (embed) :
```
📣 Nouvelle soirée
vendredi 8 août à 20:00
─────────────────────────
Deadline de vote   Lien
20:00 le 7 août    /sessions/xxx
```

**Après** — nouveau champ dédié, toujours affiché :
```
📣 Nouvelle soirée
vendredi 8 août à 20:00
─────────────────────────
Créée par    Deadline de vote    Lien
@Pseudo      20:00 le 7 août     /sessions/xxx
```

`src/lib/discord-session-created.ts` : ajout du champ `{ name: "Créée
par", value: vars.createur, inline: true }`. `<@discordId>` dans un
champ d'embed s'affiche comme une mention cliquable dans Discord **sans
déclencher de notification push** (contrairement au même ping en
`content` brut) — donc pas de double-ping du créateur, cohérent avec le
choix déjà en place ("le créateur n'est pas mentionné, il vient de
cliquer le bouton").

**Tester en prod** : créer une soirée, vérifier dans Discord que
l'embed affiche bien un champ "Créée par" avec le pseudo cliquable du
créateur.

### Fix 3 — Deadlines plus courtes

**Avant** : `6h / 12h / 24h / 48h avant la session` seulement — pas
adapté à une soirée spontanée décidée le jour même.

**Après** : `30 min / 1h / 2h / 6h / 12h / 24h / 48h avant la session`,
dans cet ordre. `src/app/sessions/page.tsx`, 3 nouvelles `<option>`
(`value="0.5"` pour 30 min). Aucun changement côté logique :
`resolveSessionSchedule` (`src/lib/session-schedule.ts`) traite déjà
`deadlineOffset` comme un nombre d'heures flottant
(`offsetHours * 60 * 60 * 1000`), `0.5` fonctionne tel quel.

**Tester en prod** : créer une soirée, ouvrir le select "Deadline de
vote", vérifier les 3 nouvelles options en tête de liste et que "30 min
avant" calcule bien une deadline 30 minutes avant l'heure de la
session.

### Fix 4 — Bug "texte à trous" dans les notifs Discord

Bug remonté avec un cas réel en prod : un `MessageTemplate` contenant
`{jeu}` était coché à la fois `REMINDER_24H`/`REMINDER_2H` (où `{jeu}`
existe) **et** `SESSION_CREATED` (où `{jeu}` n'existe pas). Envoyé à la
création d'une session, `{jeu}` n'avait aucune valeur et laissait un
trou visible dans le texte posté.

**Avant** (exemple, texte envoyé à la création) :
```
Alerte :  à 20h. Absent = tu paies ta biere ORGEN 🍕
```

**Après** :
```
Alerte : le jeu à 20h. Absent = tu paies ta biere ORGEN 🍕
```

Trois causes distinctes corrigées :

**A) Le message inapproprié doit être filtré.** Audit des seeds
(`prisma/seed.mjs`) : les groupes `SESSION_CREATED`/`SESSION_MODIFIED`
seedés par défaut n'ont jamais contenu `{jeu}` — le bug venait d'un
template créé/édité à la main sur `/admin?tab=messages`, pas du seed.
Le vrai correctif est en B/C ci-dessous, plus la vérification
"templates déjà en base" du point suivant.

**B) Substitution runtime plus robuste
(`src/lib/message-templates.ts`).** `substituteVariables` ne retire
plus silencieusement une variable non fournie — elle est remplacée par
un texte générique lisible (`GENERIC_VARIABLE_FALLBACKS` : "le jeu"
pour `{jeu}`, "l'heure" pour `{heure}`, "quelqu'un" pour
`{createur}`/`{user}`, etc., une entrée par variable connue de
`CATEGORY_VARIABLES`) **et** loggue un `console.warn` côté serveur à
chaque occurrence, pour rester repérable dans les logs Vercel même si
un message invalide passe malgré tout. Ce filet de sécurité runtime
reste une dernière défense — la vraie correction est en amont (C).

**C) Validation admin stricte + auto-désactivation au build.**
`findInvalidCategoryVariables(text, categories)` (nouvelle fonction
partagée, `message-templates.ts`) vérifie **chaque catégorie cochée
individuellement** — pas l'union comme avant
(`variablesForCategories`), qui est exactement le bug ci-dessus :
`{jeu}` existe bien dans l'union de `REMINDER_24H` + `SESSION_CREATED`,
donc l'ancienne validation "union" laissait passer une combinaison où
`SESSION_CREATED` seul ne supporte pourtant pas `{jeu}`.
  - **Formulaire** (`MessageTemplateForm.tsx`) : bandeau d'erreur exact
    demandé — *"Ce message ne peut pas être coché {catégorie} car il
    contient {variable} qui n'existe pas pour cette catégorie."* — et
    **blocage réel** de la sauvegarde (`<fieldset disabled>` autour du
    bouton d'enregistrement, plus un garde `onSubmit` en filet de
    sécurité). L'autocomplétion `{` ne suggère plus que l'intersection
    des variables des catégories cochées (pas l'union), pour éviter de
    suggérer soi-même une combinaison invalide.
  - **Server actions** (`admin/messages/actions.ts`) : même vérification
    rejouée côté serveur avant tout `create`/`update` — filet de
    sécurité si le formulaire était contourné, silencieux (pas de crash,
    juste un no-op).
  - **Templates déjà en base** : nouveau script
    `prisma/fix-invalid-templates.mjs`, wired dans `npm run build` juste
    après `seed.mjs` (même philosophie que `backfill-xp.mjs` : Node/ESM
    autonome, duplique `CATEGORY_VARIABLES` plutôt que d'importer un
    module TS aliasé). Parcourt tous les `MessageTemplate` actifs,
    désactive silencieusement (`active: false`, retiré du tirage
    aléatoire) ceux dont une variable est invalide pour l'une de leurs
    catégories, et logue chaque désactivation (`console.warn`) — visible
    dans les logs de build Vercel pour qu'un admin sache quoi corriger
    ou supprimer sur `/admin?tab=messages`. Idempotent, sûr à rejouer à
    chaque déploiement.

**Tester en prod** :
- Sur `/admin?tab=messages`, créer un message avec `{jeu}` et cocher à
  la fois "Rappel 24h avant" et "Création de soirée" → le bandeau
  d'erreur doit apparaître et le bouton "Ajouter" doit être désactivé
  tant que la catégorie invalide reste cochée ou que `{jeu}` reste dans
  le texte.
- Vérifier dans les logs Vercel du déploiement (`fix-invalid-templates`)
  qu'aucun message existant n'est signalé comme invalide (ou, si c'était
  le cas avant cette PR, qu'il apparaît bien désactivé sur
  `/admin?tab=messages` après déploiement).

### Fix 5 — Timing des notifs Discord

**Décision (confirmée avec l'utilisateur) : deux notifs distinctes,
sans rien construire de nouveau.**
- **À la création** : `announceSessionCreated`
  (`src/lib/discord-session-created.ts`) — "📣 Nouvelle soirée",
  annonce le vote ouvert, ne mentionne aucun jeu (aucune variable
  `{jeu}` dans les catégories `SESSION_CREATED`/`SESSION_MODIFIED`, cf.
  Fix 4A). Inchangée dans cette PR à part le champ "Créée par" (Fix 2).
- **À la clôture du vote** (transition `VOTING` → `SCHEDULED`,
  `closeSession` dans `src/lib/sessions.ts`) : `announceSessionResult`
  (`src/lib/discord-announce.ts`, F6) — "🎮 Soirée validée :
  {jeu}", déjà existante depuis les toutes premières PR de l'app.
  Aucun changement de code nécessaire : cette notif tombait déjà au bon
  moment.

Choix retenu plutôt que l'édition du message Discord de création
(techniquement possible via l'API webhook Discord) : réutiliser une
notif qui existe déjà depuis longtemps évite d'introduire un nouveau
couplage (stocker un `messageId`/`webhookToken` par session en base,
donc une migration) pour un gain marginal — deux messages distincts
dans le salon ("vote ouvert" puis "jeu décidé") racontent la même
histoire qu'un seul message édité, sans complexité supplémentaire ni
migration. Contrainte "pas de spam" respectée : un seul post par
événement réellement significatif (ouverture du vote, décision du jeu),
pas plus qu'avant cette PR.

**Tester en prod** : créer une soirée (notif "Nouvelle soirée" sans
jeu mentionné), voter, clôturer le vote (manuellement ou attendre la
deadline) → notif "Soirée validée : {jeu}" doit apparaître séparément
dans le même salon.

## PR 2/4 — Timing des rappels + filtres bibliothèque (PR 31)

### Bloc A — Timing des rappels configurable par le créateur

F7 envoyait systématiquement 2 rappels fixes (24h + 2h avant). Le
créateur choisit maintenant lesquels, à la création de la soirée.

**Schéma** : `Session.reminderTimings` (`Int[]`, minutes avant la
session, ex. `[1440, 120]` = 24h + 2h). **Défaut `[1440, 120]`** —
comportement F7 d'origine préservé pour toute nouvelle session sans
réglage explicite, et pour les sessions créées **avant** cette PR : la
colonne Postgres a une valeur par défaut appliquée directement par la
migration (`ALTER TABLE ... ADD COLUMN ... DEFAULT ARRAY[1440,120]`),
aucun script de backfill séparé n'était nécessaire.

**Formulaire de création** (`ReminderTimingsField.tsx`, sur `/sessions`) :
- 8 préréglages en cases à cocher : 24h / 12h / 6h / 2h / 1h / 45 min /
  30 min / 15 min avant. **24h et 2h cochés par défaut** (= comportement
  F7 d'origine).
- Bouton "+ Ajouter un rappel custom" → ligne nombre + unité
  (minutes/heures/jours), convertie en minutes à la sauvegarde.
- **Max 5 rappels par soirée** (préréglages + custom confondus) — anti-
  spam, appliqué côté UI (options désactivées au-delà) et revérifié
  côté serveur (`parseReminderTimingsFromFormData` tronque
  silencieusement au-delà de 5).
- **Décocher tous les rappels donne un tableau vide, jamais un repli
  sur le défaut** — c'est le point testé explicitement (voir plus bas) :
  le défaut 24h/2h n'est qu'un état initial de cases cochées, pas un
  filet de sécurité serveur qui réintroduirait des rappels non voulus.

**Cron** (`src/app/api/cron/reminders/route.ts`, `src/lib/discord-reminder.ts`) :
itère maintenant sur `session.reminderTimings` au lieu de deux fenêtres
fixes ; `Session.remindersSent` stocke les minutes déjà envoyées en
string (`["1440", "120"]`) plutôt que `["24h", "2h"]` — même mécanisme
anti-doublon, juste des tokens différents.

**Catégorie de message Discord** : le schéma `MessageTemplate` n'a que 2
catégories de rappel (`REMINDER_24H` "loin"/hype, `REMINDER_2H`
"proche"/urgent) — pas une par préréglage. Un timing configuré (préréglage
intermédiaire ou custom) est rattaché à l'une des deux via un seuil de 3h
(`isCloseReminder`, `src/lib/reminder-timings.ts`) : en dessous de 3h →
ton "proche", au-dessus → ton "loin". Décision assumée, documentée dans
le code — ajouter une catégorie de message par préréglage aurait
démultiplié le travail de saisie admin sur `/admin?tab=messages` pour un
gain marginal. Les libellés de catégorie sur `/admin?tab=messages` ont
été légèrement ajustés ("Rappel (loin — ≥3h avant)" / "Rappel (proche —
<3h avant)") pour ne plus laisser croire à une correspondance exacte à
24h/2h.

**Hors scope de cette PR** : les rappels ne sont configurables qu'à la
**création** de la soirée — pas d'ajout/retrait après coup depuis
`EditSessionDialog`. La demande portait explicitement sur la création ;
éditer les rappels d'une session déjà planifiée pourra être ajouté plus
tard si le besoin remonte.

**Test type demandé** : crée une soirée sur `/sessions`, décoche les 8
préréglages (aucun rappel coché), ne rajoute aucun custom, sauvegarde →
`Session.reminderTimings = []` en base. Fais passer la session en
`SCHEDULED` avec un jeu décidé, puis déclenche `GET
/api/cron/reminders` manuellement (voir § F7 "Comment tester sans
attendre 24h") : la réponse JSON doit lister cette session dans
`checked` mais **aucune entrée pour elle dans `sent`**, et aucun message
n'apparaît dans Discord pour cette soirée — le tableau vide est respecté
littéralement, pas de repli silencieux sur 24h/2h.

### Bloc B — Filtres bibliothèque style Steam

Panneau de 6 filtres (`GameFilterDrawer.tsx`), partagé entre
`/bibliotheque`, `/bibliotheque/groupe` et `/tierlist` :

1. **Modes de jeu** (multi) — Solo / Multijoueur / Coop / Local, calculés
   depuis les champs déjà en base (`isCoop`, `minPlayers`/`maxPlayers`),
   **pas** depuis IGDB `game_modes` : ce champ n'était pas encore
   fetché par `fetchIgdbGameDetails`, l'ajouter pour ce seul filtre
   aurait élargi le scope déjà large de cette PR. "Local" est une
   **heuristique assumée** (multijoueur avec `maxPlayers` ≤ 8, "format
   salon/canapé"), pas une vraie détection de mode — documenté comme
   tel dans `src/lib/game-filters.ts`.
2. **Nombre de joueurs** — 2 sliders (`<input type="range">` natifs, pas
   un composant dual-handle custom : plus simple, accessible clavier,
   tactile natif) min/max 1 à 100, sur `minPlayers`/`maxPlayers`. Un jeu
   sans ces infos est exclu dès que le filtre est resserré (pas de faux
   positif "peut-être compatible").
3. **Source** (multi) — Steam / Manuel / IGDB, directement sur
   `Game.source`.
4. **Possédé par N potes minimum** — slider sur un comptage
   `UserGame.owned` groupé par jeu, tout le groupe confondu (pas juste
   soi-même), via `getGameOwnerCounts()`. Pertinent même sur "Ma
   bibliothèque" : "montre mes jeux aussi possédés par au moins 2
   autres potes".
5. **Genre** (multi) — liste **dynamique**, dérivée des genres IGDB
   réellement présents dans la biblio consultée (`collectAvailableGenres`),
   pas une liste FR fixe déconnectée des données réelles. Traduits FR
   pour les genres IGDB les plus courants (table `GENRE_LABELS_FR`),
   repli sur le nom IGDB brut sinon. **Écart assumé par rapport à la
   liste FR donnée dans la demande** ("Action, Casual, MMO"…) : ces
   catégories ne sont pas des `genres` IGDB au sens strict (Action
   n'existe pas comme genre IGDB, MMO est un `game_mode`) — un filtre
   qui ne matcherait jamais rien serait pire qu'un filtre fidèle aux
   données réelles.
6. **Date de sortie** — 2 sliders année 1990-2026, sur
   `igdbDetails.releaseDate` (déjà caché, aucun nouveau champ IGDB
   nécessaire).

**UX** : bouton "Filtres" + compteur de filtres actifs, "Réinitialiser",
persistance en query string (`?modes=coop&genres=RPG`, partageable),
application instantanée (`router.replace` à chaque changement, pas de
bouton "Appliquer"). Panneau Radix Dialog responsive (bottom-sheet
mobile ↔ panneau ancré à droite en desktop via les breakpoints `sm:`)
plutôt que deux mécaniques distinctes drawer desktop + geste de swipe
mobile "from scratch" — réutilise le pattern déjà établi ailleurs dans
l'app (`VoterAvatars`, `EditGameDialog`…), beaucoup plus robuste qu'un
vrai geste de swipe à construire pour un gain marginal. Ouverture au tap
du bouton "Filtres" sur les deux formats plutôt qu'un swipe natif.

Le filtrage est fait en mémoire côté serveur (Prisma `findMany` simple +
`.filter()` JS via `matchesGameFilters`), pas dans la requête Prisma
elle-même : évite la syntaxe fragile des filtres JSON Prisma
(`path`/`array_contains`, sensible à la version) pour les filtres
dépendant d'`igdbDetails` — une biblio de groupe d'amis reste petite
(quelques centaines de jeux au pire), le coût du filtrage JS est
négligeable. Le champ de recherche par nom déjà présent dans
`BibliothequeGrid`/`ReadOnlyGameGrid`/`TierlistBoard` (state client,
pas dans l'URL) continue de filtrer par-dessus la liste déjà restreinte
par ces 6 filtres — les deux mécanismes se superposent sans conflit,
non-régression sur PR #7 (biblio) et PR 26 (tierlist).

**Stratégie pour les jeux sans cache IGDB (choix documenté, "Option B")** :
un jeu dont la fiche n'a jamais été ouverte n'a pas encore `igdbDetails`
en cache (rempli à la demande au premier clic sur `/jeux/[id]`, jamais
en masse — décision déjà prise avant cette PR, voir § "Fiche jeu
détaillée"). Plutôt que d'enrichir en arrière-plan au chargement de la
page biblio ("Option A"), ces jeux **apparaissent normalement** dans la
grille mais **ne remontent jamais** dans les filtres Genre/Date de
sortie tant qu'ils ne sont pas enrichis — une note explicative apparaît
directement sous ces deux filtres dans le panneau plutôt qu'un badge
par carte (plus simple, contextuel uniquement quand ces filtres sont
utilisés).

Choix retenu sur Option A pour trois raisons :
- **Cohérence avec une décision déjà prise dans le projet** : la fiche
  jeu enrichit "à la demande, jamais en masse" explicitement pour
  éviter un timeout Vercel sur un import Steam massif — un enrichissement
  en arrière-plan au chargement de `/bibliotheque` réintroduirait
  exactement le risque déjà écarté.
- **Fiabilité serverless** : Vercel termine la fonction une fois la
  réponse envoyée ; un vrai "fire-and-forget" en arrière-plan
  demanderait `after()` (Next 15+) ou un mécanisme équivalent, plus
  fragile et plus difficile à tester dans ce sandbox (pas de prod
  réelle pour vérifier qu'un enrichissement différé se termine
  effectivement) que la dégradation simple d'Option B.
- **Suffisant à l'usage** : ouvrir une fiche jeu une fois (déjà le geste
  naturel pour consulter un jeu) suffit à le rendre filtrable
  durablement ensuite — pas besoin d'un mécanisme d'arrière-plan pour
  un gain ponctuel.

### Fichiers clés (Bloc A + B)

- `src/lib/reminder-timings.ts` — préréglages, seuil "loin"/"proche",
  parsing FormData, libellés FR.
- `src/lib/discord-reminder.ts` / `src/app/api/cron/reminders/route.ts` —
  itèrent sur `reminderTimings` au lieu des deux fenêtres fixes.
- `src/components/ReminderTimingsField.tsx` — champ du formulaire de
  création (`/sessions`).
- `src/lib/game-filters.ts` — types, parsing/sérialisation URL, matching,
  traduction genres.
- `src/lib/game-library.ts` — `getGameOwnerCounts`, `getTotalUserCount`,
  `toFilterableGame` (cast `Game.igdbDetails` JSON, même pattern que
  `src/lib/game-details.ts`).
- `src/components/GameFilterDrawer.tsx` — le panneau lui-même.
- `/bibliotheque`, `/bibliotheque/groupe`, `/tierlist` — filtrage
  appliqué en amont des grilles/`TierlistBoard`, compteur "N jeux sur M"
  affiché à côté du bouton Filtres.

Migration : `prisma/migrations/20260826180000_add_session_reminder_timings`
(purement additive, défaut Postgres appliqué directement — aucun script
de backfill nécessaire).

## PR 2.5/4 — 2 corrections post-test-prod de la PR 2/4 (PR 32)

Deux bugs remontés après le test en prod de PR 31, avant d'enchaîner sur
PR 3/4. Non-régression : les autres filtres (modes hors coop, joueurs,
source, possédé par N potes, genre) ne sont pas touchés.

### Bug 1 — Sliders "Date de sortie" difficiles à manipuler

**Cause** : 2 `<input type="range">` empilés sur la même piste — un
défaut classique de ce pattern, pas un bug de step ni de touch handling
(le composant était un slider natif HTML, pas un composant custom ni
Radix) : les deux poignées se chevauchent visuellement, un tap au milieu
de la piste peut saisir la mauvaise poignée, particulièrement pénible
au tactile.

**Fix** : remplacés par 2 `<select>` natifs (année min / année max),
le fallback suggéré dans la demande — sélection exacte à chaque fois,
fiable au clavier comme au tactile, sans les problèmes de saisie
d'un slider à deux poignées. Les sliders "Nombre de joueurs" (2 sliders
également) n'ont **pas** été touchés : pas remontés comme buggés, la
demande précisait explicitement la non-régression sur les filtres qui
marchent bien.

**Tester en prod** : ouvrir le panneau Filtres sur `/bibliotheque`,
choisir une année min et une année max sur "Date de sortie" — les deux
`<select>` doivent répondre normalement au tap comme au clic, sans
grip mort ni valeur qui saute.

### Bug 2 — Le filtre Coop ne remonte presque aucun jeu

**Diagnostic confirmé** : l'import Steam pose `Game.isCoop = false` par
défaut (Steam ne fournit pas cette info dans son API) — la quasi-
totalité des jeux importés depuis Steam paraissent "pas coop" même
quand ils le sont réellement, seuls les quelques jeux ajoutés/édités
manuellement avec la case "Coop" cochée remontaient.

**D) Logique du filtre elle-même vérifiée — pas de bug là.**
`gameModesFor`/`matchesGameFilters` (`src/lib/game-filters.ts`) : un
jeu avec `isCoop = true` reçoit toujours `"coop"` dans ses modes, et
`filters.modes.some((m) => modes.includes(m))` matche dès que
`"coop"` est coché et présent — vérifié ligne à ligne, confirmé correct
par relecture (le "test unitaire mental" demandé). Le bug était
entièrement côté donnée (`isCoop` faux par défaut), pas côté filtre.

**A) Backfill IGDB automatique.** Nouveau script
`prisma/backfill-coop.mjs`, wired dans `npm run build`. `fetchIgdbGameDetails`
(`src/lib/igdb.ts`) récupère maintenant aussi `multiplayer_modes`
(`onlinecoop`/`offlinecoop`/`lancoop`/`campaigncoop` pour `isCoop` ;
`offlinemax`/`onlinemax`/`*coopmax` pour `maxPlayers`) — champ IGDB déjà
utilisé ailleurs dans le projet pour la recherche (`searchIgdbGames`),
juste jamais branché sur la fiche détaillée jusqu'ici. Portée du
backfill : jeux avec un cache IGDB **déjà en base** (`igdbDetails !=
null`) et jamais confirmés manuellement (`playInfoManual = false`, voir
plus bas) — les jeux sans cache sont couverts par B, pas par ce script
(éviterait un appel IGDB par jeu de toute la biblio à *chaque* build).

**Nouveau champ `Game.playInfoManual`** (migration
`20260828120000_add_game_play_info_manual`, défaut `false`, purement
additive) : `true` dès que `isCoop`/`minPlayers`/`maxPlayers` ont été
saisis ou confirmés par un humain (formulaire d'ajout/édition manuel,
ou le bouton "Marquer comme coop" — voir C). Sans ce champ, le backfill
(rejoué à chaque déploiement) écraserait indéfiniment une correction
manuelle au déploiement suivant — c'est le champ qui rend le bouton
manuel de C réellement utile dans la durée, pas juste une correction
ponctuelle.

**B) Enrichissement à la demande pour les jeux sans cache.** Sur
`/bibliotheque`, quand le filtre Coop est actif **et** que la biblio
personnelle contient des jeux sans `igdbDetails` (jamais visités sur
leur fiche), un bandeau léger ("Enrichissement de N jeu(x) pour le
filtre Coop…") se déclenche automatiquement
(`CoopEnrichmentTrigger.tsx` → `enrichGamesForCoopFilter`, `src/app/bibliotheque/actions.ts`),
par lots de 15 jeux max (progressif, pas d'explosion de requêtes IGDB
d'un coup). Réutilise `getGameDetails` telle quelle (même chemin que la
fiche jeu) — c'est la même fonction qui synchronise maintenant
`isCoop`/`maxPlayers` en cache, voir `computePlayInfoFromIgdb`
(`src/lib/game-details.ts`). `router.refresh()` une fois terminé pour
recalculer la liste filtrée. Scope : `/bibliotheque` uniquement (biblio
personnelle, comme demandé), pas `/bibliotheque/groupe` ni `/tierlist`.

**C) Override manuel.** Bouton discret "Marquer comme coop"/"Retirer
coop" sous chaque carte de `/bibliotheque` (`toggleGameCoop`,
`src/app/actions.ts`) — bascule `isCoop` et pose
`playInfoManual = true`, donc protégé du backfill automatique dès ce
moment. Placé **hors** du `<Link>` de la carte (un `<button>` dans un
`<a>` est invalide en HTML et aurait déclenché la navigation en plus du
toggle) — même souci potentiel que pour `EditGameDialog`/le bouton de
suppression, déjà hors du lien pour la même raison.

**Tester en prod** :
1. Filtre Coop sur `/bibliotheque` avant cette PR → très peu de jeux.
2. Après déploiement (le backfill tourne au build) → sensiblement plus
   de jeux coop remontent, sans action de l'utilisateur.
3. Sur un jeu Steam jamais visité sur sa fiche : activer le filtre Coop
   → bandeau d'enrichissement bref, puis le jeu apparaît ou non selon
   sa vraie donnée IGDB.
4. Sur un jeu mal catégorisé : cliquer "Marquer comme coop"/"Retirer
   coop" → effet immédiat sur le filtre, et persiste après un nouveau
   déploiement (le backfill ne l'écrase plus).

## PR 2.6/4 — Catégorisation coop fiable via Steam Store API + UX manuelle (PR 32, suite)

Nouveau retour de prod sur PR 32 (2.5/4) : le backfill IGDB seul aide,
mais IGDB n'a pas les données de tous les jeux — le filtre Coop reste
incomplet. Deux blocs, toujours sur `Game.isCoop`/`minPlayers`/
`maxPlayers`/`playInfoManual` (pas de nouveau champ).

### Bloc A — Steam Store API (deuxième source de vérité)

**Nouveau client** `src/lib/steam-store.ts` — `fetchSteamStoreDetails(steamAppId)`
appelle l'endpoint public (sans clé) `https://store.steampowered.com/api/appdetails?appids={id}&l=french`
et parse `data.categories`. `isCoop` est dérivé par double vérification :
un id de catégorie connu (`Set([9, 24, 27, 38, 39, 48])` — Co-op,
Shared/Split Screen, Multi-Joueur local, Multi-player, etc.) **ou** un
mot-clé sur `description` (`coop`, `co-op`, `coopératif`, `écran
partagé`, `partagé`) — la description est localisée par `?l=french`
donc pas fiable seule pour matcher toutes les variantes linguistiques,
d'où le repli sur les ids stables.

**Nouveau backfill** `prisma/backfill-steam-coop.mjs`, wired dans
`npm run build` juste après `backfill-coop.mjs` (IGDB). Portée :
`source = STEAM` **et** `playInfoManual = false` (même garde que le
backfill IGDB — jamais un jeu confirmé par un humain). Délai de 1,5s
entre deux appels (l'API Steam Store documente ~200 req/5 min pour
l'usage non authentifié ; 1,5s reste large en dessous, ~40 req/min max).
Si l'API répond 429 (rate limit) ou une erreur réseau sur un jeu, le
script logue et passe au suivant (ou s'arrête proprement sur 429, en
gardant ce qui a déjà été mis à jour) plutôt que de planter le build.

**Priorité de source (Steam Store > IGDB > défaut)** : assumée par
**séquencement** des deux scripts dans `npm run build`, pas par une
logique de comparaison croisée. `backfill-coop.mjs` (IGDB) tourne en
premier ; `backfill-steam-coop.mjs` tourne ensuite et n'écrase `isCoop`
que quand Steam Store a une réponse exploitable pour ce jeu — sinon il
ne touche pas au jeu, qui garde la valeur IGDB (ou le défaut Steam-import
`false`) posée avant lui.

**Limite assumée** : contrairement à IGDB (`multiplayer_modes.*max`,
de vrais chiffres), les `categories` Steam Store sont des tags booléens
sans nombre de joueurs — ce script **ne touche donc pas** `minPlayers`/
`maxPlayers`, seulement `isCoop`. Documenté comme un choix plutôt qu'un
oubli : inventer un chiffre plausible aurait été moins honnête qu'un
champ qu'on ne touche pas.

**Log par jeu** (format demandé) :
```
[steam-store] Skyrim → categories: [Multi-player, Co-op] → isCoop=true
```
Et un résumé en fin de script : nombre mis à jour / déjà corrects / sans
donnée exploitable / échecs, sur le total de jeux éligibles, plus une vue
d'ensemble globale (`isCoop=true` en base, `playInfoManual=false` vs
`true`).

**Combien de jeux enrichis via Steam Store vs IGDB vs manuel ?** Aucun
champ ne trace *quelle* source a posé la valeur actuelle d'un jeu (la
contrainte de cette PR excluait explicitement une migration) — donc pas
d'historique par origine consultable après coup. Ce qui est mesurable et
loggé à chaque build : le nombre de mises à jour faites par **ce**
script (Steam Store, ligne `[steam-store] Terminé en …`), le nombre fait
par `backfill-coop.mjs` (IGDB, même format de log), et l'agrégat final
`playInfoManual=false` (confirmé automatiquement, Steam Store et/ou
IGDB cumulés) vs `playInfoManual=true` (confirmé manuellement — ajout/
édition manuelle, bouton "Marquer comme coop", ou l'onglet "À vérifier"
ci-dessous). **Le temps réel de ce premier backfill et le nombre exact de
jeux concernés dépendent de la taille de la vraie bibliothèque Steam du
groupe en prod** — ce sandbox n'a pas d'accès DB/réseau pour les
mesurer : à relever dans les logs du premier déploiement Vercel après
merge (`[steam-store] Terminé en Xs — …`).

Migration Prisma : aucune, comme demandé — les champs existants
(`isCoop`, `playInfoManual`) suffisent.

### Bloc B — Onglet "À vérifier" (correction manuelle rapide)

**Nouvel onglet** `/bibliotheque/a-verifier` (`src/app/bibliotheque/a-verifier/page.tsx`),
4ᵉ onglet de `LibraryTabs.tsx` (`src/components/LibraryTabs.tsx`) après
Ma bibliothèque/Groupe/Tierlist. Liste les jeux possédés avec
`isCoop = false` **et** `playInfoManual = false` — ni Steam Store ni
IGDB n'ont pu confirmer un mode de jeu, ni personne ne l'a fait à la
main. Le nombre de jeux concernés apparaît en badge sur l'onglet
(`toVerifyCount`, calculé sur `/bibliotheque`) et en toutes lettres en
haut de la liste ("N jeux à vérifier").

Chaque carte (`ToVerifierList.tsx`, `src/components/ToVerifierList.tsx`,
composant client) affiche cover + nom + badge de source (Steam/IGDB/
Manuel), et 4 actions tap-to-toggle :
- **☐ Coop** → confirme `isCoop = true` (ne touche pas aux bornes de
  joueurs déjà en base, potentiellement déjà correctes).
- **☐ Multijoueur** → confirme `isCoop = false` mais relève les bornes
  à 2–4 si elles laissaient croire à du solo (`maxPlayers` absent ou
  ≤ 1) — sinon les garde telles quelles.
- **☐ Solo uniquement** → force `minPlayers = 1`, `maxPlayers = 1`,
  `isCoop = false`.
- **Ignorer** → ne change ni `isCoop` ni les bornes, marque juste
  `playInfoManual = true` : confirme que les valeurs actuelles sont
  correctes telles quelles, sans rien modifier.

Les 4 actions posent `playInfoManual = true` (server actions
`setToVerifierGamePlayInfo`/`ignoreToVerifierGame`,
`src/app/bibliotheque/actions.ts`) — protège le choix humain du
prochain backfill Steam Store/IGDB, exactement comme le bouton "Marquer
comme coop" de PR 32/2.5. Une fois traité, le jeu quitte la liste avec
une animation de sortie (`AnimatePresence`/`motion.div`, glissement +
fondu, `framer-motion` — cohérent avec `Stagger`/`PopIn` déjà utilisés
ailleurs dans l'app) ; l'état local de la liste est mis à jour côté
client sans recharger la page, `revalidatePath` côté serveur garde le
reste de l'app (badge, filtre Coop) synchronisé à la prochaine
navigation. Mobile-first : boutons pleine largeur tap-friendly, pas de
swipe (le tap est plus fiable et accessible qu'un geste de swipe sur ce
genre d'action, et reste cohérent avec le reste de l'app qui n'utilise
aucun swipe ailleurs).

**Bonus — "Marquer les N jeux affichés comme coop"** (`MarkAllCoopButton.tsx`,
`src/components/MarkAllCoopButton.tsx`) : apparaît sur `/bibliotheque`
uniquement quand le filtre "Coop" est le **seul** filtre de mode actif
(`filters.modes = ["coop"]`) — la liste affichée est alors déjà
entièrement composée de jeux coop (backfill ou manuel), le bouton
confirme (`playInfoManual = true`) tous les jeux visibles en un tap
(`batchMarkGamesCoop`, restreint côté serveur aux jeux réellement
possédés par l'utilisateur, jamais les ids reçus du client sans
vérification).

**Description de l'onglet "À vérifier"** (pas de capture d'écran
possible dans ce sandbox, comme pour les précédentes PR de ce chantier) :
une page dans le même style que `/bibliotheque` (fond sombre, cartes
`Card` avec bordure `border-border`), en-tête "N jeux à vérifier" en
violet d'accent, puis une liste verticale de cartes compactes (cover
11×16, nom + badge source à droite) — sous chaque nom, une rangée de 4
boutons pilules : 3 en violet clair translucide (Coop/Multijoueur/Solo
uniquement) et un "Ignorer" discret en bordure neutre. Un tap sur
n'importe lequel fait glisser la carte hors de l'écran vers la droite en
s'estompant, et la carte suivante remonte à sa place. Liste vide → message
positif "Rien à vérifier pour l'instant — tous tes jeux ont un mode de
jeu confirmé. 🎉".

**Tester en prod** :
1. `/bibliotheque` → l'onglet "À vérifier" affiche un badge avec le
   nombre de jeux non confirmés.
2. Sur `/bibliotheque/a-verifier`, taper "Coop" sur un jeu → il
   disparaît avec l'animation, et réapparaît comme coop sur
   `/bibliotheque` (filtre Coop) — sans jamais revenir dans "À
   vérifier" après un nouveau déploiement.
3. Taper "Ignorer" sur un jeu déjà correctement "pas coop" → disparaît
   de la liste, ne revient jamais (même sans changement visible ailleurs).

## PR 3/4 — Import biblio Steam Family par copier-coller

### Pourquoi copier-coller, pas une vraie API Steam Family

Demande initiale : synchronisation automatique via `IFamilyGroupsService/
GetFamilyGroupForUser` et `GetSharedLibraryApps` (`STEAM_API_KEY` +
`steamid`). Avant d'écrire la moindre ligne de schéma, vérification de la
faisabilité réelle de ces deux endpoints — et blocage confirmé par
plusieurs sources concordantes (implémentation de référence
[FamilyBot](https://github.com/Chachigo/FamilyBot), documentation Steam
Web API) : **les deux exigent un `access_token` de session Steam
personnelle** (récupéré depuis un navigateur connecté à
`store.steampowered.com`), pas une clé Web API serveur comme
`STEAM_API_KEY`. Concrètement :
- Aucun moyen pour GameNight (backend serveur, une seule
  `STEAM_API_KEY` partagée) d'obtenir cet `access_token` pour chaque
  utilisateur — ce n'est pas ce que produit le lien de compte OpenID 2.0
  déjà en place (F2), qui prouve juste "ce SteamID appartient à ce
  Discord user", pas une session authentifiée.
- Même en demandant à chaque utilisateur de coller son `access_token`
  manuellement, ce token expire périodiquement (durée non documentée
  officiellement) — renouvellement manuel récurrent, mauvaise UX pour
  un usage "configuré une fois".
- Distinct problème, non technique : le client Steam n'expose la liste
  "Famille" (jeux partagés par les autres membres) que dans son
  **interface** (Bibliothèque → filtre/regroupement par membre), pas sur
  une page web copiable au Ctrl+A/Ctrl+C comme
  `steamcommunity.com/id/toi/games` pour la biblio perso. Même avec un
  accès API qui marcherait, il n'y a pas de page web équivalente à
  proposer en "1 clic" pour la partie famille.

D'où l'alternative retenue : l'utilisateur colle lui-même une liste de
noms de jeux (peu importe leur provenance réelle — famille, notes,
mémoire), et l'app fait le reste (recherche IGDB + import automatique).
Détail technique complet dans `src/lib/family-import.ts`.

### Format accepté par le textarea

Un nom par ligne, et/ou plusieurs noms séparés par des virgules sur une
même ligne — les deux formats peuvent être mélangés :

```
Portal 2
Stardew Valley
Hades, Hollow Knight, Terraria
Baldur's Gate 3
```

Les lignes qui ressemblent à une URL (`http…`, `www.…`) ou à du texte
purement numérique/ponctuation (dates, durées type "42.3 hrs on record"
sans lettres) sont automatiquement ignorées. **Limite assumée** : ce
n'est pas un parseur HTML/DOM d'une page Steam complète collée telle
quelle (avec durée de jeu et date de dernière session entremêlées sur la
même ligne qu'un nom) — seul le "bruit" pur (une ligne qui ne contient
que des nombres/ponctuation/URL) est filtré, pas un vrai nettoyage
ligne par ligne. Documenté plutôt qu'un parseur impossible à écrire de
façon fiable pour du texte brut collé sans structure garantie.

### Matching IGDB : seuil de confiance à 85%

Pour chaque nom candidat, `searchIgdbGames` (déjà utilisé par
l'autocomplete de l'ajout manuel, aucune nouvelle intégration IGDB) —
puis score de similarité entre le nom collé et le meilleur résultat
(`stringSimilarity`, distance de Levenshtein normalisée, après
normalisation casse/accents/ponctuation). **≥ 85% → import automatique**
("Skyrim" vs "The Elder Scrolls V: Skyrim" avec juste une casse/
ponctuation différente matche à 100%) ; **< 85% ou aucun résultat → "à
confirmer"**, jamais un mauvais match silencieux. 85% choisi pour
tolérer les variations mineures usuelles (ponctuation, tiret vs espace,
apostrophe courbe) tout en filtrant les faux positifs sur un nom trop
générique — testé explicitement : "DOOM" vs "DOOM Eternal" (33%) et
"GTA V" vs "Grand Theft Auto V" (28%) tombent correctement sous le
seuil, pas de faux match automatique sur une abréviation ambiguë (l'un
comme l'autre finissent dans "à confirmer", où l'utilisateur peut
corriger le nom et relancer la recherche, ou ajouter manuellement).

### Cas particuliers gérés

- **Doublon** : jeu déjà possédé par l'utilisateur, peu importe la
  provenance d'origine (`PERSONAL`, `MANUAL` ou `FAMILY`) → aucune
  écriture, listé dans "❌ Doublons ignorés" (collapsible, replié par
  défaut).
- **Faible confiance / aucun résultat IGDB** → "⚠️ Non trouvés", avec par
  jeu : un champ texte modifiable (préempli avec le nom collé), un
  bouton "Chercher à nouveau" (relance le matching sur le nom édité),
  un lien "Ajouter manuellement" (`/bibliotheque/ajouter?name=…`, réutilise
  le formulaire existant) et "Skipper" (retire juste de la liste,
  aucune écriture).
- **Jeu déjà en base mais avec `playInfoManual = true`** (confirmé par
  un humain via l'ajout manuel ou l'onglet "À vérifier") : un match
  automatique de cette PR ne touche **jamais** `isCoop`/`maxPlayers`
  d'un `Game` déjà existant — uniquement `name`/`coverUrl` (cosmétique).
  Ces deux champs ne sont posés qu'à la création d'un nouveau `Game`, où
  il n'y a encore rien à protéger. Même règle que tous les backfills
  coop précédents (PR 32, PR 32.6).
- **Rate limiting / volume** : traitement par lots de 15 côté client
  (`FAMILY_IMPORT_BATCH_SIZE`), pas un seul appel serveur géant — même
  leçon que les backfills coop (PR "Optimisation build") : 300
  recherches IGDB d'un coup dépasseraient largement une fenêtre de
  requête serveur unique. Chaque lot fait avancer une vraie progress
  bar côté client.

### Schéma : `UserGame.source`

Nouveau champ `UserGame.source` (enum `UserGameSource` : `PERSONAL`,
`FAMILY`, `MANUAL`), migration additive
(`20260828140000_add_usergame_source`) — défaut `PERSONAL`, qui backfill
automatiquement tous les `UserGame` déjà en base en un seul `ADD COLUMN`
(ils ont tous été créés par l'import Steam perso ou l'ajout manuel avant
cette PR, jamais par un mécanisme famille qui n'existait pas). Le modèle
`Game` reste inchangé et unique par jeu (Skyrim = une seule ligne peu
importe qui le possède) — c'est `UserGame.source` qui porte "comment TOI
tu possèdes ce jeu", par relation user↔jeu :
- `importSteamLibrary` (`src/lib/steam.ts`) pose toujours `PERSONAL`, y
  compris sur un `UserGame` déjà existant (`update`) — l'import Steam
  perso est la source la plus fiable de possession réelle, elle prime
  si le jeu était déjà classé `FAMILY`.
- `addManualGame` (`src/app/actions.ts`) pose `MANUAL` uniquement à la
  création — un ajout manuel redondant sur un jeu déjà possédé (perso ou
  famille) ne reclasse pas la relation existante.
- `matchFamilyImportBatch` (`src/app/profil/family-import-actions.ts`)
  pose `FAMILY` uniquement à la création (jamais sur un doublon, voir
  ci-dessus).

### Interface

- **`/profil/parametres`** : nouvelle section "Bibliothèque Steam
  Family" (`FamilyImportForm.tsx`) — explication courte, lien vers la
  gestion Famille Steam, instructions (client Steam, pas de copier-coller
  direct possible), textarea, bouton "Analyser et importer", progress
  bar réelle pendant le traitement par lots, puis 3 sections (Non
  trouvés toujours visible en premier — c'est l'action requise — Importés
  et Doublons repliables).
- **Badge "Familial"** (`BibliothequeGrid.tsx`) : "👨‍👩‍👧 Familial" sur les
  cartes de `/bibliotheque` dont `UserGame.source = FAMILY`.
- **Filtre "Provenance dans ta bibliothèque"** (`GameFilterDrawer.tsx`,
  prop `personal`) : Steam personnel / Steam famille / Ajouté
  manuellement — affiché **uniquement sur `/bibliotheque`** (biblio
  perso d'un seul utilisateur). Volontairement absent de
  `/bibliotheque/groupe` et `/tierlist`, qui agrègent plusieurs
  possesseurs par jeu sans "la" provenance unique — un filtre qui n'a
  de sens que dans un contexte à un seul utilisateur. Consolidé à 3
  valeurs (celles réelles de `UserGameSource`) plutôt que les 4
  évoquées dans la demande initiale ("Manuel" et "IGDB" correspondent
  tous les deux à `MANUAL` en base — un 4ᵉ chip aurait dû inventer une
  distinction qui n'existe pas dans le schéma).
- **`/jeux/[id]`**, section "Qui d'autre possède ce jeu" : scindée en
  "Possession perso" (`PERSONAL`/`MANUAL`) et "Via famille Steam"
  (`FAMILY`), chaque sous-liste masquée si vide.

### Tester avec une liste d'exemple

Coller ce texte dans le champ de `/profil/parametres` (mélange
volontaire de formats/orthographes pour couvrir les cas) :

```
Portal 2
stardew valley
Hades, Hollow Knight, Terraria
Baldurs Gate 3
Counter-Strike 2
GTA V
```

Résultat attendu : "Portal 2", "Stardew Valley", "Hades", "Hollow
Knight", "Terraria", "Baldur's Gate 3" et "Counter-Strike 2" matchent
IGDB à haute confiance et s'importent automatiquement (source `FAMILY`,
badge "👨‍👩‍👧 Familial" visible sur `/bibliotheque`) ; "GTA V" (abréviation,
confiance sous le seuil face à "Grand Theft Auto V") atterrit dans "⚠️
Non trouvés" — corriger en "Grand Theft Auto V" puis "Chercher à
nouveau" pour le faire matcher. Recoller la même liste une seconde fois
→ tout ressort en "❌ Doublons ignorés", aucune double écriture.
4. Sur `/bibliotheque`, filtrer uniquement sur "Coop" → bouton "Marquer
   les N jeux affichés comme coop" visible ; avec un autre filtre en plus
   (ex. genre), le bouton disparaît.

## PR 3.5/4 — 2 fixes remontés en prod sur une vraie soirée (avant PR 4/4)

2 bugs remontés après une vraie soirée en prod (Deadlock, dimanche 30 août
2026, 20h) : incohérence dans l'embed Discord de clôture, et notif de
clôture arrivée 1h26 en retard.

### Bug 1 — Embed "Joueurs" (3) vs "Qui vient" (4 mentions) incohérents

**Diagnostic du code** (`src/lib/discord-announce.ts`,
`announceSessionResult`) : les deux champs sont dérivés de la **même**
variable `winner.votes` dans la même exécution synchrone — `Joueurs` =
`winner.votes.length`, `Qui vient` = `winner.votes.map(v => "<@…>").join(" ")`.
Mathématiquement, ces deux valeurs ne peuvent **pas** diverger au sein
d'un seul embed : `Vote` a une contrainte unique `(proposalId, userId)`
en base (pas de doublon possible), et `toggleVote` refuse tout vote après
la fermeture du vote (`isVotingOpen`), donc les votes sont figés bien
avant qu'un embed ne soit généré. La formule de comptage elle-même n'a
pas de bug.

**Root cause réelle trouvée ailleurs** : la clôture "paresseuse"
(`closeSessionIfDue`) est appelée **sans aucun garde-fou de concurrence**
à chaque chargement de `/`, `/sessions` et `/sessions/[id]` — par
n'importe quel visiteur. Dès qu'une session devient due pendant que
plusieurs personnes ont l'app ouverte (typiquement pile à l'heure d'une
soirée, quand tout le monde vérifie), `closeSession` pouvait démarrer en
parallèle plusieurs fois avant qu'aucune exécution n'ait eu le temps
d'écrire le nouveau statut (`session.status !== "VOTING"` n'était qu'une
simple lecture, pas une réservation atomique) — chaque exécution postait
alors sa **propre** annonce Discord. Deux messages "🎮 Soirée validée :
Deadlock" quasi identiques, adjacents dans le salon, expliquent
naturellement une impression d'incohérence en les parcourant vite sur
mobile — chaque message pris isolément reste interne cohérent, mais deux
messages voisins avec des totaux différents (si un vote a été inséré
entre les deux lectures concurrentes) donnent exactement l'effet décrit.

**Fix** : `closeSession` (`src/lib/sessions.ts`) réclame maintenant la
clôture par un `updateMany` **atomique**, conditionné sur `status:
"VOTING"` (nouvelle fonction `claimSessionClose`) — Postgres garantit
qu'une seule exécution concurrente peut trouver la ligne encore à l'état
`VOTING` et la faire passer à `SCHEDULED`/`CANCELLED`. Toute exécution
perdante s'arrête immédiatement, **avant** de poster quoi que ce soit sur
Discord. Appliqué aux 3 branches de clôture (aucune proposition, aucune
jouable, gagnant trouvé) — plus une seule annonce Discord possible par
session, quel que soit le nombre de déclencheurs concurrents (page
chargée par plusieurs personnes, ou le nouveau cron du Bug 2 qui
chevauche `closeSessionIfDue`).

**Tester** : pas reproductible en sandbox (nécessite une vraie
concurrence sur une base partagée) — validé par relecture du chemin
critique. En prod, vérifier qu'une session dont l'heure arrive pendant
que plusieurs onglets/téléphones ont l'app ouverte en même temps ne
génère plus qu'**un seul** message "🎮 Soirée validée" dans le salon.

### Bug 2 — Notif de clôture en retard (jusqu'à ce que quelqu'un ouvre l'app)

**Confirmé** : avant cette PR, la clôture d'une session (`closeSessionIfDue`)
ne se déclenchait qu'à la lecture — au chargement de `/`, `/sessions` ou
`/sessions/[id]` par n'importe qui. Sans personne pour ouvrir l'app après
l'heure de la session, la notif "Soirée validée" attendait indéfiniment
le prochain visiteur (1h26 dans le cas remonté).

**Fix** : nouvelle route `GET /api/cron/close-sessions`
(`src/app/api/cron/close-sessions/route.ts`), même mécanisme que
`/api/cron/reminders` (F7) et protégée par le même `CRON_SECRET`
optionnel (en-tête `Authorization: Bearer <CRON_SECRET>`). Trouve les
sessions `VOTING` dont le vote est fermé (`votingDeadline`, ou à défaut
`date`, déjà dans le passé) et les clôture immédiatement via
`closeSession` — sans attendre qu'un humain charge une page. Idempotent
et concurrence-safe par construction : réutilise le garde-fou atomique du
Bug 1, donc aucun risque de double-clôture même si le cron et
`closeSessionIfDue` (laissé en place comme filet de sécurité, gratuit
maintenant qu'il est race-safe) se chevauchent.

**Config cron-job.org** (ou équivalent), à ajouter en plus des rappels F7
et des 2 backfills coop déjà en place sur le même compte :

```bash
curl -X GET "https://ton-projet.vercel.app/api/cron/close-sessions" \
  -H "Authorization: Bearer $CRON_SECRET"
```

- URL : `https://ton-projet.vercel.app/api/cron/close-sessions`
- Méthode : `GET`
- Fréquence recommandée : **toutes les 15 minutes** (même pas que les
  rappels F7 — cohérent, un seul compte cron-job.org peut gérer les deux
  jobs en parallèle) : `*/15 * * * *`.
- En-tête : `Authorization: Bearer <CRON_SECRET>` si la variable est
  configurée (recommandé, même rationale que F7 — sans elle la route
  reste appelable par n'importe qui connaissant l'URL, dégradation
  silencieuse acceptable pour un petit groupe).

**Tester** : créer une session avec une date/deadline proche (~2 min dans
le futur), attendre que l'heure passe **sans ouvrir l'app**, puis
déclencher manuellement `curl -X GET http://localhost:3000/api/cron/close-sessions`
(local) — la session doit passer `SCHEDULED`/`CANCELLED` et l'annonce
Discord partir, sans qu'aucune page `/sessions/*` n'ait été chargée entre
temps.

### Vérification

- `npx eslint .` : clean
- `npx next build` : compile et type-check sans erreur (32 routes, dont
  la nouvelle `/api/cron/close-sessions`)
- Smoke test `next dev` : `GET /api/cron/close-sessions` répond (500
  attendu en sandbox — pas de `DATABASE_URL`, la requête Prisma est
  syntaxiquement valide et atteint la tentative de connexion) ; `/`,
  `/sessions`, `/bibliotheque` toujours 200
- `.next`/`AGENTS.md`/`CLAUDE.md` nettoyés avant commit
- Non-régression : clôture manuelle créateur (`closeSessionAction`),
  annonce Discord (F6), rappels (F7), backfills coop — tous inchangés,
  aucun n'est affecté par le garde-fou atomique (même contrat pour
  l'appelant : `null` si déjà clôturée)

## PR 4/4, sous-PR 1/3 — Couleur perso + calendrier collectif (lecture seule)

Dernière PR de la v1 (« refonte planning/dispos en vue calendrier
collectif »), la plus grosse du projet à date. Découpage validé avant
codage :

1. **Sous-PR 1** (celle-ci) : `User.color` + `/calendrier` en lecture
   seule (vues Semaine/Mois, Collectif/Individuel, intensité de dispo,
   meilleur créneau, sessions cliquables vers un résumé).
2. **Sous-PR 2** (à venir) : édition en glisser-déposer de ses propres
   dispos (hebdo + exceptions) directement sur le calendrier.
3. **Sous-PR 3** (à venir) : sessions pleinement interactives (Voter/
   Modifier inline, création de session depuis le calendrier), décision
   finale sur la nav (`Dispos` → `Calendrier` dans `BottomNav` ou non).

Zéro nouvelle dépendance npm sur l'ensemble de la fonctionnalité (les
trois sous-PR) : grille calendrier construite à la main (Tailwind CSS
Grid + Framer Motion, même approche que `TierlistBoard`/
`GameFilterDrawer`, plutôt qu'une lib calendrier pré-stylée qui aurait
fallu combattre pour le mobile) ; le glisser-déposer de la sous-PR 2
réutilisera `@dnd-kit/core`, déjà en dépendance et déjà éprouvé tactile
par `TierlistBoard`.

### Couleur perso (`User.color`)

Nouveau champ `User.color` (hex, défaut `#8b5cf6` = l'accent violet
existant de l'app) + `User.colorCustomized` (booléen, même pattern que
`Game.playInfoManual`, PR 32) pour distinguer "valeur par défaut jamais
touchée" de "choisie explicitement par l'utilisateur" — protège les
couleurs personnalisées d'être écrasées par un futur backfill.

**Palette** (10 couleurs vives, choisies pour rester distinguables d'un
coup d'œil) :

| Couleur | Hex |
| --- | --- |
| Violet (accent app, défaut) | `#8b5cf6` |
| Rouge | `#ef4444` |
| Orange | `#f97316` |
| Jaune | `#eab308` |
| Vert | `#22c55e` |
| Cyan | `#06b6d4` |
| Bleu | `#3b82f6` |
| Rose | `#ec4899` |
| Blanc | `#f8fafc` |
| Anthracite | `#64748b` |

**Color picker** (`/profil/parametres`, `ColorPickerField.tsx`), deux
méthodes qui coexistent (style Linear/Vercel) :
- **Palette rapide** : 10 pastilles cliquables, application immédiate.
- **Personnalisé avancé** : input texte hex (validation format
  `#RRGGBB`), 3 sliders RGB (0-255, valeur numérique éditable à côté),
  preview live, bouton "Appliquer" explicite — les deux vues (hex et
  sliders) restent synchronisées en temps réel dans les deux sens.

**Backfill** (`prisma/backfill-user-colors.mjs`, wired dans `npm run
build`, idempotent) : pour chaque compte avec `colorCustomized=false`,
assignation déterministe `palette[index % 10]` où `index` est le rang
par ordre de création du compte (`createdAt asc`). Le plus ancien compte
du groupe reçoit donc automatiquement Violet (palette[0]) sans logique
spéciale — couvre le cas "ma couleur = violet" demandé. Distribution
garantie unique jusqu'à 10 comptes (taille actuelle du groupe) ; au-delà
de 10, la palette boucle (limitation assumée, un groupe de potes ne
dépasse pas 10 aujourd'hui).

**Propagation** — la couleur perso apparaît partout, toujours via
`style` inline (une couleur hex dynamique par utilisateur ne peut pas
être une classe Tailwind arbitraire compilée au JIT depuis un template
literal runtime) :
- `Avatar` : nouvelle prop `ringColor` (remplace l'anneau neutre par un
  `box-shadow` coloré) — utilisée par `VoterAvatars` (avatars des
  voteurs sur `/sessions/[id]`).
- Bannière `/profil` : dégradé fallback recoloré (`bannerFallbackStyle`)
  quand pas de `bannerUrl`.
- `ColorDot` (nouveau composant) : petite pastille, utilisée à côté du
  nom sur `/profil`, `/potes/[id]` et dans `/classement` (podium +
  tableau).
- Calendrier : légende Collectif, filtre potes, meilleur créneau.

**Arbitrage important** : `RankAvatar` (anneau coloré par rang —
bronze/argent/or/légendaire, PR 27/28) garde sa signification actuelle,
inchangée. La couleur perso n'y touche pas — elle apparaît en accent
séparé (`ColorDot`) partout où c'est pertinent, jamais en remplaçant
l'anneau de rang.

### `/calendrier` (lecture seule)

**Données** (`src/lib/calendar.ts`, `getCalendarData`) : pour chaque
(jour, heure) affiché sur la plage demandée, réutilise `isAvailableAt`
(`src/lib/availability.ts`, déjà utilisée par F5 pour le calcul
"jouable") pour chaque utilisateur — le calendrier ne peut donc jamais
diverger de ce que F5 utiliserait pour calculer une proposition à cette
heure précise, sans logique de calcul de plages séparée à maintenir.
Calcule aussi le "meilleur créneau" (max de dispos simultanées sur la
plage affichée, premier trouvé chronologiquement en cas d'égalité) et
regroupe les sessions par jour.

**Vue Semaine** (défaut) : 7 jours empilés verticalement plutôt qu'une
grille 7 colonnes × 24 lignes façon Outlook — choix mobile-first assumé
(pas dans la demande initiale, décision de design prise en cours de
route) : une vraie grille horaire forcerait soit un scroll horizontal
sur 7 colonnes étroites, soit des cellules illisibles sur téléphone. Un
strip horizontal d'intensité par jour (8h-2h le lendemain, plage
resserrée sur les heures utiles pour une app de soirées) garde "toute la
semaine d'un coup d'œil" avec un simple scroll vertical.

**Vue Mois** : grille 7 colonnes classique (façon Google/Apple Calendar)
— une case n'a besoin que d'un chiffre + un fond d'intensité, donc reste
lisible en colonnes étroites sur mobile (contrairement à la vue Semaine
qui a besoin de détail horaire). Clic sur un jour → renvoie vers sa
semaine en vue Semaine.

**Collectif vs Individuel** : mode Collectif (défaut) colore les
segments/cases par intensité (`N/M` dispos, `color-mix()` sur l'accent
violet — pas de palette heatmap séparée) et affiche un panneau
"Potes affichés" (`PoteFilterDrawer`, filtre cases à cocher, même
pattern que `GameFilterDrawer`). Mode Individuel affiche la dispo d'un
seul pote (pastilles cliquables, "Toi" en premier) en tout-ou-rien par
créneau.

**Sessions** : bloc tappable par session (`SessionBlock`, statut par
couleur — vote en cours / planifiée / terminée / annulée) ouvrant un
panneau résumé (jeu, horaire, deadline de vote, propositions/votes,
lien "Voir la fiche complète" vers `/sessions/[id]`) — volontairement
lecture seule ici, `Voter`/`Modifier` inline arrivent en sous-PR 3.

**Navigation** : tout dans l'URL (`?vue=`, `?date=`, `?mode=`, `?pote=`,
`?potes=`), même philosophie que `/classement?periode=` — rendu serveur
simple, pas de composant client pour la navigation elle-même.

**Découvrabilité** : `/disponibilites` (qui reste la page de config
détaillée — dispos hebdo + exceptions ponctuelles, inchangée) affiche
maintenant une carte pointant vers `/calendrier` ; `/calendrier` pointe
en retour vers `/disponibilites` pour la config détaillée.

### Vérification

- `npx eslint .` : clean
- `npx next build` : compile et type-check sans erreur (33 routes, dont
  la nouvelle `/calendrier`)
- Smoke test `next dev` : `/calendrier` répond 307 (redirection non
  connecté, cohérent avec les autres routes protégées) sans erreur
  d'application ; `/disponibilites`, `/profil/parametres`, `/classement`,
  `/sessions` toujours accessibles (le 200 au lieu de 307 constaté sur
  `/disponibilites`/`/sessions` est le comportement déjà connu du
  sandbox, sans lien avec cette PR)
- `.next`/`AGENTS.md`/`CLAUDE.md` nettoyés avant commit
- Non-régression : `RankAvatar` (anneau de rang) inchangé, `VoterAvatars`
  garde son comportement (juste l'anneau neutre remplacé par la couleur
  perso du voteur), `/classement` et `/potes/[id]` inchangés à part
  l'ajout de la pastille couleur, `/disponibilites` toujours pleinement
  fonctionnel pour éditer dispos hebdo/exceptions

## PR refonte `/calendrier` — pattern "Outlook mobile" (avant sous-PR 2/3)

Retour terrain sur `/calendrier` (sous-PR 1) : le rendu Semaine (7 jours
empilés)/Mois (grille) manquait de clarté sur mobile. Refonte de
l'affichage — toujours en lecture seule, aucune donnée/schéma touché,
aucun glisser-déposer (sous-PR 2 suivante) — pour reproduire le pattern
de la vue calendrier mobile d'Outlook : mini-mois compact en haut +
timeline verticale de la journée sélectionnée en dessous. S'insère avant
les sous-PR 2 (glisser-déposer) et 3 (sessions interactives + création),
inchangées, juste réordonnées après celle-ci — elle reprend aussi la
décision de nav initialement prévue pour la sous-PR 3.

Une seule PR (pas de nouveau découpage à tiroirs) : cette refonte touche
uniquement l'affichage d'une page, aucune donnée/schéma, aucune autre
route — un remplacement net de `WeekGrid`/`MonthGrid` par deux nouveaux
composants, pas une famille de features séparables.

### `MiniMonthCalendar` (nouveau, remplace `MonthGrid.tsx`)

Grille mois compacte, repliable — ouverte par défaut, se replie
automatiquement au tap sur une date (laisse la place à la timeline,
rouvrable via un chevron `▲`/`▼`, état local non persisté dans l'URL).
Aujourd'hui mis en évidence, jour sélectionné en surbrillance accent. En
mode Collectif, pastille violette sur les jours avec un "bon" créneau
commun — seuil : `maxAvailableCount / totalUsers ≥ 50%` (majorité du
groupe dispo à un moment de la journée). Pas de pastille en mode
Individuel (non spécifié, laissé simple). Flèches `‹`/`›` du mini-mois =
navigation par mois (déplace la date sélectionnée vers le 1er du mois
voisin — même source de vérité `?date=` que la sélection de jour, pas
d'état "mois parcouru" séparé) ; contrairement au tap sur une date
précise, elles laissent le calendrier ouvert.

### `DayTimeline` (nouveau, remplace `WeekGrid.tsx`)

Colonne unique, 24h complètes (pas de fenêtre réduite — demande
explicite), heures en lignes. Auto-scroll vers 18h à **chaque** changement
de jour (pas seulement au premier chargement de la page) : le composant
est remonté à chaque navigation jour (`key={date}` posé par la page),
donc un `useEffect` sans dépendances suffit à relancer le scroll "au
chargement" de chaque nouvelle journée. Dispos affichées comme cellules
colorées par intensité (collectif, `color-mix` sur l'accent) ou dispo
on/off (individuel) ; sessions insérées à leur horaire (réutilise
`SessionBlock` tel quel, aucun changement). En Collectif, le créneau le
plus fort de la journée est surligné (anneau + `✨`) — dérivé directement
de `day.hours`, sans toucher à `src/lib/calendar.ts`.

Changement de jour par flèches `‹`/`›` (remplace le prev/next
semaine/mois) + swipe tactile : `touchstart`/`touchend` natifs (pas
`@dnd-kit/core` — sa mécanique item→zone de dépôt ne colle pas à un
balayage horizontal sur une colonne qui doit rester scrollable
verticalement), zéro nouvelle dépendance. Le scroll vertical natif n'est
jamais intercepté (`preventDefault` jamais appelé) ; seul un geste
nettement plus horizontal que vertical (delta X > 50px et > 1.5× le delta
Y) déclenche la navigation jour.

### Refactor `src/lib/calendar.ts` → `src/lib/calendar-dates.ts`

`addDays`, `getMonthGridRange` (et l'ex-`getWeekStart`, devenue interne,
`getWeekStart` public et `WEEK_LENGTH_DAYS` supprimés — plus de vue
Semaine) déplacés dans un nouveau module pur `src/lib/calendar-dates.ts`
(zéro import Prisma) — nécessaire pour être importable depuis
`MiniMonthCalendar`/`DayTimeline` (composants client) : `calendar.ts`
importe `@/lib/prisma`, donc un composant client qui l'importerait ferait
planter le bundle (code Node-only envoyé au navigateur). Ce module
héberge aussi le nouveau `buildCalendarHref`, partagé par la page serveur
et les deux composants client pour calculer exactement les mêmes liens
sans dupliquer la logique de query-string.

### `/calendrier/page.tsx` réécrit

Une seule requête `getCalendarData` sur toute la grille du mois affiché
(consommée à la fois par `MiniMonthCalendar` et par `DayTimeline`, qui ne
fait qu'un `find` dedans pour le jour sélectionné) — pas de requête
séparée par jour. URL simplifiée : `?vue=` disparaît (plus de bascule
Semaine/Mois), restent `?date=`, `?mode=`, `?pote=`, `?potes=`. Le
bandeau texte "meilleur créneau" est retiré (redondant avec la pastille
mini-mois + le surlignage dans la timeline).

### Navigation app : "Dispos" → "Calendrier"

`NAV_LINKS` (`src/components/nav-links.tsx`, partagé par `BottomNav` et
`HeaderNavLinks`) : l'entrée "Dispos" pointe maintenant vers
`/calendrier` au lieu de `/disponibilites`, même `CalendarIcon`. Pas de
7e icône, pas de réorganisation de grille. `/disponibilites` reste
pleinement fonctionnelle et accessible via les liens croisés déjà posés
en sous-PR 1 (carte `/disponibilites` → `/calendrier`, lien de pied de
page `/calendrier` → `/disponibilites`) — sa copie a été relue, toujours
cohérente sans modification.

### Vérification

- `npx eslint .` : clean
- `npx next build` : compile et type-check sans erreur (33 routes,
  inchangées — refonte d'affichage pure, aucune route ajoutée/retirée)
- Smoke test `next dev` : `/calendrier` (avec `?date=`/`?mode=`) répond
  307 (non connecté, cohérent) sans erreur d'application dans les logs ;
  `/disponibilites`, `/sessions`, `/classement`, `/potes`, `/profil`
  toujours accessibles (200/307 selon la routebase, cohérent avec le
  comportement déjà connu du sandbox)
- `.next`/`AGENTS.md`/`CLAUDE.md` nettoyés avant commit
- Non-régression : `User.color`/backfill/color picker/propagation
  (mergés en sous-PR 1) non touchés ; `PoteFilterDrawer`/`SessionBlock`
  réutilisés tels quels ; aucune donnée/migration ; aucun glisser-déposer

## Fix cycle de vie des soirées — fuseau horaire, clôture 0 votant, auto-DONE

Bug remonté en prod (lundi 31 août 2026) : la home affichait "Prochaine
soirée : dimanche 30 août 20:00" alors que c'était la veille, `/sessions`
listait deux soirées du 30 août en "À venir"/"Prévue" au lieu de
Historique, et la clôture automatique avait validé + annoncé sur Discord
une soirée à **0 votant** ("Personne n'a voté (clôture automatique)").
Investigation d'abord (lecture de code seule, pas d'accès DB en sandbox),
plan de correction validé, puis implémentation — 3 causes racines
indépendantes, toutes corrigées dans cette seule PR ciblée (aucune
migration, aucune nouvelle dépendance).

### Cause 1 (dominante) — aucune transition automatique `SCHEDULED → DONE`

"Prévue" est le libellé de `SCHEDULED`, pas de `VOTING` — les soirées
n'étaient donc pas bloquées en vote, elles avaient déjà été clôturées et
décidées. Le vrai trou : `markSessionDone` (`src/lib/sessions.ts`)
n'avait **aucun** déclenchement automatique, uniquement le bouton
"Marquer comme terminée" (créateur, manuel). Une soirée décidée restait
donc "Prévue" indéfiniment — visible pour toujours dans "À venir"
(`src/app/sessions/page.tsx`, filtré par statut, jamais par date) et
capable de rafler "Prochaine soirée" sur `/` (`findFirst` triée par date
croissante sur `VOTING`/`SCHEDULED`, donc la plus ancienne "gagne"
éternellement si elle ne passe jamais `DONE`).

**Fix** : nouvelle fonction `closeOverdueScheduledSessions`
(`src/lib/sessions.ts`) — trouve toutes les sessions `SCHEDULED` dont
l'heure de début dépasse `SCHEDULED_TO_DONE_GRACE_MS` (6h, valeur
produit facile à ajuster), sans aucune borne de "récence" (rattrape tout
le backlog déjà accumulé dès le premier passage, pas seulement les
sessions récentes), et appelle `markSessionDone` pour chacune (réutilisé
tel quel — pas de logique dupliquée, ouvre aussi la fenêtre de vote de
superlatifs comme le bouton manuel). Appelée par le cron **existant**
`/api/cron/close-sessions` (aucun nouveau cron externe à configurer),
**après** la clôture des votes `VOTING` de ce même run — garantit qu'une
soirée à 0 votant (cause 3) ne peut jamais atteindre `DONE` puisqu'elle
vient de passer `CANCELLED` avant que la requête `SCHEDULED` ne
s'exécute.

Vérifié que l'auto-`DONE` ne perturbe pas le vote de superlatifs
(`src/lib/superlative-voting.ts`) : la fenêtre est de **24h** (pas une
poignée de secondes), et `finalizeSuperlativeVoting` (qui poste
l'annonce Discord des récompenses) ne se déclenche que paresseusement au
chargement d'une page — jamais synchronement depuis le cron. Un
auto-`DONE` à 3h du matin n'envoie donc aucune notification nocturne, il
ouvre juste silencieusement une fenêtre que le groupe verra à son
prochain passage sur l'app.

### Cause 2 — décalage horaire systémique (Europe/Paris vs UTC réel)

Les dates saisies sont stockées comme horloge murale sans conversion
(`Date.UTC` littéral sur les chiffres tapés) — cohérent pour le
stockage/affichage, mais `wallClockNow()` renvoyait `new Date()` (heure
UTC **réelle** du serveur). Paris étant UTC+2 l'été (CEST), une soirée à
23h30 heure de Paris n'était considérée due qu'à 23h30 UTC réel, soit
01h30 le lendemain à Paris — explique le timing de la notif Discord
reçue vers 01h00.

**Fix** (`src/lib/wallclock.ts`) : `wallClockNow()` recalculée comme
horloge murale de `Europe/Paris` — lit l'heure réelle actuelle telle
qu'affichée à Paris via `Intl.DateTimeFormat` (DST géré automatiquement
par la donnée IANA, aucune librairie de fuseaux ajoutée), puis la
reconstruit avec les mêmes conventions `Date.UTC` que le stockage. Un
seul point de correction, propagé sans modification à `isVotingOpen`,
`closeSessionIfDue`, `resolveSessionSchedule`, `todayDateOnly`. Les
`new Date()` bruts restants ont été remplacés par `wallClockNow()` dans
le cron (`src/app/api/cron/close-sessions/route.ts`) et les 2
pré-filtres de page (`src/app/page.tsx`, `src/app/sessions/page.tsx`) —
sinon ils redevenaient une source de désaccord avec les comparaisons
internes désormais corrigées (plus strictes qu'avant, donc pouvant
exclure à tort des sessions en réalité dues).

Cas limite minuit : géré par construction — `Intl.DateTimeFormat` avec
`timeZone` calcule toujours la date/heure locale correcte, y compris
quand le passage à minuit heure de Paris ne correspond pas au passage à
minuit UTC réel (vérifié manuellement : 2026-08-30T22:15:00Z UTC réel →
2026-08-31T00:15 heure de Paris, correctement reconstruit).

### Cause 3 — clôture automatique validée avec 0 votant

Dans `closeSession`, la sélection du gagnant (`jouableProposals.reduce`)
n'avait aucun plancher sur le nombre de votes — si toutes les
propositions "jouables" avaient 0 vote, l'une d'elles "gagnait" quand
même et la soirée était validée + annoncée sur Discord
("🎮 Soirée validée", avec le texte déjà prévu "Personne n'a voté
(clôture automatique)" dans `discord-announce.ts`).

**Fix** (décision produit validée) : si le "gagnant" parmi les
propositions jouables a 0 vote, la session passe `CANCELLED`
**silencieusement** — aucune annonce Discord (contrairement au cas
"aucune proposition jouable", qui reste annoncé "❌ Soirée annulée").
`CloseSessionResult.discord` devient `PostToDiscordResult | null` pour
distinguer ce cas ; les 2 appelants (`api/cron/close-sessions/route.ts`,
`app/sessions/actions.ts`) sont mis à jour pour ne pas planter sur ce
`null`.

### Vérification

- `npx eslint .` : clean
- `npx next build` : compile et type-check sans erreur (33 routes,
  inchangées — aucune route ajoutée/retirée)
- Script Node autonome reproduisant l'algorithme `wallClockNow()` : CEST
  (été, UTC+2) et CET (hiver, UTC+1) tous deux corrects, cas limite
  minuit correct, et reproduction exacte du bug rapporté ("session à
  23h30 heure de Paris considérée due exactement à l'heure réelle de
  Paris 23h30", au lieu de 2h plus tard avant le fix)
- Smoke test `next dev` : `/`, `/sessions`, `/disponibilites` toujours
  200 ; `/calendrier` 307 (non connecté, cohérent) ; `GET
  /api/cron/close-sessions` répond 500 en sandbox (attendu — pas de
  `DATABASE_URL`, l'erreur confirme que la requête Prisma est atteinte
  sans erreur de code, cf. logs : "No database host or connection
  string was set")
- `.next`/`AGENTS.md`/`CLAUDE.md` nettoyés avant commit
- Non-régression : `claimSessionClose` (garde-fou de concurrence,
  PR 3.5/4) inchangé ; clôture manuelle créateur, annonce Discord (F6),
  rappels (F7), calendrier (`/calendrier`, refonte précédente) — aucun
  n'est affecté ; aucune migration, aucune nouvelle dépendance

## Propagation `User.color` dans `/calendrier`

PR ciblée : les blocs de dispo de `DayTimeline` utilisaient jusqu'ici un
violet fixe, sans lien avec la couleur perso choisie par chacun
(`User.color`, PR 4/4 sous-PR 1). `getCalendarData` renvoyait déjà
`color` sur chaque `CalendarUser` — aucun changement nécessaire côté
requête, `DayTimeline` recevait déjà la liste `users` complète.

**Individuel** : le bloc d'un créneau dispo prend directement la couleur
de l'utilisateur affiché (`selectedUserColor`, dérivée de `users` par
`selectedUserId`).

**Collectif** : un seul pote dispo sur le créneau → sa couleur perso
directement (identifie qui est libre d'un coup d'œil, sans ouvrir le
panneau potes) ; 2+ potes dispo → violet accent neutre avec la rampe
d'intensité déjà en place (opacité proportionnelle à
`dispos/total`). Choix assumé : mélanger plusieurs couleurs perso
arbitraires dans une barre de 28px serait illisible sur mobile — au-delà
d'un seul pote, l'intensité reste le signal le plus clair pour "combien
de monde est dispo".

**Inchangé** (comme demandé) : la pastille "bon créneau" du mini-mois et
le surlignage "meilleur créneau collectif" de la timeline restent en
violet accent — ce sont des indicateurs collectifs, pas liés à un pote
en particulier.

### Vérification

- `npx eslint .` : clean
- `npx next build` : compile et type-check sans erreur (33 routes,
  inchangées)
- Smoke test `next dev` : `/calendrier` et `/calendrier?mode=individuel`
  répondent 307 (non connecté, cohérent) sans erreur d'application
- `.next`/`AGENTS.md`/`CLAUDE.md` nettoyés avant commit
- Non-régression : `MiniMonthCalendar` (pastille), surlignage meilleur
  créneau, `SessionBlock`, `ColorDot` (légende) inchangés ; aucune
  donnée/migration ; aucun glisser-déposer (sous-PR suivante)

## Édition tactile des dispos depuis `/calendrier` (sous-PR 2/3)

PR ciblée : jusqu'ici `/calendrier` était en lecture seule (sous-PR 1/3
puis redesign "Outlook mobile", sous-PR 1.5). Cette PR ajoute la
possibilité de modifier ses propres dispos directement en tapant sur un
créneau de la timeline, sans repasser par `/disponibilites`.

**Contrainte de schéma centrale** : `AvailabilityOverride` a une
contrainte `@@unique([userId, date])` — une seule ligne d'exception par
jour et par user, avec une seule plage `startTime`/`endTime` (ou journée
entière). C'est la même limitation que le formulaire d'exception de
`/disponibilites` ; ce n'est pas une régression introduite ici. Taper sur
une heure qui n'est pas déjà exactement celle de l'exception du jour
**remplace** donc l'exception existante (elle "se déplace" sur la
nouvelle heure, l'ancienne heure redevient celle du planning hebdo) —
option validée explicitement plutôt qu'un rejet avec message d'erreur,
jugée plus fluide sur mobile. Un toast `"Exception remplacée"` confirme
ce cas ; sinon `"Dispo ajoutée"` / `"Indispo ajoutée"`, ou `"Exception
supprimée — retour au planning habituel"` en re-tapant le créneau déjà en
exception (toggle).

**Portée de l'édition** : le mode édition n'apparaît **que** en vue
Individuel, et uniquement quand on regarde **sa propre** fiche
(`canEdit = mode === "individuel" && selectedUserId === user.id`,
calculé côté serveur dans `calendrier/page.tsx`). Aucune édition en vue
Collectif, ni en Individuel sur le profil d'un pote — les server actions
(`upsertOverride`, `removeOverrideForDate`) opèrent toujours sur
`getCurrentUser()` en interne et ignorent tout `userId` venu du client ;
sans ce garde-fou côté UI, éditer en regardant la fiche d'un pote
aurait modifié en silence sa propre dispo tout en affichant celle d'un
autre.

**Aucune logique dupliquée** : les modifications passent par les
**mêmes** server actions que `/disponibilites`
(`src/app/disponibilites/actions.ts`). `upsertOverride`/`removeOverride`
gagnent un `revalidatePath("/calendrier")` en plus de
`/disponibilites` (pour ne pas afficher de données périmées en
naviguant entre les deux pages). Nouvelle fonction
`removeOverrideForDate(formData)` — variante de `removeOverride`
adressée par date plutôt que par id opaque, puisque le calendrier
connaît la date éditée mais pas l'id de la ligne en base ; même
contrainte unique, même garde-fou d'appartenance.

**Toujours une exception ponctuelle, jamais le planning hebdo** :
taper un créneau crée/modifie uniquement `AvailabilityOverride` pour ce
jour précis — `WeeklyAvailability` (planning hebdo récurrent) n'est
jamais touché depuis le calendrier, conformément à la demande ("reste
sur `/disponibilites`"). Un badge `📌 Exception ce jour` s'affiche sur
la journée ouverte dès qu'une exception existe, pour que la distinction
hebdo/ponctuel reste visible sans ambiguïté.

**Rendu** : en mode édition, chaque heure devient un `<button>` (bordure
pointillée accent, `active:scale-95` au tap) au lieu d'un `<div>`
statique ; la disponibilité affichée est recalculée en direct côté
client via `isAvailableAt(instant, ownWeeklySlots, localOverride)` — la
même fonction pure que le serveur, réutilisée telle quelle plutôt que de
patcher l'état local de façon incrémentale, pour garantir que l'heure
"libérée" par un déplacement d'exception affiche toujours la bonne
valeur (celle dérivée du planning hebdo) sans requête supplémentaire.
État optimiste (`localOverride`, mis à jour immédiatement au tap, server
action en arrière-plan via `startTransition`) — même pattern que
`TierlistBoard`/`ActionForm`, pas de `router.refresh()`.

Le geste de swipe jour précédent/suivant (sous-PR 1.5) reste inchangé et
ne rentre pas en conflit avec le tap : son seuil de détection (50px)
exclut naturellement les taps courts.

**Hors périmètre** (comme demandé) : pas de glisser-déposer pour étendre
une plage horaire (le tap seul suffit sur mobile) ; pas de création de
session depuis le calendrier ; pas d'édition du planning hebdomadaire
récurrent depuis le calendrier (reste sur `/disponibilites`) — ces
points sont prévus pour la sous-PR 3/3.

### Fichiers touchés

- `src/app/disponibilites/actions.ts` — `revalidatePath("/calendrier")`
  ajouté sur `upsertOverride`/`removeOverride` ; nouvelle fonction
  `removeOverrideForDate`
- `src/app/calendrier/page.tsx` — calcul de `canEdit`, requêtes
  `ownWeeklySlots`/`ownOverrideForDay` (gated, aucun coût hors vue
  éditable), props passées à `DayTimeline`
- `src/components/calendar/DayTimeline.tsx` — mode édition (`editMode`),
  état optimiste (`localOverride`), `handleTapHour`, rendu
  bouton/div conditionnel, badge exception

### Vérification

- `npx eslint .` : clean
- `npx next build` : compile et type-check sans erreur (mêmes routes
  qu'avant, inchangées)
- Smoke test `next dev` : `/calendrier` et `/calendrier?mode=individuel`
  répondent 307 (non connecté, cohérent avec le sandbox sans
  `AUTH_SECRET`/DB live) sans erreur d'application ; le tap-to-persist
  réel n'a pas pu être exercé en sandbox (pas de session/DB), seule
  l'atteignabilité de la route et l'absence de crash sont vérifiées ici,
  comme pour les PR précédentes de ce chantier
- `.next`/`AGENTS.md`/`CLAUDE.md` nettoyés avant commit
- Non-régression : lecture seule inchangée en Collectif et en Individuel
  sur un pote ; `MiniMonthCalendar`, surlignage meilleur créneau
  collectif, couleurs perso (sous-PR précédente), swipe jour
  précédent/suivant tous inchangés ; aucune migration

## Sessions interactives sur le calendrier (sous-PR 3/3)

Dernière étape du chantier calendrier : les soirées deviennent
interactives depuis `/calendrier`, sans dupliquer aucune logique
existante — panneau détaillé au tap sur une session, création rapide au
tap sur un créneau libre.

**Correction de route repérée avant codage** : la demande initiale visait
`/soirees/creer`, qui n'existe pas — le formulaire de création est
**inline** en haut de `/sessions` (le mot-clé code reste "sessions", même
si l'UI affiche "Soirées"). Réutilisé tel quel plutôt que de créer une
route dédiée.

**1. `src/lib/calendar.ts`** — `CalendarSession` gagne `players:
CalendarUser[]`, les voteurs de la proposition gagnante
(`decidedGameId`) — mêmes "joueurs inscrits" que le "Qui vient" de
l'embed Discord (`src/lib/sessions.ts`). Vide tant qu'aucun jeu n'est
décidé (`VOTING`). Le `select` Prisma sur `votes` gagne juste le
sous-objet `user` (id/discordName/discordAvatar/color) là où seul `id`
était chargé — même requête, pas de coût supplémentaire notable.

**2. `src/components/calendar/SessionBlock.tsx`** (réécriture du
panneau, existant depuis la sous-PR 1) — passe de bottom-sheet à un
**panneau latéral** (`fixed inset-y-0 right-0`, slide-in depuis la
droite via Framer Motion `x: "100%" → 0`). `Dialog.Root` devient
contrôlé (`open`/`onOpenChange`) pour permettre la fermeture
programmatique au swipe (`touchstart`/`touchend`, même seuil ~50px que
le swipe jour de `DayTimeline`, direction : vers la droite) — le tap en
dehors ferme déjà nativement via `Dialog.Overlay` (comportement Radix
par défaut, rien à coder). Icône 🎮 ajoutée sur le bloc trigger dans la
timeline pour le distinguer d'un bloc dispo. `VoterAvatars` (composant
déjà existant, réutilisé tel quel) affiche `session.players` quand la
session a un gagnant. Couleur du badge "Vote en cours" dans le panneau
passée à `bg-warning`/`text-warning` (ambre) — distinct de "Prévue"
(violet accent, inchangé) et "Terminée" (grisé, inchangé) ; changement
scopé à `STATUS_BLOCK_CLASSES` (calendrier uniquement), le badge partagé
`SESSION_STATUS_LABELS` utilisé ailleurs dans l'app (liste des sessions,
fiche détail) n'est pas touché.

**3. `src/components/calendar/DayTimeline.tsx`** — nouvelle interaction :
en vue Individuel, hors mode édition dispo (sous-PR 2), un tap sur une
heure **sans session** ouvre un bottom-sheet "Créer une soirée ici ?"
(un seul `Dialog` partagé, pas une instance par heure) menant vers
`/sessions?date=&time=` préremplis. Disponible sur n'importe quel profil
affiché en Individuel — pas seulement le sien : repérer un créneau libre
chez un pote puis y caler une soirée est un usage voulu, confirmé
explicitement plutôt que restreint à `canEdit`.

**4. `src/app/sessions/page.tsx`** — lecture de `searchParams.date`/`time`
(en plus de `gameId` déjà géré pour la préselection de jeu), passés en
`defaultValue` sur les inputs `date`/`time` du formulaire déjà en place.
Aucune nouvelle validation : `createSession` gère déjà les cas
deadline-après-session et session-trop-proche.

**Aucune migration, aucune nouvelle server action.** Hors périmètre
(comme demandé) : pas de modification/suppression de session depuis le
calendrier, pas de nouveau formulaire de création, pas de glisser-déposer
de sessions.

### Vérification

- `npx eslint .` : clean
- `npx next build` : compile et type-check sans erreur (mêmes routes
  qu'avant, inchangées)
- Smoke test `next dev` : `/calendrier`, `/calendrier?mode=individuel` et
  `/sessions?date=2026-09-05&time=20:00` redirigent vers `/` (non
  connecté, cohérent avec le sandbox sans `AUTH_SECRET`/DB live) sans
  erreur d'application — `/sessions` avec les query params le fait via un
  `<meta http-equiv="refresh">` intégré au flux RSC plutôt qu'un vrai 307
  HTTP, artefact du streaming Turbopack dev quand `redirect()` est
  déclenché après le début de l'envoi de la réponse, pas une régression.
  Le panneau latéral, le swipe-to-close et la création rapide n'ont pas
  pu être exercés interactivement en sandbox (pas de session/DB) — seule
  l'atteignabilité des routes et l'absence de crash sont vérifiées ici,
  comme pour les PR précédentes de ce chantier
- `.next`/`AGENTS.md`/`CLAUDE.md` nettoyés avant commit
- Non-régression : édition tactile des dispos (sous-PR 2), couleurs
  perso (sous-PR précédente), `MiniMonthCalendar`, surlignage meilleur
  créneau collectif, swipe jour précédent/suivant tous inchangés ; liste
  et fiche détail `/sessions` inchangées à part le préremplissage

## Retour terrain sur l'édition tactile — plage horaire + édition en Collectif

Deux améliorations UX remontées après test réel de la sous-PR 3/3
(édition tactile fusionnée à celle-ci plutôt qu'une PR séparée — les deux
retouchent le même fichier `DayTimeline.tsx` sur le même mécanisme
d'édition, une PR à part aurait juste ajouté un conflit de fusion pour
rien).

**Sélection de plage horaire** : un seul tap sélectionnait 1h — trop lent
pour une plage de plusieurs heures (ex. 18h→00h = 6 taps). Nouveau
comportement : 1er tap = ancre "en attente" (opacité réduite sur la
cellule, bouton d'édition affichant "⏳ Tape la fin de la plage…") ; 2e
tap dans les 3s = fin de plage → toute la plage `[min, max]` est basculée
et sauvegardée en **un seul** `upsertOverride` (`startTime`=début,
`endTime`=fin) — respecte la contrainte `@@unique([userId, date])`
(une seule exception par jour) exactement comme le toggle 1h d'origine,
aucun changement de schéma. Sans 2e tap dans la fenêtre, un `setTimeout`
retombe sur le comportement 1h d'origine (l'ancre seule). Le sens du
bascule (dispo → indispo ou l'inverse) suit l'état actuel de l'heure
ancre, appliqué à toute la plage — pas de logique de "majorité" à
inventer sur une plage aux états mixtes. Le timeout est nettoyé au
démontage du composant et à chaque bascule du mode édition (évite qu'une
ancre oubliée ne déclenche une action après coup).

**Édition des dispos en vue Collectif** : le bouton "Modifier mes dispos"
n'apparaissait qu'en Individuel sur sa propre fiche. `canEdit` (calculé
côté page) est maintenant vrai aussi en Collectif — l'édition ne touche
toujours que les dispos de l'utilisateur connecté (mêmes server actions,
même garde-fou côté serveur qui ignore tout `userId` client). La densité
collective (couleur/opacité par heure) ne dépend que de
`availableUserIds` renvoyé par le serveur, jamais de `canEdit`/`editMode`
— donc **inchangée** en mode édition, tout le monde reste visible pendant
qu'on modifie sa propre dispo. Un petit point de la couleur perso
(`ownColor`, nouvelle prop passée depuis `user.color`) marque en plus les
heures où sa propre dispo est active, seul signal sinon invisible tant
qu'on n'a pas tapé (le `title` hover existant montre déjà le compte
collectif "x/y dispos", mais `title` ne fonctionne pas au tactile). Les
blocs des potes restent en lecture seule par construction : la cellule
collective a toujours été un agrégat, jamais un point d'entrée par-pote —
rien à verrouiller de plus.

### Fichiers touchés

- `src/app/calendrier/page.tsx` — `canEdit` étendu au Collectif, nouvelle
  prop `ownColor`
- `src/components/calendar/DayTimeline.tsx` — sélection de plage
  (`pendingStart`/`pendingStartRef`/`pendingTimeoutRef`,
  `applyOverrideRange`), indicateur point perso en Collectif+édition

### Vérification

- `npx eslint .` : clean
- `npx next build` : compile et type-check sans erreur (routes
  inchangées)
- Smoke test `next dev` : `/calendrier` en Collectif et en Individuel
  répondent 307 (non connecté, cohérent avec le sandbox) sans erreur
  d'application. La sélection de plage et l'édition Collectif n'ont pas
  pu être exercées interactivement en sandbox (pas de session/DB) —
  seule l'atteignabilité des routes et l'absence de crash sont
  vérifiées, comme pour les PR précédentes de ce chantier
- `.next`/`AGENTS.md`/`CLAUDE.md` nettoyés avant commit
- Non-régression : toggle 1h d'origine (dégénère naturellement d'une
  plage `[hour, hour]`), édition Individuel sur sa propre fiche, lecture
  seule sur un pote, densité collective, `MiniMonthCalendar`, création
  rapide de soirée, swipe jour précédent/suivant tous inchangés ; aucune
  migration, aucune nouvelle server action

## Retour terrain sur PR #42 — plage sans délai + création en Collectif

Deux ajustements remontés après test de #42 (déjà mergée — nouvelle PR,
pas un ajout de commits dessus).

**Sélection de plage sans timeout** : le délai de 3s pour taper la fin de
plage a été retiré — l'ancre "en attente" (`pendingStart`) reste active
indéfiniment, jusqu'au 2e tap (fin de plage) ou à un bouton **"Annuler"**
désormais affiché à côté du message "⏳ Tape la fin de la plage…" quand
une ancre est posée. Le `setTimeout`/`pendingTimeoutRef` de #42 est
supprimé — plus simple, plus prévisible (pas d'expiration surprise en
pleine réflexion). Toujours pas de drag/glisser : conflit avec le scroll
vertical natif de la timeline sur mobile, même raisonnement que pour le
swipe jour déjà en place.

**Création de soirée déverrouillée en Collectif** : "Créer une soirée
ici ?" ne dépendait que de `mode === "individuel"` — condition retirée,
la seule contrainte reste `!editMode && sessionsAtHour.length === 0`
(aucune session à cette heure, mode édition dispo désactivé). Le mode
édition reste dédié aux dispos dans les deux vues ; hors de ce mode, un
tap sur une heure libre propose systématiquement la création, qu'on soit
en Individuel ou en Collectif.

### Fichiers touchés

- `src/components/calendar/DayTimeline.tsx` — suppression du timeout de
  plage (`RANGE_SELECT_WINDOW_MS`/`pendingTimeoutRef`), bouton "Annuler"
  à côté du message d'attente, `canPromptCreate`/`handleTapEmptyHour`
  ouverts au Collectif

### Vérification

- `npx eslint .` : clean
- `npx next build` : compile et type-check sans erreur (routes
  inchangées)
- Smoke test `next dev` : `/calendrier` en Collectif et en Individuel
  répondent 307 (non connecté, cohérent avec le sandbox) sans erreur
  d'application. Le comportement sans timeout, le bouton "Annuler" et la
  création rapide en Collectif n'ont pas pu être exercés interactivement
  en sandbox (pas de session/DB) — seule l'atteignabilité des routes et
  l'absence de crash sont vérifiées
- `.next`/`AGENTS.md`/`CLAUDE.md` nettoyés avant commit
- Non-régression : sélection de plage (2e tap), toggle 1h (dégénère
  d'une plage `[hour, hour]`), édition Individuel/Collectif, densité
  collective, point perso, `MiniMonthCalendar`, swipe jour
  précédent/suivant, panneau session tous inchangés ; aucune migration,
  aucune nouvelle server action

## Fix : avatar Discord jamais rafraîchi après la première connexion

Bug remonté : si un utilisateur changeait sa photo de profil Discord,
l'app continuait d'afficher l'ancienne indéfiniment.

**Investigation** : le callback `signIn` (`src/auth.ts`) upsertait déjà
`discordName`/`discordAvatar` avec les valeurs fraîches de l'OAuth à
chaque connexion — ce code était déjà correct, rien à y changer. Le vrai
problème : avec `session: { strategy: "jwt" }`, ce callback ne se
redéclenche qu'à une **vraie reconnexion OAuth** (l'utilisateur retape
ses identifiants Discord) — pas à chaque visite. Le JWT de session reste
valide jusqu'à 30 jours par défaut chez Auth.js, pendant lesquels
l'utilisateur reste "connecté" sans jamais retraverser `signIn`. Un
changement d'avatar Discord pendant cette fenêtre ne se propageait donc
qu'à la prochaine reconnexion complète — potentiellement des semaines
plus tard. Toutes les pages affichent déjà l'avatar depuis la table
`User` en base (jamais depuis le JWT), donc pas de souci de cache
`next/image` : l'URL Discord elle-même change quand l'avatar change (le
hash de l'avatar est dans l'URL), un simple refresh en base suffit.

**Fix** : `src/lib/discord-profile.ts` (nouveau) — `refreshDiscordProfile`
rappelle `GET https://discord.com/api/users/@me` (scope `identify`, déjà
demandé par le provider Discord) et met à jour `discordName`/
`discordAvatar` en base. Réplique exactement le mapping avatar du
provider next-auth (`profile()` dans `@auth/core/providers/discord.ts` —
gère le cas avatar animé `a_*` → `.gif`, et l'avatar par défaut si
`avatar === null`) pour rester cohérent avec ce que `signIn` pose à la
connexion. Best-effort et silencieux : un jeton d'accès expiré (Discord :
~7 jours) ou une erreur réseau logue et laisse les données telles
quelles, sans jamais casser la session.

`src/auth.ts` : le callback `jwt` (qui s'exécute à **chaque** lecture de
session, contrairement à `signIn`) garde le jeton d'accès Discord posé à
la connexion (`account.access_token`) et rappelle
`refreshDiscordProfile` si plus de 12h se sont écoulées depuis le
dernier rafraîchissement (`discordSyncedAt`, même ordre de grandeur que
le throttle de `touchStreak`) — assez fréquent pour propager un
changement d'avatar rapidement, assez rare pour ne jamais peser sur la
latence des pages protégées. `src/types/next-auth.d.ts` étendu avec
`discordAccessToken`/`discordSyncedAt` sur le type `JWT`.

**Limite connue, assumée** : le jeton d'accès Discord expire après ~7
jours (durée de vie standard OAuth2 de Discord) sans flux de
refresh-token — hors périmètre pour ce fix ciblé (ajouterait la gestion
d'un `refresh_token` stocké et sa rotation, complexité et surface de
risque disproportionnées pour ce bug). Au-delà de 7 jours d'inactivité
de connexion, le rafraîchissement périodique s'arrête silencieusement
jusqu'à la prochaine vraie reconnexion — grande amélioration par rapport
à l'état actuel (aucun rafraîchissement possible avant la prochaine
reconnexion, point) sans complexifier l'auth.

### Fichiers touchés

- `src/lib/discord-profile.ts` (nouveau) — `refreshDiscordProfile` +
  mapping avatar répliqué du provider Discord
- `src/auth.ts` — callback `jwt` : conservation du jeton d'accès,
  rafraîchissement throttlé (12h)
- `src/types/next-auth.d.ts` — `discordAccessToken`/`discordSyncedAt`
  sur `JWT`

### Vérification

- `npx eslint .` : clean
- `npx next build` : compile et type-check sans erreur (routes
  inchangées)
- Smoke test `next dev` : `/` répond 200, `/profil` redirige 307 (non
  connecté, cohérent avec le sandbox) sans erreur d'application. Le
  rafraîchissement réel (appel Discord `/users/@me`, upsert en base)
  n'a pas pu être exercé en sandbox (pas de session Discord/DB live) —
  seule l'absence d'erreur de compilation/exécution est vérifiée, comme
  pour les PR précédentes
- `.next`/`AGENTS.md`/`CLAUDE.md` nettoyés avant commit
- Non-régression : callback `signIn` inchangé (upsert à la connexion
  toujours identique), callback `session` inchangé, connexion/déconnexion
  Discord inchangées ; aucune migration (aucun nouveau champ `User`, le
  throttle vit uniquement dans le JWT)

## Refonte de la home (`/`)

La home ne montrait jusqu'ici que "Prochaine soirée" + "Ta bibliothèque" +
2 boutons — trop vide pour une app pensée pour être consultée souvent.
Refonte complète en 6 sections (dans cet ordre), chacune dans sa propre
card, avec une entrée en fondu + translation Framer Motion (stagger
~100ms entre cards) :

1. **Header perso** — `RankAvatar` (anneau coloré par rang + pastille de
   niveau, déjà utilisé sur `/profil` et `/potes/[id]`) à la place du
   simple avatar rond, + ligne "Niveau X · Titre · Rang" en dessous du
   pseudo.
2. **Prochaine soirée** — cover IGDB en fond de card (jeu décidé si
   `SCHEDULED`, sinon la proposition la plus votée en `VOTING`, avec
   dégradé pour garder le texte lisible), + nombre de "joueurs inscrits"
   (voteurs de la proposition gagnante une fois le jeu tranché, sinon tous
   les voteurs toutes propositions confondues pendant le vote — même sens
   que le "Qui vient" Discord déjà utilisé côté annonces/calendrier).
   Reste un lien vers `/sessions/[id]` (pas `/soirees/[id]`, qui n'existe
   pas dans le routing de l'app).
3. **Activité récente** — fusion des 4 types d'événements déjà horodatés
   en base (soirées terminées, badges débloqués, récompenses gagnées,
   passages de niveau), 5 plus récents tous types confondus, sans
   pagination. Les passages de niveau n'étaient auparavant **pas persistés**
   (seulement une notif Discord ponctuelle) : nouveau modèle
   `LevelUpEvent` (append-only, écrit uniquement par le chemin XP live
   `awardXp()`, jamais par le script de backfill `backfill-xp.mjs` qui ne
   passe pas par cette fonction — vérifié avant d'écrire le modèle pour
   éviter tout risque de flood d'événements historiques au prochain
   build).
4. **Stats du groupe** — total de soirées jouées, jeu le plus joué (avec
   cover), meilleur streak actif (fenêtre 24h, alignée sur le seuil de
   cassure de `touchStreak`), nombre de joueurs actifs (fenêtre plus
   large de 7 jours — un pote silencieux depuis 2 jours n'a pas
   "disparu" du groupe, il n'a juste plus de streak en cours).
5. **Dispos de la semaine** — 7 colonnes Lun→Dim (semaine calendaire
   contenant aujourd'hui, pas un rolling 7 jours), dispo "du soir" (20h,
   même heure repère que la timeline calendrier) par jour, meilleur jour
   surligné en violet, tap → `/calendrier?date=...`.
6. **Classement rapide** — podium top 3 compact, composant `PodiumSpot`
   extrait de `/classement` (comportement inchangé sur `/classement`,
   maintenant partagé) + lien "Voir tout" vers `/classement`.

La card "Ta bibliothèque" est retirée de la home (pas dans la liste des 6
sections demandées) — `/bibliotheque` reste accessible depuis la nav
principale, rien n'est perdu en découvrabilité. Les boutons "Mes dispos"
et "Soirées" restent en bas de page ; "Se déconnecter" inchangé.

### Nouveau : `LevelUpEvent`

```prisma
model LevelUpEvent {
  id        String   @id @default(cuid())
  userId    String
  level     Int
  createdAt DateTime @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([createdAt])
}
```

Écrit dans `awardXp()` (`src/lib/xp-actions.ts`) juste à côté de la notif
Discord existante (même détection `afterLevel > beforeLevel`) — aucun
autre appelant. Pas de backfill rétroactif : les passages de niveau
antérieurs à cette PR n'apparaîtront pas dans le feed (acceptable, un feed
d'activité "récente" n'a pas vocation à reconstruire l'historique complet).

### Fichiers touchés

- `prisma/schema.prisma` + migration `20260901140000_add_level_up_event`
  — modèle `LevelUpEvent` + relation sur `User`
- `src/lib/xp-actions.ts` — `awardXp()` persiste désormais un
  `LevelUpEvent` en plus de la notif Discord
- `src/lib/home.ts` (nouveau) — `getRecentActivity`, `getGroupStats`,
  `getWeekAvailability`, dédiées à `/`
- `src/lib/calendar-dates.ts` — `getWeekStart` exporté (déjà interne,
  réutilisé par `getWeekAvailability`)
- `src/components/PodiumSpot.tsx` (nouveau) — extrait de
  `/classement/page.tsx` à l'identique
- `src/app/classement/page.tsx` — utilise `PodiumSpot` partagé,
  définition locale supprimée
- `src/components/motion.tsx` — `Stagger` accepte un `staggerDelay`
  optionnel (défaut 0.04 inchangé pour tous les appelants existants),
  utilisé à 0.1 sur la home pour un stagger ~100ms entre les 6 cards
- `src/lib/wallclock.ts` — `nowMs()` (nouveau) : isolation de
  `Date.now()` dans une fonction nommée, requis par le lint
  `react-hooks/purity` qui interdit l'appel direct dans le corps d'un
  composant
- `src/app/page.tsx` — réécriture complète des 6 sections

### Vérification

- `npx eslint .` : clean
- `npx next build` : compile et type-check sans erreur, toutes les
  routes existantes inchangées
- Smoke test `next dev` : `/` répond 200 (page de connexion, non
  authentifié en sandbox), `/classement` redirige 307 (cohérent, non
  connecté) — aucune erreur d'application dans les logs. Les 6 nouvelles
  sections de la home authentifiée (cover IGDB, activité récente, stats
  du groupe, dispos de la semaine, podium) n'ont pas pu être exercées
  visuellement en sandbox (pas de session Discord ni de `DATABASE_URL`
  live) — seules l'absence d'erreur de compilation/exécution et la
  cohérence des types via `next build` sont vérifiées, comme pour les PR
  précédentes de ce type
- `.next`/`AGENTS.md`/`CLAUDE.md` nettoyés avant commit
- Non-régression : `/classement` rendu identique (podium + tableau
  inchangés, seule l'implémentation de `PodiumSpot` a bougé de fichier) ;
  `Stagger`/`StaggerItem` par défaut inchangés pour les 17 autres pages
  qui les utilisent (`staggerDelay` optionnel, défaut conservé) ;
  `awardXp()` garde exactement son comportement XP/notif Discord existant,
  ajoute uniquement une écriture `LevelUpEvent` en plus

## Ping sélectif à la création d'une soirée

Jusqu'ici, créer une soirée mentionnait automatiquement tout le groupe
(sauf les users en silence). Le créateur peut désormais choisir, dans un
nouveau champ "Qui prévenir ?" du formulaire de création, qui reçoit la
mention Discord — pratique pour une soirée réservée à un sous-groupe.

**Stockage** : `Session.notifiedUserIds` (`Json?`, additif). `null` = pas
de restriction, comportement historique préservé pour **toute session
créée avant cette PR** (aucun backfill nécessaire, la colonne reste
`null` pour l'existant). Un tableau — même vide — est la sélection
explicite faite au formulaire, respectée littéralement : tout décocher
mentionne bien personne, sans repli silencieux sur "tout le monde" (même
philosophie que `reminderTimings`, PR 31). `Json?` plutôt que `String[]?`
: Prisma interdit les listes scalaires optionnelles, seul `Json` supporte
la distinction "non renseigné" vs "tableau vide" nécessaire ici — pas de
table de relation, un simple filtre de mentions n'a pas besoin
d'intégrité référentielle.

**UI** (`src/components/NotifyRecipientsField.tsx`) : liste compacte des
potes (avatar + pseudo + `ColorDot`), tous cochés par défaut, boutons
"Tout sélectionner"/"Tout désélectionner", entrée en fondu via
`Stagger`/`StaggerItem` existants. Même pattern que
`ReminderTimingsField` (état React local, checkboxes `notifyUserId` lues
depuis le `FormData` à la soumission, `src/lib/notify-recipients.ts` pour
le parsing).

**Filtre appliqué aux 3 notifications concernées** — un pote décoché à la
création n'est mentionné nulle part pour cette soirée :
- **Création** (`announceSessionCreated`) — restreint le ping de tout le
  groupe à la sélection.
- **Clôture/validation** (`announceSessionResult`) — restreint les
  mentions des votants du jeu gagnant à la sélection (le compteur
  "Joueurs" reste inchangé, c'est un fait — qui vient réellement — pas
  lié à qui est notifié ; le champ "Qui vient" distingue maintenant "0
  votant" de "des votants, mais aucun à mentionner").
- **Rappels** (`sendSessionReminder`) — s'ajoute par-dessus le filtre
  existant (seuls les votants du jeu gagnant sont déjà mentionnés) :
  intersection avec la sélection.

**Hors périmètre, volontairement** : la notif "soirée modifiée"
(`announceSessionModified`, changement de créneau) n'est pas concernée —
elle ne mentionne déjà que les votants, sans lien avec cette sélection,
et n'était pas demandée.

### Fichiers touchés

- `prisma/schema.prisma` + migration `20260901150000_add_session_notified_user_ids`
  — `Session.notifiedUserIds`
- `src/lib/notify-recipients.ts` (nouveau) — parsing formulaire +
  résolution du champ `Json` stocké
- `src/components/NotifyRecipientsField.tsx` (nouveau)
- `src/app/sessions/page.tsx` — fetch des potes + intégration du champ
- `src/app/sessions/actions.ts` — `createSession` stocke la sélection
- `src/lib/discord-session-created.ts`, `src/lib/discord-announce.ts`,
  `src/lib/discord-reminder.ts` — filtre appliqué aux mentions

### Vérification

- `npx eslint .` : clean
- `npx next build` : compile et type-check sans erreur, toutes les
  routes existantes inchangées
- Smoke test `next dev` : `/` et `/sessions` répondent sans erreur
  d'application (non authentifié en sandbox, redirection vers `/`) —
  aucune erreur liée aux nouveaux fichiers dans les logs. Le
  comportement réel des mentions Discord (webhook, filtre appliqué) n'a
  pas pu être exercé en sandbox (pas de session/DB live ni de
  `DISCORD_WEBHOOK_URL`) — seules l'absence d'erreur de
  compilation/exécution et la cohérence des types sont vérifiées, comme
  pour les PR précédentes touchant Discord
- `.next`/`AGENTS.md`/`CLAUDE.md` nettoyés avant commit
- Non-régression : toute session créée avant cette PR garde
  `notifiedUserIds: null` → comportement de ping identique à avant
  (tout le groupe, sauf `silenceReminders`) sur les 3 points modifiés ;
  `announceSessionModified` non touché ; `winner.votes.length` (compteur
  "Joueurs") non filtré, reste un fait indépendant du ping

## Pages d'erreur custom (Sprint 1 v2, fiabilisation)

L'app utilisait jusqu'ici les pages 404/500 par défaut de Next — hors
identité GameNight, et sans logging exploitable côté 500. Trois fichiers
racine (conventions App Router, aucun routing à câbler) :

- **`src/app/not-found.tsx`** — 404 brandée ("Cette page a rage quit 🎮",
  emoji manette animé — léger shake en boucle). Déclenchée aussi bien par
  une route inexistante que par les `notFound()` déjà en place (fiche
  jeu/pote/session introuvable), sans rien changer à ces appels
  existants. Bouton "Retour à l'accueil".
- **`src/app/error.tsx`** — error boundary racine ("Le serveur a crash
  💀 On respawn bientôt"). Client Component imposé par Next (`error`/
  `reset` passés en props par le framework) ; `console.error(error)`
  dans un `useEffect` pour que Vercel Logs capture l'erreur en prod.
  Deux boutons : "Réessayer" (`reset()`, retente le rendu du segment
  sans recharger toute la page) et "Retour à l'accueil". Ne capture pas
  les erreurs du layout racine lui-même (Header, `auth()`) — nécessiterait
  un `global-error.tsx` séparé, hors périmètre demandé.
- **`src/app/loading.tsx`** — Suspense global, spinner + logo GameNight.
  Volontairement un Server Component sans Framer Motion : seulement des
  animations CSS Tailwind natives (`animate-spin`/`animate-pulse`), qui
  s'affichent dès le premier octet streamé par le serveur, avant même
  l'hydratation JS — un écran de chargement ne doit pas lui-même
  attendre un bundle client pour apparaître. `role="status"` +
  texte `sr-only` pour les lecteurs d'écran.

Les trois réutilisent `.bg-hero-gradient` (déjà utilisé sur l'écran de
connexion) et les composants `Button`/`ButtonLink` existants — aucun
nouveau composant partagé, pas de nouvelle classe CSS. `MotionConfig
reducedMotion="user"` (déjà posé dans `layout.tsx`) désactive
automatiquement les animations Framer Motion de `not-found.tsx`/
`error.tsx` pour `prefers-reduced-motion` — pas de gestion manuelle
nécessaire.

### Fichiers touchés

- `src/app/not-found.tsx` (nouveau)
- `src/app/error.tsx` (nouveau)
- `src/app/loading.tsx` (nouveau)

### Vérification

- `npx eslint .` : clean
- `npx next build` : compile et type-check sans erreur ; `/_not-found`
  apparaît dans la liste des routes générées, toutes les routes
  existantes inchangées
- Smoke test `next dev` : une route inexistante répond bien `404` et
  affiche le contenu brandé ("Cette page a rage quit", "Retour à
  l'accueil") ; `/` répond `200` sans régression — aucune erreur
  d'application dans les logs. `error.tsx` (déclenché uniquement par une
  vraie exception de rendu) et `loading.tsx` (fenêtre de streaming très
  courte en local) n'ont pas pu être exercés visuellement en sandbox —
  vérifiés par lecture de code et cohérence TypeScript via `next build`
  uniquement, comme pour les PR précédentes touchant des cas
  difficiles à déclencher manuellement
- `.next`/`AGENTS.md`/`CLAUDE.md` nettoyés avant commit
- Non-régression : les 6 `notFound()` existants (jeu/pote/session
  introuvables) pointent désormais vers cette 404 brandée au lieu de la
  page par défaut de Next, sans changement de leur propre logique ;
  `layout.tsx`, `PageTransition`, `Header`/`BottomNav` inchangés

## Audit des APIs externes (Sprint 1, suite fiabilisation)

Revue de tous les `fetch()` vers Steam Web API, Steam Store, IGDB/Twitch et
Discord (6 fichiers : `src/lib/{steam,steam-store,igdb,discord,discord-profile,deepl}.ts`)
et de tous leurs appelants, pour vérifier qu'aucune panne externe ne peut
faire planter une page.

**Déjà sûr avant cette PR** (vérifié, non modifié) :
- `postToDiscord` (`discord.ts`) et `translateToFrench` (`deepl.ts`) —
  try/catch interne, ne lèvent jamais.
- `refreshDiscordProfile` (`discord-profile.ts`) — try/catch interne.
- `fetchIgdbGameDetails`/`searchIgdbGames`/`fetchSteamStoreDetails` lèvent
  **volontairement** (convention documentée dans ces fichiers) — mais tous
  leurs appelants (`getGameDetails`, `/api/igdb/search`, `family-import.ts`,
  `backfill-steam-coop.ts`, `enrichGamesForCoopFilter`) catchent déjà
  correctement, avec repli sur le cache DB existant ou un état d'erreur
  explicite. `getGameDetails` en particulier : en cas d'échec IGDB, ressert
  le cache déjà en base (même périmé) s'il existe, sinon `error:
  "fetch_failed"` — exactement le comportement demandé pour IGDB down.

**Deux trous trouvés et corrigés** — les seuls appels Steam Web API
(`verifySteamOpenId`, `importSteamLibrary` → `getOwnedGames`) qui n'étaient
catchés nulle part :
- `src/app/api/steam/callback/route.ts` — une panne Steam pendant le
  callback OAuth faisait planter toute la route (500 brut) au lieu d'un
  retour propre à `/profil/parametres`.
- `src/app/actions.ts` (`reimportSteamLibrary`) — même trou sur le bouton
  "Réimporter ma bibliothèque Steam".

Les deux sont maintenant enveloppés dans un `try/catch` qui redirige vers
`/profil/parametres?steam=indisponible` (nouvelle valeur, distincte de
`steam=erreur` qui reste réservée à un échec de vérification OpenID) —
`.bibliotheque` continue d'afficher les jeux déjà en base sans interruption
puisque cette page ne fait aucun appel Steam live.

**`<ApiErrorBanner />`** (`src/components/ApiErrorBanner.tsx`, nouveau) —
composant réutilisable demandé : bandeau ⚠️ + message + bouton "Réessayer"
optionnel, fond `bg-warning/10` / bordure `border-warning/40` (cohérent
avec le token `--warning` déjà utilisé ailleurs). Purement présentatif —
pas d'état interne : il "disparaît automatiquement" simplement parce que
l'appelant arrête de le rendre une fois son erreur résolue. `onRetry`
accepte indifféremment une fonction cliente locale ou une server action
passée en prop (même pattern que `ActionForm.tsx` déjà existant). Cablé à
3 endroits réels :
- `AjouterJeuForm.tsx` — remplace le message d'erreur texte de la
  recherche IGDB, retry = relance la recherche.
- `/jeux/[id]` — remplace le message "IGDB injoignable" de
  `GameIgdbSection`, sans retry (le bouton "Rafraîchir les infos" déjà
  présent sur la page fait déjà ce rôle).
- `/profil/parametres` — nouvel état `steam=indisponible`, retry =
  `reimportSteamLibrary` (seulement si un compte Steam est déjà lié,
  sinon pas de bouton pertinent).

**Discord (toast) — délibérément inchangé.** La demande évoque un toast
"Notif Discord non envoyée" pour une action directe, mais toutes les
actions qui postent dans Discord (création/modification/clôture/renvoi de
session) redirigent déjà après coup et affichent un bandeau inline via
`?discord=echec` sur `/sessions/[id]` — `ActionForm.tsx` documente
explicitement pourquoi un toast n'est pas utilisé sur une action qui
redirige (pas le temps de s'afficher avant le changement de page). Ce
mécanisme existant couvre déjà 100% des actions Discord "directes" de
l'app ; l'action n'est jamais bloquée par un échec d'envoi (déjà vrai
avant cette PR). Remplacer ce pattern documenté par un toast aurait été
une régression de cohérence sans gain fonctionnel.

### Fichiers touchés

- `src/components/ApiErrorBanner.tsx` (nouveau)
- `src/app/api/steam/callback/route.ts` — try/catch autour de
  `verifySteamOpenId`/`importSteamLibrary`
- `src/app/actions.ts` — try/catch dans `reimportSteamLibrary`
- `src/app/profil/parametres/page.tsx` — nouvel état `steam=indisponible`
  via `<ApiErrorBanner>`
- `src/components/AjouterJeuForm.tsx` — `<ApiErrorBanner>` pour l'échec de
  recherche IGDB
- `src/app/jeux/[id]/page.tsx` — `<ApiErrorBanner>` pour l'échec IGDB de
  la fiche jeu

### Vérification

- `npx eslint .` : clean
- `npx next build` : compile et type-check sans erreur, toutes les routes
  existantes inchangées
- Smoke test `next dev` : `/` et `/bibliotheque/ajouter` répondent `200`
  sans erreur d'application dans les logs. Une vraie panne Steam/IGDB n'a
  pas pu être simulée en sandbox (pas d'accès réseau externe) — les
  chemins d'erreur ont été vérifiés par lecture de code (`try/catch`
  autour de chaque appel réseau non catché trouvé par l'audit) et
  cohérence TypeScript via `next build`
- `.next`/`AGENTS.md`/`CLAUDE.md` nettoyés avant commit
- Non-régression : tous les chemins de succès (import Steam, recherche
  IGDB, fiche jeu) inchangés — seuls les chemins d'échec, auparavant non
  catchés à ces deux endroits, sont désormais gérés ; `steam=erreur`/
  `steam=importe`/`steam=prive` conservent exactement leur comportement
  existant

## Rate limiting sur les server actions (Sprint 1, suite fiabilisation)

Rien n'empêchait jusqu'ici un client de spammer un bouton (vote, création
de soirée, dispo…) et d'envoyer des dizaines de requêtes DB en quelques
secondes. Objectif : un rate limit léger sur toutes les actions qui
écrivent en base suite à un clic utilisateur — sans dépendance externe
(pas de Redis, pas de service payant).

**`src/lib/rate-limit.ts` (nouveau)** — `checkRateLimit(userId, action,
{limit, windowMs}?)`, `Map` en mémoire du process. Clé = `action:userId`
(fenêtre glissante — chaque bucket garde les timestamps récents, élagués à
chaque appel, pour éviter le double-burst à la frontière de deux fenêtres
qu'un simple compteur à fenêtre fixe autoriserait). Défaut : 10
requêtes/minute par action et par user.

Deux écarts assumés par rapport à l'énoncé, documentés dans le fichier :
- **Clé `userId` seul, pas `IP + userId`** : toutes les actions ciblées
  passent déjà par `getCurrentUser()` avant d'atteindre le contrôle —
  l'utilisateur Discord authentifié est une clé plus stable et plus
  significative que l'IP pour une app à ~6 users, et il n'y a pas
  d'action pré-auth à protéger ici.
- **Reset au cold start Vercel serverless** : chaque instance a son
  propre compteur, remis à zéro à chaque cold start — acceptable à cette
  échelle (explicitement toléré par la demande), pas un oubli.

**Aucun throw.** `checkRateLimit` renvoie `false`, jamais d'exception : un
throw dans une server action invoquée depuis un `<form action=…>` sans
wrapper client remonterait jusqu'à `error.tsx` (bien trop sévère pour "tu
vas un peu vite"), et Next.js peut assainir le message d'une erreur levée
côté serveur en prod, rendant `instanceof`/`.message` peu fiables côté
client. À la place, réutilisation du pattern déjà établi dans l'app
(`updateGame` → `{ ok, error? }`) partout où c'est pertinent.

**Deux traitements, selon comment l'action est invoquée** (vérifié
composant par composant avant de choisir, pour ne jamais changer la
signature d'une action encore utilisée par un `<form action={fn}>` brut —
React attend `void | Promise<void>` dans ce cas, pas un type de retour) :
- **Traitement complet** (résultat `{ ok, error? }` + toast différencié
  "Doucement ! Trop de requêtes, réessaie dans quelques secondes.") sur
  les actions explicitement citées par la demande et déjà invoquées via
  `ActionForm`/`useTransition` : `createSession`, `toggleVote`
  (`VoteButton`, avec annulation du vote optimiste en cas de rate limit),
  `addWeeklySlot`/`upsertOverride`/`removeOverrideForDate`
  (`disponibilites`, `DayTimeline`), `updateGame` (`EditGameDialog`).
- **Garde silencieuse** (`if (!checkRateLimit(...)) return;`, même
  convention que les autres retours anticipés déjà présents dans ces
  actions pour un id manquant/invalide) sur tout le reste des actions
  d'écriture déclenchées par une action utilisateur directe :
  `editSessionAction`, `proposeGame`, `withdrawProposalAction`,
  `closeSessionAction`, `resendDiscordAction`, `cancelSessionAction`,
  `deleteSessionAction`, `markSessionDoneAction`,
  `submitSessionResultsAction`, `submitSuperlativeVotesAction`,
  `forceCloseSuperlativeVotingAction`, `removeWeeklySlot`,
  `removeOverride`, `addManualGame`, `toggleGameCoop`, `removeUserGame`,
  `reimportSteamLibrary`, `enrichGamesForCoopFilter`,
  `setToVerifierGamePlayInfo`, `ignoreToVerifierGame`,
  `batchMarkGamesCoop`, `refreshGameDetails`, `updateUserColor`,
  `toggleSilenceReminders`, `setBannerUrlAction`, `uploadBannerAction`.
  Pas de nouvel affichage différencié pour ces actions-là : couverture
  complète contre le spam DB sans élargir la surface UI au-delà de ce que
  demande le rate limiting lui-même (PR ciblée).

**Deux exceptions délibérées** :
- `setGameTierAction` (`/tierlist`, drag-and-drop) — limite relevée à
  60/min : un classement complet de bibliothèque déclenche légitimement
  bien plus de 10 dépôts par minute, ce n'est pas un vecteur de spam
  comparable à un bouton de vote.
- `matchFamilyImportBatch` (import familial) — **exemptée entièrement** :
  déjà auto-bornée par lots (`FAMILY_IMPORT_BATCH_SIZE`), séquentielle et
  cadencée côté client — un import légitime de plusieurs dizaines de jeux
  dépasserait la limite par défaut sans être du spam.

Non concerné (conformément à la demande) : les crons (déjà protégés par
`CRON_SECRET`), les lectures/pages/chargements, les actions admin.

**`ActionForm.tsx`** — étendu pour accepter un résultat `{ ok, error? }`
en plus du `void` d'origine (rétrocompatible avec tous les appelants
existants) et une prop `errorMessages?: Record<string, string>` pour
mapper une clé d'erreur au message de toast à afficher.

### Fichiers touchés

- `src/lib/rate-limit.ts` (nouveau)
- `src/components/ActionForm.tsx` — support du résultat `{ ok, error? }`
  et de `errorMessages`
- `src/app/sessions/actions.ts`, `src/app/sessions/page.tsx`,
  `src/components/VoteButton.tsx`
- `src/app/disponibilites/actions.ts`, `src/app/disponibilites/page.tsx`,
  `src/components/calendar/DayTimeline.tsx`
- `src/app/actions.ts`, `src/app/bibliotheque/ajouter/page.tsx`,
  `src/components/EditGameDialog.tsx`,
  `src/app/profil/parametres/page.tsx`
- `src/app/bibliotheque/actions.ts`, `src/app/jeux/actions.ts`,
  `src/app/profil/actions.ts`, `src/app/tierlist/actions.ts`,
  `src/app/profil/family-import-actions.ts` (commentaire d'exemption
  seulement, aucun appel ajouté)

### Vérification

- `npx eslint .` : clean
- `npx next build` : compile et type-check sans erreur, toutes les routes
  existantes inchangées
- Smoke test `next dev` : `/`, `/sessions`, `/disponibilites`,
  `/bibliotheque`, `/tierlist`, `/profil/parametres`,
  `/bibliotheque/ajouter` répondent sans erreur d'application (redirection
  serveur normale vers `/` en l'absence de session, sandbox sans
  `AUTH_SECRET`/DB) — aucune régression de compilation introduite par les
  gardes de rate limit
- `.next`/`AGENTS.md`/`CLAUDE.md` nettoyés avant commit
- Non-régression : chaque action garde son comportement exact sous la
  limite (10/min, ou 60/min pour la tierlist) ; seul le comportement
  au-delà de la limite change, et uniquement pour refuser proprement au
  lieu de laisser passer un spam illimité

## Validation zod + logging structuré + tests automatisés (Sprint 1, fiabilisation — suite)

Trois chantiers de fiabilisation indépendants, regroupés dans une seule PR
comme demandé.

### 1. Validation entrées serveur (zod)

**`src/lib/validations.ts`** (nouveau) — schémas zod partagés pour toutes
les server actions ciblées, chacune appelant `schema.safeParse()` en tout
premier. Répartition volontaire zod/logique métier (documentée en tête du
fichier) : zod valide la **forme** (identifiant non vide, date
`YYYY-MM-DD`, heure `HH:mm`, couleur `#RRGGBB`, URL `http(s)://`...) ; les
règles métier qui dépendent de l'état actuel (deadline avant/après la
session, session pas trop proche...) restent dans `resolveSessionSchedule`
— déjà correctes et déjà couvertes par les tests du chantier 3, dupliquer
cette logique dans un schéma séparé aurait été une nouvelle source de
désaccord plutôt qu'une protection.

Deux écarts assumés par rapport à l'énoncé :
- `upsertOverride`/`addWeeklySlot` ne valident **pas** `startTime <
  endTime` en dur — `isAvailableAt` (`src/lib/availability.ts`) supporte
  explicitement un créneau qui traverse minuit (ex. 21:00–00:00) en
  interprétant `endTime <= startTime` comme "jusqu'à minuit puis de
  minuit à endTime". Imposer l'ordre casserait cette fonctionnalité
  existante (zéro régression) — zod valide donc uniquement le format
  `HH:mm`, l'ordre reste géré par `isAvailableAt`.
- `createSession` ne valide **pas** "au moins 1 proposition de jeu" : le
  formulaire réel n'a jamais eu ce champ requis (`gameId` n'est présent,
  optionnel, que si on arrive depuis "Proposer une soirée avec ce jeu"
  sur une fiche jeu) — les propositions s'ajoutent après coup via
  `proposeGame`, c'est le flux nominal de l'app depuis PR #1. Imposer
  cette contrainte aurait cassé la création de soirée standard.

Actions ciblées, avec le même partage à deux niveaux qu'en PR "Rate
limiting" :
- **Traitement complet** (erreur affichée : redirect `?error=...` ou
  `{ok:false,error}` selon comment l'action est déjà invoquée) :
  `createSession` (+ filtre `notifiedUserIds` contre les vrais ids en
  base plutôt que de rejeter toute la création pour un id périmé),
  `editSessionAction`, `toggleVote`, `addWeeklySlot`, `upsertOverride`,
  `removeOverrideForDate`, `addManualGame`, `updateGame`.
- **Garde silencieuse** (même convention que les autres retours anticipés
  déjà présents dans ces actions) : `proposeGame`,
  `withdrawProposalAction`, `submitSuperlativeVotesAction` (validation
  zod de la forme avant les règles métier déjà strictes — self-vote,
  appartenance aux participants), `removeWeeklySlot`, `removeOverride`,
  `toggleGameCoop`, `removeUserGame`, `updateUserColor`,
  `setBannerUrlAction`.

Deux bugs corrigés en passant, révélés par l'ajout de la validation :
`addWeeklySlot`/`upsertOverride`/`removeOverrideForDate` renvoyaient
`{ ok: true }` sur une entrée invalide (date/heure vide ou malformée) —
`ActionForm` affichait alors le toast de succès "Dispo sauvegardée" alors
que rien n'était enregistré. Corrigé : `{ ok: false, error:
"donnees_invalides" }`.

`castVote`/`castSuperlativeVote` : l'auteur du vote n'est jamais lu depuis
`formData`, toujours `getCurrentUser()` — déjà vrai avant ce chantier,
rien à valider de plus sur ce point précis.

### 2. Logging structuré des erreurs

**`src/lib/logger.ts`** (nouveau) — `logger.error(context, error, meta?)`
/ `logger.warn(context, message, meta?)` / `logger.info(context, message,
meta?)`, chacun émettant une ligne JSON `{ timestamp, level, context,
message, meta?, stack? }` via `console.error`/`warn`/`log` (Vercel Logs
capture déjà `console.*` automatiquement — aucun service externe ajouté,
pas de Sentry, pas de LogSnag). `logger.error` accepte indifféremment une
`Error` catchée (message + stack extraits automatiquement) ou un message
texte direct.

Tous les `console.error`/`console.warn`/`console.log` bruts du codebase
(53 occurrences, 19 fichiers) remplacés par des appels au logger, avec un
`context` cohérent par domaine (`steam`, `igdb`, `igdb-match`, `discord`,
`deepl`, `family-import`, `auth`, `message-templates`,
`cron:close-sessions`, `cron:reminders`, `bibliotheque`, `error-boundary`,
`igdb-coop`, `steam-store`) : les 4 crons/routes de backfill, les 6 clients
d'API externes (Steam, Steam Store, IGDB, Discord, DeepL, profil Discord),
les server actions qui catchaient déjà des erreurs, et l'error boundary
racine (`error.tsx`). Dans `auth.ts`, l'import est aliasé `appLogger` pour
ne pas entrer en collision visuelle avec la clé `logger: {...}` de la
config Auth.js elle-même (pas de collision réelle en JS — les clés d'objet
ne masquent pas les identifiants de module — mais gardé pour la lisibilité).

`error.tsx` reste un Client Component (imposé par Next pour un error
boundary) : son `logger.error` s'exécute donc dans le navigateur
(visible en devtools), pas dans les logs serveur Vercel — documenté
explicitement dans le commentaire, pour ne pas laisser croire que Vercel
Logs capture ce cas précis. La quasi-totalité des crashs applicatifs de
l'app passe par une server action ou une route API, déjà loguée côté
serveur avant de remonter jusqu'ici le cas échéant.

### 3. Tests automatisés (vitest)

`npm install -D vitest` + **`vitest.config.mts`** minimal (alias `@/*` →
`src/*`, aucun environnement DOM — uniquement des fonctions pures, pas de
composant React testé). `"test": "vitest run"` ajouté aux scripts.
**70 tests, 0 skip, `npx vitest run` vert.**

Un seul petit refactor pour rendre une logique testable sans dénaturer le
code : le calcul du "meilleur créneau commun" (`bestSlot`), auparavant
mêlé à la boucle de récupération DB de `getCalendarData`
(`src/lib/calendar.ts`), en a été extrait vers une fonction pure
`findBestSlot` dans `src/lib/calendar-dates.ts` (fichier déjà sans import
Prisma, déjà pensé pour être partagé serveur/client) — même
comportement exact, juste un appel en fin de fonction au lieu d'un
tracking `bestSlot`/`maxAvailableCount` mêlé dans la boucle.

Fonctions couvertes (uniquement des fonctions pures — aucune DB, aucun
mock complexe, conformément à la demande) :
- **`wallclock.ts`** : `wallClockNow()` renvoie bien l'heure de Paris et
  pas l'heure UTC (hiver CET +1, été CEST +2), gère correctement les deux
  transitions DST 2026 (passage heure d'été fin mars, heure d'hiver fin
  octobre, vérifiées via `vi.useFakeTimers()`/`setSystemTime`) ;
  `formatDurationFr()` sur les trois paliers (min/h/j) + clamp négatif.
- **`calendar-dates.ts`** : `addDays`, `getWeekStart`, `getMonthGridRange`,
  `buildCalendarHref` (les 4 combinaisons de mode/paramètres), et le
  nouveau `findBestSlot` (créneau max tous jours confondus, `null` si
  personne dispo, `null` sur liste vide, premier créneau gardé en cas
  d'égalité).
- **`session-schedule.ts`** : `resolveSessionSchedule` — cas normal sans
  ajustement, deadline calculée depuis `deadlineOffset`, deadline passée
  repoussée à +30min, deadline ≥ session recalée à session-1min, refus
  session trop proche/déjà passée. (Les cas "0 votant → CANCELLED" et
  "égalité → ancienneté" cités dans la demande vivent dans `closeSession`,
  `src/lib/sessions.ts` — écritures Prisma, hors périmètre "pas de DB".)
- **`xp.ts`** : `xpForLevel`/`levelForXp` (repères documentés + inversion
  exacte aux paliers + pas de saut prématuré), `titleForLevel`/
  `rankForLevel` (paliers + plafond au-delà du dernier), `streakMultiplier`
  (pas de bonus à 0/1, +5 %/jour, plafond +50 % au jour 11).
- **`xp-actions.ts`** : seule `isUniqueConstraintViolation` y est pure
  (`awardXp`/`touchStreak` écrivent en base) — le calcul XP
  base+streak et les seuils de niveau qu'elle utilise sont déjà couverts
  via `xp.ts` ci-dessus, `xp-actions.ts` ne fait que les appliquer avant
  d'écrire.
- **`rate-limit.ts`** : sous la limite → autorisé, au-dessus → refusé,
  reset après la fenêtre glissante (`vi.setSystemTime`), compteurs
  indépendants par action et par user.
- **`validations.ts`** : chaque primitive (id/date/heure/couleur/URL) et
  chaque schéma métier — entrée valide accepte, entrée invalide rejette
  (dont le créneau traversant minuit, volontairement accepté).

### Fichiers touchés

- `src/lib/validations.ts`, `src/lib/logger.ts`, `vitest.config.mts`
  (nouveaux)
- `src/app/sessions/actions.ts`, `src/app/sessions/page.tsx`,
  `src/lib/session-schedule.ts` (chantier 1)
- `src/app/disponibilites/actions.ts`, `src/app/disponibilites/page.tsx`
  (chantier 1)
- `src/app/actions.ts`, `src/app/bibliotheque/ajouter/page.tsx` (chantier 1)
- `src/app/profil/actions.ts` (chantier 1)
- `src/lib/calendar.ts`, `src/lib/calendar-dates.ts` (extraction
  `findBestSlot`, chantier 3)
- 19 fichiers pour le remplacement `console.*` → `logger.*` (chantier 2) :
  `src/auth.ts`, `src/lib/{discord-profile,backfill-igdb-coop,
  family-import,igdb,discord,backfill-steam-coop,game-details,
  message-templates,deepl}.ts`, `src/app/error.tsx`,
  `src/app/bibliotheque/actions.ts`, `src/app/actions.ts`,
  `src/app/api/igdb/search/route.ts`,
  `src/app/api/steam/callback/route.ts`,
  `src/app/api/backfill/{igdb-coop,steam-store}/route.ts`,
  `src/app/api/cron/{close-sessions,reminders}/route.ts`
- 7 fichiers `*.test.ts` (chantier 3) : `wallclock`, `calendar-dates`,
  `session-schedule`, `xp`, `xp-actions`, `rate-limit`, `validations`
- `package.json` (`zod`/`vitest` en dépendances, script `test`)

### Vérification

- `npx eslint .` : clean
- `npx next build` : compile et type-check sans erreur, toutes les routes
  existantes inchangées
- `npx vitest run` : **70 tests, 0 skip, tout vert**
- Smoke test `next dev` : `/`, `/sessions`, `/disponibilites`,
  `/bibliotheque`, `/bibliotheque/ajouter`, `/profil/parametres`,
  `/calendrier`, `/tierlist` répondent sans erreur d'application — logs
  serveur inspectés pour confirmer que le nouveau `logger` structuré
  fonctionne bien en conditions réelles (ex. l'erreur `MissingSecret`
  d'Auth.js, attendue en sandbox sans `AUTH_SECRET`, apparaît bien comme
  une ligne JSON `{"level":"error","context":"auth",...}`)
- `.next`/`AGENTS.md`/`CLAUDE.md` nettoyés avant commit
- Non-régression : toutes les actions gardent leur comportement exact
  pour une entrée valide (seul le chemin d'entrée invalide change, du
  silence ou d'un mauvais message vers une erreur propre) ; `bestSlot` du
  calendrier calcule exactement la même valeur qu'avant l'extraction
  (couvert par `findBestSlot`)

## Sprint 2 — UX/Polish, PR-A (layout desktop + soirées + potes + skeletons + calendrier)

Retours utilisateurs après le Sprint 1 : "trop vide", "trop de scroll",
"espace perdu à gauche/droite sur desktop", "les annulées polluent", "pas
de nombre de participants", "page potes moche", "GIFs pas visibles". PR-A
couvre les 5 chantiers qui ne touchent pas le schéma (layout, onglets
soirées, refonte potes, skeletons, points colorés calendrier) — PR-B
(onboarding premier login, page `/guide`, confettis) suivra une fois
celle-ci mergée, seule à nécessiter une migration Prisma et une nouvelle
dépendance.

### 1. Layout desktop — utiliser l'espace

`max-w-2xl` → `lg:max-w-6xl` (`lg:max-w-5xl` sur `/calendrier`, plus
compact car la timeline reste fondamentalement une liste verticale) sur
les 5 pages principales, avec un `lg:grid` à 2 colonnes qui ne s'active
qu'à partir du breakpoint `lg` — en dessous, tout reste dans l'ordre
d'origine, une seule colonne, aucun changement visuel mobile :

- **Home** (`src/app/page.tsx`) : "Prochaine soirée" + "Stats du groupe"
  côte à côte, puis "Activité récente" + "Dispos de la semaine" côte à
  côte (2 `<div className="lg:grid lg:grid-cols-2">` distincts imbriqués
  dans le `Stagger` existant plutôt qu'un unique grid sur toute la
  section — nécessaire pour garder l'ordre de lecture "1 colonne" correct
  en mobile sans dupliquer le JSX derrière un `hidden lg:block`).
- **Soirées** (`src/app/sessions/page.tsx`) : formulaire de création à
  gauche (`lg:grid-cols-[380px_1fr]`), liste à droite.
- **Classement** (`src/app/classement/page.tsx`) : podium à gauche
  (`lg:sticky lg:top-4` — reste visible pendant le scroll de la liste),
  tableau complet à droite.
- **Potes** (`src/app/potes/page.tsx`) : grille `lg:grid-cols-2` de
  cards (voir section 3).
- **Calendrier** (`src/app/calendrier/page.tsx`) : mini-mois + onglets +
  filtres en colonne de gauche compacte (`lg:grid-cols-[320px_1fr]`),
  timeline du jour à droite. Traitement non explicitement demandé pour
  cette page dans la liste des grilles 2 colonnes, mais élargir le
  `max-w` seul sans grille aurait laissé son problème principal ("espace
  perdu") non résolu — décision assumée.

### 2. Page Soirées — onglets + participants

Onglets **"À venir"** (défaut, sessions `VOTING`+`SCHEDULED`, triées par
date croissante — la requête globale est triée `desc`, re-triée
explicitement pour cette liste car "à venir" doit montrer le plus proche
en premier) et **"Historique"** (`DONE`+`CANCELLED`), pilotés par
`?tab=upcoming|history` — même pattern query-param sans état client que
`/classement?periode=` et `AdminTabs`. Sous-filtre "Afficher les
annulées" dans Historique (`?cancelled=1`, décoché par défaut — un simple
lien qui bascule le query param plutôt qu'une vraie checkbox, cohérent
avec l'absence d'état client de la page).

Chaque card affiche maintenant "X joueur(s) inscrit(s)" avec une pile de
mini-avatars (5 max puis "+N") — même définition de "joueurs inscrits"
que la home (voteurs de la proposition gagnante une fois `decidedGameId`
connu, sinon tous les voteurs). Un composant décoratif local (pas le
`VoterAvatars` existant, qui est interactif/`Dialog` — l'imbriquer dans le
`<Link>` de la card aurait créé un bouton dans un lien) affiche ces
avatars. Couleurs de badge de statut inchangées (`SESSION_STATUS_LABELS`
non modifié).

### 3. Page Potes — refonte visuelle + GIFs

Liste plate → grille de cards (`lg:grid-cols-2` desktop, 1 colonne
mobile) avec, par pote : bannière en haut (même technique
`background-image` CSS que `/profil` — **jamais** `next/image`, seule
manière de garantir qu'un GIF anime réellement plutôt que d'être figé sur
sa première frame), avatar à anneau coloré par rang + pastille de niveau
(reproduction visuelle de `RankAvatar` sans son bouton interactif — le
composant partagé ne peut pas être imbriqué dans le `<Link>` de la card
pour la même raison que `VoterAvatars` ci-dessus), rang, 3 stats rapides
(soirées jouées, XP, streak actif avec `StreakFlame` animée),
`User.color` en bordure de card (`color-mix` avec `var(--border)` à 45%),
lien vers le profil complet. Stagger Framer Motion inchangé (juste
regridé). "Soirées jouées" vient d'une seule requête `groupBy` sur
`XpEvent` (`reason: "PARTICIPATE"`) plutôt que N requêtes par pote — XP
total et streak sont déjà des colonnes `User`, aucune requête
supplémentaire nécessaire pour elles.

### 4. Skeleton loaders

Le composant `<Skeleton />` et les `loading.tsx` `/sessions`,
`/bibliotheque`, `/disponibilites`, `/sessions/[id]` existaient déjà
(Sprint 1 v2) et couvrent déjà "composant réutilisable + Suspense
`loading.tsx`". Ajout des 4 `loading.tsx` manquants pour les pages
retouchées ci-dessus — `/calendrier`, `/classement`, `/profil`, `/potes`
— reproduisant leur nouvelle structure large/regrid (mêmes largeurs
`lg:max-w-*`/`lg:grid-cols-*` que la page réelle, pour qu'il n'y ait pas
de saut de layout au chargement) ; `/sessions/loading.tsx` mis à jour
pour refléter son nouveau layout formulaire/liste. La home (`/`) reste
sur le spinner générique de `src/app/loading.tsx` (Sprint 1 v2) : `/` et
le segment racine coïncidant dans l'App Router, lui donner un skeleton
dédié aurait demandé de déplacer `page.tsx` dans un groupe de routes
`(home)/` — restructuration non demandée et hors scope pour un simple
fallback de chargement.

### 5. Avatars couleur — calendrier collectif

En vue Collectif, hors mode édition, une cellule horaire avec 2+ potes
dispo affiche maintenant leurs ronds `User.color` côte à côte (16px, 4 +
"+N" au-delà de 5) au lieu du fond violet uni — le fond accent/densité
existant (`color-mix` sur `var(--accent)`) reste la base visuelle, les
ronds se superposent par-dessus. Un tap ouvre un bottom-sheet (même
pattern `Dialog` que la création de soirée) listant les pseudos. Ce
nouveau comportement remplace, uniquement pour ces cellules à 2+ potes,
le tap "créer une soirée ici" — qui reste inchangé pour les cellules à
0/1 pote dispo, où voir "qui est dispo" n'apporte rien. Le cas à 1 seul
pote dispo (cellule teintée de sa couleur perso) est inchangé.

### Fichiers modifiés/ajoutés

- `src/app/page.tsx`, `src/app/sessions/page.tsx`,
  `src/app/classement/page.tsx`, `src/app/potes/page.tsx`,
  `src/app/calendrier/page.tsx` — layout desktop
- `src/components/calendar/DayTimeline.tsx` — ronds de couleur +
  bottom-sheet
- `src/app/sessions/loading.tsx` (mis à jour), `src/app/calendrier/loading.tsx`,
  `src/app/classement/loading.tsx`, `src/app/profil/loading.tsx`,
  `src/app/potes/loading.tsx` (nouveaux)

### Vérification

- `npx eslint .` : clean
- `npx next build` : compile et type-check sans erreur, toutes les routes
  existantes inchangées
- `npx vitest run` : 70 tests, 0 skip, tout vert (aucun test touché par
  cette PR, purement UI)
- Smoke test `next dev` : `/`, `/sessions`, `/potes`, `/classement`,
  `/calendrier` répondent 200 sans erreur d'application
- `.next`/`AGENTS.md`/`CLAUDE.md` nettoyés avant commit
- Zéro régression : aucune requête Prisma existante modifiée en dehors
  des `select`/`include` étendus pour les nouveaux besoins d'affichage
  (participants soirées, stats potes) ; aucun champ de schéma touché ;
  mobile (`< lg`) visuellement identique à avant sur les 5 pages
  retouchées

## Sprint 2 — UX/Polish, PR-B (onboarding premier login + guide + confettis)

Suite de PR-A (layout desktop, onglets soirées, refonte potes, skeletons,
calendrier) — les 3 chantiers restants du Sprint 2, isolés dans une
deuxième PR car ils sont les seuls à toucher le schéma (migration
additive) ou ajouter une dépendance (`canvas-confetti`).

### 1. Onboarding premier login (U1)

`User.onboardingCompleted Boolean @default(false)` (migration additive,
`prisma/migrations/20260902100000_add_user_onboarding_completed`) — passe
à `true` dès que l'écran a été vu ou skippé, ne se réaffiche plus jamais
ensuite. `src/lib/onboarding.ts` (`shouldShowOnboarding`) décide de
l'affichage : tant que `onboardingCompleted` est faux (comptes déjà
existants avant cette PR inclus), on ne montre le tutoriel QUE si le
compte n'a strictement rien fait encore — aucune soirée jouée (`XpEvent`
PARTICIPATE, même définition que `getProfileStats`) et aucune dispo
réglée (ni créneau récurrent, ni exception ponctuelle). Un compte plus
ancien qui a déjà de l'activité ne se le voit jamais imposer après coup.

`OnboardingFlow` (`src/components/onboarding/OnboardingFlow.tsx`, client)
— 4 écrans plein écran montés sur la home quand `shouldShowOnboarding`
est vrai : Bienvenue (avatar + pseudo), Règle tes dispos (CTA vers
`/calendrier`), Propose une soirée (CTA vers `/sessions`), C'est parti
(récap XP total + nombre de badges, bouton "Commencer"). Navigation par
swipe horizontal (mêmes seuils que le swipe jour de `DayTimeline`) ou
boutons Précédent/Suivant, "Passer" toujours visible. `completeOnboardingAction`
(`src/app/onboarding-actions.ts`) marque le flag — appelée directement
(pas de `<form>`, un simple clic) et fermée côté client immédiatement
sans attendre la réponse serveur (garde silencieuse, même convention que
les autres actions "toggle" du profil).

### 2. Page "Comment ça marche" (U2)

`/guide` — route statique, 6 sections (Calendrier, Soirées, XP/Rangs/Badges,
Récompenses, Notifications, Profil), icône + 2-3 phrases chacune, stagger
Framer Motion. Accessible via un "?" flottant (`GuideFab`, monté dans le
layout racine, visible sur toutes les pages connectées — `bottom-20` sur
mobile pour rester au-dessus de `BottomNav`, `bottom-6` sur desktop).

### 3. Confettis de célébration (U9)

`canvas-confetti` (+ `@types/canvas-confetti`) installé.
`CelebrationConfetti` (`src/components/CelebrationConfetti.tsx`, client,
monté dans le layout racine) lit `?celebrate=levelup|badge|win` sur
n'importe quelle page via `useSearchParams`, tire les confettis une seule
fois puis nettoie le paramètre avec `history.replaceState` (jamais
`router.replace`, qui redéclenche un re-render inutile pour un simple
nettoyage d'URL).

Déclenchement câblé aux points sûrs où le redirect suivant est vu par
CE MÊME user (jamais dans une boucle qui traite plusieurs participants à
la fois, où on ne sait pas qui va voir la page) :
- `awardXp` (`src/lib/xp-actions.ts`) retourne désormais `{ leveledUp }` ;
  `unlockMatchingBadges`/`unlockBadge`/`checkSessionsCreatedBadges`
  (`src/lib/badges.ts`) retournent `boolean` (badge débloqué ou non). Les
  autres appelants de ces fonctions ignorent simplement la valeur de
  retour — aucun changement de comportement pour eux.
- `createSession` (`src/app/sessions/actions.ts`) : redirige déjà vers
  `/sessions/${session.id}` pour son propre créateur → ajoute
  `?celebrate=badge` (prioritaire) ou `?celebrate=levelup` si l'XP de
  création a fait passer un palier ou débloqué un badge.
- `submitSessionResultsAction` : redirige vers `/sessions/${id}/resultats`,
  vu par le créateur qui vient de saisir le podium. Si LE CRÉATEUR
  lui-même (pas un autre participant) est placé 1er → `?celebrate=win` ;
  sinon `?celebrate=levelup` si son propre bonus XP l'a fait progresser
  de niveau.

Portée assumée : le mécanisme (composant + query param) fonctionne pour
n'importe quel futur point de déclenchement, mais seuls ces 2 câblages
sont posés dans cette PR — `toggleVote`, les rappels dispos et le
level-up déclenché par la clôture d'une soirée (`closeSession`, qui
attribue de l'XP à plusieurs participants d'un coup côté cron, sans
redirection utilisateur individuelle possible) ne déclenchent pas de
confettis, la mécanique de redirection ne s'y prête pas sans refonte plus
large hors scope de cette PR.

### Fichiers modifiés/ajoutés

- `prisma/schema.prisma` + migration `add_user_onboarding_completed`
- `src/lib/onboarding.ts`, `src/app/onboarding-actions.ts`,
  `src/components/onboarding/OnboardingFlow.tsx` (nouveaux)
- `src/app/guide/page.tsx`, `src/components/GuideFab.tsx` (nouveaux)
- `src/components/CelebrationConfetti.tsx` (nouveau)
- `src/lib/xp-actions.ts`, `src/lib/badges.ts` (retours booléens)
- `src/app/sessions/actions.ts` (câblage `?celebrate=`)
- `src/app/page.tsx`, `src/app/layout.tsx` (montage des 3 composants)
- `package.json` (`canvas-confetti` + `@types/canvas-confetti`)

### Vérification

- `npx eslint .` : clean
- `npx next build` : compile et type-check sans erreur, `/guide` apparaît
  dans les routes générées
- `npx vitest run` : 70 tests, 0 skip, tout vert (aucun test existant
  cassé par le changement de signature `awardXp`/badges)
- Smoke test `next dev` : `/`, `/guide`, `/sessions`,
  `/sessions/[id]/resultats` répondent 200 sans erreur d'application
- `.next`/`AGENTS.md`/`CLAUDE.md` nettoyés avant commit
- Zéro régression : tous les appelants existants de `awardXp`/`check*Badges`
  ignorent simplement la nouvelle valeur de retour, comportement inchangé ;
  migration additive (`DEFAULT false`, `NOT NULL`) sans effet sur les
  comptes existants au-delà du nouveau champ

## Sprint 2 PR-B, extension (lien guide + PWA + pull-to-refresh + haptique)

Complète PR-B avant merge : un oubli du chantier "page guide" (lien
profil), plus 3 chantiers Sprint 2 supplémentaires qui ne touchent pas le
schéma — ajoutés sur la même branche/PR (#49, encore ouverte) plutôt que
d'ouvrir une PR séparée qui dépendrait d'elle avant même d'exister.

### Lien "Comment ça marche" depuis le profil

`/profil/parametres` — nouvelle card "Aide" en bas de page avec un bouton
vers `/guide`, en complément du "?" flottant déjà en place.

### PWA basique (U7)

`public/manifest.json` (name/short_name "GameNight", `display:
standalone`, `theme_color` violet `#8b5cf6`, `background_color` sombre)
+ 2 icônes PNG (192/512, générées depuis `src/app/icon.svg` existant via
`sharp`). Câblé dans `src/app/layout.tsx` via l'API `Metadata`/`Viewport`
native de Next (`manifest`, `appleWebApp`, `icons.apple`, `viewport.themeColor`)
plutôt que des balises `<link>`/`<meta>` posées à la main — Next les génère
lui-même dans le `<head>` à partir de ces exports. Volontairement **aucun
service worker** : pas de cache offline, pas de push, juste ce qu'il faut
pour que le bouton "Ajouter à l'écran d'accueil" apparaisse.

### Pull-to-refresh mobile (U6)

`<PullToRefresh>` (`src/components/PullToRefresh.tsx`) — implémentation
maison en `touchstart`/`touchmove`/`touchend` (~60 lignes), zéro
dépendance. Ne s'active que si le geste commence tout en haut de la page
(`window.scrollY === 0`), au-delà de 60px de mouvement vers le bas ;
relâchement → `router.refresh()` + petit indicateur de chargement
(masqué après un délai fixe, `router.refresh()` ne renvoyant pas de
promesse). Wrappe le contenu des 5 pages principales : home, soirées,
calendrier, classement, potes.

### Feedback haptique (U8)

`src/lib/haptics.ts` — `haptics.light/medium/heavy/success()`, fine
couche sur `navigator.vibrate()` (guardée `typeof`, no-op silencieux sur
iOS/Safari/desktop où l'API n'existe pas). Câblé sur : `VoteButton`
(`medium`, à chaque tap voter/dévoter), tap dispo sur le calendrier dans
`DayTimeline` (`light`, uniquement en mode édition — un tap hors édition
ouvre le prompt de création de soirée, pas une dispo), et
`CelebrationConfetti` (`success` — pattern double — pour level up/badge,
un simple `vibrate(200)` pour une victoire de soirée).

### Fichiers modifiés/ajoutés

- `src/app/profil/parametres/page.tsx` (card Aide)
- `public/manifest.json`, `public/icon-192.png`, `public/icon-512.png` (nouveaux)
- `src/app/layout.tsx` (metadata PWA)
- `src/components/PullToRefresh.tsx` (nouveau) + wiring dans `src/app/page.tsx`,
  `src/app/sessions/page.tsx`, `src/app/calendrier/page.tsx`,
  `src/app/classement/page.tsx`, `src/app/potes/page.tsx`
- `src/lib/haptics.ts` (nouveau) + wiring dans `src/components/VoteButton.tsx`,
  `src/components/calendar/DayTimeline.tsx`, `src/components/CelebrationConfetti.tsx`

### Vérification

- `npx eslint .` : clean
- `npx next build` : compile et type-check sans erreur
- `npx vitest run` : 70 tests, 0 skip, tout vert
- Smoke test `next dev` : `/`, `/manifest.json`, `/icon-192.png`,
  `/icon-512.png`, `/sessions`, `/calendrier`, `/classement`, `/potes`,
  `/profil/parametres` répondent 200
- `.next`/`AGENTS.md`/`CLAUDE.md` nettoyés avant commit
- Zéro régression : `PullToRefresh` ne `preventDefault` jamais le scroll
  natif (reste un pur indicateur visuel) ; `haptics.*` no-op silencieux
  partout où `navigator.vibrate` n'existe pas

## Sprint 2 PR-C — son de notification + cloche in-app

Suite de PR-B (mergée) — les 2 derniers chantiers du Sprint 2 UX/Polish,
tous deux nécessitant une migration Prisma (branche redémarrée depuis
`main` à jour après le merge de PR-B).

### Son de notification in-app (U10)

`User.soundEnabled Boolean @default(true)` (migration additive) — toggle
dans `/profil/parametres` (carte "Sons", `toggleSoundEnabled`). N'affecte
que la lecture audio locale : les webhooks Discord et les notifications
in-app elles-mêmes restent écrits en base même son coupé.

2 fichiers `.wav` courts (~0.3-0.5s), **générés** plutôt que trouvés en
ligne (aucun accès réseau fiable en sandbox pour vérifier une licence
libre de droits) — synthèse pure en Node (`Buffer`/en-tête WAV manuel,
sinusoïdes avec fade in/out, zéro dépendance) dans
`public/sounds/{achievement,success}.wav` : `achievement.wav` (3 notes
ascendantes) pour level up/badge, `success.wav` (2 notes, ding) pour une
soirée validée. Joués via `new Audio()` depuis `CelebrationConfetti`
(déjà monté dans le layout racine pour les confettis — même événement
`?celebrate=`, un seul composant déclenche confettis + haptique + son),
`soundEnabled` récupéré une fois dans `layout.tsx` et passé en prop.

### Notifications in-app — cloche (U3)

`Notification` (migration additive) : `userId`, `type` (enum
`NotificationType` : `LEVEL_UP`/`BADGE`/`SESSION_RESULT`/
`SESSION_CREATED`/`REMINDER`), `title`, `message`, `read`, `createdAt`,
`relatedSessionId`/`relatedBadgeId` — ces deux derniers en ids "libres"
**sans** relation Prisma/contrainte FK (une notification doit rester
lisible même si la session référencée est supprimée entre temps par son
créateur, cf. la fonctionnalité de suppression de session existante).

`src/lib/notifications.ts` — `createNotification`/`createNotifications`
(best-effort, jamais bloquant : une erreur d'écriture ici ne doit pas
faire échouer l'action Discord qui vient de réussir, même philosophie que
`postToDiscord` qui ne lève jamais), `getUnreadNotificationCount`,
`listRecentNotifications`, `notificationHref`.

Écriture systématique **en plus** de chaque webhook Discord déjà envoyé
(mêmes destinataires, mêmes données — jamais recalculés séparément) :
- `xp-actions.ts` (`awardXp`, level up) → `LEVEL_UP`
- `badges.ts` (`unlockBadge`) → `BADGE`
- `discord-session-created.ts` (`announceSessionCreated`) → `SESSION_CREATED`,
  mêmes destinataires que les mentions Discord (`others`, déjà filtrés par
  `notifiedUserIds`/`silenceReminders`)
- `discord-announce.ts` (`announceSessionResult`, soirée validée) →
  `SESSION_RESULT`, mêmes destinataires que `notifiedVotes`
- `discord-reminder.ts` (`sendSessionReminder`, cron) → `REMINDER`, mêmes
  destinataires que `players`

`NotificationBell` (`src/components/Header.tsx`) — cloche avec badge
non-lus, panneau en bottom-sheet Radix `Dialog` (même pattern que le
reste de l'app — création de soirée sur le calendrier, liste des
votants — plutôt qu'un nouveau composant dropdown/popover, zéro nouvelle
dépendance). Ouverture du panneau = marque tout comme lu (+ bouton
explicite "Tout marquer comme lu" en plus, redondant mais demandé
explicitement). 20 dernières notifications, lien vers la page concernée
si `relatedSessionId`/`relatedBadgeId`.

Placement assumé, différent de l'énoncé littéral : la cloche est dans le
**header** (sticky, visible à toutes les tailles d'écran) plutôt que
dupliquée dans `BottomNav`, dont la grille à 6 cases est dédiée aux
routes principales — y ajouter un 7e élément non-navigationnel (un
déclencheur de panneau, pas un lien) aurait cassé la cohérence de cette
grille pour un gain d'accessibilité mobile nul (le header reste visible
en scrollant sur toutes les pages).

### Fichiers modifiés/ajoutés

- `prisma/schema.prisma` + migration `add_notifications_and_sound_toggle`
- `src/lib/notifications.ts`, `src/app/notifications-actions.ts` (nouveaux)
- `src/components/NotificationBell.tsx` (nouveau) + wiring dans `src/components/Header.tsx`
- `public/sounds/achievement.wav`, `public/sounds/success.wav` (nouveaux, générés)
- `src/app/profil/actions.ts` (`toggleSoundEnabled`), `src/app/profil/parametres/page.tsx` (carte Sons)
- `src/components/CelebrationConfetti.tsx` (lecture son), `src/app/layout.tsx` (fetch `soundEnabled`)
- `src/lib/xp-actions.ts`, `src/lib/badges.ts`, `src/lib/discord-session-created.ts`,
  `src/lib/discord-announce.ts`, `src/lib/discord-reminder.ts` (écriture `Notification`)

### Vérification

- `npx eslint .` : clean
- `npx next build` : compile et type-check sans erreur
- `npx vitest run` : 70 tests, 0 skip, tout vert
- Smoke test `next dev` : `/`, `/sessions`, `/profil/parametres`,
  `/sounds/achievement.wav`, `/sounds/success.wav` répondent 200
- `.next`/`AGENTS.md`/`CLAUDE.md` nettoyés avant commit
- Zéro régression : `createNotification`/`createNotifications` best-effort
  (loggées, jamais levées) — une panne d'écriture de notification ne peut
  pas casser la création de soirée, le vote, le level up, etc. ; migration
  additive sans effet sur les comptes/sessions existants

## Sprint 3, PR-A — correctifs visuels + Tags + Revanche auto

Retours visuels post-Sprint2 (3 correctifs) + 2 des 6 features "v2" — les
4 restantes (roue du gambling, défis hebdo, achievements de groupe,
dettes/gage) sont trop volumineuses pour la même PR (cf. sections
suivantes, PR-B et PR-C).

### FIX1 — Bouton Guide sur la Home

`ButtonLink` discret ("📖 Guide", variant `ghost`) ajouté juste après
l'en-tête "Salut, [pseudo]" sur `/`, en plus du "?" flottant (`GuideFab`)
déjà en place — les deux coexistent, le bouton texte étant un point
d'entrée plus visible pour un nouvel arrivant que le FAB en coin d'écran.

### FIX2 — Pastilles calendrier collectif : fond neutre

Le remplissage coloré (violet accent avec opacité proportionnelle au
nombre de dispos, ou couleur perso pleine à 1 seul pote dispo) est retiré
des créneaux en vue Collectif de `/calendrier` (`DayTimeline.tsx`) — le
fond redevient neutre (`var(--surface-hover)`) partout en Collectif. Seules
les pastilles de couleur par pote (`ColorDot`, ~16px, overlap façon
GitHub) restent visibles, désormais affichées dès qu'AU MOINS un pote est
dispo (avant : seulement à partir de 2, en dessous de quoi le créneau
proposait la création de soirée au tap). Vue 1 jour inchangée (pas de vue
multi-jours). Vue Individuel non touchée (une seule couleur possible, pas
de surcharge visuelle à corriger).

### FIX3 — Espace Home desktop

Vérifié par audit de code (pas de screenshot possible : aucun accès DB
dans ce sandbox pour un dev smoke test authentifié) — déjà satisfait par
la refonte layout de la PR-A du Sprint 2 : `Card`/`Button`/`Stagger` n'ont
aucune contrainte de largeur, et le conteneur de la home utilise le même
`lg:max-w-6xl` + `lg:grid-cols-2` que `/classement`, `/sessions`, `/potes`.
Aucun changement de code nécessaire.

### FEATURE 6 — Tags/rôles ping

- `Tag`/`UserTag` (migration additive) — tags libres, `Tag.name` unique.
  6 tags par défaut seedés (`prisma/seed-tags.mjs`, idempotent par nom,
  ajouté au script `build`) : FPS, Coop, Compétitif, Chill, Horreur,
  Stratégie. N'importe quel pote peut en créer un nouveau (pas de rôle
  admin dédié, même philosophie que `MessageTemplate`/`SuperlativeCategory`).
- Auto-attribution depuis `/profil/parametres` (nouvelle card "Mes tags") —
  chips togglables (`toggleUserTagAction`) + petit formulaire "+ Ajouter"
  (`createTagAction`, upsert par nom : créer un tag déjà existant
  l'attribue simplement).
- Couleur de chip dérivée du nom (hash déterministe sur la palette de
  `User.color`, cf. `src/lib/tags.ts`) — pas de colonne couleur en base,
  un même tag a toujours la même couleur partout sans état à synchroniser.
- Sélection groupée par tag à la création d'une soirée
  (`NotifyRecipientsField`) : cliquer un chip tag coche d'un coup tous les
  potes qui le portent (ou les décoche tous si déjà tous cochés).
- Chips affichés à côté du pseudo sur les cartes `/potes`.

### FEATURE 3 — Revanche auto

Entièrement dérivé de `SessionResult` existant, aucune nouvelle table.
`src/lib/revanche.ts` (`checkRevancheAfterSessionResults`), appelé juste
après l'enregistrement des résultats (`submitSessionResultsAction`,
best-effort comme les autres écritures de notification) : pour chaque
participant de la session qui vient d'atteindre exactement sa 3e
participation à ce jeu sans jamais avoir été 1er, notifie tous les AUTRES
membres du groupe (jamais le participant concerné lui-même) — notif
`REVANCHE` ("🔄 [Pote] n'a jamais gagné à [Jeu] en 3 parties — proposer une
revanche ?"), qui pointe vers `/sessions?gameId=…` (préremplit la création
de soirée avec ce jeu, mécanisme déjà existant). Ne s'applique qu'aux jeux
compétitifs (`isCoop = false`, seuls à porter un `placement`) ; se déclenche
une seule fois par (pote, jeu) — pas à chaque défaite suivante.

`Notification` étendu (migration additive) : nouvelle valeur d'enum
`REVANCHE` + colonne `relatedGameId` (id "libre", même philosophie que
`relatedSessionId`/`relatedBadgeId`) ; `notificationHref` sait construire
le lien `/sessions?gameId=…` à partir de ce champ.

### Fichiers modifiés/ajoutés

- `src/app/page.tsx` — bouton Guide
- `src/components/calendar/DayTimeline.tsx` — fond neutre + seuil pastilles
- `prisma/schema.prisma` — `Tag`/`UserTag`, `Notification.relatedGameId` +
  `NotificationType.REVANCHE`
- `prisma/migrations/20260902140000_add_tags/`
- `prisma/migrations/20260902150000_add_revanche_notification/`
- `prisma/seed-tags.mjs` (+ wiré dans `npm run build`)
- `src/lib/tags.ts`, `src/app/tags-actions.ts`
- `src/app/profil/parametres/page.tsx` — card "Mes tags"
- `src/components/NotifyRecipientsField.tsx` — sélection groupée par tag
- `src/app/sessions/page.tsx` — fetch tags + tagIds par pote
- `src/app/potes/page.tsx` — chips de tags sur les cartes
- `src/lib/notifications.ts` — `relatedGameId` + `notificationHref`
- `src/lib/revanche.ts` (nouveau)
- `src/app/sessions/actions.ts` — appel `checkRevancheAfterSessionResults`
- `src/components/NotificationBell.tsx` — icône `REVANCHE`

### Vérification

- `npx eslint .` : clean
- `npx next build` : compile et type-check sans erreur
- `npx vitest run` : 70 tests, 0 skip, tout vert
- Pas de dev smoke test authentifié possible (aucun `DATABASE_URL` dans ce
  sandbox) — vérifié par audit de code et build/lint/tests
- `.next`/`AGENTS.md`/`CLAUDE.md` nettoyés avant commit
- Zéro régression : migrations additives, `notificationHref` reste
  rétrocompatible (les 3 champs `relatedX` sont vérifiés dans le même
  ordre, un ancien enregistrement sans `relatedGameId` se comporte
  exactement comme avant)

## Sprint 3, PR-B — Activité compacte + Actu gaming + Roue du gambling

### FIX — Activité récente plus compacte

`getRecentActivity(3)` au lieu de `getRecentActivity(5)` sur la home — la
fonction elle-même n'a pas changé (son paramètre `limit` existait déjà),
seul l'appel change.

### FEATURE — Actu gaming 📰

- `GameNews` (migration additive) — cache des news Steam
  (`ISteamNews/GetNewsForApp/v2`, endpoint public, **aucune clé requise**
  contrairement à `GetOwnedGames` : rien à ajouter à `.env.example`).
  `@@unique([steamAppId, title])` pour l'idempotence.
- `src/lib/steam-news.ts` — `fetchGameNews(steamAppId)`, appel réseau brut.
- `src/lib/backfill-game-news.ts` — `runGameNewsBackfill()` : les 10 jeux
  les plus joués du groupe (le plus de soirées `DONE`, même `groupBy` que
  `getGroupStats`) parmi les jeux `source=STEAM` avec un `steamAppId`
  (jeux IGDB-only skippés silencieusement). Chaque jeu traité
  indépendamment — une erreur réseau sur l'un n'affecte jamais les autres
  ni le cache déjà en base (spec "si l'API est down → actus en cache, pas
  d'erreur").
- `POST /api/backfill/game-news` (202 + `after()`, `CRON_SECRET`) — même
  mécanique que `/api/backfill/igdb-coop`/`/steam-store`. **À ajouter au
  même cron externe quotidien** que ces deux routes (voir § "Configurer
  le cron externe" plus haut) : `https://ton-projet.vercel.app/api/backfill/game-news`,
  `POST`, une fois par jour max — jamais appelé à un chargement de page.
- `getRecentGameNews(5)` (`src/lib/home.ts`) — lit uniquement le cache
  `GameNews`, jamais l'API Steam ; comme le backfill ne peuple cette table
  que pour le top 10 du moment, un simple tri `publishedAt desc` global
  suffit à retrouver "les news des jeux les plus joués".
- Card "📰 Actu gaming" sur la home, après "Activité récente" — mini cover
  (32px) + titre tronqué 1 ligne + jeu + date relative, tap → `feedurl`
  dans un nouvel onglet. **Masquée entièrement** si aucune actu en cache
  (spec).

### FEATURE — Roue du gambling 🎰

- `Session.createdViaRoulette` (migration additive, défaut `false`) —
  pas de table dédiée à la roulette : une roulette EST une session,
  identique en tout point à une session normale une fois le jeu décidé.
- `/roulette` — bouton "🎰 Roulette" sur `/sessions`, en-tête. 2 onglets
  (`?tab=roue` par défaut / `?tab=historique`, même pattern query-param
  que `/sessions?tab=`).
  - **Préparation** : le créateur est auto-participant (non désélectionnable),
    coche d'autres potes (checkboxes + avatars). Pour chaque participant
    sélectionné, une card dédiée permet de chercher/ajouter EXACTEMENT 2
    jeux depuis SA bibliothèque perso (`UserGame.owned=true`) — c'est
    toujours le créateur qui pilote cette UI (pas de session multi-device
    en temps réel dans cette app), donc "choisir pour un pote absent" est
    structurellement la seule interaction possible, pas un mode à part.
    "Lancer la roulette" reste désactivé tant que 2+ participants n'ont
    pas chacun leurs 2 jeux.
  - **La roue** : `RouletteWizard.tsx` (client) — roue en conic-gradient
    (segments = tous les jeux proposés, une couleur par segment sur une
    palette de 8) tournée via `motion.div`/`animate={{ rotate }}` — le
    delta de rotation ajouté est toujours calculé en avant (jamais négatif)
    depuis la rotation accumulée, pour que "Relancer" ne fasse jamais
    sauter la roue en arrière. Tic sonore (`public/sounds/tick.wav`, généré
    par synthèse WAV brute comme `achievement.wav`/`success.wav`) toutes
    les 90ms pendant les 3,6s de rotation si `User.soundEnabled`.
    Confettis (`canvas-confetti`) + `haptics.success()` à l'arrêt.
  - **Résultat** : cover + nom du jeu gagnant, champ date/heure (défaut
    aujourd'hui 20h, calculé côté serveur — jamais `new Date()` côté
    client pendant le rendu), bouton "Créer la soirée"
    (`createSessionFromRouletteAction`) et "Relancer" (respin pur client,
    mêmes jeux/participants, pas de reconfiguration).
- `createSessionFromRouletteAction` (`src/app/roulette/actions.ts`) — crée
  la session directement `SCHEDULED` avec `decidedGameId`/`decidedTime`
  déjà posés (exactement l'état dans lequel `closeSession` laisse une
  session normale une fois le vote clôturé, cf. `src/lib/sessions.ts`),
  PLUS un `Proposal` et un `Vote` par participant sur le jeu gagnant — ça
  fait fonctionner sans aucune modification tout ce qui lit "les votants
  du jeu gagnant" ailleurs (compteur "joueurs inscrits", saisie des
  résultats, vote de superlatifs...). XP `CREATE_SESSION` + check badges
  identiques à `createSession`. Annonce Discord via `announceSessionResult`
  (même embed "🎮 Soirée validée : [Jeu]" que la clôture normale d'un
  vote) plutôt que `announceSessionCreated` — un jeu déjà décidé par la
  roue n'a rien à faire voter.
- Onglet "Historique" — sessions `createdViaRoulette=true`, même style de
  card que `/sessions` (réimplémenté localement plutôt qu'extrait en
  composant partagé, pour ne pas toucher `/sessions` qui fonctionne déjà).

### Fichiers modifiés/ajoutés

- `src/app/page.tsx` — `getRecentActivity(3)`, card "Actu gaming"
- `prisma/schema.prisma` — `GameNews`, `Session.createdViaRoulette`
- `prisma/migrations/20260903100000_add_game_news/`
- `prisma/migrations/20260903100100_add_session_created_via_roulette/`
- `src/lib/steam-news.ts`, `src/lib/backfill-game-news.ts` (nouveaux)
- `src/app/api/backfill/game-news/route.ts` (nouveau)
- `src/lib/home.ts` — `getRecentGameNews`
- `src/lib/validations.ts` — `createRouletteSessionSchema`
- `src/app/roulette/page.tsx`, `src/app/roulette/actions.ts` (nouveaux)
- `src/components/roulette/RouletteWizard.tsx` (nouveau)
- `src/app/sessions/page.tsx` — bouton "🎰 Roulette"
- `public/sounds/tick.wav` (nouveau)

### Vérification

- `npx eslint .` : clean
- `npx next build` : compile et type-check sans erreur
- `npx vitest run` : 70 tests, 0 skip, tout vert
- Pas de dev smoke test authentifié possible (aucun `DATABASE_URL` dans ce
  sandbox) — vérifié par audit de code et build/lint/tests
- `.next`/`AGENTS.md`/`CLAUDE.md` nettoyés avant commit
- Zéro régression : migrations additives ; `createSessionFromRouletteAction`
  produit exactement l'état post-clôture d'une session normale (mêmes
  invariants que `closeSession`), donc aucune page existante n'a besoin
  d'un cas particulier pour une session créée via la roue

## Sprint 3, PR-C — Roulette asynchrone 🎰

### Contexte

La roulette du PR-B (mode "instant") exige que tout le monde soit présent
en même temps pour choisir ses jeux — en pratique les potes ne sont pas
synchronisés. Ce PR ajoute un mode **asynchrone** : chacun propose ses 2
jeux séparément, à son rythme, avant une deadline ; la roue tourne toute
seule (via cron) une fois la deadline passée. Le mode instant existant
reste disponible tel quel, derrière un toggle.

### Modèle de données

- `Roulette` — `scheduledAt` (heure de la soirée), `deadline` (limite de
  proposition, défaut `scheduledAt - 1h`), `status`
  (`OPEN`/`SPINNING`/`DONE`), `resultGameId`/`resultSessionId` (ids
  scalaires "libres", même pattern que `Notification.relatedSessionId` —
  pas de FK vers un jeu/session qui pourrait être supprimé plus tard),
  `notifiedUserIds` (`Json?`, même pattern que `Session.notifiedUserIds`),
  `reminderSent`.
- `RouletteEntry` — une ligne par jeu proposé (`@@unique([rouletteId,
  userId, gameId])`), 2 lignes par participant une fois qu'il a fini.

### Fonctionnement

1. **Création** (`/roulette?tab=creer`) — créneau + deadline + potes
   invités (même composant `NotifyRecipientsField` que le ping sélectif,
   désormais paramétrable via `fieldName`/`label`) → notif Discord "🎰
   ROULETTE DU GAMBLING !" mentionnant les invités.
2. **Propositions** (`/roulette/[id]`) — chacun propose ses 2 jeux depuis
   sa bibliothèque. Tant que `status === OPEN`, les jeux des AUTRES ne
   sont **jamais chargés côté serveur** (pas juste cachés en CSS) — seul
   un compteur "X/Y ont proposé" est calculé, à partir d'un `groupBy` qui
   ne renvoie que des `userId`. Rappel Discord automatique 1h avant la
   deadline pour qui n'a pas fini.
3. **Tirage** — déclenché soit manuellement par le créateur ("Lancer la
   roue maintenant"), soit automatiquement à la deadline. Deux
   déclencheurs concurrents possibles (cron externe + chargement de page
   paresseux) : réclamé atomiquement via un `updateMany` conditionné sur
   `status: OPEN` (`claimRouletteSpin`), exactement le même mécanisme que
   `claimSessionClose`. Moins de 2 participants ayant proposé → annulation
   silencieuse (`resultGameId: null`), même philosophie que "0 votant" sur
   une session classique. Sinon : une `Session` est créée directement
   `SCHEDULED` avec le jeu gagnant décidé, plus un `Proposal`/`Vote` par
   participant ayant réellement proposé — exactement l'invariant déjà
   utilisé par le mode instant, donc rien d'autre dans l'app n'a besoin de
   savoir qu'une session vient d'une roulette async.
4. **Révélation** — qui visite `/roulette/[id]` après le tirage voit un
   `RouletteResultReveal` qui rejoue l'animation de roue jusqu'au résultat
   déjà décidé côté serveur (`computeWinningRotation`, extrait dans
   `RouletteWheelDisplay.tsx` et réutilisé par le mode instant, qui
   dupliquait auparavant ce même code). Pour qui n'est pas présent :
   notification Discord "🎰 La roue a choisi : [Jeu] !".
5. **Cron** — pas de nouvel endpoint : `processOpenRoulettes()` est greffé
   à la fin de `/api/cron/close-sessions` (déjà appelée toutes les 15 min
   par le cron externe existant), pour éviter d'imposer une config cron
   supplémentaire.

### Intégration

- `/sessions/[id]` (soirée en "Vote en cours", créateur) — bouton "🎰
  Roulette" vers `/roulette?tab=creer&date=...&time=...`, date préremplie.
- `/roulette` — toggle "Mode async" (par défaut) / "Mode instant"
  (`RouletteWizard`, inchangé) ; mode async en 3 onglets "En cours" /
  "Créer" / "Historique". L'historique liste les sessions
  `createdViaRoulette=true` des DEUX modes (même champ, posé par les deux
  chemins de création).

### Fichiers modifiés/ajoutés

- `prisma/schema.prisma` — `Roulette`, `RouletteEntry`, `RouletteStatus`
- `prisma/migrations/20260903120000_add_roulette_async/`
- `src/lib/roulette.ts` (nouveau) — logique métier (claim atomique,
  tirage, rappel, traitement batch)
- `src/lib/discord-roulette.ts` (nouveau) — 4 annonces Discord + notifs
  in-app
- `src/lib/validations.ts` — `createRouletteSchema`,
  `submitRouletteEntriesSchema`
- `src/app/roulette/actions.ts` — `createRouletteAction`,
  `submitRouletteEntriesAction`, `forceSpinRouletteAction`
- `src/app/roulette/[id]/page.tsx` (nouveau)
- `src/app/roulette/page.tsx` — réécrit (toggle + 3 onglets)
- `src/components/roulette/RouletteWheelDisplay.tsx` (nouveau) — roue
  partagée, extraite de `RouletteWizard`
- `src/components/roulette/RouletteCountdown.tsx`,
  `RouletteEntryForm.tsx`, `RouletteResultReveal.tsx` (nouveaux)
- `src/components/roulette/RouletteWizard.tsx` — réutilise
  `RouletteWheelDisplay`/`computeWinningRotation` au lieu de dupliquer
- `src/components/NotifyRecipientsField.tsx` — `fieldName`/`label`
  paramétrables (réutilisé pour les participants d'une roulette)
- `src/app/api/cron/close-sessions/route.ts` — appelle
  `processOpenRoulettes()`
- `src/app/sessions/[id]/page.tsx` — bouton "🎰 Roulette"

### Vérification

- `npx eslint .` : clean
- `npx next build` : compile et type-check sans erreur
- `npx vitest run` : 70 tests, 0 skip, tout vert
- Pas de dev smoke test authentifié possible (aucun `DATABASE_URL` dans ce
  sandbox) — vérifié par audit de code et build/lint/tests
- `.next`/`AGENTS.md`/`CLAUDE.md` nettoyés avant commit
- Zéro régression : migration additive ; mode instant inchangé derrière le
  toggle ; `createdViaRoulette` reste le seul contrat entre les deux modes
  et le reste de l'app

## Sprint 3 suite, PR-D — Défis hebdo + Achievements de groupe + Dettes/gage

### FEATURE — Défis hebdo 🎯

- `WeeklyChallenge` (migration additive) — une ligne par semaine
  calendaire (`weekStart`, lundi 00:00, `@@unique`), piochée au hasard
  parmi 15 templates fixes (`CHALLENGE_TEMPLATES`,
  `src/lib/weekly-challenges.ts`) à la génération, elle-même **paresseuse**
  (au premier appel de `getCurrentWeeklyChallenge()` sur la semaine — Home
  et `/sessions/[id]` — pas de cron dédié, catch sur la contrainte unique
  pour l'idempotence sous accès concurrents).
- Card "🎯 Défi de la semaine" sur la Home (lecture seule).
- Complétion : bouton "🎯 Marquer le défi comme complété" sur
  `/sessions/[id]` (soirée `DONE`, créateur uniquement, seulement si le
  défi de la semaine EN COURS n'est pas déjà complété ET que la soirée
  appartient à cette même semaine — une vieille soirée ne peut jamais
  cocher rétroactivement un défi ultérieur). Réclamé atomiquement
  (`updateMany` sur `completedAt: null`, même mécanique que
  `claimSessionClose`/`claimRouletteSpin`).
- 100 XP à chaque participant réel de la soirée (mêmes voteurs de la
  proposition gagnante que partout ailleurs) — nouveau `XpReason`
  `CHALLENGE_COMPLETE`. Badge "🎯 Challenger" au 5ème défi complété par un
  même user (nouveau critère `CHALLENGES_COMPLETED` dans
  `src/lib/badges.ts`, même système que les 15 badges existants).

### FEATURE — Achievements de groupe 🏅

- `GroupAchievement` (migration additive) — 10 lignes seedées à l'avance
  (`prisma/seed-group-achievements.mjs`, idempotent par `key`, même
  philosophie que `Badge`/`seed-badges.mjs`), `unlockedAt` nul = pas
  encore débloqué.
- `checkGroupAchievements()` (`src/lib/group-achievements.ts`) — recalcul
  complet à chaque clôture de soirée (`markSessionDone`, "clôture" =
  soirée passée `DONE`, manuelle ou cron), réclame chaque déblocage
  atomiquement. Les 10 critères : Première soirée, Squad (5 joueurs
  différents), Marathoniens (10 soirées), Diversité (10 jeux différents),
  Réguliers (4 semaines consécutives), Noctambules (soirée après 23h),
  Century (100 soirées), Collectionneur collectif (500 jeux biblio
  groupe), Full House (soirée avec tout le groupe), Légendaire (1 membre
  rang Légende).
- Notif Discord (embed fixe, pas de `MessageTemplate` — même choix que les
  annonces roulette) + notification in-app à TOUT le groupe
  (`createNotifications` batch) + confettis pour le créateur qui vient de
  clôturer (`?celebrate=achievement`, nouveau kind dans
  `CelebrationConfetti`).
- "🏅 Trophées du groupe" sur la Home — les 10 lignes toujours affichées
  (encyclopédique, comme `BadgeGrid`), débloqués en couleur, verrouillés
  grisés.

### FEATURE — Dettes/gage 💀

- `Debt` (migration additive, FK cascade vers `User`/`Session`) — détectée
  automatiquement à la saisie des résultats d'une soirée
  (`submitSessionResultsAction`) : le formulaire de résultats gagne un
  toggle "Présent" par participant (coché par défaut) ; un voteur décoché
  n'a ni `SessionResult` ni XP, et devient débiteur (`detectDebts`,
  `src/lib/debts.ts`) — `reason` fige le jeu + la date au moment de la
  détection.
- Gage (texte libre) et statut "soldée" gérés depuis la Home
  (`src/app/dettes/actions.ts`), réservés au créateur de la soirée qui a
  généré la dette — pas au débiteur lui-même ("gage défini par le
  créateur", spec).
- Badge "💀" à côté du pseudo (Home — greeting du user courant — et
  `/potes`) tant qu'au moins une dette est active. "💀 Dettes du groupe"
  sur la Home, masquée s'il n'y en a aucune (même philosophie que "Actu
  gaming").

### Fichiers modifiés/ajoutés

- `prisma/schema.prisma` — `WeeklyChallenge`, `GroupAchievement`, `Debt`,
  `NotificationType.ACHIEVEMENT`, `XpReason.CHALLENGE_COMPLETE`
- `prisma/migrations/20260903150000_add_weekly_challenge_group_achievement_debt/`
- `src/lib/weekly-challenges.ts`, `src/lib/group-achievements.ts`,
  `src/lib/debts.ts` (nouveaux)
- `src/lib/discord-group-achievement.ts` (nouveau)
- `prisma/seed-group-achievements.mjs` (nouveau, wired dans `npm run build`)
- `src/lib/badges.ts` — critère `CHALLENGES_COMPLETED` +
  `checkChallengeBadges`
- `prisma/seed-badges.mjs` — badge "Challenger"
- `src/lib/xp.ts` — `XP_AMOUNTS.CHALLENGE_COMPLETE`
- `src/lib/sessions.ts` — `markSessionDone` appelle
  `checkGroupAchievements()`, retourne les trophées débloqués
- `src/lib/validations.ts` — `setDebtGageSchema`
- `src/app/dettes/actions.ts` (nouveau)
- `src/app/sessions/actions.ts` — `completeWeeklyChallengeAction`,
  `markSessionDoneAction` (celebrate achievement), `submitSessionResultsAction`
  (toggle présent + `detectDebts`)
- `src/components/SessionResultsForm.tsx` — toggle "Présent" par participant
- `src/components/CelebrationConfetti.tsx` — kind `achievement`
- `src/app/page.tsx` — 3 nouvelles cards + badge 💀 sur le greeting
- `src/app/potes/page.tsx` — badge 💀
- `src/app/sessions/[id]/page.tsx` — bouton "Marquer le défi comme complété"

### Vérification

- `npx eslint .` : clean
- `npx next build` : compile et type-check sans erreur
- `npx vitest run` : 70 tests, 0 skip, tout vert
- Pas de dev smoke test authentifié possible (aucun `DATABASE_URL` dans ce
  sandbox) — vérifié par audit de code et build/lint/tests
- `.next`/`AGENTS.md`/`CLAUDE.md` nettoyés avant commit
- Zéro régression : migrations additives ; les 3 features n'introduisent
  aucun nouveau champ obligatoire sur un flux existant (le toggle
  "Présent" du formulaire de résultats est coché par défaut pour tous —
  un formulaire soumis sans y toucher produit exactement le même résultat
  qu'avant cette PR)

## Fixes bugs remontés (priorité Sprint 4)

Trois bugs remontés par les utilisateurs, traités avant le Sprint 4.

### FIX 1 — Avatars/pseudos Discord auto-refresh

Un rafraîchissement passif existait déjà (`src/auth.ts`, callback `jwt`,
toutes les 12h) mais dépend du jeton OAuth **individuel** de chaque
user, stocké uniquement dans SON JWT de session (pas d'adapter Prisma —
`session: { strategy: "jwt" }`, aucune table `Account`). Un jeton Discord
expire au bout de ~7 jours sans jamais se renouveler tout seul (pas de
refresh token géré) : passé ce délai, `refreshDiscordProfile` échoue
silencieusement en boucle (`res.ok` faux) jusqu'à la prochaine vraie
reconnexion — d'où le bug remonté ("ne se met à jour qu'à la
déconnexion/reconnexion").

**Fix** : `refreshAllDiscordProfilesViaBot()` (`src/lib/discord-profile.ts`)
rafraîchit TOUT LE MONDE via le jeton du **bot** Discord de l'application
(`GET /users/{id}`, ne périme jamais), indépendamment de toute session
active. Nouvelle route `GET /api/cron/refresh-discord-profiles`, appelée
par un cron externe toutes les 1h, même protection `CRON_SECRET` que
les autres crons. `DISCORD_BOT_TOKEN` optionnelle — no-op silencieux
(warning loggé) si absente ; le rafraîchissement passif au login continue
de fonctionner seul dans ce cas.

**Config cron-job.org** (ou équivalent), en plus des crons déjà en place :

```
URL     : https://ton-projet.vercel.app/api/cron/refresh-discord-profiles
Méthode : GET
Header  : Authorization: Bearer <CRON_SECRET>
Fréquence : toutes les 1h (0 * * * *)
```

**Config bot Discord** : Developer Portal → ton application → onglet
"Bot" → "Reset Token" pour obtenir `DISCORD_BOT_TOKEN` → inviter le bot
sur le serveur Discord du groupe (OAuth2 → URL Generator → scope `bot`,
aucune permission particulière requise pour `GET /users/{id}`).

### FIX 2 — Bibliothèque Steam auto-sync (nouveaux achats)

`importSteamLibrary` traitait déjà TOUS les jeux renvoyés par
`GetOwnedGames` à chaque appel (upsert, jamais un ajout des seuls jeux
manquants) — un nouvel achat aurait donc été importé correctement...
si quelque chose appelait cette fonction sans action explicite de
l'utilisateur. Ce n'était le cas qu'au lien initial du compte Steam et
via le bouton "Réimporter" manuel : aucun cron n'existait pour ça (le
cron `/api/backfill/steam-store` existant ne fait que resynchroniser
`isCoop` pour des jeux déjà en base, jamais d'appel `GetOwnedGames`).

**Fix** : nouvelle route `GET /api/cron/steam-library-sync`, qui appelle
`importSteamLibrary` pour chaque user avec un `steamId64`, toutes les 1h.
`importSteamLibrary` renvoie désormais `newCount` (jeux que le user
ne possédait pas encore juste avant cet appel), loggé quand > 0. Boucle
"best-effort par user" — une panne Steam sur un compte n'empêche jamais
de traiter les autres (même philosophie que
`processOpenRoulettes`/`closeOverdueScheduledSessions`).

**Config cron-job.org** :

```
URL     : https://ton-projet.vercel.app/api/cron/steam-library-sync
Méthode : GET
Header  : Authorization: Bearer <CRON_SECRET>
Fréquence : toutes les 1h (0 * * * *)
```

### FIX 3 — Steam Family re-sync facile

Aucun endpoint Steam public n'expose la bibliothèque Family Sharing
(confirmé par le commentaire déjà présent sur `family-import.ts`) — le
copier-coller reste la seule solution garantie. Deux améliorations
pragmatiques :

- `getOwnedGames` pose désormais `include_played_free_games=1` (en plus
  d'`include_appinfo=1` déjà présent) — strictement plus permissif,
  capture certains jeux gratuits/partagés que Steam omettait sinon selon
  les comptes (aucune garantie officielle documentée par Steam sur les
  jeux Family spécifiquement).
- Bouton "🔄 Resynchroniser Family" sur `/profil/parametres`, à côté de
  l'import copier-coller (`resyncSteamFamilyAction`,
  `src/app/profil/family-import-actions.ts`) — rappelle
  `importSteamLibrary` et distingue deux cas via `newCount` : des
  nouveaux jeux trouvés (import silencieux, message de succès) ou aucun
  (message clair renvoyant vers le copier-coller, plutôt qu'un faux "à
  jour" silencieux — Steam n'a simplement rien renvoyé de nouveau pour ce
  compte).
- `User.steamLastSyncAt` (nouveau champ, migration additive) — posé par
  `importSteamLibrary` à CHAQUE appel (lien initial, réimport manuel,
  cron quotidien, resync Family), seule source de vérité pour "Dernière
  sync : il y a Xj" affiché sur `/profil/parametres`. Volontairement pas
  déduit de `Game.createdAt`/`UserGame.createdAt` : un run sans aucun
  nouveau jeu ne toucherait aucune de ces dates alors qu'une sync a bien
  eu lieu.

### Fichiers modifiés/ajoutés

- `prisma/schema.prisma` — `User.steamLastSyncAt`
- `prisma/migrations/20260903180000_add_steam_last_sync/`
- `src/lib/discord-profile.ts` — `refreshAllDiscordProfilesViaBot`
- `src/app/api/cron/refresh-discord-profiles/route.ts` (nouveau)
- `src/lib/steam.ts` — `include_played_free_games`, `steamLastSyncAt`,
  `ImportSteamLibraryResult.newCount`
- `src/app/api/cron/steam-library-sync/route.ts` (nouveau)
- `src/app/profil/family-import-actions.ts` — `resyncSteamFamilyAction`
- `src/app/profil/parametres/page.tsx` — bouton resync Family, indicateur
  "Dernière sync"
- `.env.example` — `DISCORD_BOT_TOKEN`

### Vérification

- `npx eslint .` : clean
- `npx next build` : compile et type-check sans erreur
- `npx vitest run` : 70 tests, 0 skip, tout vert
- Pas de dev smoke test authentifié possible (aucun `DATABASE_URL` dans ce
  sandbox) — vérifié par audit de code et build/lint/tests
- `.next`/`AGENTS.md`/`CLAUDE.md` nettoyés avant commit
- Zéro régression : migration additive ; `ImportSteamLibraryResult` gagne
  un champ (`newCount`) sans retirer ni changer les existants, tous les
  appelants déjà en place continuent de fonctionner sans modification
  (vérifié par grep de tous les usages)

## Sprint 4 PR-A : Pronostics, Paris d'XP, Dernière activité Steam

Première moitié du Sprint 4 (3 features moyennes sur 5, découpé en 2 PR
comme demandé — la seconde moitié, Recap mensuel + Saisons, arrive dans
une PR séparée).

### FEATURE 1 — Pronostics 🔮

Avant une soirée `SCHEDULED`, chaque participant prédit qui va "carry" la
soirée (`Pronostic`, 1 par personne et par soirée). Résolu automatiquement
en même temps que le vote de superlatifs (`resolvePronostics`,
src/lib/pronostics.ts, appelée depuis `finalizeSuperlativeVoting`) :
correct = le prédit a gagné une catégorie superlatif dont le nom contient
"carry" ou "mvp" (matching par mot-clé — `isCarryOrMvpCategory`,
src/lib/superlative-voting.ts — les catégories sont admin-éditables sur
/admin/superlatifs, pas un enum figé ; le seed ne fournit que "MVP de la
soirée" aujourd'hui).

- Prono correct → +50 XP, notif Discord ("🔮 [Pote] avait prédit juste —
  +50 XP") et notif in-app.
- Stat "taux de prono correct" (X/Y = Z%) sur /profil.
- Badge "🔮 Oracle" : 10 pronos corrects.
- Aucun aperçu des pronos des autres avant la révélation (seul le compte
  "X/Y ont pronostiqué" est visible pendant la fenêtre de prédiction).

### FEATURE 5 — Paris d'XP 🎲

Même fenêtre que les pronostics (soirée `SCHEDULED`), avec une mise d'XP :
slider 10 → 50% du solde actuel, par tranches de 10. La mise est déduite
immédiatement à la pose du pari (`placeBet`, src/lib/xp-bets.ts,
transaction atomique création + décrément) — jamais négative, le slider
est borné côté serveur avant toute écriture. Résolu en même temps que les
pronostics : pari gagné (la cible a gagné carry/mvp) → double mise
créditée ; perdu → rien de plus (mise déjà déduite).

- Badge "🎲 High Roller" : 5 paris gagnés.
- Badge "💰 All In" : parier 50% pile de son solde ET gagner (`XpBet.allIn`
  figé au moment du pari, `xpTotal` pouvant changer après coup).
- Historique gains/pertes sur /profil.

### FEATURE 4 — Dernière activité Steam 🎮

`importSteamLibrary` (src/lib/steam.ts) calcule désormais le jeu le plus
récemment joué à partir du champ `rtime_last_played` que Steam renvoie
pour chaque jeu de `GetOwnedGames` (non documenté officiellement mais
stable en pratique) — pas de second appel API (`GetRecentlyPlayedGames`
ne donne qu'un temps de jeu sur 2 semaines, pas un vrai timestamp).
Rafraîchi automatiquement par le cron `steam-library-sync` existant
(toutes les 1h), le lien initial et le bouton "Réimporter" — aucun
changement de cron nécessaire.

Affiché sur `/potes` (sous chaque card) et en en-tête de `/profil` : "🎮
Joue à [Jeu] — il y a Xh". Consultation passive uniquement, aucune notif
Discord. N'affiche rien si `steamId64` n'est pas lié.

### Fichiers modifiés/ajoutés

- `prisma/schema.prisma` — `Pronostic`, `XpBet`, `User.lastPlayedGame`/
  `lastPlayedAt`, `XpReason.PRONOSTIC_CORRECT`/`XP_BET_WON`,
  `NotificationType.PRONOSTIC`/`XP_BET`
- `prisma/migrations/20260903200000_add_pronostics_xp_bets_steam_activity/`
- `src/lib/pronostics.ts`, `src/lib/xp-bets.ts` (nouveaux)
- `src/lib/superlative-voting.ts` — `isCarryOrMvpCategory` + wiring
  `resolvePronostics`/`resolveBets` dans `finalizeSuperlativeVoting`
- `src/lib/badges.ts` — critères `PRONOSTICS_CORRECT`/`BETS_WON`/
  `ALL_IN_WIN` + `checkPronosticBadges`/`checkBetBadges`
- `prisma/seed-badges.mjs` — Oracle, High Roller, All In
- `src/lib/steam.ts` — `rtime_last_played`, calcul dernière activité dans
  `importSteamLibrary`
- `src/lib/xp.ts` — `XP_AMOUNTS.PRONOSTIC_CORRECT`
- `src/app/sessions/actions.ts` — `submitPronosticAction`, `placeBetAction`
- `src/components/PronosticForm.tsx`, `src/components/XpBetForm.tsx` (nouveaux)
- `src/app/sessions/[id]/page.tsx` — sections pronos/paris (SCHEDULED) +
  révélation (DONE)
- `src/app/profil/page.tsx` — taux de prono correct + historique paris
- `src/app/potes/page.tsx`, `src/app/profil/layout.tsx` — "🎮 Joue à..."
- `src/lib/validations.ts` — `pronosticSchema`, `xpBetSchema`

### Vérification

- `npx eslint .` : clean
- `npx next build` : compile et type-check sans erreur
- `npx vitest run` : 70 tests, tout vert
- Migration purement additive — zéro régression PR #1-56

## Sprint 4 PR-B : Recap mensuel Wrapped, Saisons mensuelles

Seconde moitié du Sprint 4 — dépend du modèle `Pronostic` introduit par la
PR-A (stat "meilleur pronostiqueur" du recap) : branche basée sur
`sprint4-pr-a`, PR ouverte contre cette base plutôt que `main` (stacked
PR), à merger après la PR-A.

### FEATURE 2 — Recap mensuel Wrapped 📊

Un seul cron quotidien (`/api/cron/monthly-tasks`, voir plus bas) génère,
au premier passage à partir du 1er du mois, un recap figé du mois
précédent (`MonthlyRecap`, `@@unique([year, month])` — idempotent, jamais
recalculé après coup). Stats : soirées jouées, jeu le plus joué, MVP du
mois (le plus de fois élu "MVP de la soirée"), joueur le plus actif (le
plus de soirées), meilleur streak, meilleur pronostiqueur (le plus de
pronos corrects du mois), XP total du groupe. Silencieux si aucune soirée
jouée ce mois-là (pas de recap vide).

`/recap/[year]/[month]` — style Spotify Wrapped : dégradé violet→noir,
scroll-snap vertical, une stat par écran révélée en Framer Motion
`whileInView` au scroll (le "tap ou auto-scroll" de la spec). Card "📊
Recap" sur la Home dès que le recap du mois dernier existe. Notif Discord
avec lien direct vers le recap.

### FEATURE 3 — Saisons mensuelles 🏆

Reset mensuel du classement XP (`Season`/`SeasonSnapshot`). Une seule
saison `isActive` à la fois ; `finalizeSeasonIfDue` (src/lib/seasons.ts,
appelée par le même cron quotidien) clôture la saison dès que sa
`endDate` (dernier jour du mois) est dépassée : snapshot du classement
AVANT reset (seule façon de consulter "qui était où"), annonce Discord du
champion, `xpTotal` remis à 0 pour tout le monde (badges/achievements/
streak jamais touchés), nouvelle saison ouverte immédiatement (jamais de
trou sans saison active).

Saison 1 bootstrapée par `prisma/seed-season.mjs` au déploiement de cette
PR — **sans reset rétroactif** : les scores XP actuels des users restent
la tête de départ, comme demandé.

- `/saisons` — historique des saisons terminées, podium top 3.
- `/profil/saisons` — résultats passés de l'utilisateur, "🏆 Champion"
  si `position === 1`. Pas un `Badge`/`UserBadge` : le système de badges
  (critères à seuil cumulatif) ne modélise pas "était 1er à un instant
  T", propre à chaque saison plutôt qu'un cumul statistique.
- Home : "🏆 Saison X — Jour Y/30" avec barre de progression.

**Config cron-job.org** (ou équivalent), en plus des crons déjà en
place :

```
URL     : https://ton-projet.vercel.app/api/cron/monthly-tasks
Méthode : GET
Header  : Authorization: Bearer <CRON_SECRET>
Fréquence : 1x par jour
```

### Fichiers modifiés/ajoutés

- `prisma/schema.prisma` — `MonthlyRecap`, `Season`, `SeasonSnapshot`,
  `User.seasonSnapshots`
- `prisma/migrations/20260903210000_add_monthly_recap_seasons/`
- `prisma/seed-season.mjs` (nouveau, bootstrap Saison 1) + wiring dans
  `npm run build`
- `src/lib/wallclock.ts` — `startOfMonthUTC`, `endOfMonthUTC`
- `src/lib/seasons.ts`, `src/lib/monthly-recap.ts` (nouveaux)
- `src/app/api/cron/monthly-tasks/route.ts` (nouveau)
- `src/components/RecapWrapped.tsx` (nouveau)
- `src/app/recap/[year]/[month]/page.tsx`,
  `src/app/saisons/page.tsx`, `src/app/profil/saisons/page.tsx` (nouveaux)
- `src/components/ProfilTabs.tsx` — onglet "Saisons"
- `src/app/page.tsx` — cards recap + progression de saison

### Vérification

- `npx eslint .` : clean
- `npx next build` : compile et type-check sans erreur (39 routes)
- `npx vitest run` : 70 tests, tout vert
- Migration purement additive — zéro régression PR #1-56 + PR-A

## Fix bug remonté : Saison 1 jamais créée au déploiement

`prisma/seed-season.mjs` ne bootstrappe Saison 1 qu'au `npm run build` —
en pratique, la migration ajoutant `Season` a été appliquée après le
build qui aurait dû lancer ce script, donc aucune saison n'a jamais été
créée en prod (`getSeasonProgress()` et `finalizeSeasonIfDue()`
retournaient silencieusement sans rien faire, faute de saison active).

**Fix** : `ensureFirstSeasonExists()` (src/lib/seasons.ts) — garde-fou
idempotent (si une saison active existe, `findFirst` et sort
immédiatement ; sinon crée Saison 1, contrainte unique sur
`Season.number` comme filet de sécurité contre un double-appel
concurrent) appelé à la volée à deux endroits : chargement de la Home et
cron `close-sessions` (toutes les 15 min) — répare l'état sans dépendre
uniquement d'un script de build, y compris après un bug futur ou une
purge accidentelle de la table `Season`.

### Fichiers modifiés

- `src/lib/seasons.ts` — `ensureFirstSeasonExists`
- `src/app/page.tsx`, `src/app/api/cron/close-sessions/route.ts` — wiring

### Vérification

- `npx eslint .` : clean
- `npx next build` : compile et type-check sans erreur
- `npx vitest run` : 70 tests, tout vert

## Sprint 5 PR-A : Tournois Bracket 🏆

Tournois à élimination directe entre potes, sur un jeu de la bibliothèque
commune — 4, 6 ou 8 joueurs, bracket généré automatiquement, XP et badges
à la clé.

### Modèle et génération du bracket

`Tournament` (statuts `REGISTRATION` → `IN_PROGRESS` → `DONE`,
`championId` dénormalisé pour éviter de re-dériver "qui a gagné la
finale" partout où c'est affiché), `TournamentParticipant` (seed
aléatoire, `eliminatedAt` informatif), `TournamentMatch` (`round`,
`position`, `player1Id`/`player2Id`/`winnerId` nullables).

`bracketSizeFor(maxPlayers)` — prochaine puissance de 2 ≥ maxPlayers (6
joueurs → bracket à 8 slots, avec 2 "byes"). `generateBracket` :

- Tirage aléatoire (pas de seeding par XP, cf. demande), TOUS les matchs
  de TOUS les rounds créés d'un coup (round 1 avec les joueurs tirés, les
  suivants avec des slots `null` à remplir au fur et à mesure) — le
  bracket entier existe dès le lancement, plus simple à requêter/afficher
  qu'une génération paresseuse round par round.
- **Répartition des "byes"** : remplir d'abord TOUS les `player1` (un par
  match, garanti non-null), puis les `player2` avec les participants
  restants — un remplissage séquentiel naïf (`slots[i]=shuffled[i]`,
  paires `(2i,2i+1)`) regrouperait les byes en fin de bracket au point de
  laisser un match totalement vide sur le cas le plus fréquent de la
  demande (6 joueurs / 8 slots) ; cette répartition garantit au contraire
  qu'aucun match du round 1 n'a ses deux joueurs vides. Les byes sont
  résolus immédiatement (le joueur seul avance sans jouer), jamais
  affichés comme un match "à jouer".
- Lancement soit automatique (places pleines), soit anticipé par le
  créateur (`launchTournamentAction`, dès 2 inscrits).

`declareWinner` (créateur du tournoi OU l'un des deux joueurs du match) →
`advanceWinner` fait avancer le gagnant au round suivant
(`nextPosition = floor(position/2)`) jusqu'à la finale, qui déclenche
`finalizeTournament` : XP (1er 200, 2e 100, demi-finalistes 50 — "demi-
finalistes" = perdants du round `totalRounds - 1`, formule qui généralise
correctement au bracket à 4 comme à 8), badges ("Champion de tournoi" 1
victoire, "Gladiateur" 5 participations), annonce Discord.

### UI

- `/tournois` — 3 onglets (En cours/À venir/Terminés).
- `/tournois/creer` — nom, jeu (biblio commune), 4/6/8 joueurs.
- `/tournois/[id]` — inscriptions (liste + S'inscrire/Se désinscrire/
  Lancer) en `REGISTRATION`, bracket visuel en `IN_PROGRESS`/`DONE`.
- `TournamentBracket` — rendu **récursif** depuis la finale vers le round
  1 (chaque nœud empile ses 2 enfants du round précédent dans une colonne
  centrée `items-center`) : l'alignement vertical entre rounds est garanti
  par le layout flexbox lui-même, sans calcul de pixels. Connecteurs CSS
  (bordure + traits), animation Framer Motion à l'affichage de chaque
  match, boutons "[Joueur] gagne" par match jouable.
- Découvrabilité : bouton "🏆 Tournois" sur `/sessions` (même pattern que
  "🎰 Roulette"), card Home "🏆 Tournoi en cours" si un tournoi est actif
  (inscriptions ouvertes ou en cours).

### Fichiers modifiés/ajoutés

- `prisma/schema.prisma` — `Tournament`, `TournamentParticipant`,
  `TournamentMatch`, `TournamentStatus`, `XpReason.TOURNAMENT_RESULT`
- `prisma/migrations/20260904090000_add_tournaments/`
- `src/lib/tournaments.ts` (nouveau) — génération bracket, résolution,
  finalisation
- `src/lib/xp.ts` — `TOURNAMENT_1ST`/`TOURNAMENT_2ND`/`TOURNAMENT_SEMIFINALIST`
- `src/lib/badges.ts` — critères `TOURNAMENTS_WON`/`TOURNAMENTS_PARTICIPATED`
  + `checkTournamentBadges`
- `prisma/seed-badges.mjs` — badges "Champion de tournoi", "Gladiateur"
- `src/lib/validations.ts` — `createTournamentSchema`, `declareWinnerSchema`
- `src/app/tournois/actions.ts`, `src/app/tournois/page.tsx`,
  `src/app/tournois/creer/page.tsx`, `src/app/tournois/[id]/page.tsx`
  (nouveaux)
- `src/components/tournaments/TournamentBracket.tsx` (nouveau)
- `src/app/page.tsx` — card "Tournoi en cours"
- `src/app/sessions/page.tsx` — bouton "🏆 Tournois"
- `src/app/profil/page.tsx` — libellé `XP_REASON_LABELS.TOURNAMENT_RESULT`

### Vérification

- `npx eslint .` : clean
- `npx next build` : compile et type-check sans erreur (44 routes)
- `npx vitest run` : 73 tests, tout vert
- Migration purement additive — zéro régression PR #1-60

## Sprint 5 PR-B : Chat in-app 💬 + Wishlist 🛒

### Chat in-app (FEATURE 2)

Messagerie **polling** (PAS de websockets — Vercel Hobby ne supporte pas
les connexions persistantes, cf. demande) : le client relit
`getChatMessagesAction` (appelée directement depuis le composant client,
même pattern que `markAllNotificationsReadAction`/`NotificationBell`)
toutes les 10s, avec indicateur "Actualisation…".

- `ChatMessage` (canal global si `sessionId` null, sinon canal dédié à
  une soirée — même table filtrée) + `ChatReaction` (une réaction par
  personne par message, `@@unique([messageId, userId])` : reproposer une
  réaction différente la remplace, retaper la même la retire).
- Icône 💬 dans le header à côté de la cloche → panneau plein écran sur
  mobile, glissant depuis la droite sur desktop (même famille que
  `GameFilterDrawer`, plein écran plutôt que bottom-sheet sur mobile,
  demandé explicitement pour le chat).
- Onglet "💬 Chat" embarqué directement sur `/sessions/[id]` (canal
  scopé à la soirée).
- Bulles colorées avec `User.color`, envoyé à droite/reçu à gauche
  (iMessage), réactions par longue-pression (👍😂🔥💀), max 200 messages
  chargés (jamais supprimés en base, juste plus affichés au-delà).

### Wishlist jeux à acheter (FEATURE 3, V17)

`/wishlist` — nouvel onglet "🛒 À acheter" dans `LibraryTabs` (à côté de
"Ma bibliothèque"/"Groupe"/"Tierlist"/"À vérifier").

- `GameWishlist` (`@@unique([gameId])` : un jeu ne peut avoir qu'une
  seule entrée à la fois, proposer un jeu déjà listé revient à voter
  dessus) + `GameWishlistVote` (`interested` 👍/👎, `@@unique([wishlistId,
  userId])`).
- Tri par nombre d'intéressés décroissant, badge "X/6 intéressés" en
  vert dès la majorité du groupe.
- **Détection automatique d'achat** : `checkWishlistPurchases`
  (src/lib/wishlist.ts) tourne après CHAQUE import Steam réussi
  (`importSteamLibrary` — donc le cron `steam-library-sync` ET le bouton
  "Réimporter" manuel) — dès qu'un membre possède désormais un jeu de la
  wishlist, l'entrée est marquée "✅ Acheté par [Pote]" toute seule,
  jamais un état à cocher à la main. Vérifiée aussi à la proposition
  elle-même (si quelqu'un possède déjà le jeu au moment où il est
  proposé).
- Cover reprise directement de `Game.coverUrl` (déjà résolue à
  l'import/ajout, aucun nouvel appel IGDB). Prix Steam **best-effort**,
  jamais mis en cache (contrairement à `Game.igdbDetails` — un prix
  change, une fiche jeu non) : fetch live à l'affichage de la page pour
  les jeux Steam non encore achetés, silencieusement absent si Steam
  Store est injoignable ou n'a pas de prix (gratuit, retiré du store…).

### Fichiers modifiés/ajoutés

- `prisma/schema.prisma` — `ChatMessage`, `ChatReaction`,
  `GameWishlist`, `GameWishlistVote`
- `prisma/migrations/20260904120000_add_chat_wishlist/`
- `src/lib/chat.ts`, `src/app/chat/actions.ts` (nouveaux)
- `src/components/chat/ChatMessages.tsx`, `src/components/chat/ChatPanel.tsx` (nouveaux)
- `src/components/Header.tsx` — icône 💬
- `src/app/sessions/[id]/page.tsx` — section "💬 Chat"
- `src/lib/wishlist.ts`, `src/app/wishlist/actions.ts`, `src/app/wishlist/page.tsx` (nouveaux)
- `src/lib/steam-store.ts` — `priceFormatted` sur `SteamStoreDetails`
- `src/lib/steam.ts` — `checkWishlistPurchases` appelée après chaque import
- `src/components/LibraryTabs.tsx` — onglet "🛒 À acheter"
- `src/lib/validations.ts` — schémas chat + wishlist

### Vérification

- `npx eslint .` : clean
- `npx next build` : compile et type-check sans erreur (45 routes)
- `npx vitest run` : 73 tests, tout vert
- Migration purement additive — zéro régression PR #1-61

## Sprint 5 suite : fix wishlist + infra/perf

### FIX — Wishlist : recherche IGDB plutôt que la biblio du groupe

Le but de la wishlist est de proposer un jeu que PERSONNE dans le groupe
ne possède encore (ex. un jeu pas encore sorti) — un `<select>` limité à
`prisma.game.findMany()` ne pouvait donc jamais servir son but premier.
`WishlistProposeForm` (nouveau) remplace ce select par une recherche IGDB
en autocomplete (debounce 300ms, même endpoint `/api/igdb/search` que
`AjouterJeuForm`) : cover + nom dans les résultats, tap → jeu upsert par
`igdbId` (même logique que `addManualGame`, src/app/actions.ts — si le
jeu existe déjà en base, ex. import Steam matché, on l'attache
directement plutôt que de dupliquer la ligne `Game`) → entrée wishlist
créée. `proposeWishlistGameSchema` mis à jour en conséquence (`igdbId`
obligatoire, plus de `gameId`).

### I1 — Cache des covers IGDB/Steam

`next/image` sert déjà ces domaines via l'optimiseur intégré
(`remotePatterns`, en place depuis la 1ère PR) mais sans
`minimumCacheTTL` explicite, il ne gardait le fichier optimisé en cache
que quelques heures. Une cover IGDB/Steam ne change quasiment jamais une
fois résolue — `next.config.ts` fixe maintenant `minimumCacheTTL` à 30
jours.

### I2 — Optimistic UI

Audit de l'existant avant d'ajouter quoi que ce soit : le vote sur les
propositions de soirée (`VoteButton`) et le toggle de dispo sur
`/calendrier` (`DayTimeline`) avaient déjà le pattern complet (mise à
jour immédiate + défait avec toast si le serveur refuse). Étendu aux 3
endroits qui ne l'avaient pas encore, même pattern partout :

- **Pronostic** (`PronosticForm`) — "Pronostic enregistré" s'affiche dès
  le clic ; `submitPronosticAction` renvoie maintenant un résultat
  (`{ok, error?}`, même contrat que `ToggleVoteResult`) pour pouvoir
  redéfaire l'affichage si l'action échoue.
- **Vote wishlist** (`WishlistVoteButtons`, nouveau) — bouton actif +
  badge "X/6 intéressés" mis à jour immédiatement ; `voteWishlistAction`
  renvoie désormais `VoteWishlistResult`.
- **Envoi de message chat** (`ChatMessages`) — la bulle apparaît
  immédiatement (id temporaire, remplacée par la vraie ligne au prochain
  `refresh()`, ou retirée + toast si `sendChatMessageAction` échoue,
  désormais elle aussi à résultat).

### I3 — Compression des bannières avant upload

`BannerForm` redimensionne (sans jamais agrandir, `min(1, 1500/largeur,
500/hauteur)`) et recompresse (canvas `toBlob`, JPEG qualité 80%) côté
client AVANT l'upload Vercel Blob — le fichier compressé remplace le
fichier sélectionné dans l'`<input type="file">` (trick `DataTransfer`)
pour que l'upload natif (`<form action={uploadBannerAction}>`) parte
bien de la version réduite. Dégradation silencieuse (fichier original
conservé) si la compression échoue (canvas indisponible, image
indécodable…) — l'upload doit rester possible dans tous les cas.

### I4 — Index Prisma

Audit des index existants avant d'en ajouter (cf. demande) :
`UserGame.userId` (déjà couvert par `@@id([userId, gameId])`),
`Notification.userId+read` (déjà exact), `AvailabilityOverride.userId+date`
(déjà couvert par `@@unique([userId, date])`) et `XpEvent.userId` (déjà
en place) n'avaient besoin de rien. `ChatMessage.createdAt` est mieux
couvert par l'index composite `(sessionId, createdAt)` déjà posé au
Sprint 5 PR-B (nos requêtes filtrent toujours par `sessionId`). Seul
`Session` (filtré par `status` puis trié par `date` sur `/sessions`, la
Home et les crons) n'avait encore aucun index — ajouté
(`@@index([status, date])`).

### I5 — Tableau récapitulatif des crons

Aucun doublon constaté (chaque cron couvre une tâche distincte) :

| Cron | URL | Fréquence | Ce qu'il fait |
| :--- | :-- | :-------- | :------------ |
| Clôture des soirées | `/api/cron/close-sessions` | 15 min | `VOTING → SCHEDULED/CANCELLED`, `SCHEDULED → DONE`, tirage des roulettes async dues, garde-fou Saison 1 |
| Rappels de soirée | `/api/cron/reminders` | 15 min | Envoie les rappels Discord programmés (`Session.reminderTimings`) |
| Sync bibliothèques Steam | `/api/cron/steam-library-sync` | 1h | Réimporte la biblio Steam de chaque compte lié, badges, détection d'achats wishlist |
| Rafraîchissement profils Discord | `/api/cron/refresh-discord-profiles` | 1h | Avatar/pseudo de tout le monde via le bot Discord (contourne l'expiration du token OAuth individuel) |
| Tâches mensuelles | `/api/cron/monthly-tasks` | 1x/jour | Clôture de saison si échue, génération du recap Wrapped du mois si le 1er |

### Fichiers modifiés/ajoutés

- `src/components/wishlist/WishlistProposeForm.tsx` (nouveau),
  `src/app/wishlist/actions.ts`, `src/app/wishlist/page.tsx`,
  `src/lib/validations.ts`
- `next.config.ts` — `minimumCacheTTL`
- `src/components/PronosticForm.tsx`, `src/app/sessions/actions.ts` —
  `submitPronosticAction` à résultat
- `src/components/wishlist/WishlistVoteButtons.tsx` (nouveau) —
  `voteWishlistAction` à résultat
- `src/components/chat/ChatMessages.tsx`, `src/app/chat/actions.ts` —
  `sendChatMessageAction` à résultat, bulle optimiste
- `src/components/BannerForm.tsx` — compression client-side
- `prisma/schema.prisma`, `prisma/migrations/20260904140000_add_session_status_date_index/`

### Vérification

- `npx eslint .` : clean
- `npx next build` : compile et type-check sans erreur (45 routes)
- `npx vitest run` : 73 tests, tout vert
- Migration purement additive — zéro régression PR #1-62

## Fix bugs remontés : cron avatars Discord silencieux + bannières GIF figées à l'upload

### Bug 1 — cron avatars Discord sans trace de diagnostic

Le cron `/api/cron/refresh-discord-profiles` (1h, cron-job.org) utilise
bien `refreshAllDiscordProfilesViaBot()` (`src/lib/discord-profile.ts`) —
jeton du **bot** Discord (`Authorization: Bot ...`), jamais périmé,
indépendant de la session OAuth d'un utilisateur (contrairement à
`refreshDiscordProfile()`, appelée depuis `auth.ts`, qui dépend elle du
jeton d'accès individuel de chaque user et casse silencieusement après
~7 jours faute de refresh token — comportement connu, documenté plus haut
dans "Fixes bugs remontés (priorité Sprint 4)", non concerné par ce fix).
Vérifié : construction de l'URL avatar (`discordAvatarUrl()`) identique
byte pour byte au mapping du provider Discord natif de `@auth/core`
(formule avatar par défaut, détection GIF via préfixe `a_`) — pas un bug
de format.

Le vrai problème : **aucune trace de diagnostic sur les échecs**. Un
`if (!res.ok) continue;` avalait silencieusement toute erreur HTTP (jeton
bot absent, invalide, révoqué, `403`, `429`...) sans logger ni le
`discordId` concerné ni le code retour, et la route ne loguait un résumé
que si `updated > 0` — un run qui échoue à 100 % ne laissait donc aucune
trace dans les logs Vercel, rendant la cause racine (probablement
`DISCORD_BOT_TOKEN` jamais configurée ou invalide en prod — aucun accès
réseau/DB dans ce sandbox pour le confirmer empiriquement) impossible à
diagnostiquer à distance. Fix : logs structurés (`logger.info`/`error`)
ajoutés à chaque étape — nombre d'utilisateurs à vérifier au démarrage,
échec HTTP par user (`discordId` + status + corps de réponse tronqué),
mise à jour effective par user (`discordId` + ancien/nouvel avatar et nom),
et résumé de la route à chaque run (plus seulement si `updated > 0`). Le
prochain run en prod rendra la cause racine immédiatement visible dans les
Vercel Logs.

### Bug 2 — bannières GIF figées après upload

Les bannières (`/potes`, `/profil`) sont déjà rendues en `background-image`
CSS natif, jamais via `next/image` — choix déjà documenté plus haut ("Page
Potes — refonte visuelle + GIFs", Sprint 2 PR-A) précisément pour éviter
qu'un GIF soit figé sur sa première frame. `images.remotePatterns` (3
domaines : `cdn.discordapp.com`, `cdn.akamai.steamstatic.com`,
`images.igdb.com`) n'intervient donc pas ici — `bannerUrl` accepte toute
URL `http(s)` (`httpUrlSchema`, aucune liste blanche de domaines côté
stockage).

Le vrai bug avait été réintroduit ailleurs, par une feature plus récente :
l'upload de bannière (PR 28, FIX4) recompresse **toute** image côté client
via `<canvas>` avant l'envoi vers Vercel Blob
(`compressBannerImage`) — `drawImage` ne capture que la 1ère frame d'un
GIF, et `canvas.toBlob` ré-encode systématiquement en JPEG statique (pas
de support GIF). Résultat : tout pote ayant uploadé un GIF (plutôt que
collé une URL externe déjà hébergée) se retrouvait avec une bannière
figée sur une frame — pas de bug de rendu, un bug de perte de données à la
source. Fix (`src/components/BannerForm.tsx`) : `handleFileChange` saute
désormais l'appel à `compressBannerImage` pour `file.type === "image/gif"`
et envoie le fichier original tel quel (déjà plafonné à 5 Mo par la
validation existante juste au-dessus).

### Fichiers modifiés

- `src/lib/discord-profile.ts`, `src/app/api/cron/refresh-discord-profiles/route.ts`
  — logs structurés
- `src/components/BannerForm.tsx` — GIF non compressés à l'upload

### Vérification

- `npx eslint .` : clean
- `npx next build` : compile et type-check sans erreur (45 routes)
- `npx vitest run` : 73 tests, tout vert

## Polish visuel, PR-A (micro-interactions, états vides, dégradés, typo)

Première des deux PR demandées ("polish visuel" + "amélioration des
features existantes") — celle-ci couvre le polish visuel pur (items 1-4
de la demande). L'amélioration des features (profil enrichi, classement
engageant, récap de soirée, notifications groupées, ligne "maintenant" au
calendrier, spectacle roulette) suivra dans une PR-B une fois celle-ci
mergée, même découpage que les sprints précédents.

### 1. Micro-interactions

- **Boutons** : `Button`/`ButtonLink` avaient déjà `whileTap={{ scale:
  0.97 }}` (Framer). Pour couvrir aussi les `<button>` natifs hors de ces
  deux composants (icônes du header, boutons de dialog, toggles de
  `DayTimeline`…) sans auditer chaque fichier un par un, une règle CSS
  globale (`globals.css`) ajoute `transition: transform/background-color/…
  150ms` + `:active { transform: scale(0.97) }` sur `button`. L'inline
  style posé par Framer sur les boutons motion prime sur cette règle CSS
  (pas de conflit visuel), donc les deux mécanismes cohabitent.
- **Cards hover glow** : `Card`/`.card-glow` existaient déjà et sont
  utilisés dans 13 fichiers (bibliothèque, sessions, tournois, potes…) —
  couverture déjà large, pas de changement nécessaire ici.
- **Onglets à soulignement animé** : nouveau composant partagé
  `TabLink` (`src/components/ui/TabLink.tsx`) — un `motion.span` avec
  `layoutId` (un id par barre d'onglets, jamais partagé entre deux barres
  différentes) glisse sous l'onglet actif au lieu de réapparaître
  instantanément. Remplace le `border-b-2` statique dans `ProfilTabs`,
  `PoteTabs`, `LibraryTabs`, `AdminTabs`.
- **Toggles à fond glissant** : nouveau composant partagé
  `SegmentedControl` (`src/components/ui/SegmentedControl.tsx`) — même
  principe (`layoutId`) mais le fond `bg-accent` glisse d'une pilule à
  l'autre. Remplace le pattern "pilule pleine posée/retirée
  instantanément" dans : `BannerForm` (URL/Upload), `/sessions` (À
  venir/Historique), `/roulette` (mode async/instant, puis En
  cours/Créer/Historique), `/calendrier` (Collectif/Individuel),
  `/classement` (Global/Mois/Semaine).
- **Compteurs count-up** : nouveau composant partagé `CountUp`
  (`src/components/ui/CountUp.tsx`, anime une `MotionValue` Framer de 0
  à la valeur cible en ~600ms, saute l'animation si
  `prefers-reduced-motion`) — appliqué aux stat cards de `/profil`
  (soirées jouées, jeux en biblio, soirées créées, récompenses, streak)
  et aux stats du groupe sur la home (soirées jouées, joueurs actifs).

### 2. États vides

Nouveau composant partagé `EmptyState` (`src/components/ui/EmptyState.tsx`
— icône + titre + action optionnelle) posé sur : home (aucune soirée à
venir, activité récente vide, dettes du groupe — **la section "Dettes"
ne se masque plus si vide, elle affiche désormais un état "✨ Personne ne
doit rien" au lieu de disparaître**), `/sessions` (à venir/historique
vides), `/tournois` (avec CTA "+ Créer un tournoi"), `/wishlist`, chat
(`ChatMessages`, canal global et par soirée), `/roulette` (en
cours/historique vides). Le pronostic sans participant (`PronosticForm`,
`/sessions/[id]`) affiche désormais "🔮 Fais ton prono avant la soirée !"
tant que personne n'a répondu, au lieu du simple compteur "0/N".

### 3. Dégradés & fonds

- Halo dégradé discret (`.name-halo`, radial violet→transparent) derrière
  le nom sur l'en-tête `/profil`.
- Bordure dégradé très subtile (`.gradient-border` — double
  `background-clip` padding-box/border-box, `!important` sur
  `border-color` uniquement pour rester déterministe à côté du `border
  border-border` déjà posé par `Card`) sur les 8 cards de section de la
  home.
- Fond radial doux derrière le podium top 3 (`.podium-glow-bg`,
  `/classement`).
- Léger shimmer CSS en boucle (`.rank-badge-shimmer`, respecte
  `prefers-reduced-motion` via la règle globale existante) sur les
  badges de rang texte (Bronze/Argent/Or…) : `/profil`, `/potes/[id]`,
  `/potes`.

### 4. Typographie

Titres de section de la home (Stats du groupe, Activité récente, Dispos
de la semaine, Actu gaming, Défi de la semaine, Trophées du groupe,
Dettes du groupe, Classement rapide) passés de `text-sm text-muted` à
`text-lg font-semibold text-foreground`. `tabular-nums` ajouté sur les
nombres qui doivent s'aligner proprement : stats du groupe et stats de
profil (déjà couvertes par `CountUp`), XP/streak de `/profil`, position
et XP de `/classement` (lignes + podium).

### Fichiers modifiés/ajoutés

- `src/components/ui/TabLink.tsx`, `SegmentedControl.tsx`,
  `EmptyState.tsx`, `CountUp.tsx` (nouveaux)
- `src/app/globals.css` — transition boutons, `.gradient-border`,
  `.name-halo`, `.podium-glow-bg`, `.rank-badge-shimmer`
- `src/components/ProfilTabs.tsx`, `PoteTabs.tsx`, `LibraryTabs.tsx`,
  `admin/AdminTabs.tsx` — `TabLink`
- `src/app/sessions/page.tsx`, `roulette/page.tsx`, `calendrier/page.tsx`,
  `classement/page.tsx`, `src/components/BannerForm.tsx` —
  `SegmentedControl`
- `src/app/page.tsx`, `tournois/page.tsx`, `wishlist/page.tsx`,
  `src/components/chat/ChatMessages.tsx` — `EmptyState`
- `src/app/profil/layout.tsx` — `CountUp`, halo, shimmer, tabular-nums
- `src/app/classement/page.tsx`, `src/components/PodiumSpot.tsx` —
  podium glow, tabular-nums
- `src/app/potes/[id]/layout.tsx`, `src/app/potes/page.tsx` — shimmer
  badge de rang

### Vérification

- `npx eslint .` : clean
- `npx next build` : compile et type-check sans erreur (45 routes)
- `npx vitest run` : 73 tests, tout vert
- Zéro régression PR #1-64
- Pas d'accès DB/réseau live dans ce sandbox : build + lint + tests +
  vérification manuelle du diff, pas de test navigateur authentifié
  possible (Discord OAuth) au-delà d'un smoke test de la page de login

## Fix urgent (page /profil blanche sur desktop) + design de fond

### Bug urgent — CountUp cassait /profil

`CountUp` (nouveau composant de la PR-A ci-dessus) utilisait
`useMotionValue`/`useTransform` de Framer Motion et rendait la valeur
dérivée directement comme enfant de `motion.span`
(`<motion.span>{rounded}</motion.span>`, un `MotionValue` plutôt qu'un
`ReactNode` classique) — un crash de rendu sur ce composant fait tomber
tout l'arbre React jusqu'à la limite d'erreur la plus proche, ce qui
explique une page `/profil` entièrement blanche (le composant apparaît
dans l'en-tête ET dans les stat cards, sur le même arbre que le reste de
la page). Réécrit avec un simple `useState` mis à jour depuis le callback
`onUpdate` de l'API impérative `animate()` — plus aucune valeur non-
primitive rendue comme enfant React. `prefers-reduced-motion` toujours
respecté via une durée `0` (au lieu d'un retour anticipé avec `setState`
synchrone dans le corps de l'effet, qui aurait déclenché des rendus en
cascade — repéré par la règle ESLint `react-hooks/set-state-in-effect`).

### Design de fond

L'app était jugée trop "noir plat" — ajout d'une couche de profondeur
visuelle cohérente sur tout le site, PERFORMANCE FIRST (`transform`/
`opacity`/`background-position` uniquement, jamais de reflow ; effets
coûteux allégés ou désactivés sur mobile).

- **Mesh gradient de fond** (`body` dans `globals.css`) — 3 taches de
  couleur (violet/indigo/bleu foncé) en `color-mix` à faible dosage
  (8-10 % directement dans les stops du dégradé, jamais une `opacity`
  globale qui aurait aussi atténué le fond solide et donc le contraste du
  texte). `background-attachment: fixed` + animation `background-
  position` (32s) seulement à partir de `sm:` — statique sur mobile
  (l'attachement fixe force un repaint au scroll sur certains navigateurs
  mobiles, et l'anim n'a pas la place de se voir sur un petit écran).
- **Glassmorphism** — `Card` (composant partagé, ~100+ usages dans
  l'app) passe en fond semi-transparent (`bg-surface/70`) + bordure type
  verre (`border-white/10`) + flou seulement à partir de `sm:`
  (`backdrop-blur-sm`, coûteux au scroll sur mobile). Sans support
  `backdrop-filter`, le navigateur ignore juste la classe et garde le
  fond semi-transparent uni — pas de `@supports` nécessaire. `.gradient-
  border` (PR-A) mis à jour pour rester cohérent (fond translucide au
  lieu d'opaque).
- **Parallax léger** — nouveau `ParallaxHeader`
  (`useScroll`/`useTransform` de Framer, `transform` pur donc coût quasi
  nul) posé sur l'en-tête de la home et celui de `/profil`, facteur ~0.3.
- **Fade-in au scroll** — nouveau `FadeInView` (`whileInView`, distinct
  de `Stagger`/`StaggerItem` qui animent au montage) posé sur les 5
  sous-routes de `/profil` (aperçu, historique, badges, superlatifs,
  saisons) — periphérie représentative plutôt qu'exhaustive sur "toutes
  les pages" (risque de régression trop élevé pour une seule PR sur des
  dizaines de pages déjà animées différemment).
- **Particules flottantes** (home, `FloatingParticles`) — 10 points CSS
  purs derrière l'en-tête, positions/délais **déterministes** (dérivés de
  l'index, jamais `Math.random()` — un générateur aléatoire diffère entre
  le rendu serveur et l'hydratation client, ce qui casse l'hydratation).
  Masquées sur mobile (`hidden sm:block`).
- **Glow doré/argenté/bronze** sur le podium (`PodiumSpot`,
  `/classement`) — dégradé radial flouté par place, distinct de l'anneau
  de rang XP (deux signaux différents).
- **Ken Burns** sur la bannière `/profil` (`.banner-ken-burns`, scale
  1→1.05→1, 22s) — conteneur passé en `overflow-hidden` pour ne pas
  déborder sur le reste de la page.
- **Ondes radar** derrière la roue de la roulette pendant qu'elle tourne
  (`.radar-pulse`, nouveau prop `spinning` sur `RouletteWheelDisplay`,
  câblé depuis `RouletteWizard` ET `RouletteResultReveal` — composant
  partagé par les deux modes).
- **Traînée du curseur** (desktop uniquement, `pointer: fine`) — nouveau
  `CursorTrail` (monté globalement dans `layout.tsx`, manipule le DOM
  directement plutôt que du state React : un `mousemove` peut tirer des
  dizaines de fois par seconde, recycler 5 `div` ainsi coûte bien moins
  cher qu'un re-rendu React à cette fréquence). Réglage cosmétique en
  `localStorage` (`src/lib/cursor-trail-preference.ts`, pas de colonne
  `User` — pas lié au compte), activé par défaut, toggle dans
  `/profil/parametres` (`CursorTrailToggle`, `useSyncExternalStore` pour
  lire `localStorage` sans risque de mismatch d'hydratation — même classe
  de bug que celui du CountUp corrigé ci-dessus, évitée ici dès le
  départ).

### Fichiers modifiés/ajoutés

- `src/components/ui/CountUp.tsx` — fix
- `src/app/globals.css` — mesh gradient, Ken Burns, particules, radar,
  traînée du curseur (classes CSS)
- `src/components/ui/Card.tsx` — glassmorphism
- `src/components/ui/ParallaxHeader.tsx`, `FadeInView.tsx` (nouveaux)
- `src/components/FloatingParticles.tsx`, `CursorTrail.tsx`,
  `CursorTrailToggle.tsx` (nouveaux)
- `src/lib/cursor-trail-preference.ts` (nouveau)
- `src/app/page.tsx`, `src/app/profil/layout.tsx` — parallax + particules
- `src/app/profil/page.tsx`, `historique/`, `badges/`, `superlatifs/`,
  `saisons/` — `FadeInView`
- `src/app/profil/parametres/page.tsx` — section "Effets visuels"
- `src/components/PodiumSpot.tsx` — glow par place
- `src/components/roulette/RouletteWheelDisplay.tsx`, `RouletteWizard.tsx`,
  `RouletteResultReveal.tsx` — radar pulse
- `src/app/layout.tsx` — montage `CursorTrail`

### Vérification

- `npx eslint .` : clean
- `npx next build` : compile et type-check sans erreur (45 routes)
- `npx vitest run` : 73 tests, tout vert
- Zéro régression PR #1-64
- Zéro régression PR #1-63

## Fix urgent : chat polling actif même onglet en arrière-plan

Le chat (`ChatMessages`, canal global ET onglet "💬 Chat" d'une soirée)
faisait un `setInterval(refresh, 10_000)` sans condition — même onglet en
arrière-plan, consommant du quota Vercel (requêtes serveur) pour rien
pendant des heures sur un onglet oublié ouvert.

- **API Page Visibility** (`document.hidden` / `visibilitychange`) — une
  seule fonction `syncWithVisibility`, appelée au montage ET à chaque
  bascule de visibilité : onglet caché → `clearInterval` ; onglet visible →
  `refresh()` immédiat puis relance de l'intervalle. Pas de code dupliqué
  entre le cas "montage initial" et le cas "retour au premier plan".
- **Intervalle 10s → 15s** — suffisant pour un groupe de ~6 potes,
  ~33 % de requêtes en moins même onglet actif.
- **Panneau de chat fermé → polling coupé** — déjà couvert sans code
  supplémentaire : `ChatPanel` utilise un `Dialog.Root` Radix non contrôlé
  dont le contenu n'a aucune transition/animation CSS (l'animation
  d'entrée est pilotée en JS par Framer Motion) — `Presence` de Radix
  démonte donc `ChatMessages` immédiatement à la fermeture, ce qui
  déclenche déjà le cleanup de l'effet (`clearInterval` +
  retrait du listener `visibilitychange`). Vérifié en lisant
  `ChatPanel.tsx` et le code de `@radix-ui/react-dialog`/`-presence`
  avant d'écarter une restructuration plus lourde (prop `open`/`active`
  contrôlée) au profit de ce fix auto-suffisant dans `ChatMessages.tsx`
  seul. Bonus : le `refresh()` immédiat à la réouverture élimine aussi les
  messages périmés affichés entre la réouverture et le premier tick.
- Gain estimé : ~90 % des requêtes de polling en moins sur un usage
  normal (onglet en arrière-plan la majorité du temps + panneau global
  fermé la majorité du temps).

### Fichiers modifiés

- `src/components/chat/ChatMessages.tsx` — intervalle 15s, effet de
  polling réécrit avec `syncWithVisibility`

### Vérification

- `npx eslint .` : clean
- `npx next build` : compile et type-check sans erreur (45 routes)
- `npx vitest run` : 73 tests, tout vert
- Zéro régression PR #1-65

## Fix bug remonté : /profil blanche uniquement en navigation client (pas au F5)

### Limite de l'environnement

Ce bug ne se reproduit qu'avec une session Discord authentifiée
(`/profil` redirige vers `/` sans utilisateur connecté) — ce sandbox n'a
pas de `DATABASE_URL`/`AUTH_SECRET` réels ni d'accès réseau, donc pas de
session vivante possible ici. Impossible d'ouvrir un vrai F12 sur une
navigation authentifiée pour lire l'erreur JS exacte demandée en étape 1 :
ce qui suit est une revue de code exhaustive des composants listés
(étape 3), pas une lecture de stack trace en direct.

### Composants audités

- **CountUp** — déjà corrigé (fix précédent, `useState`+`onUpdate`,
  aucun accès `window`/`document` pendant le rendu). Confirmé sain.
- **Shimmer badges** (`LegendaryPulse`/`LegendaryGlow`) — utilisent
  `useReducedMotion` de Framer Motion, conçu pour être sûr en SSR
  (retourne `null` côté serveur/premier rendu, se resynchronise ensuite).
  Rien à corriger.
- **Ken Burns**, **gradient halo**, **glassmorphism** — CSS pur (classes
  dans `globals.css`/`Card.tsx`), aucun JS exécuté au rendu, ne peuvent
  pas causer une erreur React.
- **Cursor trail** — ne rend jamais rien (`return null`), toute la
  logique est dans un `useEffect` ; ne peut pas faire planter un rendu.
  Monté une seule fois dans le layout racine (persiste entre les
  navigations), donc pas spécifique à une navigation vers `/profil`.
- **Particles** — CSS pur, et de toute façon pas monté sur `/profil`
  (seulement sur la home).
- **Parallax scroll (`ParallaxHeader`)** — seul autre composant du lot à
  manipuler une `MotionValue` (`useScroll`/`useTransform`, même famille
  que le bug CountUp original). Le code source de `useScroll` (Framer
  Motion) confirme qu'il est bien protégé (`typeof window === "undefined"`)
  et n'exécute rien de risqué en dehors d'effets — mais reste le
  composant le plus exposé structurellement : seul à dépendre d'un état
  de scroll global au moment précis où `/profil` est monté "à froid" lors
  d'une navigation client (contrairement à l'hydratation d'un F5, qui
  rejoue un rendu déjà produit côté serveur).

### Fix appliqué

- **`ParallaxHeader`** — retarde tout rendu lié à `scrollY` au premier
  rendu monté (`useSyncExternalStore`, même technique que
  `CursorTrailToggle` pour rester compatible avec la règle ESLint
  `react-hooks/set-state-in-effect`) : le tout premier rendu, serveur
  comme client, affiche le contenu dans un `<div>` simple, puis bascule
  sur la version `motion.div` avec le décalage parallax juste après.
  Élimine toute dépendance à `scrollY` pendant la phase de rendu la plus
  sensible, sans changement visuel perceptible.
- **`src/app/global-error.tsx`** (nouveau) — `error.tsx` existant ne
  couvre explicitement pas les erreurs du layout racine lui-même
  (`Header`, `auth()`, `CursorTrail` — cf. son propre commentaire) : une
  erreur à cet endroit précis produisait une page blanche muette plutôt
  qu'un message. Ce fichier comble ce trou (API Next.js dédiée) et logue
  l'erreur + son `digest` via `logger.error` — la prochaine fois qu'un
  crash survient à cet endroit, on aura enfin de quoi le diagnostiquer au
  lieu d'une page blanche silencieuse.

### Si le bug persiste après cette PR

Sans repro live possible ici, la piste la plus utile serait de coller le
contenu exact de l'onglet Console (F12) au moment du clic sur "Profil"
dans la nav — avec `global-error.tsx` en place, une éventuelle erreur du
layout racine sera au moins loguée (`logger.error`) au lieu de rester
invisible.

### Vérification

- `npx eslint .` : clean
- `npx next build` : compile et type-check sans erreur (45 routes)
- `npx vitest run` : 73 tests, tout vert
- Zéro régression PR #1-66

## Fix bug remonté : /profil blanche en navigation client — indice décisif (le resize la fait réapparaître)

### Nouvel indice du testeur

Complément du bug ci-dessus (PR #67, pas résolu) : la page reste
blanche en navigation client, mais **un simple resize de la fenêtre la
fait réapparaître instantanément** — comme le F5. Signature classique
d'un composant dont le tout premier rendu dépend d'un mécanisme externe
(ici un `IntersectionObserver`) qui ne se déclenche pas de façon fiable
sur un montage 100 % client, mais dont un resize force le recalcul.

### Root cause identifiée : `FadeInView`

`FadeInView` pilotait son animation via `whileInView` (Framer Motion,
donc un `IntersectionObserver` sous le capot) — utilisé sur `/profil` et
ses 4 sous-routes pour faire apparaître **le contenu entier de la page**
au chargement, jamais pour du vrai scroll-reveal de contenu hors écran
(à la différence de `RecapWrapped`, qui garde `whileInView` à raison).
Sur un montage purement côté client (navigation App Router — pas de HTML
serveur à hydrater, contrairement à un F5), la toute première
notification de l'observateur peut être retardée par le navigateur
jusqu'au prochain recalcul de layout — un `resize` (ou un scroll) en
force un, ce qui explique exactement le symptôme rapporté. Tant que rien
ne force ce recalcul, le contenu reste bloqué à `opacity: 0` : invisible,
mais toujours présent dans le DOM (aucune erreur JS à voir en console,
ce qui explique aussi pourquoi l'audit précédent — qui cherchait un
crash — n'avait rien trouvé côté `FadeInView`).

Recherche complémentaire demandée (`window.innerWidth`/`innerHeight`,
`matchMedia`, `ResizeObserver`) : aucun composant de l'app n'utilise ces
API pour conditionner un premier rendu — seuls `CountUp` (déjà safe) et
`CursorTrail` utilisent `matchMedia`, tous deux dans un effet, sans
jamais masquer de contenu.

### Fix

`FadeInView` ne dépend plus d'un `IntersectionObserver` : l'animation
est maintenant déclenchée par un `useEffect` (`requestAnimationFrame`,
garanti de s'exécuter après le commit — hard refresh comme navigation
client, sans dépendre d'un observateur externe ni d'un événement
utilisateur). Le contenu est **toujours rendu dès le tout premier
rendu** (jamais masqué en attendant un événement) ; seule l'animation
d'entrée est retardée d'une frame.

### Fichiers modifiés

- `src/components/ui/FadeInView.tsx` — retire `whileInView`, anime au
  montage via `useEffect`/`requestAnimationFrame`

### Vérification

- `npx eslint .` : clean
- `npx next build` : compile et type-check sans erreur (45 routes)
- `npx vitest run` : 73 tests, tout vert
- Zéro régression PR #1-67

## Fix bug remonté : /profil — le contenu apparaît puis disparaît (le fix précédent avait une faille)

### Confirmation finale du testeur

Le fix de la PR précédente (retirer `whileInView`) n'a pas suffi : en
navigation privée (donc pas une extension navigateur), le contenu de
`/profil` apparaît ~0.1s puis **disparaît** — un symptôme différent du
"jamais affiché" d'avant, qui pointait vers une faille dans le fix
lui-même plutôt qu'un nouveau bug.

### Root cause : le fix précédent démontait/remontait le nœud DOM

`FadeInView` gardait un `useState`+`useEffect` "monté ?" : premier
rendu → `<div>` simple (contenu visible), une frame plus tard → bascule
vers `<motion.div initial={{opacity:0}} animate={{opacity:1}}>`. Ce
changement de **type d'élément** (`div` → `motion.div`) force React à
démonter le premier nœud et en monter un tout nouveau — Framer Motion
applique alors `initial` (`opacity: 0`) instantanément sur ce nouveau
nœud, invisible le temps que `animate` le refasse apparaître sur 0.5s.
D'où : visible → invisible → visible à nouveau, exactement le symptôme
rapporté. Le même défaut existait dans `ParallaxHeader` (ajouté par
précaution dans une PR encore antérieure, jamais confirmé nécessaire —
son usage de `useScroll` est SSR-safe par construction, vérifié dans le
code source de Framer Motion).

### Fix radical (comme demandé, sans demi-mesure)

Les deux composants n'ont plus qu'un seul élément `motion.div`, jamais
démonté/remonté :

- **`FadeInView`** — plus de `useState`/`useEffect` du tout. Juste
  `initial={{opacity:0, y:20}}` + `animate={{opacity:1, y:0}}` sur un
  unique `motion.div`, animé au montage par Framer Motion lui-même
  (jamais `whileInView`, jamais d'`IntersectionObserver`) — fiable de
  façon identique en hydratation (F5) comme en montage 100% client
  (navigation).
- **`ParallaxHeader`** — retrait de la garde `useSyncExternalStore`
  ajoutée par précaution : inutile (le composant est déjà SSR-safe) et
  dangereuse pour la même raison structurelle que ci-dessus.

Vérification demandée sur `whileInView` + `initial` opacity 0 dans tout
le reste de l'app : `FadeInView` est utilisé uniquement sur `/profil`
et ses 4 sous-routes (`historique`, `badges`, `superlatifs`, `saisons`)
— aucun autre composant sur `home`, `potes`, `classement`, `soirées`,
`calendrier` ou `bibliothèque` n'utilise ce couple. Seul
`RecapWrapped` (`/recap/[year]/[month]`, hors de la liste de pages à
vérifier) garde `whileInView` — délibérément : chaque stat doit
apparaître au moment précis où on scrolle jusqu'à elle (effet "Spotify
Wrapped"), un vrai besoin de scroll-reveal que `FadeInView` n'a jamais
eu. Laissé tel quel ; à signaler si un bug similaire y est constaté.

### Fichiers modifiés

- `src/components/ui/FadeInView.tsx` — un seul `motion.div`, `initial`/
  `animate` uniquement, plus aucun état de montage manuel
- `src/components/ui/ParallaxHeader.tsx` — retrait de la garde de
  montage devenue inutile (et dangereuse)

### Vérification

- `npx eslint .` : clean
- `npx next build` : compile et type-check sans erreur (45 routes)
- `npx vitest run` : 73 tests, tout vert
- Zéro régression PR #1-68

## Fix bug remonté : cron avatars Discord "Succès" sur cron-job.org mais rien ne se met à jour, aucune trace Vercel

### Diagnostic

`refreshAllDiscordProfilesViaBot()` (`src/lib/discord-profile.ts`) fait
un retour anticipé silencieux — `{ checked: 0, updated: 0 }`, HTTP 200 —
si `DISCORD_BOT_TOKEN` n'est pas configurée sur le déploiement. C'est
déjà le diagnostic posé dans le fix précédent ("Fix bugs remontés : cron
avatars Discord silencieux...", plus haut) qui avait ajouté les logs
structurés manquants — mais la rétention des logs Vercel sur le plan
Hobby est courte, et un run silencieux (200 OK sans rien faire) toutes
les heures est facile à manquer entre deux consultations. Le diagnostic
ne peut donc plus dépendre uniquement des Vercel Logs.

Vérifications complémentaires demandées :
- `DISCORD_BOT_TOKEN` est bien lu depuis `process.env` (`discord-profile.ts`).
- `GET /users/{id}` avec un jeton de **bot** (`Authorization: Bot ...`)
  est un endpoint public de l'API Discord — il ne nécessite pas que le
  bot partage un serveur avec l'utilisateur (contrairement à un endpoint
  membre de guilde). Vérifié correct, pas un bug de requête.
- Bascule sur les jetons OAuth individuels de la table `Account`
  (Auth.js) **délibérément écartée** : c'est précisément le mécanisme
  que ce cron a été créé pour contourner (`refreshDiscordProfile`,
  toujours utilisée par `auth.ts`, dépend du jeton OAuth de chaque user
  qui expire au bout de ~7 jours sans jamais se renouveler — cf. le
  commentaire de `refreshAllDiscordProfilesViaBot` lui-même). Y basculer
  réintroduirait exactement le bug que ce cron corrige.

### Fix

- **Le JSON de réponse porte maintenant la cause exacte** —
  `botTokenConfigured`, `failed`, `error?` — visible directement dans
  l'historique des runs de cron-job.org (qui affiche le corps de chaque
  réponse), sans dépendre des Vercel Logs.
- Log `logger.info` en tout premier dans le handler, avant toute
  condition (`"Handler appelé."`) : si cette ligne n'apparaît jamais
  dans les Vercel Logs pour un run donné, la requête n'atteint pas ce
  handler du tout (mauvaise URL configurée sur cron-job.org — domaine de
  preview au lieu de prod, par exemple) ; si elle apparaît mais rien
  après, la cause est dans ce handler.
- Log explicite de l'issue de l'auth `CRON_SECRET` (401 loggé, ou
  avertissement si la variable n'est pas configurée).
- `DISCORD_BOT_TOKEN` absente passe de `logger.warn` à `logger.error`
  (plus visible/alertable) et compte désormais les échecs HTTP par user
  (`failed`) dans le résumé de fin de run.

### Si le bug persiste après cette PR

Si le prochain run cron-job.org affiche `"botTokenConfigured": false`
dans le corps de la réponse, la cause est confirmée : `DISCORD_BOT_TOKEN`
doit être ajoutée aux variables d'environnement du projet Vercel
(Production), pas seulement en local — action à faire côté dashboard
Vercel, aucun changement de code ne peut la remplacer.

### Fichiers modifiés

- `src/lib/discord-profile.ts` — diagnostic dans le retour JSON,
  compteur d'échecs, `warn`→`error`
- `src/app/api/cron/refresh-discord-profiles/route.ts` — log au tout
  début du handler, log explicite de l'auth

### Vérification

- `npx eslint .` : clean
- `npx next build` : compile et type-check sans erreur (45 routes)
- `npx vitest run` : 73 tests, tout vert
- Zéro régression PR #1-69

## Amélioration des features existantes, PR-A (profil enrichi, classement engageant, ligne "maintenant")

Première des deux PR de la demande "amélioration des features
existantes" (items 1, 2, 5 — profil, classement, calendrier ; la
seconde PR couvre récap de soirée, notifications groupées, roulette).
⚠️ Aucun `whileInView` Framer Motion nulle part dans cette PR — toutes
les animations utilisent `animate` déclenché au montage, conformément à
la contrainte explicite après les 3 PR de fix `/profil`.

### 1. Profil — section "📊 Statistiques"

Nouvelle section sur l'onglet Aperçu (`/profil`), entre "Prochaine
soirée" et "Dernière activité" :

- **Win rate** — `sessionResult.placement === 1` / total, calculé
  uniquement sur les soirées **compétitives** (`placement` non-null) :
  une soirée coop n'a pas de podium (`placement` toujours `null`, cf.
  `submitSessionResultsAction`), donc pas de notion fiable de
  "gagnée/perdue" à en tirer sans introduire un nouveau signal en base.
  `—` si aucune soirée compétitive jouée.
- **Meilleur streak historique** — nouveau champ `User.bestStreakCount`
  (migration), mis à jour dans `touchStreak()` en parallèle de
  `streakCount` (jamais décrémenté). `streakCount` repart à 1 dès qu'un
  streak casse, cet historique n'existait nulle part ailleurs — pas
  reconstructible rétroactivement, seulement à partir de maintenant.
- **Jeu le plus joué** (avec cover) — décompte en mémoire sur
  `SessionResult` (toutes soirées, coop incluses), même approche que
  `monthly-recap.ts` (pas de `groupBy` possible à travers une relation
  Prisma).
- **Pronos corrects** — réutilise l'agrégat déjà calculé sur cette page.
- **Total XP gagné en paris** — `xpBet.aggregate` sur les paris gagnés,
  ×2 (les paris gagnés payent double, cf. `resolveBets`).
- **Graphique XP 30 jours** — Recharts (nouvelle dépendance, `LineChart`
  simple), cumul reconstruit à partir de `xpTotal` actuel moins la somme
  des `XpEvent` de la fenêtre (pas de nouvelle table d'historique).
- **"Membre depuis X jours"** — sous le rang, dans la nouvelle section.

Aucune de ces stats ne nécessitait de migration à part
`bestStreakCount` — tout le reste est dérivable des modèles existants.

### 2. Classement — plus engageant

- **Deltas de position ↑/↓/=** — reconstruit le total XP d'il y a 7
  jours par soustraction (`xpTotal` actuel moins les gains `XpEvent` de
  la semaine écoulée), sans nouvelle table de snapshot hebdomadaire.
  Uniquement sur la période "Global" (seule où la position est stable
  dans le temps, pas réinitialisée comme "Ce mois"/"Cette semaine") —
  `null` sinon, pas de flèche affichée plutôt qu'un delta trompeur.
- **Barre de progression XP** vers le niveau suivant sous chaque ligne
  du classement (`levelProgress`, calculé sur `xpTotal` à vie comme le
  niveau lui-même).
- **Confettis légers sur le podium** — `canvas-confetti` (déjà une
  dépendance, utilisée par `CelebrationConfetti`), nouveau composant
  dédié `PodiumConfetti` avec des réglages volontairement discrets
  (peu de particules, gravité/vitesse basses) pour un effet "tombe
  doucement" plutôt qu'une explosion — distinct de
  `CelebrationConfetti`, un vrai burst pour une victoire ponctuelle, pas
  adapté à un effet d'ambiance rejoué à chaque visite de la page.

### 5. Calendrier — ligne "maintenant"

Trait horizontal orange dans `DayTimeline`, façon Outlook/Google
Calendar, uniquement sur le jour affiché s'il s'agit d'aujourd'hui
(`isToday`). Position verticale calculée en pourcentage de la hauteur de
la ligne d'heure courante (minute du jour / 60), fond de cette ligne
légèrement teinté (`bg-accent/5`). Se déplace en temps réel
(`setInterval` 60s, même pattern que `VotingCountdown` : valeur initiale
via un initialiseur paresseux de `useState` — jamais calculée dans le
corps de l'effet — pour éviter tout risque de décalage d'hydratation).
`wallClockNow()` (horloge murale Paris) plutôt que `new Date()` local,
cohérent avec le reste du fichier.

### Fichiers modifiés/ajoutés

- `prisma/schema.prisma` + migration — `User.bestStreakCount`
- `src/lib/xp-actions.ts` — `touchStreak` maintient `bestStreakCount`
- `src/app/profil/page.tsx` — section Statistiques
- `src/components/XpEvolutionChart.tsx` (nouveau) — Recharts
- `src/lib/scoreboard.ts` — `weekDeltaPosition`, `levelProgress`
- `src/app/classement/page.tsx` — flèches delta, barre XP, confettis
- `src/components/PodiumConfetti.tsx` (nouveau)
- `src/components/calendar/DayTimeline.tsx` — ligne "maintenant"
- `package.json` — nouvelle dépendance `recharts`

### Vérification

- `npx eslint .` : clean
- `npx next build` : compile et type-check sans erreur (45 routes)
- `npx vitest run` : 73 tests, tout vert
- Zéro régression PR #1-69

## Fix bug remonté : /profil blanc en navigation client — la vraie root cause (enfin)

### Nouvel indice décisif

Aucune erreur console. Le contenu est dans le DOM mais invisible
(`opacity`/`visibility`/`display` suspect), réapparaît au F5 ou au resize,
jamais en navigation client (clic menu). Les 3 PR précédentes
(`FadeInView`/`ParallaxHeader`, cf. sections plus haut) n'ont pas réglé le
problème — logique : elles corrigeaient de vrais défauts, mais pas
**celui-ci**.

### Root cause : `/profil` est la SEULE route avec une mise en page imbriquée

`PageTransition` (`src/components/PageTransition.tsx`, monté dans
`app/layout.tsx` autour de `{children}`, donc sur TOUTE l'app) anime un
fondu `initial={{opacity:0}}` → `animate={{opacity:1}}` sur un
`motion.div` unique keyé par `pathname`, sous `AnimatePresence
mode="wait"`. Ça fonctionne pour toutes les routes... sauf `/profil`, qui
est la seule à avoir sa propre `layout.tsx` EN PLUS de sa `page.tsx` —
`find src/app -maxdepth 2 -name layout.tsx` ne retourne que
`app/layout.tsx` et `app/profil/layout.tsx`, aucune autre route n'a ce
découpage. Les deux sont des Server Components `async` (chacun avec ses
propres requêtes Prisma).

Next.js diffuse donc `/profil` en plusieurs temps (le layout, puis la
page), alors que `PageTransition` ne voit qu'UNE seule clé (`pathname`)
pour toute la navigation. Le fondu se termine dès que le premier flux
arrive ; le contenu qui arrive ensuite (le vrai contenu de la page)
atterrit dans le calque déjà "figé" par le compositeur du navigateur —
invisible jusqu'à un reflow forcé (resize/F5 recalculent tout), sans
jamais lever d'erreur JS puisque rien ne plante réellement, c'est un
problème de peinture/compositing, pas de logique. `mode="wait"` aggrave
l'effet en séquençant explicitement sortie/entrée sur cette frontière
déjà fragile.

`MeshGradientBackground`/`GlassmorphismCard` (suggérés dans le rapport) —
vérifiés : **n'existent pas** dans ce code, aucune piste à explorer
là-dessus.

### Fix

`PageTransition` sort `/profil` (et toutes ses sous-routes) du fondu de
transition — rendu direct, sans `motion.div` ni `AnimatePresence`, sur
cette route précise seulement. Le reste de l'app (aucune autre route
n'a de layout imbriqué, donc aucune autre route n'est exposée à ce
défaut) garde le fondu normalement, zéro changement visuel ailleurs.

### Limite de vérification

Impossible de rejouer le scénario exact (navigation client vers
`/profil`) dans ce sandbox : `/profil` exige une session Discord
authentifiée, aucun compte de test disponible ici pour piloter un vrai
navigateur. Le diagnostic ci-dessus est structurel (le seul layout
imbriqué de l'app, comportement Next.js/Framer Motion documenté) et
vérifié par lecture de code, pas par capture DevTools réelle — à
confirmer par toi en prod comme demandé.

### Fichiers modifiés

- `src/components/PageTransition.tsx` — bypass du fondu pour `/profil`

### Vérification

- `npx eslint .` : clean
- `npx next build` : compile et type-check sans erreur
- `npx vitest run` : 73 tests, tout vert
- Zéro régression PR #1-71 (aucune autre route touchée)

## Fix 4 bugs remontés : cron avatars Discord, bannières GIF bloquées, cron rappels inactif, erreur PKCE

### Bug 1 — cron avatars Discord toujours sans effet

Correction du premier diagnostic transmis : le projet **n'a pas** de table
`Account` Auth.js avec des colonnes `access_token`/`refresh_token` — la
session utilise `strategy: "jwt"` **sans adaptateur Prisma**, donc Auth.js
ne persiste jamais de jeton en base nulle part. C'est justement la cause
racine du bug : jusqu'ici, un jeton OAuth Discord ne vivait que dans le
cookie de session chiffré de l'utilisateur connecté, invisible et
inaccessible à un cron qui tourne hors de toute session.

Le jeton **bot**, lui, existait déjà (`DISCORD_BOT_TOKEN`, PR précédente)
mais restait silencieux en pratique : `GET /users/{id}` avec `Authorization:
Bot ...` est fiable, donc le vrai suspect était soit la variable absente
sur Vercel, soit un problème de rate-limit/erreurs HTTP jamais remontées
clairement — les deux plus difficiles à diagnostiquer sans jeton individuel
de comparaison.

**Nouvelle architecture (ce fix)** : `src/auth.ts`, callback `jwt`, persiste
désormais `discordAccessToken`/`discordRefreshToken`/`discordTokenExpiresAt`
sur la ligne `User` elle-même (3 nouvelles colonnes, migration
`add_discord_oauth_tokens`) à chaque connexion OAuth réelle. Le cron
`/api/cron/refresh-discord-profiles` (`refreshAllDiscordProfiles`,
`src/lib/discord-profile.ts`) :
1. **Mécanisme principal** — pour chaque user avec un jeton stocké,
   rafraîchit son `access_token` via `POST
   https://discord.com/api/v10/oauth2/token` (`grant_type=refresh_token`)
   si expiré (avec marge de sécurité de 5 min), persiste la nouvelle paire
   de jetons (Discord **fait tourner** le `refresh_token` à chaque usage —
   l'ancien devient invalide, il faut toujours sauvegarder le nouveau), puis
   rappelle `/users/@me` pour mettre à jour avatar/pseudo.
2. **Repli bot** — uniquement pour les users qui n'ont pas encore de jeton
   stocké (pas reconnectés depuis ce déploiement), en réutilisant
   `DISCORD_BOT_TOKEN` comme avant.

Réponse JSON détaillée : `{ oauth: { checked, updated, skipped, failed },
bot: { checked, updated, failed } }`, avec un log `logger.info` récapitulatif
à la fin de chaque run et un log au tout premier appel du handler (même
garde-fou que le fix cron précédent).

**Limite connue (rollout progressif)** : les jetons OAuth ne se peuplent en
base qu'à la PROCHAINE vraie reconnexion de chaque utilisateur (une session
JWT peut rester valide jusqu'à 30 jours sans repasser par le flux OAuth).
Entre le déploiement de ce fix et cette reconnexion, ces users restent
couverts par le repli bot (donc le cron continue à fonctionner pour eux,
sans interruption), puis basculent automatiquement sur le mécanisme
principal dès leur prochain login.

### Bug 2 — bannières GIF bloquées (`ERR_BLOCKED_BY_RESPONSE.NotSameOrigin`)

Le blocage vient d'un en-tête `Cross-Origin-Resource-Policy` posé côté
hébergeur du GIF (klipy.com) sur SA réponse — pas quelque chose que
`referrerPolicy`, `next.config.js` ou tout autre réglage côté navigateur/app
peut contourner : `referrerPolicy` ne gouverne que l'en-tête `Referer`
sortant, un mécanisme sans rapport avec CORP. Ajouté quand même à
`BannerImage` (demandé, inoffensif) mais ce n'est pas le vrai fix.

Changements :
- `klipy.com` ajouté à `images.remotePatterns` (`next.config.ts`) — utile
  pour d'autres hébergeurs de bannière compatibles `next/image`, mais **ne
  résout pas** un blocage CORP (celui-ci bloque même une requête `<img>`
  native, avant que `next/image` n'entre en jeu).
- Nouveau composant partagé `src/components/BannerImage.tsx` : `<img>`
  natif (nécessaire pour disposer d'un événement `onError`, absent d'un
  `background-image` CSS) avec `onError` basculant sur le même dégradé de
  secours (`bannerFallbackStyle`) que l'absence de bannière — **c'est le
  vrai fix** : une bannière bloquée par CORP reste invisible sans previous
  fix, désormais elle affiche proprement le dégradé de la couleur du user
  au lieu d'un blanc/erreur silencieux. Utilisé sur `/profil` et `/potes`.

### Bug 3 — cron rappels inactif depuis le 21/08

L'URL de la route n'a jamais changé (`/api/cron/reminders`, export `GET`
uniquement, cohérent avec toute la documentation existante) — vérifié via
l'historique git. La date du 21/08 correspond exactement au commit de
migration du cron Vercel (limité à un intervalle minimum non disponible sur
le plan Hobby) vers un cron externe (cron-job.org) : tout indique une
configuration cron-job.org jamais finalisée ou une désactivation
automatique après une série d'échecs (comportement cron-job.org : un job qui
échoue plusieurs fois d'affilée est auto-désactivé et doit être
**manuellement réactivé** dans le dashboard — aucun changement de code ne
peut le faire à sa place).

Durcissement appliqué (pour empêcher que ça se reproduise une fois
réactivé) : la boucle de scan/envoi de rappels est maintenant enveloppée
dans un try/catch renvoyant `{ checked: 0, sent: [], error }` en HTTP 200 au
lieu de laisser une éventuelle erreur inattendue remonter en 500 non
capturé (même garde-fou que les autres crons du projet) ; log
`logger.info` au tout premier appel du handler ; log explicite de l'échec
d'authentification `CRON_SECRET`.

**Action manuelle requise** : vérifier/réactiver le job dans le dashboard
cron-job.org, et confirmer que l'URL configurée pointe vers le domaine de
production (`https://gamenight-zeyfro.vercel.app/api/cron/reminders`) avec
l'en-tête `Authorization: Bearer <CRON_SECRET>`.

### Bug 4 — erreur PKCE (`pkceCodeVerifier value could not be parsed`)

`trustHost: true` et `AUTH_URL` sont déjà correctement configurés
(`src/auth.ts`, `.env.example`) — écartés comme cause. Recherche des
retours connus sur cette erreur Auth.js : aucune cause racine confirmée par
les mainteneurs à ce jour ; le pattern le plus documenté dans la communauté
est la perte de cookies lors d'une redirection OAuth cross-origin ouverte
depuis un **navigateur intégré** (in-app browser d'une autre app — typiquement
le navigateur intégré de l'app mobile Discord elle-même quand le lien de
connexion est ouvert depuis là), qui bloque plus agressivement les cookies
que Safari/Chrome/Firefox. Auth.js masque volontairement la vraie cause
derrière `error=Configuration` sur toute erreur de ce type — seul le
callback `logger.error` de `auth.ts` (déjà en place) en garde la trace
réelle côté serveur.

Fix appliqué, à la mesure de cette confiance : le message affiché sur
`error=Configuration` (`src/app/page.tsx`) est maintenant actionnable —
il suggère d'ouvrir le lien dans le navigateur du téléphone plutôt que
depuis l'app qui l'a ouvert, au lieu d'un message générique. Aucun
changement spéculatif de configuration cookies/PKCE n'a été fait sans
cause confirmée (risque de régression pour les users qui se connectent
normalement).

### Fichiers modifiés/ajoutés

- `prisma/schema.prisma` + migration `add_discord_oauth_tokens` —
  `User.discordAccessToken`/`discordRefreshToken`/`discordTokenExpiresAt`
- `src/auth.ts` — persistance des jetons OAuth en base (callback `jwt`)
- `src/lib/discord-profile.ts` — `refreshDiscordAccessToken`,
  `refreshAllDiscordProfilesViaOAuth`, `refreshAllDiscordProfiles`
  (nouveau point d'entrée combiné OAuth + repli bot)
- `src/app/api/cron/refresh-discord-profiles/route.ts` — branché sur
  `refreshAllDiscordProfiles`, try/catch
- `src/components/BannerImage.tsx` (nouveau) — `<img>` + repli `onError`
- `src/app/profil/layout.tsx`, `src/app/potes/page.tsx` — utilisent
  `BannerImage`
- `next.config.ts` — `klipy.com` dans `remotePatterns`
- `src/app/api/cron/reminders/route.ts` — try/catch, logs
- `src/app/page.tsx` — message d'erreur `Configuration` actionnable
- `.env.example` — `DISCORD_BOT_TOKEN` redocumentée comme repli

### Vérification

- `npx eslint .` : clean
- `npx next build` : compile et type-check sans erreur (55 routes)
- `npx vitest run` : 73 tests, tout vert
- Zéro régression PR #1-73

## Feature : forcer la reconnexion globale (rollout du cron avatars Discord)

### Objectif

Le cron `refresh-discord-profiles` (PR 74) ne peut rafraîchir un avatar via
OAuth que pour les users ayant un jeton stocké en base — posé uniquement à
une VRAIE reconnexion (voir `auth.ts`). Sans action, ce rollout resterait
lent et passif (jusqu'à 30 jours par user, durée de vie max d'une session
JWT). Cette feature ajoute un déclencheur explicite, à usage ponctuel :
déconnecter tout le monde d'un coup pour accélérer ce rollout, avec une
notif Discord expliquant pourquoi.

### Correction de piste : pas de "table Account" à vider

La demande initiale supposait d'invalider les sessions "en changeant
AUTH_SECRET" ou via une table `Session`/`Account` Auth.js — rappel du même
point que la PR 74 : cette app utilise `session: { strategy: "jwt" }` sans
adaptateur Prisma, donc aucune table de ce genre n'existe. Changer
`AUTH_SECRET` invaliderait bien tous les JWT existants, mais de façon
brutale et non pilotable depuis le code applicatif (secret d'environnement,
pas une donnée en base) — pas de notif propre au bon moment, pas adapté à
un déclenchement depuis un bouton `/admin`.

### Fonctionnement retenu (schéma `sessionVersion`-like, sans nouveau champ sur le JWT à invalider)

- `User.forceReloginAt` (`DateTime?`) — un seul timestamp, posé à la même
  valeur sur TOUS les users par `triggerGlobalRelogin`
  (`src/lib/force-relogin.ts`).
- `token.sessionCreatedAt` (JWT, `auth.ts`) — posé UNE SEULE FOIS par
  session, à la connexion OAuth fraîche (jamais réécrit ensuite, jusqu'à
  expiration/reconnexion).
- `getCurrentUser()` (`src/lib/current-user.ts`) compare les deux : si
  `forceReloginAt` est plus récent que `sessionCreatedAt` du token courant
  (ou si le token n'a pas ce champ du tout — le cas de TOUTES les sessions
  actives avant ce déploiement), la session est traitée comme déconnectée
  (`getCurrentUser` renvoie `null`). Chaque page protégée fait déjà
  `if (!user) redirect("/")` : aucun changement nécessaire là où l'app
  utilise déjà `getCurrentUser()` pour ses gardes d'accès (toutes les
  server actions, déjà auditées — voir plus bas pour les 3 exceptions
  écartées).
- Pas de cookie à effacer explicitement, pas de table à purger : la
  prochaine vraie reconnexion OAuth repose un `sessionCreatedAt` frais qui
  repasse après `forceReloginAt`, donc pas de reboucle.

### Bug corrigé en cours de route : pages qui gardaient `auth()` comme source de vérité

`session?.user` (retour brut de `auth()`) reste VRAI pour un JWT posé avant
un `forceReloginAt` — Auth.js ne sait rien de ce marqueur, purement
applicatif. Trois endroits utilisaient encore ce raccourci au lieu de
`getCurrentUser()` pour décider quoi afficher, ce qui aurait cassé le but
même de la feature :
- `src/app/page.tsx` — gardait `if (!session?.user)` pour décider d'afficher
  l'écran de connexion, puis appelait `getCurrentUser()` plus bas et
  faisait `return null` (page blanche) si `null` — l'inverse du but
  recherché. Corrigé : `getCurrentUser()` appelé en premier, c'est lui qui
  décide de la branche "écran de connexion".
- `src/app/layout.tsx` — `BottomNav`/`GuideFab`/confettis restaient
  affichés (gate sur `session?.user`) par-dessus l'écran de connexion.
  Corrigé : gate sur `getCurrentUser()`.
- `src/components/Header.tsx` — même chose pour les liens de nav/cloche de
  notifications. Corrigé.

Les 3 routes API restantes qui utilisent encore `auth()` directement
(`/api/steam/link`, `/api/steam/callback`, `/api/igdb/search`) sont
volontairement laissées telles quelles : narrow, sans rendu UI affecté,
risque de régression sur un flux OAuth tiers (Steam) jugé disproportionné
par rapport au gain (fenêtre de tolérance de quelques jours max, pas un
enjeu de sécurité — cette feature accélère un rollout, ce n'est pas une
révocation de sécurité).

### UI (bouton) vs route API (`CRON_SECRET`) — deux chemins, un seul cœur

La demande initiale imaginait un unique endpoint protégé par
`CRON_SECRET`, sur le modèle des routes `/api/cron/*`. Distinction faite en
pratique, pour rester cohérent avec le reste de l'app :
- **Bouton admin** (`/admin?tab=reglages`, `ForceReloginCard` +
  `forceReloginAction`) — appelle une SERVER ACTION exécutée côté serveur,
  jamais un `fetch` vers la route HTTP : `CRON_SECRET` n'a donc pas besoin
  d'être exposé au navigateur. Accessible à tout le monde, comme le reste
  de `/admin` ("Pas de rôle admin dédié : tout le monde peut gérer ces
  réglages.", déjà le cas pour Messages/Récompenses/Badges/Jeux-stats) —
  protégé uniquement par une confirmation modale (même gabarit que
  `DeleteSessionDialog`, seule autre action destructrice du projet) et un
  rate limit strict (1 déclenchement / 10 min).
- **Route `/api/admin/force-relogin`** (POST, `Authorization: Bearer
  <CRON_SECRET>`) — pour un déclenchement manuel/scripté (`curl`) sans
  passer par l'UI, exactement le besoin décrit dans la demande initiale.
  Les deux chemins appellent le même cœur, `triggerGlobalRelogin()`
  (`src/lib/force-relogin.ts`).

### Notif Discord

Un seul appel `postToDiscord` dans `triggerGlobalRelogin` — le
déclenchement lui-même (clic admin ou appel API) EST l'unique envoi, pas de
logique de déduplication supplémentaire nécessaire (action manuelle, pas un
cron répété). Message exact demandé : "🔄 Mise à jour de l'app —
reconnectez-vous pour profiter des dernières features ! 👉 [lien]", avec un
embed assorti. Best-effort (même convention que le reste du projet) : un
échec Discord ne bloque jamais la reconnexion forcée, déjà actée en base.

### Fichiers modifiés/ajoutés

- `prisma/schema.prisma` + migration `add_force_relogin_at` —
  `User.forceReloginAt`
- `src/types/next-auth.d.ts` — `Session.user.sessionCreatedAt` /
  `JWT.sessionCreatedAt`
- `src/auth.ts` — pose `sessionCreatedAt` à la connexion fraîche, l'expose
  dans le callback `session`
- `src/lib/current-user.ts` — check `forceReloginAt` vs `sessionCreatedAt`
- `src/lib/force-relogin.ts` (nouveau) — `triggerGlobalRelogin`
- `src/app/admin/reglages/actions.ts` (nouveau) — `forceReloginAction`
- `src/components/admin/ForceReloginCard.tsx`,
  `src/components/admin/ReglagesTab.tsx` (nouveaux)
- `src/components/admin/AdminTabs.tsx`, `src/app/admin/page.tsx` —
  nouvel onglet "Réglages"
- `src/app/api/admin/force-relogin/route.ts` (nouveau) — déclenchement
  manuel/scripté, `CRON_SECRET`
- `src/app/page.tsx`, `src/app/layout.tsx`, `src/components/Header.tsx` —
  gate sur `getCurrentUser()` au lieu de `session?.user` brut

### Vérification

- `npx eslint .` : clean
- `npx next build` : compile et type-check sans erreur (56 routes)
- `npx vitest run` : 73 tests, tout vert
- Zéro régression PR #1-74
