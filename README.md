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
| `AUTH_REQUIRE_GUILD_MEMBER` | *(Optionnelle)* `true` exact = un **nouveau** compte doit avoir un Membership autorisé dans une communauté ACTIVE, confirmé par OAuth `guilds` (`/users/@me/guilds`, paginé). Existants/admins exemptés de cette admission, jamais de la frontière communautaire. Erreur ou liste partielle = connexion fraîche refusée sans révoquer les Membership. Isolation/picker ON synchronisent également les comptes existants ; tous trois OFF = login historique sans appel guilds. Voir [rollout](docs/COMMUNITY_ROLLOUT.md). |

Le tableau complet (variables V2, interrupteurs, défauts, fichier de lecture) est dans « V2 — Référence : variables d'environnement », en fin de document.

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
- La commande `npm run build` conserve `prisma migrate deploy` avant `next
  build` en production. Avec `VERCEL_ENV=preview`, elle exécute uniquement
  `prisma generate` puis `next build` : migrer séparément une base Preview
  isolée, jamais la production depuis une Preview. Voir
  [le bilan de stabilisation V2](docs/STABILISATION_V2.md).
- **PR "build ne fait plus que compiler"** : `npm run build` ne fait
  désormais QUE migrations de production puis compilation (Preview : génération
  Prisma et compilation) — aucune écriture de
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
- **Taux de présence (L5-04)** : les saisies de résultats enregistrent le
  statut présent/absent de chaque voteur de la proposition gagnante, conservé
  même après la purge de la soirée. `/profil` affiche le taux par communauté
  active. Les résultats antérieurs à cette migration ne sont pas reconstitués,
  car les absences n'y étaient pas conservées. Dans `/admin → Communautés`,
  un admin peut activer un bonus prudent de 2 XP par présence et un malus de
  1 XP par absence explicitement décochée à la saisie; tous deux sont
  désactivés par défaut, réglables de 0 à 20 XP, et une perte ne descend
  jamais le solde sous zéro.
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

**Rappels pendant le vote.** La route lit aussi les soirées `VOTING` du chemin bot (`announceViaBot`) : un rappel part à son heure réelle (date − délai) même si le vote n'est pas clos. Avant, seules les soirées `SCHEDULED` à jeu décidé étaient lues : un « 15h avant » ne partait jamais, et un « 1h avant » était perdu si le vote se clôturait trop près de la soirée. Un délai dont l'échéance précède la **création** de la soirée (« 15h avant » pour une soirée créée 10h avant) est marqué résolu sans envoi, sans alerte (`computeTimingsDue`, `createdAt` converti en horloge murale par `toWallClock`). À la mise en production, une soirée déjà en vote dont un délai est déjà passé reçoit UN rappel de rattrapage avec le temps réellement restant. Le webhook historique ne poste toujours rien. Précision du cron : un rappel peut arriver jusqu'à une période de cron en retard (15 min).

À chaque appel, la route (`src/app/api/cron/reminders/route.ts`) parcourt
les sessions `SCHEDULED` à jeu décidé et à venir, et envoie un rappel pour
chaque timing de `Session.reminderTimings` dès que le seuil est franchi
*et* que ce timing n'a pas déjà été envoyé (`Session.remindersSent`,
tableau JSON de minutes en string, ex. `["1440", "120"]` — évite les
doublons entre deux appels **successifs** sur le même timing ; la
protection contre deux exécutions **simultanées** est un mécanisme
séparé, voir « Protection contre les envois en double » ci-dessous). Une
session créée
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

### Protection contre les envois en double (verrou global)

`Session.remindersSent` empêche un timing déjà envoyé avec succès d'être
renvoyé lors d'un appel **suivant**, mais ne protège pas contre **deux
exécutions en cours en même temps** (ex. un cron externe qui redéclenche
avant la fin d'un run précédent) : les deux liraient le même
`remindersSent` "pas encore envoyé" avant que l'une des deux ait eu le
temps d'écrire son résultat, et enverraient chacune le même rappel
Discord.

Fix : un verrou global (`CronLock`, `src/lib/cron-lock.ts`), une seule
ligne singleton (`name = "reminders"`) créée par la migration
`20260914120000_add_cron_lock` — **pas** par le seed quotidien/décorrélé
(`runSeedReconciliation`, appelé uniquement par
`POST /api/backfill/seed-reconcile`), puisque `prisma migrate deploy`
s'exécute de façon synchrone dans `npm run build`, avant que le nouveau
déploiement ne serve le moindre trafic (cutover atomique Vercel) — la
ligne existe donc forcément avant le premier appel possible à la route.

- Acquisition **atomique** (un seul `updateMany` conditionné, même
  pattern que `claimSessionClose`/`finalizeSeasonIfDue`) : la route
  n'entre dans la boucle d'envoi que si elle a réussi à poser le verrou.
- Chaque exécution écrit un `token` aléatoire à l'acquisition et ne peut
  libérer **que son propre verrou** (comparaison sur ce `token`) — une
  exécution qui a dépassé le bail ne peut jamais écraser le verrou d'une
  exécution plus récente qui aurait déjà repris la main.
- **Bail (TTL) = 90s** : le `maxDuration` explicite de cette route est de
  60s (choix de route, pas le plafond du plan : défaut et maximum Vercel
  de 300s sur Hobby avec Fluid compute ; déclaré comme sur les routes de
  backfill IGDB/Steam/actus) +
  30s de marge pour la latence réseau et un éventuel écart d'horloge — une
  exécution ne peut de toute façon jamais dépasser 60s, donc un verrou
  plus vieux que le bail ne peut correspondre qu'à une exécution déjà
  morte.
- Si le verrou est déjà détenu par une autre exécution en cours, ce run
  s'arrête immédiatement (réponse `{ skipped: "already_running" }`, 200 —
  cas normal, pas une erreur, aucun rappel de cette session/ce timing
  n'est perdu : il sera repris par l'exécution qui détient le verrou, ou
  au prochain passage).
- Si la ligne `CronLock` manque ou que l'acquisition échoue pour toute
  autre raison, la route **échoue explicitement**
  (`{ error: "cron_lock_unavailable" }`) et n'envoie **aucun** rappel —
  jamais de dégradation silencieuse vers un envoi non protégé, même si ce
  cas ne devrait jamais se produire en pratique vu la garantie de la
  migration ci-dessus.

**Limites résiduelles assumées** (pas de solution — impossibles à éliminer
avec un simple verrou à bail, hors scope de ce fix) :

- **Doublon toujours possible** si une exécution dépasse elle-même le
  bail (dans les faits jamais plus de 60s, le `maxDuration` de la route) : une
  exécution suivante peut alors reprendre la main avant que la première
  ne soit réellement terminée. Le webhook Discord standard ne fournit
  aucun mécanisme d'idempotence (pas de clé de déduplication possible côté
  appelant) — une garantie "exactement une fois" n'est donc **pas**
  atteignable avec cette intégration, quel que soit le mécanisme de
  verrouillage choisi.
- **Un rappel peut rester manqué** si, après un crash, la prochaine
  exécution qui réussit à acquérir le verrou arrive après que `date` de
  la session soit déjà passée — le filtre `date: { gt: now }` de la route
  l'exclut alors définitivement. Comportement de filtrage inchangé par ce
  fix (déjà présent avant lui) : le choix fait ici priorise "ne jamais
  perdre un rappel à cause du verrou lui-même" plutôt que "garantir
  zéro doublon à tout prix" — un verrou par rappel individuel (claim
  avant envoi) aurait risqué l'inverse (perte définitive sur un crash
  entre la réservation et l'envoi réel), jugé pire.
- **Notifications in-app** (`createNotifications`, bulle 🔔) : leur propre
  risque de duplication (écrites avant même de connaître le résultat de
  l'envoi Discord) est **antérieur** à ce fix et **hors scope** — non
  traité ici, cf. le code de `sendSessionReminder`
  (`src/lib/discord-reminder.ts`).

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
un choix de route, pas le plafond Hobby (300 s avec Fluid compute) ; les deux backfills s'arrêtent volontairement avant cette
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

**Diagnostic « 25 jeux sur 134 ont `igdbDetailsFetchedAt` »** — le backfill n'a pas
perdu sa logique : la phase 1 (remplissage des jeux ayant un `igdbId` sans fiche)
existe, est testée avec 134 jeux, et progresse à chaque passage. Ce qui limitait
le débit : chaque fiche coûte ≈ 1,5-2 s (IGDB + traduction DeepL + pause anti-limite
de débit), soit **~28 fiches par passage de 50 s** (134 jeux = 5 passages). La route
passe donc à `maxDuration = 300` / budget **240 s** (comme `seed-reconcile`) : un
seul passage remplit ~130 fiches. En plus : chaque appel IGDB est borné à 15 s
(une requête qui ne répond jamais ne bloque plus tout le passage), et une fiche en
cache **sans date** (`igdbDetailsFetchedAt` null) est rafraîchie puis datée. Le cron
externe (cron-job.org) n'a pas à changer : la route répond toujours 202.

Un log de **couverture** est émis à chaque passage, pour suivre sans accès à la base :

```
[igdb-coop] Couverture IGDB : 25/134 fiche(s) datée(s), 109 restante(s), 0 introuvable(s), 0 en cache sans date.
```

(`introuvable` = IGDB ne connaît pas l'`igdbId`, retenté après 7 jours ; un nombre élevé
signale des `igdbId` erronés plutôt qu'un problème de débit.)

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
3. Méthode `GET` ou `POST` (`igdb-coop` accepte les deux ; `steam-store`
   reste en `POST`), en-tête `Authorization: Bearer <CRON_SECRET>` — sans
   `CRON_SECRET` côté serveur la route répond 503.
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
`/api/backfill/*`. GET et POST équivalents. **Réponse `202` immédiate** +
traitement dans `after()` (même contrat que `igdb-coop`/`steam-store`) :
cron-job.org coupe à 30 s alors que les 11 tâches (boucles N+1 vers Neon,
qui croissent avec les données) peuvent les dépasser. `maxDuration = 300`
(Hobby + Fluid compute : durée par défaut ET maximale 300 s) ; budget interne
240 s, vérifié ENTRE les tâches (une tâche n'est jamais interrompue).

```json
{ "status": "accepted", "message": "Réconciliation des seeds lancée en arrière-plan." }
```

Le résultat par tâche n'est **plus** dans la réponse : il est dans les logs
Vercel (contexte `seed-reconcile`) :

- `début (11 tâches, budget 240000 ms)`
- par tâche : `tâche X début` puis `tâche X fin <ms> ok|error`
- `fin stopReason=completed|time_budget|error durée=<ms> sautées=[…]`
  (`time_budget` = budget atteint, niveau **warn**, tâches restantes listées
  et reprises au passage suivant — tout est idempotent).
- Un `début`/`tâche X début` **sans `fin`** = coupure par la plateforme
  (> 300 s) : signal pour passer à un traitement avec curseur.

**Best-effort strict** : chaque tâche dans son propre `try`/`catch` (voir
`src/lib/seed-reconciliation.ts`) — un échec de l'une (`error` dans les
logs) n'empêche JAMAIS les 10 autres de s'exécuter, et la route répond
toujours `202`. **Pas de verrou** : deux passages simultanés ne dupliquent
rien (uniques `XpEvent`/`UserBadge`/`Badge`/`Tag`/`GroupAchievement`/`Season`/
`GameStatType`, violation attrapée par tâche) — seules exceptions, sans
contrainte unique : `SuperlativeCategory` et `MessageTemplate`, au tout
premier seed uniquement.

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
   `202 { "status": "accepted" }`, puis vérifier dans les logs Vercel
   (`seed-reconcile`) un `fin stopReason=completed` avec les 11 tâches `ok`.
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

## Architecture multi-communautés (fondations, PR A)

Objectif : un serveur Discord = une communauté isolée. Cette première PR pose
les fondations **sans changer le comportement** de l'app (migration
**additive** uniquement, motif expand/contract : rien n'est retiré ni rendu
obligatoire sur l'existant).

| Élément | Rôle |
| :-- | :-- |
| `Community` | Une communauté : `slug` unique (futur `/c/[slug]/…`), `discordGuildId` unique, statut `PENDING` (bot ajouté, en attente d'activation) / `ACTIVE` / `SUSPENDED` / `LEFT` (bot retiré, `leftAt` = départ des 30 jours de conservation) / `ARCHIVED`. |
| `CommunityChannelConfig` | Salon Discord par communauté et par catégorie (`SESSION`, `TOURNAMENT`) ; remplacera `DISCORD_BOT_*_CHANNEL_ID`. |
| `Membership` | Appartenance utilisateur ↔ communauté : rôle `OWNER` / `ADMIN` / `MEMBER`, statut `ACTIVE` / `LEFT` / `REMOVED`. Un seul OWNER actif (garanti en code). |
| `src/lib/default-community.ts` | `ensureDefaultCommunity` (12e tâche de seed-reconcile) crée/conserve default et son guild historique. Isolation/picker/porte AUTH OFF : rattachement historique des comptes sans aucun Membership, rôles OWNER/ADMIN/MEMBER acquis. Dès que l'un est ON : aucun rattachement automatique ; OAuth `guilds` est la source d'admission. Les statuts/rôles existants ne sont pas écrasés par le seed. |
| `src/lib/community-access.ts` | Point de contrôle : `requireMembership(communityId)` / `requireCommunityRole(communityId, min)`. Exige un Membership ACTIVE dans une communauté ACTIVE, relus en base à chaque appel (jamais dans le JWT) ; tout refus = 404 indistinct. Pas encore appelé par les pages (PR suivantes). |
| `src/lib/community-scope.test.ts` | Garde-fou statique : échoue si un nouveau code appelle `prisma.<modèle collectif>.<op>(…)` directement. `EXISTING_EXCEPTIONS` fige **185 couples fichier/modèle** (84 fichiers, 37 modèles collectifs), à vider au fil des PR de filtrage (jamais allonger). |

Modèles collectifs (37) : les 35 du plan (soirées, votes, superlatifs, XP,
saisons, tournois, chat, roulette, « Jouer maintenant », wishlist, succès et
stats de groupe…) + `Badge` / `UserBadge` (catalogues copiés par
communauté). Personnels : `User`, `UserGame`, disponibilités, préférences,
notifications, tags, tierlist. Globaux : `Game`, `GameNews`, `CronLock`.

Aucune nouvelle variable d'environnement. Après le déploiement, lancer une
fois `/api/backfill/seed-reconcile` (ou attendre le passage quotidien) pour
créer la communauté par défaut et les Memberships.

Discord (vérifié dans la doc officielle, voir la PR) : l'ajout du bot émet
le webhook d'événements `APPLICATION_AUTHORIZED` (`integration_type` 0 +
`guild` + `user`) ; une installation serveur exige `MANAGE_GUILD` ;
`GET /guilds/{id}/members/{user}` fonctionne sans l'intent privilégié
`GUILD_MEMBERS` ; aucun webhook pour le retrait du bot (contrôle par cron via
`GET /users/@me/guilds`).

Angles morts du garde-fou (borne basse assumée, à couvrir par revue tant que
le client scopé n’existe pas) :

- **SQL brut** (`$queryRaw` / `$executeRaw`) sur des tables collectives,
  présent dans 6 fichiers : `src/lib/retention.ts`, `src/lib/seasons.ts`,
  `src/lib/tournaments.ts`, `src/lib/xp-bets.ts`,
  `src/lib/notification-delivery.ts`, `src/app/tournois/actions.ts` ;
- **`include` imbriqués** (`prisma.user.findMany({ include: { xpEvents: true } })`) ;
- **scripts hors `src/`** (`prisma/*.mjs`), non analysés.

### Client Prisma scopé et colonnes `communityId` (PR7)

Infrastructure seule : **aucun appelant migré**, aucun changement de comportement (le client scopé est transparent quand `COMMUNITY_ISOLATION_ENABLED` est éteint). Les PR8 à PR11 migrent les accès un domaine à la fois en retirant les lignes de `EXISTING_EXCEPTIONS`.

| Élément | Rôle |
| :-- | :-- |
| Migration `20261005120000_community_id_collective_roots` | `communityId` **nullable** (+ FK `SetNull` + index) sur `ChatMessage`, `Debt`, `GameWishlist`, `Roulette`, `InstantSession`, `WeeklyChallenge`, `MonthlyRecap`, `Season`, `GroupAchievement`, `GroupSessionStats`, `GroupGameStat`, `GroupActiveWeek` (s'ajoutent à `Session` et `Tournament`). Additive, sans backfill : `NULL` = communauté `default`. Les modèles enfants (`Proposal`, `Vote`, `SessionResult`, `TournamentMatch`…) héritent de leur parent et n'ont pas de colonne. `XpEvent`/`LevelUpEvent` (PR12) et les catalogues (`Badge`, `MessageTemplate`…, PR13) sont hors périmètre. |
| `src/lib/community-scoped-client.ts` | `getScopedPrisma(userId)` / `scopedPrisma(scope)` : client `$extends` à nommer **`scopedDb`**. Lectures, `update*`, `delete*`, `upsert`, `count`, `aggregate`, `groupBy` : filtre `communityIdFilter` ajouté dans `AND` (aussi sur les opérations « unique »). Créations : `communityId` scalaire **obligatoire** et dans le périmètre (`null` seulement si `default` en fait partie). Une ligne ne change jamais de communauté. Opération inconnue : refusée. Périmètre vide : rien de visible. |
| Garde-fou `community-scope.test.ts` | Un accès `scopedDb.<modèle>.<op>(` n'est plus compté comme direct, mais tout fichier qui cite `scopedDb` doit appeler `getScopedPrisma`/`scopedPrisma`. `COMMUNITY_SCOPED_MODELS` est comparé aux modèles de `schema.prisma` portant `communityId`. |

**Bornes** (comme le garde-fou statique) : `include`/`select` imbriqués et SQL brut non filtrés. **À revoir par la PR de chaque domaine** : des clés uniques restent globales (`Season.number`, `WeeklyChallenge.weekStart`, `MonthlyRecap(year, month)` ; celles de `GameWishlist`, `GroupAchievement` et des tables `Group*` sont devenues composites en PR9) : deux communautés ne pourraient pas avoir chacune sa ligne tant qu'elles ne sont pas passées en clés composites avec `communityId`.

### Chat, dettes et accueil par communauté (PR8)

Derrière `COMMUNITY_ISOLATION_ENABLED` (éteint = comportement historique, aucune lecture ajoutée, `communityId` laissé à `null` à l'écriture comme en PR3).

| Surface | Règle |
| :-- | :-- |
| Chat — canal global | Messages de la communauté **active** de l'utilisateur seulement (`getActiveScopedPrisma`) ; envoi refusé sans communauté. |
| Chat — canal de soirée | Message rattaché à la communauté **de la soirée** (lue via le client scopé : soirée d'une autre communauté = refus) ; lecture dans le périmètre de toutes les communautés de l'utilisateur. Réaction sur un message hors périmètre : sans effet. |
| Dettes | `detectDebts` hérite de la communauté de la soirée (`scopedPrismaForCommunity`, quel que soit l'état d'appartenance du créateur). « Dettes du groupe » de l'accueil : communauté active. Badge 💀 (accueil, `/potes`) : toutes les communautés de l'utilisateur. Gage et paiement : une dette hors périmètre est introuvable. |
| Accueil — flux d'activité | « Soirée jouée » déjà filtrée (PR4). Badges, superlatifs et niveaux : limités aux membres visibles (`memberUserWhereFor`), **filtre provisoire** faute de `communityId` sur XP/badges/superlatifs. |

Reste global sur l'accueil (PR suivantes) : compteurs de groupe (`getGroupStats` : `GroupSessionStats`, `GroupGameStat`, streak, joueurs actifs) et succès de groupe (PR9), défi de la semaine (PR10), récap mensuel et saison (PR11), badges débloqués (PR12). Rétention et audit de stockage lisent `chatMessage`/`debt` en direct jusqu'à PR13.

### Wishlist, trophées et compteurs de groupe par communauté (PR9)

**Migration non purement additive** (`20261005140000_community_scoped_keys`) : `communityId` devient **obligatoire** et entre dans la clé de `GameWishlist` (`@@unique([communityId, gameId])`), `GroupAchievement` (`@@unique([communityId, key])`), `GroupSessionStats` (`@@unique([communityId])`, `id` en `cuid()`), `GroupGameStat` (`@@id([communityId, gameId])`) et `GroupActiveWeek` (`@@id([communityId, weekStart])`). Aucune donnée supprimée : la migration crée la communauté `default` si elle manque (mêmes valeurs que `ensureDefaultCommunityRecord`, qui la retrouve par son slug), y rattache toutes les lignes existantes, puis remplace les clés ; `onDelete` passe de SET NULL à CASCADE. Appliquée à blanc sur une base avec des lignes historiques (zéro dérive `prisma migrate diff`). **Fenêtre de déploiement** : entre la migration (build Vercel) et la mise en ligne du nouveau code, l'ancien code peut échouer à écrire dans ces tables (clôture de soirée, proposition de wishlist) : déployer hors des heures de jeu.

Ces tables n'ont **pas de `null`** : la communauté par défaut a un vrai identifiant (`getDefaultCommunityId`), utilisé aussi **isolation éteinte**. Le client scopé n'émet donc jamais `communityId: null` pour elles (`COMMUNITY_REQUIRED_MODELS`).

### Connexion OAuth multi-serveurs et bascule

Les domaines PR A #196 et PR B #197 et le correctif issuer #198 sont acquis.
Le login demande `identify email guilds` et lit `/users/@me/guilds` uniquement
dans le callback OAuth frais : une page courte = un appel, pagination après
200 résultats. Aucun appel d'appartenance Discord dans `jwt`, `session` ou les
pages. Le matcher ne parcourt pas toutes les communautés : guilds de
l'utilisateur intersectés avec les communautés connues ACTIVE en base.

Isolation, picker ou porte AUTH actifs : profil/Membership transactionnels,
comptes existants compris, LEFT réactivé, REMOVED préservé, communauté suspendue
exclue. Départ constaté à la prochaine connexion fraîche, préférence invalide
effacée ; erreur/page partielle = aucun changement d'appartenance. Sans serveur
autorisé : aucune donnée collective. Plusieurs serveurs sans choix valide avec
picker ON : aucune résolution de repli ; accueil et liste des soirées suivent
le serveur choisi. Les droits de setup restent ceux du payload Discord signé.

La [procédure de rollout](docs/COMMUNITY_ROLLOUT.md) contient sauvegarde,
seed-reconcile, ordre des flags, `forceReloginAt`, portail/commandes, bot/salons,
essai The Tower et rollback compatible A/B. Ajouter C ensuite demande uniquement
installation/configuration et connexion fraîche, aucune PR/migration/env serveur.
Les [mesures locales à 100/1 000 communautés](docs/COMMUNITY_LOAD_RESULTS.json)
ne valident pas une performance de production. **Flags production toujours OFF ;
The Tower n'est pas ouvert ni déclaré prêt par ces tests.**

| Surface | Règle |
| :-- | :-- |
| Compteurs de groupe (`markSessionDone`) | Écrits dans la communauté **de la soirée** (`null` → par défaut), dans la même transaction (accès direct assumé : écriture dérivée). |
| Accueil (`getGroupStats`) | Compteurs de la communauté **active** + joueurs de cette communauté ; isolation éteinte : somme de toutes les lignes (comportement historique). |
| Trophées (`checkGroupAchievements(communityId)`) | Calculés sur une communauté (ses soirées, ses compteurs, ses membres). Créés par `ensureGroupAchievements` : seed (communauté par défaut + ACTIVE), première lecture de l'accueil, ou clôture d'une communauté qui n'en a aucun. **Annonce Discord : uniquement la communauté par défaut** (salon de l'environnement) ; les autres ne sont pas annoncées. |
| Wishlist | Propositions dans la communauté **active** (refusées sans communauté) ; le même jeu peut figurer dans deux communautés ; vote hors périmètre sans effet ; le propriétaire déjà connu d'un jeu est cherché parmi les membres de la communauté ; achat détecté : toutes les communautés de l'utilisateur. |

Le test de rétention (`retention.integration.test.ts`) et l'ordre des clés sont adaptés ; `Game.wishlistEntry` / `Game.groupStat` deviennent des listes (`wishlistEntries`, `groupStats`), sans usage dans le code.

### Création automatique d'une communauté (PR2)

Éteinte par défaut : `COMMUNITY_AUTO_CREATE_ENABLED` doit valoir exactement `true`. Une communauté créée est **toujours `PENDING`** (aucun accès, aucun Membership avant l'activation par un admin).

| Élément | Rôle |
| :-- | :-- |
| `POST /api/discord/webhook-events` | Webhook d'événements Discord (Developer Portal → Webhooks, événement `APPLICATION_AUTHORIZED`). Publique, authentifiée par la signature Ed25519 (`DISCORD_APP_PUBLIC_KEY` ; 503 sans clé, 401 si invalide, vérifiée avant tout parsing). Seule une installation **serveur** avec le scope `bot` crée une communauté ; les installations utilisateur sont ignorées. Répond 204 (PING compris). |
| `/api/cron/community-guild-sync` | Rattrapage via `GET /users/@me/guilds` : crée en `PENDING` les serveurs manqués par le webhook, marque `LEFT` (+ `leftAt`) les communautés `PENDING`/`ACTIVE` dont le bot est parti. Fail-safe : liste vide, incomplète, en erreur ou création en échec = aucun `LEFT`. La communauté `default` n'est jamais marquée `LEFT` automatiquement. |
| `src/lib/community-provisioning.ts` | Création idempotente (webhook et cron peuvent se croiser) : serveur déjà connu → nom/icône seulement ; `LEFT` (bot réajouté) → `PENDING` ; `SUSPENDED`/`ARCHIVED` → jamais modifiée. |

### Activation par `/gamenight setup` (PR6)

Éteinte par défaut : `COMMUNITY_SETUP_COMMAND_ENABLED` doit valoir exactement `true`. Un membre qui a la permission **Gérer le serveur** (ou Administrateur) tape `/gamenight setup` : la communauté de son serveur passe `ACTIVE` sans validation manuelle (l'onglet admin « Communautés » reste le secours). **Attention** : tant que `COMMUNITY_ISOLATION_ENABLED` est éteint ou partiel (voir PR4), tout serveur activé donne à ses membres l'accès au contenu des autres communautés : n'allumer ce flag qu'après la bascule de l'isolation.

| Élément | Rôle |
| :-- | :-- |
| `POST /api/discord/interactions` | Endpoint d'interactions (portail → General Information → Interactions Endpoint URL). Publique, authentifiée par la signature Ed25519 (`DISCORD_APP_PUBLIC_KEY` ; 503 sans clé, 401 si invalide, avant tout parsing). Le PING de validation est toujours acquitté (PONG), flag éteint compris. Réponses éphémères, sans mention. |
| `src/lib/discord-interactions.ts` | Revérifie `MANAGE_GUILD`/`ADMINISTRATOR` sur `member.permissions` du payload signé (`default_member_permissions` n'est qu'un réglage d'affichage que les admins du serveur peuvent changer). Refuse hors serveur. |
| `src/lib/community-setup.ts` | Lit le vrai nom et l’icône Discord (y compris ACTIVE/default), vérifie les permissions du bot, crée une catégorie GameNight et les salons texte soirées/tournois manquants, enregistre CommunityChannelConfig puis active. Relance sur ACTIVE : complète sans écraser la configuration existante ; SUSPENDED/ARCHIVED : refusé. Verrou par guild et reprise des créations partielles, aucune migration. Aucun Membership créé (il naît à la connexion). |
| `scripts/discord-commands.json` + `scripts/register-discord-commands.mjs` | Définition de la commande globale (`default_member_permissions: "32"`, serveurs uniquement). Simulation par défaut ; `--execute` fait un `PUT` qui **remplace toutes les commandes globales** de l'application (`DISCORD_CLIENT_ID`, `DISCORD_BOT_TOKEN`). |

### Salons d'annonce par communauté (PR3)

Éteinte par défaut : `COMMUNITY_CHANNELS_ENABLED` doit valoir exactement `true`. Éteinte, **rien ne change** : `DISCORD_BOT_GUILD_ID` et `DISCORD_BOT_*_CHANNEL_ID` restent la seule source et aucune lecture de `CommunityChannelConfig` n'a lieu.

| Élément | Rôle |
| :-- | :-- |
| `Session.communityId` / `Tournament.communityId` | Colonnes **nullables** (migration additive, aucun backfill) : `null` = communauté `default` (toutes les lignes historiques). Renseignées à la création seulement si le flag est allumé. |
| `src/lib/community-channels.ts` | Résolution de la destination (serveur + salon) d'une communauté, fail-closed : communauté non `ACTIVE` ou introuvable = rien ; salon `enabled=false` = rien ; sans salon configuré, repli sur l'environnement **uniquement pour `default`**, jamais pour une autre communauté (une annonce ne part jamais dans le salon d'une autre). Le serveur est `Community.discordGuildId`, vérifié avec le salon avant tout envoi (`verifyChannelDestination`, inchangé). |
| `pickCreationCommunityId` | Communauté d'une nouvelle soirée/tournoi : la seule communauté ACTIVE du créateur ; s'il en a plusieurs, `default` si elle en fait partie, sinon la plus ancienne. Provisoire : l'écran de choix explicite du serveur (PR5) le remplacera. |

Branchements : création de soirée (`createSession`), soirée issue d'une roulette, création de tournoi (destination figée sur le tournoi comme avant), résolveurs d'envoi soirées et tournois (communauté relue au moment de l'envoi), page des invitations. Les lignes de `CommunityChannelConfig` s'écrivent depuis l'onglet « Communautés » de `/admin` (voir « Administration des communautés », drapeau `COMMUNITY_ADMIN_ENABLED`) ; le salon doit appartenir au serveur de la communauté, vérifié à l'enregistrement et à l'envoi.

### Isolation des données par communauté (PR4)

Éteinte par défaut : `COMMUNITY_ISOLATION_ENABLED` doit valoir exactement `true`. Allumée, l'utilisateur ne voit que les données des communautés `ACTIVE` où il a un `Membership` `ACTIVE` (relu en base à chaque requête) ; les anciens `communityId = null` désignent `default`. Fail-closed : sans aucune communauté, rien n'est visible. Éteinte, le client collectif reste transparent ; la progression PR B utilise néanmoins explicitement `default` pour les vues et la communauté du parent pour les récompenses dérivées.

| Couvert | Comment |
| :-- | :-- |
| Soirées (liste, accueil, calendrier, profil, roulette, détail) | `accessibleSessionWhere` / `getSessionAccessRole` : l'accès créateur/invité **et** la communauté (`AND`, jamais vide). |
| Invitations | `inviteToSession` refuse un invité non membre de la communauté de la soirée ; les listes d'invitables et de mentions sont limitées à cette communauté. |
| Tournois | Liste et détail filtrés ; `registerForTournamentAction` vérifie `canAccessTournament` ; mentions limitées à la communauté. |
| Potes | `/potes` limité aux membres de mes communautés ; `canViewPote` vérifié dans le layout **et dans chaque page** `/potes/[id]/*` (un layout n'est pas garanti de s'exécuter avant ses pages) ; le titre de page ne révèle plus le pseudo d'un autre. |
| Classement | `getScoreboard(période, { communityId })` : membres de la communauté demandée (`/classement?communaute=<id>`, `requireMembership` → 404 si non membre), sinon communauté active (`default` si membre, sinon la plus ancienne ; provisoire jusqu'à PR5). |
| Création | Sous isolation, une soirée/un tournoi reçoit toujours un `communityId` ; sans aucune communauté, la création est refusée. |

PR7–PR9 et [PR A](docs/COMMUNITY_DOMAINES_PR_A.md) couvrent les domaines collectifs, chat/dettes, roulette, « Jouer maintenant », superlatifs, pronostics, paris, défis, récaps et clés de saisons/tournois. [PR B](docs/COMMUNITY_DOMAINES_PR_B.md) ajoute XP, niveaux, badges et streaks par communauté, clôtures de saisons, récaps XP complets, annonces via les salons du serveur, administration métier et rétention filtrées. `CommunityMemberStats` remplace les anciennes colonnes de progression `User` dans les lectures et écritures vivantes. Les colonnes historiques restent conservées.

Les catalogues de jeux, définitions de badges/superlatifs, bibliothèques personnelles et administration de l'installation restent partagés. Les exceptions statiques restantes décrivent des accès système ou des enfants dont le parent doit être contrôlé ; elles ne constituent pas seules une preuve d'isolation. Aucun flag n'est activé par PR B : validations locales, échecs de baseline, limites historiques et contrôles avant production sont détaillés dans son document. Ajouter un serveur exige configuration, Membership et installation du bot, sans migration ou code spécifique à ce serveur.

Hors PR A (PR suivantes) : routes `/c/[slug]`, webhook d'événements Discord,
colonne `communityId` sur les modèles collectifs, filtrage des lectures,
client Prisma scopé. Étape « contract » (NOT NULL,
suppression) : interdite tant qu'elle n'est pas explicitement validée.

### Sélecteur de serveur (PR5)

Éteint par défaut : `COMMUNITY_PICKER_ENABLED` doit valoir exactement `true`. Éteint, `/serveurs` répond 404, aucune redirection, aucune lecture : comportement identique à avant.

Allumé, le header affiche en permanence le serveur actuel et son sélecteur, sur ordinateur et mobile. Le choix reste en base, sans déconnexion ; l’action revalide les Memberships et invalide les données de toutes les pages avant de revenir à l’accueil du serveur choisi. Un seul serveur est choisi automatiquement. Noms et icônes proviennent de Discord via setup puis le cron `community-guild-sync`, historique `default` compris.

Allumé, un utilisateur membre de **plusieurs** serveurs choisit celui que GameNight affiche :

| Situation (Membership ACTIFS, communauté ACTIVE) | Comportement |
| :-- | :-- |
| 0 serveur | `/serveurs` affiche « Le bot n'est sur aucun de tes serveurs » ; l'accueil, `/sessions`, `/tournois` et `/classement` y renvoient. |
| 1 serveur | C'est lui : `/serveurs` redirige vers `?next=` (chemin interne uniquement) ou l'accueil, rien n'est enregistré. |
| Plusieurs, choix enregistré valide | Le choix est utilisé ; `/serveurs` permet d'en changer. |
| Plusieurs, aucun choix valide | L'accueil, `/sessions`, `/tournois` et `/classement` renvoient sur `/serveurs?next=…`. |

**Le choix n'est jamais une autorisation.** `User.activeCommunityId` est revalidé contre les Membership ACTIVE et communautés ACTIVE à chaque usage. Un retrait/suspension en base coupe l'accès à la requête suivante ; un départ Discord est synchronisé à la prochaine connexion OAuth fraîche. Avec picker ON, plusieurs serveurs sans choix valide donnent `null` et exigent le sélecteur, sans repli silencieux. Picker OFF conserve la règle historique default/premier Membership valide. L'enregistrement exige le même contrôle ; l'accès reste décidé par `requireMembership` et les droits du parent.

Code : `src/lib/community-picker.ts` (drapeau, état, porte `requireCommunityChosen`, `safeNextPath`), `src/app/serveurs/` (page + action). Le drapeau est indépendant de `COMMUNITY_ISOLATION_ENABLED` : la porte impose le choix, c'est l'isolation qui filtre les données. **Appliquer la migration avant d'allumer.**

### Administration des communautés

Éteinte par défaut : `COMMUNITY_ADMIN_ENABLED` doit valoir exactement `true`. Éteinte, l’onglet n’apparaît pas dans `/admin` (`?tab=communautes` retombe sur « Messages »), les actions redirigent sans rien écrire et aucune lecture n’a lieu. **Aucune variable existante, migration ni logique de connexion n’est modifiée** : `Community.activatedAt` / `activatedById` et `CommunityChannelConfig` existaient déjà.

Onglet **Communautés** du hub `/admin`, réservé aux admins (`requireAdmin` : `ADMIN_DISCORD_IDS` ou `User.role = ADMIN`, comme le reste de `/admin`) :

| Action | Règle |
| :-- | :-- |
| Liste | Toutes les communautés : statut, serveur Discord, membres ACTIFS, salons configurés. |
| Activer | `PENDING` → `ACTIVE` uniquement (jamais depuis `SUSPENDED`, `LEFT`, `ARCHIVED`), serveur Discord requis ; `activatedAt` / `activatedById` renseignés ; `updateMany` filtré sur `PENDING` (deux clics simultanés n’écrasent rien). |
| Salons SESSION / TOURNAMENT | Communautés `PENDING` ou `ACTIVE` seulement. Le choix se fait dans la liste des salons texte du serveur (`GET /guilds/{id}/channels`), puis le salon est **revérifié côté serveur** (`verifyChannelDestination` : il appartient au serveur de la communauté et accepte les fils) avant l’`upsert` de `CommunityChannelConfig` (`enabled = true`). Discord injoignable ou salon étranger : rien n’est écrit. Aucun message n’est envoyé. |

Limites : pas de retrait ni de désactivation d’un salon depuis l’écran (une ligne se remplace), pas de suspension ni d’archivage. Sans `COMMUNITY_CHANNELS_ENABLED`, les salons enregistrés ne sont pas lus à l’envoi. Code : `src/lib/community-admin.ts`, `src/app/admin/communautes/actions.ts`, `src/components/admin/CommunitiesTab.tsx`, `listGuildChannels` dans `src/lib/discord-rest.ts`.

## Structure du projet

```
prisma/schema.prisma        # Schéma de données complet (§5)
src/auth.ts                 # Config Auth.js (provider Discord, callbacks)
src/lib/discord-token-crypto.ts # Chiffrement AES-256-GCM des jetons OAuth Discord stockés en base
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
src/lib/banner-blob.ts      # Détection de signature d'image + décision/suppression best-effort des blobs de bannière orphelins
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
src/app/sessions/actions/results.ts           # Server actions : saisie des résultats
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
confiance aveugle dans le client — voir « Durcissement des bannières »
ci-dessous pour le détail de cette validation serveur). Pas de
compression automatique dans FIX4 (ajoutée depuis côté client, voir plus
bas). Preview immédiate avant validation via `URL.createObjectURL` sur
les deux onglets.

### Durcissement des bannières (validation réelle + anti-orphelins)

`file.type` (le MIME déclaré par le navigateur au moment du `<input
type="file">`) n'est qu'une étiquette côté client, trivialement
falsifiable — renommer un fichier ou fabriquer un `File` arbitraire en
JS suffit. Avant cette PR, `uploadBannerAction` ne validait QUE ce champ.
Elle ne supprimait par ailleurs jamais l'ancien blob lors d'un
remplacement de bannière : chaque nouvel upload laissait l'ancien fichier
stocké indéfiniment sur Vercel Blob.

**Validation par signature (`src/lib/banner-blob.ts`,
`detectBannerImageSignature`).** Le format réel est désormais déterminé
en lisant les premiers octets du fichier (signatures documentées : JPEG
`FF D8 FF`, PNG `89 50 4E 47 0D 0A 1A 0A`, GIF `47 49 46 38 (37|39) 61`,
WebP `RIFF….WEBP`) — jamais `file.type`. Lecture seule, aucun décodage ni
réencodage : un GIF reste byte pour byte le fichier original, animation
comprise. L'extension ET le `contentType` passés à `put()` viennent de ce
format détecté, pas du champ déclaré — le Content-Type servi ensuite par
le CDN Vercel Blob devient fiable lui aussi. Une signature non reconnue
(fichier corrompu, ou tentative de déguiser un autre type de fichier en
image) est rejetée avec le même message que l'ancien contrôle de format.
Choix assumé : pas de nouvelle dépendance (type `file-type`) pour 4
signatures fixes et bien documentées — une vérification manuelle de
quelques octets est plus simple, entièrement auditable, et suffisante à
cette échelle.

**Suppression best-effort de l'ancien blob, jamais à l'aveugle.** Un
`bannerUrl` peut être soit une URL externe arbitraire, soit un blob Vercel
uploadé par n'importe quel membre du groupe : le distinguer avec
certitude demande deux preuves, pas une seule.
1. **Store** — `head(url)` du SDK `@vercel/blob` interroge l'API de
   gestion Vercel Blob (jamais l'URL elle-même), authentifiée par notre
   propre `BLOB_READ_WRITE_TOKEN` (le `storeId` qu'il encode est envoyé en
   en-tête `x-vercel-blob-store-id`, vérifié dans les sources locales du
   SDK, `chunk-YYMLUMXS.js`) : `head()` échoue pour tout blob qui
   n'appartient pas à NOTRE store, y compris un blob hébergé sur le même
   domaine `*.public.blob.vercel-storage.com` mais appartenant à un autre
   projet Vercel.
2. **Utilisateur** — un `head()` réussi prouve seulement que le blob est
   dans notre store, pas qu'il appartient à CET utilisateur : rien
   n'empêcherait un membre de coller comme bannière l'URL Blob d'un autre
   membre du même groupe. D'où le namespace `banners/{userId}/...`
   (`buildBannerBlobPathname`) pour tous les nouveaux uploads : la
   suppression n'est autorisée que si le pathname du blob commence
   exactement par `banners/{sonPropreUserId}/`.

Les anciens blobs uploadés avant cette PR (format plat
`banners/{userId}-{timestamp}.ext`, sans séparateur fiable) ne
correspondent à aucun des deux formats reconnus : ils restent
délibérément orphelins plutôt que d'être supprimés sur la foi d'un
parsing de chaîne fragile — un stockage inutilisé qui persiste est
largement préférable à un risque, même faible, de supprimer le fichier
d'un autre utilisateur.

**Ordre des opérations, strict dans les deux actions** (jamais de
suppression avant que la nouvelle valeur soit committée en base — sinon
un échec Prisma après coup laisserait `bannerUrl` pointer vers un fichier
détruit) :
- `uploadBannerAction` : upload du nouveau blob → mise à jour Prisma → si
  échec, nettoyage immédiat du blob tout juste créé (`?upload=echec`,
  jamais d'orphelin frais) → si succès, nettoyage best-effort de l'ancien
  blob (seulement s'il est prouvé nôtre pour CET utilisateur) →
  redirection.
- `setBannerUrlAction` (bascule vers une URL externe, ou vidage de la
  bannière) : mise à jour Prisma d'abord → nettoyage best-effort de
  l'ancien blob ensuite.
- Aucune suppression si l'ancienne et la nouvelle URL sont identiques
  (`shouldDeleteOldBanner`).

Aucune migration Prisma (la vérification se fait entièrement à la volée
sur `bannerUrl`, pas besoin de stocker le pathname séparément pour 6
utilisateurs). Tests (`src/lib/banner-blob.test.ts`) : détection de
signature, décision pure de suppression (`canDeleteBannerBlob`,
`shouldDeleteOldBanner`), et orchestration best-effort avec `head`/`del`
injectés (jamais d'appel Vercel Blob réel dans les tests).

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

### Notifications Web Push — navigateur (L6-13)

Le membre active ou retire lui-même chaque appareil dans Profil → Paramètres.
La livraison réutilise les notifications in-app; elle reste entièrement
inactive tant que `WEB_PUSH_ENABLED=true` et les trois paramètres VAPID ne
sont pas fournis. Aucun envoi Discord, cron ou service externe supplémentaire.
Un utilisateur peut enregistrer au plus cinq appareils; les abonnements
révoqués par le navigateur sont supprimés à la prochaine tentative.

Un administrateur déploie une paire VAPID persistante (`subject`, clé publique
et clé privée) puis configure `WEB_PUSH_ENABLED`,
`WEB_PUSH_VAPID_SUBJECT`, `WEB_PUSH_VAPID_PUBLIC_KEY` et
`WEB_PUSH_VAPID_PRIVATE_KEY`. Ne jamais régénérer une paire déjà utilisée ni
committer ces valeurs. La clé privée reste uniquement dans l'environnement
serveur; `.env.example` ne contient que des noms vides. En l'absence de ces
valeurs, l'interface affiche que le service est désactivé et l'API refuse les
nouveaux abonnements. Migration additive `web_push_subscriptions`.

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
  mécanique que `/api/backfill/igdb-coop`/`/steam-store`. **Planifié sur
  cron-job.org** : `https://ton-projet.vercel.app/api/backfill/game-news`,
  `POST`, quotidien à 05:00 (testé : réponse 202) — jamais appelé à un
  chargement de page.
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
- `src/app/sessions/actions.ts` —
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

Planifié sur cron-job.org : quotidien à 02:45, heure de Paris.

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

### Atomicité inscription / désinscription / lancement (fix concurrence, round 2)

`declareWinner`/`advanceWinner` étaient déjà protégés (claim atomique sur
`TournamentMatch.completedAt`, dans une transaction — voir PR "Atomicité
saisons + tournois"). L'inscription, la désinscription et la génération du
bracket ne l'étaient pas : chacune lisait `Tournament`/`TournamentParticipant`
puis écrivait, sans le moindre verrou.

**Bug remonté** : deux inscriptions concurrentes sur la toute dernière
place pouvaient toutes les deux passer le contrôle "places restantes"
(lu avant que l'autre n'ait committé) et dépasser `maxPlayers` — le
participant en trop restait inscrit en base mais silencieusement absent
du bracket (`generateBracket` ne prend que les `bracketSize` premiers
tirés). Variante plus grave : une désinscription atterrissant pendant la
fenêtre entre la lecture des participants de `generateBracket` (faite
hors transaction) et l'écriture de son bracket faisait planter la
transaction entière (`update` sur une ligne `TournamentParticipant` déjà
supprimée) — rollback complet, y compris le `status` déjà basculé en
`IN_PROGRESS`, erreur serveur visible côté créateur.

**Fix** : les trois parcours (`registerForTournamentAction`,
`unregisterFromTournamentAction`, `generateBracket`) verrouillent
maintenant D'ABORD la même ligne `Tournament`
(`SELECT ... FOR UPDATE`, avant toute lecture de `TournamentParticipant`)
dans une transaction, avant de re-vérifier `status`/places/déjà-inscrit
et d'écrire. Une seule ligne `Tournament` verrouillée par transaction,
jamais deux : Postgres sérialise les trois parcours entre eux sans aucun
risque de deadlock (pas d'ordre de verrouillage concurrent possible avec
une seule ressource par transaction).

Le cœur de la génération du bracket est extrait en
`buildBracketInTransaction(tx, tournamentId)` — appelée par le wrapper
public `generateBracket` (sa propre transaction, cas du lancement par le
créateur) OU directement par `registerForTournamentAction` quand
l'inscription en cours remplit la dernière place, en réutilisant SA
transaction déjà ouverte (jamais une seconde transaction imbriquée — le
verrou Postgres est réentrant pour une même transaction).

`declareWinner`/`advanceWinner` non touchés par ce fix — protection déjà
correcte, axe de concurrence différent (résolution d'un match, pas
mutation de la liste des participants).

**Limite honnêtement assumée** : comme pour les fixes précédents de ce
type (clôture de saison, pari XP, verrou cron), aucun mock Prisma
n'existe dans ce projet — l'atomicité du verrouillage ne peut être
prouvée que par lecture du diff, jamais par un test automatisé. Les
helpers purs déjà couverts (`bracketSizeFor`, `totalRoundsFor`,
`computeMatchLoser`, `computeNextSlot`) sont inchangés et leurs tests
existants passent toujours ; aucun nouveau helper pur n'a été introduit
par ce fix (la correction porte entièrement sur l'ordonnancement
transactionnel, pas sur une nouvelle logique de décision testable en
isolation).

### Lien direct dans l'annonce Discord de création (fix UX)

L'annonce "🏆 Tournoi ... — inscriptions ouvertes !" (`createTournamentAction`,
`src/app/tournois/actions.ts`) ne contenait jusqu'ici aucun moyen d'atteindre
`/tournois/{id}` depuis Discord — il fallait chercher la page à la main.

`resolveAppOrigin`/`resolveAbsoluteUrl` (`src/lib/app-url.ts`, fonctions
pures testées isolément) dérivent l'URL absolue de l'app **sans domaine
codé en dur**, à partir des variables que Vercel injecte automatiquement à
l'exécution (aucune configuration côté projet) :

- `VERCEL_ENV === "production"` → `VERCEL_PROJECT_PRODUCTION_URL` (domaine
  stable de Production, ou domaine personnalisé le cas échéant) ;
- sinon (Preview) → `VERCEL_URL` (URL unique du déploiement courant) —
  volontairement **pas** `VERCEL_PROJECT_PRODUCTION_URL` en Preview, sinon
  un lien Preview pointerait à tort vers la Production.

**Comportement explicite si l'URL ne peut pas être résolue** (dev local
sans ces variables, ou — cas qui ne devrait jamais arriver en déploiement
réel — variables Vercel absentes) : le lien est **omis** du message (texte
d'origine conservé tel quel), et un `logger.warn` explicite le signale —
jamais de lien cassé (`.../undefined`) envoyé dans Discord. `postToDiscord`
lui-même n'est pas modifié : son propre comportement (no-op + warning si
`DISCORD_WEBHOOK_URL` absente) reste inchangé et s'applique par-dessus,
indépendamment de la résolution de l'URL.

Portée volontairement limitée à cette seule annonce : les autres messages
Discord du projet (clôture de session, fin de saison, victoires de
tournoi, rappels...) n'ont pas été touchés — même limite pointée par la
reconnaissance préalable, traitée séparément si besoin.

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
- **Alertes L6-10** : option désactivée par défaut par communauté dans
  `/admin → Communautés`; un admin peut régler le seuil (20 % par défaut,
  borné à 5–80 %). Le contrôle utilise le prix France (`cc=fr`), tourne
  via la route `steam-library-sync` déjà déclenchée (aucun nouveau cron
  Vercel), et vérifie au plus 3 entrées par communauté toutes les 6 h,
  en rotation. Le proposant et les personnes ayant voté « intéressé »
  reçoivent une notification in-app; une même entrée a un délai de 7 jours
  entre alertes. Aucun Discord ni push n'est envoyé.

- **Plan d'achat collectif L6-11 (MVP)** : désactivé par défaut et activable
  par un admin dans `/admin → Communautés`. Le proposant peut indiquer une
  date visée et une note courte; le plan est visible avec les votes existants.
  La date et les votes restent indicatifs : aucune somme, promesse financière,
  paiement ou action automatique n'est collecté ou déclenché.

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

> Tableau historique (avant la V2) : voir « V2 — Référence : routes cron et backfill » en fin de document pour la version à jour.

Aucun doublon constaté (chaque cron couvre une tâche distincte) :

| Cron | URL | Fréquence | Ce qu'il fait |
| :--- | :-- | :-------- | :------------ |
| Clôture des soirées | `/api/cron/close-sessions` | 15 min | `VOTING → SCHEDULED/CANCELLED`, `SCHEDULED → DONE`, tirage des roulettes async dues, garde-fou Saison 1 |
| Rappels de soirée | `/api/cron/reminders` | 15 min | Envoie les rappels Discord programmés (`Session.reminderTimings`) |
| Sync bibliothèques Steam | `/api/cron/steam-library-sync` | 1h | Réimporte la biblio Steam de chaque compte lié, badges, détection d'achats wishlist |
| Rafraîchissement profils Discord | `/api/cron/refresh-discord-profiles` | 1h | Avatar/pseudo de tout le monde via le bot Discord (contourne l'expiration du token OAuth individuel) |
| Tâches mensuelles | `/api/cron/monthly-tasks` | quotidien à 02:45 | Clôture de saison si échue, génération du recap Wrapped du mois si le 1er |

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

**Cause** : le lien que l'on copie depuis la barre d'adresse de klipy (`https://klipy.com/gifs/<slug>`)
est une **page HTML**, pas une image. Cette page répond avec
`Cross-Origin-Resource-Policy: same-origin` (+ `X-Content-Type-Options: nosniff`) : le navigateur
refuse de l'embarquer dans un `<img>` d'une autre origine. Seuls les **liens d'image directs**
(`static.klipy.com/…`) fonctionnent : les fichiers médias y sont servis sans CORP
(`access-control-allow-origin: *`). Source : commentaire de `src/lib/banner-url.ts` (l. 1-16).

Ce n'est donc pas un réglage de l'app : `referrerPolicy` ne gouverne que l'en-tête `Referer` sortant
(sans rapport avec CORP), `next.config.ts` ne peut pas modifier la réponse de klipy, et un proxy ne
récupérerait que du HTML.

**Correctifs en place** :
- **Refus du lien de page** : `findBannerUrlProblem` (`src/lib/banner-url.ts:22`) rejette tout hôte
  `klipy.com` / `www.klipy.com` avec un message qui dit quoi copier (« clic droit → Copier l'adresse
  de l'image », le lien doit commencer par `static.klipy.com`) ; appelée par `BannerForm.tsx:105` et
  par la validation serveur (`src/lib/validations.ts:170`).
- **Repli visuel** : `src/components/BannerImage.tsx` — `<img>` natif avec `onError` qui bascule sur le
  dégradé de secours (`bannerFallbackStyle`) au lieu d'un blanc silencieux (utilisé sur `/profil`
  et `/potes`).
  Trois replis : (1) lien connu pour ne PAS être une image (page `klipy.com` / Tenor / Giphy déjà en
  base, `isKnownNonImageBannerUrl`) → dégradé tout de suite, sans requête ; (2) échec **avant
  l'hydratation** (rendu serveur : l'événement `error` d'un blocage rapide part avant que React ait
  attaché `onError`) → rattrapé au montage par un `ref` (image terminée sans dimension) ; (3) échec
  après hydratation → `onError`. L'échec est mémorisé **par URL** : une nouvelle bannière enregistrée
  n'hérite plus de l'échec de l'ancienne. Vérifié en navigateur réel (CORP `same-origin`, 404, lien de page).
- `klipy.com` figure aussi dans `images.remotePatterns` (`next.config.ts:27`) : utile pour
  `next/image`, mais **sans effet** sur un blocage CORP (qui frappe même un `<img>` natif).

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

## Accessibilité de base — focus clavier, noms accessibles et cibles tactiles du chat

Première PR d'un audit accessibilité plus large (12 zones auditées :
boutons icône, réactions du chat, cibles tactiles, navigation clavier de
la tierlist, calendrier, combobox de proposition de jeu, dialogues Radix,
bracket de tournoi, focus visible, champs non labellisés, messages
dynamiques, imbrication de liens/boutons, contraste). Périmètre volontai-
rement resserré à ce qui a le meilleur rapport valeur/risque et ne change
ni le comportement ni la mise en page de l'app : le reste de l'audit
(clavier sur la tierlist, `aria-live` sur le chat, redimensionnement du
calendrier, contraste de `--faint`, etc.) est laissé pour des PR dédiées
futures.

### 1. Focus clavier visible

`focus:border-accent focus:outline-none` (≈55 occurrences sur ~30
fichiers) supprimait l'anneau de focus natif sur tous les champs texte/
textarea/date/heure/url/fichier de l'app, sans le remplacer par un
indicateur suffisamment visible (juste une couleur de bordure). Complété
avec le pattern déjà existant et validé dans `RankAvatar.tsx` :
`focus-visible:ring-2 focus-visible:ring-accent
focus-visible:ring-offset-2 focus-visible:ring-offset-background`.

- Chaque fichier a été vérifié individuellement (pas de remplacement
  global aveugle) : recherche de tout ancêtre `overflow-hidden` qui
  aurait pu rogner le nouvel anneau (aucun trouvé — les `overflow-hidden`
  présents dans ces fichiers concernent des vignettes, barres de
  progression ou aperçus d'image, jamais les champs concernés).
- Les éléments qui avaient déjà un indicateur `focus-visible` correct
  (`RankAvatar.tsx`) n'ont pas été touchés.
- Les boutons natifs sans `focus:outline-none` (ex. réactions du chat)
  gardent leur anneau de focus par défaut du navigateur, déjà correct —
  pas de raison d'y toucher.
- `focus:border-accent` (retour visuel souris) est conservé tel quel :
  seul l'ajout de `focus-visible:ring-*` change, donc aucun changement
  visuel pour un clic souris.

### 2. Noms accessibles — réactions du chat

`src/components/chat/ChatMessages.tsx` : les boutons du picker de
réactions (emoji seul comme contenu) et les pastilles de compteur de
réactions n'avaient pas de `aria-label`. Un lecteur d'écran lisait
l'emoji de façon inconsistante selon l'OS, sans indiquer qu'il s'agit
d'une action. Ajout de :
- `aria-label={`Réagir avec ${emoji}`}` sur les boutons du picker.
- `aria-label={`${count} réaction(s) ${emoji} — cliquer pour réagir
  aussi`}` sur les pastilles de compteur.

### 3. Cibles tactiles du chat (≥ 44×44 px)

Toujours dans `ChatMessages.tsx`, trois cibles sous la recommandation
44×44 px sont maintenant conformes :
- Boutons du picker de réactions : `h-8 w-8` (32px) → `h-11 w-11`
  (44px).
- Pastilles de compteur de réactions : `min-h-11 min-w-11` ajouté (elles
  restent des pastilles compactes visuellement, mais leur zone cliquable
  atteint 44px).
- Bouton d'envoi du message : `h-10 w-10` (40px) → `h-11 w-11` (44px).

Aucune de ces trois zones n'a de logique, de texte ou de comportement
changé — uniquement la taille et le nom accessible.

### Explicitement hors périmètre (PR dédiées futures)

- Interaction clavier pour ouvrir le picker de réactions (actuellement
  long-press uniquement) — nécessite de concevoir une UX clavier.
- `KeyboardSensor` dnd-kit sur `TierlistBoard.tsx` — drag-and-drop
  clavier, changement fonctionnel plus large.
- Hauteur des cellules de `DayTimeline.tsx` (28px) — changement visuel
  majeur sur 24 lignes de calendrier.
- Correction du contraste de `--faint` (`globals.css`) — impacte
  visuellement toute l'app, gardé pour une PR dédiée au contraste.
- `aria-live` sur les nouveaux messages de chat — comportement
  fonctionnel à valider séparément.

### Vérification

- `npx eslint .` : clean
- `npx tsc --noEmit` via `npx next build` (type-check Next.js complet,
  56 routes) : compile sans erreur
- `npx vitest run` : 122 tests, tout vert (aucun fichier de test modifié
  — changements purement visuels/attributs, rien à tester en pur logique
  ici)

### Checklist de test manuel (desktop + mobile)

- Navigation complète au clavier (`Tab` / `Shift+Tab`) sur les pages
  modifiées : soirées, dispos, roulette, tournois, profil/paramètres,
  bibliothèque, tierlist, messages/badges admin, formulaires d'import
  familial, wishlist, chat.
- Focus visible (anneau violet) sur chaque champ/bouton/lien modifié,
  jamais rogné par son conteneur.
- Ouverture et utilisation au clavier des dialogues concernés (édition
  de soirée, édition de jeu).
- Dans le chat : les boutons de réaction annoncent bien leur emoji au
  lecteur d'écran (VoiceOver/NVDA) au lieu de rien.
- Sur mobile : le picker de réactions, les pastilles de compteur et le
  bouton d'envoi du chat sont confortablement appuyables (44px).
- Aucune régression visuelle évidente sur les pages/composants touchés.

## Chiffrement des jetons OAuth Discord stockés en base

`User.discordAccessToken`/`discordRefreshToken` (persistés en base depuis
le fix "cron avatars Discord silencieux", voir plus haut) étaient stockés
en clair. Durci ici : chiffrés côté application avant chaque écriture,
sans casser la connexion, le cron de rafraîchissement, le renouvellement
des refresh tokens, les comptes dont le jeton actuel est encore en clair,
ni le mécanisme de reconnexion globale.

### Format — enveloppe versionnée et authentifiée

```
enc:v1:<iv base64>:<authTag base64>:<ciphertext base64>
```

`src/lib/discord-token-crypto.ts` — AES-256-GCM, IV aléatoire de 12 octets
à CHAQUE chiffrement (jamais réutilisé), tag d'authentification 16 octets,
version `"v1"` passée en AAD (donnée additionnelle authentifiée GCM) : la
falsifier sans casser le tag est impossible. Clé dédiée
(`DISCORD_TOKEN_ENCRYPTION_KEY`, Base64, 32 octets décodés), **distincte**
de `AUTH_SECRET`/`CRON_SECRET`/`DATABASE_URL` — jamais dérivée d'elles.

**Parsing strict au déchiffrement** — toute valeur commençant par `enc:`
avec un format incorrect ou une version inconnue est `invalid`, **jamais**
traitée comme un ancien jeton en clair (`legacy`) :
- nombre de segments (exactement 5) ;
- alphabet Base64 de chaque segment ;
- IV décodé : exactement 12 octets ;
- tag décodé : exactement 16 octets ;
- ciphertext décodé : non vide ;
- tag GCM vérifié (toute altération du ciphertext/IV/tag, ou une mauvaise
  clé, fait échouer le déchiffrement).

Seule une valeur qui ne commence PAS du tout par `enc:` est `legacy` —
utilisée telle quelle, sans backfill.

### Compatibilité ascendante sans backfill

Aucun script de migration : le rollout progressif tombe du comportement
déjà existant. Un jeton d'accès Discord expire au bout de ~1h ; le cron
`refresh-discord-profiles` tourne toutes les heures et réécrit
systématiquement la paire complète (access + refresh) dès qu'elle est
proche de l'expiration. Résultat : dans l'heure ou les deux heures suivant
le déploiement, chaque compte actif voit son jeton — en clair ou non —
remplacé par une paire fraîche, chiffrée. Une vraie reconnexion produit le
même effet immédiatement. Aucune suppression, aucun backfill pendant le
build.

### Comportement quand la clé manque

`getEncryptionKey()` lève une erreur contrôlée (nom de variable + longueur
obtenue, jamais son contenu) si `DISCORD_TOKEN_ENCRYPTION_KEY` est absente,
pas du Base64 valide, ou ne décode pas en exactement 32 octets. Capturée
par les `try/catch` déjà best-effort existants :
- **`auth.ts`** (callback `jwt`, connexion) : aucune persistance du
  nouveau jeton en base, ni en clair ni chiffré — **la connexion continue
  normalement**, la session JWT ne dépend pas de cette écriture. Seul le
  rafraîchissement auto d'avatar/pseudo hors session en pâtit pour ce
  compte (déjà le comportement existant pour tout user pas encore
  reconnecté).
- **`discord-profile.ts`** (cron) : la clé est validée **une seule fois
  avant la boucle**, avant tout appel réseau Discord — si elle échoue, un
  seul log clair, aucun appel `/users/@me` ni `/oauth2/token` tenté, et
  **tous** les jetons stockés basculent vers le repli bot
  (`DISCORD_BOT_TOKEN`) s'il est configuré. Un jeton présent en base mais
  illisible cette exécution (clé absente/invalide, enveloppe corrompue,
  mauvaise clé après rotation) n'est **jamais** traité comme "couvert par
  l'OAuth" au seul motif que la colonne n'est pas nulle : le repli bot
  couvre maintenant explicitement cette catégorie (`unreadableUsers`), en
  plus des users sans jeton du tout.

### Rotation / perte de clé (MVP assumé)

Si `DISCORD_TOKEN_ENCRYPTION_KEY` est perdue ou changée, toute valeur
chiffrée avec l'ancienne clé devient définitivement `invalid` au
déchiffrement (échec du tag GCM par construction — comportement attendu,
pas un bug). Conséquence acceptée pour ce MVP : ces comptes perdent leur
jeton stocké et doivent simplement **se reconnecter** — une vraie
reconnexion régénère une paire fraîche, chiffrée avec la clé courante.
Aucune perte de compte ni de donnée de jeu, uniquement le confort du
rafraîchissement auto hors session le temps de la reconnexion (repli bot
disponible entre-temps si configuré).

### Rotation Discord — atomicité de la paire

Lors d'un renouvellement (`refreshAllDiscordProfilesViaOAuth`, cron), la
clé de chiffrement est validée **avant** d'appeler l'endpoint Discord de
renouvellement (sinon Discord ferait tourner le `refresh_token` sans que
l'app puisse persister la nouvelle paire — jeton perdu). Après la réponse
Discord, les deux jetons sont chiffrés puis persistés en un **seul**
`update` Prisma — jamais l'un sans l'autre.

### Fichiers modifiés

- `src/lib/discord-token-crypto.ts` (nouveau) — `getEncryptionKey`,
  `encryptToken`, `decryptToken`, `isLegacyToken`, `resolveStoredToken`.
- `src/lib/discord-token-crypto.test.ts` (nouveau) — helpers purs
  uniquement, aucun appel Blob/Discord/Prisma réel.
- `src/auth.ts` — chiffrement avant écriture dans le callback `jwt`.
- `src/lib/discord-profile.ts` — validation de la clé une fois avant la
  boucle du cron, déchiffrement/chiffrement dans
  `refreshAllDiscordProfilesViaOAuth`, et bascule du repli bot vers les
  jetons illisibles en plus des jetons absents (`refreshAllDiscordProfiles`).
- `.env.example` — nouvelle variable `DISCORD_TOKEN_ENCRYPTION_KEY`.

**Aucune migration Prisma** (colonnes déjà `TEXT`, illimitées côté
Postgres). **Aucune nouvelle dépendance** (`node:crypto` est natif).

### ⚠️ Avant de merger cette PR

`DISCORD_TOKEN_ENCRYPTION_KEY` doit être générée et configurée dans Vercel
(**Production ET Preview**) **avant** le déploiement de ce code :

```bash
openssl rand -base64 32
```

À coller dans Vercel → Settings → Environment Variables. Sans cette
variable configurée au moment du déploiement, les nouveaux jetons ne sont
simplement pas persistés en base tant qu'elle manque (dégradation sûre,
jamais de jeton en clair écrit) — mais autant l'avoir en place dès le
départ pour ne rien perdre.

## Fix : cron Steam surdimensionné — activité absente chez les autres potes

Diagnostic remonté après la PR précédente (repli `GetRecentlyPlayedGames`) :
en Production, le réimport manuel affichait bien l'activité récente d'un
compte, mais le cron automatique (`steam-library-sync`, toutes les 2 min)
ne mettait à jour QUE le premier compte traité par
`prisma.user.findMany` (ordre non garanti) — les autres restaient figés
d'un passage à l'autre, malgré un cron actif et authentifié.

### Root cause

Cette route appelait `importSteamLibrary` **pour chaque compte lié**,
séquentiellement : upsert de chaque jeu dans `Game`/`UserGame`, vérif
badges, vérif wishlist — à CHAQUE passage de 2 min, rien que pour
rafraîchir un libellé d'activité. Un seul compte avec une grosse
bibliothèque (badge "Collectionneur, 100+ jeux" confirmé en Prod) pouvait
à lui seul consommer tout le budget de temps de la route, privant tous
les comptes suivants de toute mise à jour — de façon déterministe, pas
flaky, à chaque exécution.

### Fix — séparation léger/complet

- **`steam-library-sync`** (inchangé dans son URL/sa cadence — toujours
  toutes les 2 min) ne fait plus QUE l'activité : nouvelle fonction
  `refreshSteamActivity()` (`src/lib/steam.ts`), un seul appel
  `getOwnedGames` (+ repli `getRecentlyPlayedGames` si besoin), **aucun**
  upsert `Game`/`UserGame`, **aucun** badge, **aucune** vérification
  wishlist, une seule écriture `prisma.user.update` par compte.
  Concurrence réellement bornée à 3 comptes simultanés
  (`processInBatches`, `src/lib/cron-batch.ts` — jamais un
  `Promise.allSettled` non borné) + timeout individuel de 6s par appel
  Steam (`AbortSignal.timeout`) : un compte qui bloque ne peut jamais
  affecter les autres. `maxDuration = 45` (pire cas calculé : 2 lots
  successifs de 3 puis 2 comptes × jusqu'à 2 appels Steam séquentiels ×
  6s = 24s, sous les 30s du déclencheur cron-job.org).
- **`steam-library-full-sync`** (nouvelle route, nouveau cron à créer,
  cadence recommandée : toutes les 2h) — import complet inchangé
  (`importSteamLibrary`, strictement la même fonction), **un seul compte
  par passage**, en rotation round-robin sur `steamFullSyncAttemptedAt`
  (ASC, `nulls: "first"`). `maxDuration = 60` à l'époque ; voir « Phase 5 » : désormais 300 s + 202 + `after()`.

### Nouveaux champs `User` (migration additive, pas de backfill)

- `steamActivityCheckedAt` — posé par le cron léger à CHAQUE compte
  effectivement atteint, succès ou erreur Steam confondus (sémantique :
  "dernière tentative", jamais "dernier succès"). Permet de distinguer un
  compte jamais atteint par un lot (time-budget épuisé) d'une vraie erreur
  Steam sur ce compte.
- `steamFullSyncAttemptedAt` — posé par le cron complet, INCONDITIONNELLEMENT
  avant chaque tentative (jamais par `importSteamLibrary` elle-même, qui
  reste décorrélée de toute notion de rotation cron). Sert uniquement à
  l'ordonnancement du round-robin : un compte qui échoue systématiquement
  (bibliothèque trop volumineuse, panne persistante) avance quand même en
  fin de file à chaque tentative plutôt que de monopoliser indéfiniment la
  première place.

`steamLastSyncAt` (champ existant) reste exclusivement réservé à une
synchronisation COMPLÈTE **réussie** — `importSteamLibrary` la pose
désormais en une seule écriture finale, fusionnée avec `steamPublic` et
l'activité, atteinte seulement après le succès complet des
upserts/badges/wishlist (jamais avant, contrairement à l'ancien
comportement) : un import interrompu en cours de route (crash, timeout) ne
laisse plus `steamLastSyncAt` prétendre à tort à une synchronisation
réussie.

### Profil devenu privé — activité obsolète

Ni `/potes` ni `/profil` ne filtrent l'affichage sur `steamPublic`
(vérifié) : sans effacement explicite, un compte passé privé garderait
indéfiniment affiché son dernier jeu connu. `buildActivityRefreshWrite`
efface donc explicitement `lastPlayedGame`/`lastPlayedAt` (→ `null`) sur
la catégorie `private`.

### 5 catégories d'observabilité (résumé PII-free loggé par le cron léger)

`precise` (timestamp exact) / `approximate` (repli, nom seul) / `none`
(aucune activité récente) / `private` (profil privé) / `error` (Steam
injoignable/timeout — ne touche jamais l'activité déjà en base). Compteur
supplémentaire `degraded` : sous-ensemble d'`approximate` quand
`getOwnedGames` a échoué et que seul `getRecentlyPlayedGames` a répondu. Jamais de
Steam ID ni de nom réel dans les logs, uniquement des compteurs par
catégorie.

### Diagnostic : « la dernière activité Steam n'apparaît pas sur /potes »

Reproduit avec Steam simulé (`src/lib/steam-activity.integration.test.ts`,
aucun appel réel). La carte n'affiche une ligne « 🎮 … » que si
`User.lastPlayedGame` est renseigné ; voici toutes les causes, du code au
compte Steam :

| Cause | Effet | Corrigeable ici ? |
| :-- | :-- | :-- |
| **Détails de jeu privés** sur Steam (`GetOwnedGames` → `{response:{}}`) | catégorie `private`, activité effacée, `steamPublic=false` | Non — réglage du compte (Steam → Confidentialité → *Détails du jeu* : public) |
| **Aucune partie sur les 2 dernières semaines** | catégorie `none`, rien affiché (fenêtre imposée par `GetRecentlyPlayedGames`) | Non — limite de l'API Steam |
| **`GetOwnedGames` en échec** (timeout 6 s sur un gros catalogue, 429, 5xx) | **avant ce correctif : catégorie `error`, activité jamais écrite**, même si l'appel léger répondait | **Oui — corrigé** : repli dégradé sur `GetRecentlyPlayedGames` |
| Cron `steam-library-sync` non appelé ou `STEAM_API_KEY` absente | `steamActivityCheckedAt` jamais posé | Non — configuration (cron-job.org / Vercel) |
| Votre propre carte | la page `/potes` liste les AUTRES membres (`id: { not: user.id }`) | Voulu — votre activité est en tête de `/profil` |

**Repli dégradé** (`refreshSteamActivity`) : si `getOwnedGames` échoue,
`getRecentlyPlayedGames` (petit appel, officiel) est tenté. Liste non vide →
activité « approximative » habituelle (`steamPublic` posé à `true`, la
liste n'étant renvoyée que si les détails sont publics). Liste vide →
ambigu (privé ? aucune partie ?) → `error` : l'activité déjà en base n'est
**jamais** effacée sur un appel qui n'a pas pu distinguer les deux cas. Un
profil réellement privé (`{response:{}}`) n'utilise jamais ce repli. Au plus
2 appels Steam par compte : le calcul du pire cas du cron (24 s pour 5
comptes) est inchangé.

**Comment vérifier en production** (lecture seule) : la ligne de log
`cron:steam-library-sync` donne un résumé par passage, par exemple
`{"precise":0,"approximate":4,"none":1,"private":1,"error":0,"degraded":1,"rejected":0}`.
Beaucoup de `error` ou de `degraded` = API Steam lente ou catalogues
lourds ; beaucoup de `private` = comptes à régler côté Steam. Par compte :
`steamPublic`, `steamActivityCheckedAt` (jamais posé = jamais atteint par le
cron) et `lastPlayedGame`.

### Fichiers modifiés/ajoutés

- `prisma/schema.prisma`, `prisma/migrations/20260915150000_add_steam_activity_tracking/`
  — `User.steamActivityCheckedAt`/`steamFullSyncAttemptedAt`.
- `src/lib/cron-batch.ts` (nouveau) — `processInBatches`, concurrence
  bornée générique + `shouldContinue` (filet de budget de temps).
- `src/lib/cron-batch.test.ts` (nouveau).
- `src/lib/steam.ts` — `SteamCallOptions`/`signal` sur `getOwnedGames`/
  `getRecentlyPlayedGames` ; `categorizeActivityOutcome`,
  `buildActivityRefreshWrite`, `refreshSteamActivity` (fonctions pures +
  orchestration, sans toucher `computeSteamActivityUpdate` utilisée par
  `importSteamLibrary`) ; réordonnancement des écritures
  d'`importSteamLibrary` (écriture finale unique après succès complet).
- `src/lib/steam-activity.test.ts` — tests des 3 nouvelles fonctions pures
  + arithmétique figée du pire cas (24s < 30s).
- `src/app/api/cron/steam-library-sync/route.ts` — réécrite (léger
  uniquement).
- `src/app/api/cron/steam-library-full-sync/route.ts` (nouveau).

### Configurer le nouveau cron externe (cron-job.org ou équivalent)

`steam-library-sync` garde exactement la même URL et la même cadence — **rien
à reconfigurer côté cron-job.org pour cette route**. Seule une nouvelle
entrée est à créer :

```
URL     : https://ton-projet.vercel.app/api/cron/steam-library-full-sync
Méthode : GET
Header  : Authorization: Bearer <CRON_SECRET>
Fréquence : toutes les 2h (0 */2 * * *)
```

### Vérification

- `npx tsc --noEmit` : clean.
- `npx eslint .` : clean.
- `npx vitest run` : 247 tests, tout vert (dont les nouveaux tests
  `cron-batch`/`categorizeActivityOutcome`/`buildActivityRefreshWrite`).
- `npx next build` : compile, type-check et génère les deux routes cron
  sans erreur.
- Aucun appel Steam réel, aucun cron réel, aucune donnée réelle touchée
  pendant l'implémentation — migration non appliquée à une base réelle,
  seulement `npx prisma generate` (schema-only).

### ⚠️ Avant de merger cette PR

La migration `20260915150000_add_steam_activity_tracking` s'applique
automatiquement au prochain déploiement (`prisma migrate deploy` dans le
script `build`), comme toutes les migrations précédentes de ce dépôt —
aucune action manuelle requise sur la base. Après le merge, créer la
nouvelle entrée cron-job.org ci-dessus pour activer l'import complet en
rotation (`steam-library-sync` continue de tourner sans interruption avec
sa config existante).

## Refonte notifications Discord — fondations de livraison (PR 1/N)

Première PR d'un chantier plus large (audit détaillé mené séparément, non
inclus dans ce dépôt) visant à remplacer le webhook Discord unique actuel
(`DISCORD_WEBHOOK_URL`, un seul salon, aucun routage, aucune préférence par
catégorie) par un système à plusieurs salons/fils/DM avec retry et
édition. Cette PR pose UNIQUEMENT le socle transactionnel de livraison —
**aucun appelant existant n'est modifié, aucun comportement Discord actuel
ne change**. Rien n'envoie encore quoi que ce soit via ce nouveau chemin ;
`postToDiscord`/`Notification` restent le seul mécanisme actif.

Rappels produit retenus pour les PR suivantes (pas encore implémentés
ici) : `#🎮-soirées` (une annonce + un fil par soirée), `#🏆-tournois`
(une annonce + un fil par tournoi), `#🎖️-récompenses` (un récapitulatif
par joueur et par jour, heure de Paris, avec un fil ; succès collectifs et
bilans mensuels/saisonniers en messages collectifs distincts) ; les
récompenses personnelles ne basculent jamais en MP ; les invitations de
session instantanée (lancement/changement de jeu/fin) suivent les règles
de destinataires déjà validées avec l'utilisateur.

### Modèle de données (`NotificationEvent` / `NotificationDelivery`)

Sépare "ce qui s'est passé" de "où ça part" :

- **`NotificationEvent`** — une ligne par occurrence métier (`category`,
  `eventType` en chaîne libre, `sourceId`, `occurrence`). Idempotent sur
  `[category, eventType, sourceId, occurrence]` : redéclencher le même
  événement ne crée jamais de doublon.
- **`NotificationDelivery`** — une ligne par destinataire × canal ×
  opération, rattachée à un événement. Idempotent sur `[eventId, channel,
  recipientKey, operation, targetSlot]`. Deux livraisons visant des
  `targetSlot` DIFFÉRENTS (ex. éditer l'annonce ET poster dans son fil)
  sont indépendantes et ne se bloquent jamais l'une l'autre ; en revanche,
  SEND/EDIT/ARCHIVE visant le MÊME `targetSlot` s'excluent mutuellement
  (voir plus bas — portée corrigée après audit, initialement par
  `(targetSlot, operation)`, maintenant par `targetSlot` seul). `transport`
  (`WEBHOOK`/`BOT`) est choisi une fois pour toutes à la création de la
  ligne : jamais les deux pour une même livraison, condition nécessaire à
  la bascule progressive webhook → bot prévue dans les PR suivantes.

Voir les commentaires dans `prisma/schema.prisma` pour le détail complet
de chaque champ (`sequence`, `reservedBy`/`reservedUntil`,
`nextAttemptAt`, `discordMessageId`/`discordChannelId`/`discordThreadId`,
etc.).

### Cycle de vie (`src/lib/notification-delivery.ts`)

Un futur exécuteur (absent de cette PR) portera toujours ce cycle dans cet
ordre :

1. **`enqueueDelivery`** — écrit l'intention en base (idéalement dans la
   même transaction que la mutation métier), jamais bloquant sur Discord.
2. **`claimNextDelivery(owner)`** — réserve AU PLUS UNE livraison PENDING
   due, de façon atomique, et retourne AVANT tout appel réseau. L'appelant
   doit effectuer l'appel Discord APRÈS ce retour, jamais dans une
   transaction englobante.
3. **`finalizeDeliverySuccess`/`finalizeDeliveryFailure(id, reservationToken, …)`**
   — clôture la livraison, conditionnée au `reservationToken` retourné par
   `claimNextDelivery` (PAS à `owner`/`reservedBy`, voir plus bas), sinon
   renvoie `false` sans rien écraser.
4. **`recoverExpiredReservations(now)`** — à appeler périodiquement (par
   un futur sweep, absent de cette PR) : repasse à PENDING les
   réservations dont le bail a expiré sans finalisation (crash, timeout).

#### Réservation durable — propriétaire ET jeton (corrigé après audit)

Une réservation pose un état PERSISTÉ (`status='RESERVED'`, `reservedBy`,
`reservationToken`, `reservedUntil`) qui survit à la transaction SQL qui
l'a créée — contrairement à un simple verrou de ligne tenu en mémoire.
L'appel Discord se fait donc toujours hors de toute transaction SQL.

**Correction (audit avant merge #95)** : la version initiale conditionnait
la finalisation sur `reservedBy`, une étiquette libre fournie par
l'appelant (typiquement un identifiant de worker). Si un worker redémarre
et réutilise le MÊME identifiant statique, deux réservations successives
de la même ligne pouvaient partager le même `reservedBy` — un traitement
obsolète (crash, lenteur) aurait alors pu finaliser à tort une réservation
plus récente détenue par le "même" worker. Corrigé avec
`reservationToken` : généré aléatoirement (`crypto.randomUUID`) à CHAQUE
réservation réussie, jamais choisi par l'appelant. Deux réservations
successives de la même ligne ont TOUJOURS des jetons différents, donc une
finalisation tardive avec un jeton périmé ne peut jamais correspondre à la
réservation courante — testé bout en bout (réservation A → expiration →
récupération → réservation B avec le MÊME `reservedBy` que A → finalisation
tardive de A refusée, voir "Tests d'intégration" plus bas). `reservedBy`
reste une étiquette informative (logs), plus la condition de sécurité.

#### Exclusivité par cible — corrigée après audit (verrou advisory seul insuffisant)

Une correction a été explicitement demandée avant l'implémentation : une
vérification applicative du type "pas de livraison RESERVED sur cette
cible" (un `SELECT ... WHERE NOT EXISTS`) NE SUFFIT PAS — deux
transactions concurrentes peuvent toutes deux lire "aucune réservation" au
même instant, avant que l'une des deux n'ait committé la sienne, et
réserver chacune une livraison différente pour la même cible. Corrigé une
première fois avec un verrou advisory Postgres transactionnel
(`pg_try_advisory_xact_lock`) — mais **cette première version restait
insuffisante**, confirmé par une revue avant merge puis reproduit à la
main via `psql` (deux réservations RESERVED simultanément pour la même
cible, en rejouant l'algorithme hors du code applicatif) : le verrou
advisory `_xact_` est relâché au COMMIT, donc il n'arbitre que des
réservations STRICTEMENT SIMULTANÉES — une fois la première transaction
committée, rien n'empêchait une transaction SÉQUENTIELLE ultérieure de
réserver une AUTRE ligne PENDING pour la MÊME cible.

**Correctif définitif** : sous le verrou advisory (qui sérialise
maintenant uniquement l'ARBITRAGE entre transactions concurrentes), une
vérification SQL explicite confirme qu'aucune réservation active
(`status='RESERVED'`) n'existe déjà pour la cible avant d'en poser une
nouvelle. C'est cette vérification, pas le verrou lui-même, qui porte la
garantie d'exclusivité — valable désormais entre réservations SIMULTANÉES
ET SÉQUENTIELLES, verrouillé par un test dédié pour chaque cas (voir plus
bas).

**Portée élargie** : la clé du verrou et de la vérification est
`targetSlot` SEUL (plus `targetSlot:operation` comme dans la version
précédente) — SEND, EDIT et ARCHIVE visant la MÊME cible s'excluent
désormais mutuellement, puisque ce sont trois opérations sur le même
message physique Discord qui ne peuvent pas progresser en parallèle sans
risquer un envoi/une édition concurrente incohérente. Deux `targetSlot`
différents restent entièrement indépendants et progressent en parallèle
(testé explicitement avec deux rappels distincts, jamais confondus).

Un second piège, orthogonal, a aussi été corrigé en cours de route :
verrouiller tout un lot de candidats d'un coup (`FOR UPDATE SKIP LOCKED
LIMIT 20`) fait qu'un seul appel concurrent rafle tous les candidats,
laissant les appels concurrents suivants sans rien à examiner — repéré par
le test "N claims concurrents sur N cibles indépendantes", qui a d'abord
échoué (1 succès sur 8 au lieu de 8). Le scan se fait maintenant ligne par
ligne (`LIMIT 1`, avec exclusion des ids déjà essayés), ce qui restaure le
comportement file-d'attente standard de `SKIP LOCKED`. Un troisième défaut
lié à l'ordre des candidats (`ORDER BY "createdAt"`, qui peut être à
égalité entre deux lignes créées dans la même milliseconde sous forte
cadence de test) a également été corrigé en triant par `sequence` (compteur
`SERIAL`, ordre total garanti sans égalité possible).

#### Portée de `targetSlot`

Format attendu (contrat applicatif, pas de contrainte DB — pas de modèle
`Guild` dans cette PR) : `<guildId>:<category>:<sourceId>:<rôle>` — une
valeur = un message Discord physique précis, jamais partagée entre deux
messages distincts. Exemples : `default-guild:SESSION:session123:announce`,
`default-guild:SESSION:session123:thread`,
`default-guild:SESSION:session123:reminder-1h` (à distinguer de
`reminder-1d`, un message DIFFÉRENT malgré la même soirée source — jamais
le même `targetSlot`, sous peine d'être traités comme des révisions
successives du même message et de se périmer l'un l'autre).

#### Ordre des éditions — intégré au chemin de réservation, plus un appel séparé

**Correction (audit avant merge #95)** : la protection contre les éditions
dépassées vivait uniquement dans `supersedeStaleDeliveries()`, une
fonction séparée qu'un futur exécuteur aurait pu oublier d'appeler avant
chaque claim. Elle est maintenant intégrée directement dans
`claimNextDelivery` : chaque candidat examiné est d'abord comparé à une
livraison plus récente de la MÊME opération sur la MÊME cible ; si une
existe, le candidat est marqué SKIPPED immédiatement et le scan continue
— la correction ne dépend plus d'un appel externe (testé explicitement
sans jamais appeler `supersedeStaleDeliveries`). Cette fonction reste
disponible comme utilitaire de nettoyage périodique (lignes périmées
au-delà de la fenêtre de scan d'un claim), pas comme condition de
correction.

`sequence` (colonne `SERIAL`, jamais recalculée côté app) donne un ordre
total et atomique entre livraisons visant la même cible ET la même
opération — comparaison scopée PAR OPÉRATION : un SEND n'est jamais
périmé par une EDIT, ni l'inverse ; deux `targetSlot` différents (ex. deux
rappels distincts) ne sont jamais comparés entre eux non plus, testé
explicitement pour ne jamais en supprimer un à tort.

#### Dépendance EDIT/ARCHIVE → SEND

Une EDIT ou une ARCHIVE ne devient réclamable qu'une fois le SEND
correspondant (même `targetSlot`) au statut SENT — sinon le candidat est
différé (laissé PENDING, jamais marqué en erreur), retenté à un futur
claim. Une fois la dépendance remplie, la référence du message ciblé
(`discordMessageId`/`discordChannelId`/`discordThreadId` du SEND) est
résolue et renvoyée dans `targetMessage`, pour que le futur client Discord
n'ait pas à refaire cette requête.

#### Contrat de timeout pour le futur client HTTP

`hasSufficientLeaseRemaining(reservedUntil, now, marginMs)` (fonction pure,
testée indépendamment de Postgres) matérialise le contrat attendu du futur
client Discord (PR suivante, pas implémenté ici) : avant d'engager l'appel
réseau, vérifier le temps restant sur le bail et n'appeler que s'il en
reste plus que `MIN_CALL_MARGIN_MS` (5s, marge pour le round-trip de
finalisation lui-même) ; le timeout HTTP du client doit lui-même être borné
en conséquence, jamais au-delà. Si le temps restant est insuffisant,
traiter comme un échec retryable immédiat plutôt que de risquer un appel
qui dépasse le bail. **Ceci réduit la fenêtre du risque résiduel
documenté plus bas, ne l'élimine pas** — un appel engagé à temps peut
quand même dépasser le bail si Discord répond lentement.

### Limites assumées (documentées, pas contournées)

- **Pas de garantie exactement-une-fois** entre Postgres et Discord : si
  la réservation expire ENTRE le moment où Discord a effectivement
  accepté un message et celui où `finalizeDeliverySuccess` le consigne, un
  autre propriétaire peut reprendre la livraison et l'envoyer une seconde
  fois. Risque résiduel accepté, borné par un bail court
  (`DEFAULT_RESERVATION_LEASE_MS = 30s`, dérivé du plafond dur Vercel
  Hobby comme `CRON_LOCK_LEASE_MS`) et réduit (jamais éliminé) par le
  contrat de timeout ci-dessus.
- Aucun exécuteur n'existe encore : ces fonctions ne sont appelées par
  AUCUN code métier ni AUCUNE route dans cette PR. Elles sont testées de
  façon isolée, pas en conditions de production.

### Tests d'intégration — PostgreSQL isolé (pas de mock Prisma)

Dérogation volontaire à la convention habituelle du dépôt ("pas de mock
Prisma, tests unitaires sur fonctions pures uniquement") : les garanties
prouvées ici (réservation atomique, exclusivité par cible, ordre des
éditions, récupération après crash) sont des propriétés du moteur
transactionnel Postgres — un mock ne testerait que l'appel de méthodes,
jamais le comportement réel, ce qui invaliderait la garantie même que ces
tests doivent établir. `src/lib/notification-delivery.integration.test.ts`
lance donc de vraies transactions concurrentes (`Promise.all` de plusieurs
appels à `claimNextDelivery`) contre une base PostgreSQL dédiée.

**Procédure locale** :

```bash
# Une base PostgreSQL locale, dédiée aux tests — JAMAIS la base de
# production/Neon.
createdb gamenight_notif_test
DATABASE_URL="postgresql://<user>@localhost:5432/gamenight_notif_test" \
  npx prisma migrate deploy

TEST_DATABASE_URL="postgresql://<user>@localhost:5432/gamenight_notif_test" \
  npm run test:postgres
```

`npm run test:postgres` exige `TEST_DATABASE_URL` et lance Vitest avec un
seul worker de fichier (`--maxWorkers=1`). Cette sérialisation ne retire ni
ne séquentialise les scénarios de concurrence **à l'intérieur** des tests :
elle empêche seulement les suites `notification-delivery`,
`notification-executor` et `notification-preferences` d'exécuter en parallèle
leurs nettoyages `TRUNCATE` contre les mêmes tables de la base isolée.

La commande générale `TEST_DATABASE_URL=… npm test`, parallèle par défaut,
n'est pas une commande verte avec les suites actuelles : les `TRUNCATE` de
fichiers différents peuvent supprimer les événements/livraisons d'une suite
pendant qu'une autre les vérifie, ce qui produit notamment des violations de
clé étrangère et des claims manquants. Utiliser la commande sérialisée ci-dessus
pour toute validation PostgreSQL complète et reproductible.

Sans `TEST_DATABASE_URL`, la suite d'intégration est **explicitement
SKIPPÉE** (avec un avertissement console) plutôt que silencieusement
absente ou faussement verte — `npx vitest run` reste utilisable sans base
locale pour le reste de la suite.

### Fichiers ajoutés

- `prisma/schema.prisma`,
  `prisma/migrations/20260916120000_add_notification_delivery_foundations/`
  — modèles `NotificationEvent`/`NotificationDelivery` + 5 enums,
  entièrement additifs.
- `prisma/migrations/20260916130000_add_notification_delivery_reservation_token/`
  (nouvelle migration, additive — la précédente n'a jamais été modifiée) —
  colonne `reservationToken` + index `[targetSlot, status]` pour
  l'exclusivité corrigée.
- `src/lib/notification-delivery.ts` — `createNotificationEvent`,
  `enqueueDelivery`, `claimNextDelivery`, `finalizeDeliverySuccess`,
  `finalizeDeliveryFailure`, `supersedeStaleDeliveries`,
  `recoverExpiredReservations`, `hasSufficientLeaseRemaining`.
- `src/lib/notification-delivery.integration.test.ts` — 18 tests contre
  Postgres isolé (idempotence, exclusivité par cible simultanée ET
  séquentielle, opérations différentes sur une même cible, concurrence
  réelle sur N cibles indépendantes, finalisation conditionnelle par
  jeton, récupération après expiration + finalisation tardive refusée,
  dépendance EDIT/ARCHIVE → SEND, ordre des éditions intégré au chemin de
  claim, non-suppression de messages distincts légitimes).
- `src/lib/notification-delivery.pure.test.ts` (nouveau) — 5 tests de
  `hasSufficientLeaseRemaining`, fonction pure, tourne dans la suite
  rapide normale (pas de `TEST_DATABASE_URL` requis).

### Vérification

- `npx tsc --noEmit` : clean.
- `npx eslint` (fichiers modifiés) : clean.
- `npx vitest run` (avec `TEST_DATABASE_URL` pointée vers une base
  PostgreSQL locale isolée, PostgreSQL 16) : **270 tests, tout vert** —
  dont les 18 tests d'intégration, exécutés 8 fois consécutives sans échec
  pour écarter un faux positif ponctuel sur les assertions de concurrence.
  Sans `TEST_DATABASE_URL` : 252 tests verts, 18 skippés explicitement
  (pas de faux vert).
- `npx next build` : compile et type-check sans erreur ; aucune nouvelle
  route générée (rien n'est encore branché).
- Les deux migrations validées par application de tout l'historique
  (`prisma migrate deploy`) sur la base de test locale — jamais exécutées
  contre Neon/production. Aucun appel Discord réel, aucune donnée réelle
  touchée.
- **Les tests d'intégration ont réellement trouvé 3 bugs de concurrence
  supplémentaires pendant ce correctif** (en plus du défaut d'exclusivité
  initial), tous corrigés puis reverifiés : le cast implicite manquant sur
  la comparaison de l'enum `DeliveryOperation` dans une requête `$queryRaw`
  paramétrée (erreur SQL immédiate, corrigée par un cast explicite), le tri
  des candidats par `createdAt` au lieu de `sequence` (égalités possibles à
  la milliseconde sous forte cadence, non-déterministe), et deux tests
  eux-mêmes mal conçus (deux livraisons de même opération sur une même
  cible, confondant exclusivité et péremption — corrigés en isolant les
  scénarios avec des opérations distinctes).

### ⚠️ Avant de merger cette PR

Les deux migrations (`20260916120000_add_notification_delivery_foundations`
et `20260916130000_add_notification_delivery_reservation_token`)
s'appliquent automatiquement au prochain déploiement (`prisma migrate
deploy` dans le script `build`), comme toutes les migrations précédentes
de ce dépôt — additives uniquement, aucune action manuelle requise sur la
base, aucun impact sur le comportement observable de l'app (rien n'est
branché). Les PR suivantes du chantier (client Discord bot, migration des
préférences, bascule des salons) dépendent de celle-ci.

## Client Discord REST (PR 2/N)

Deuxième PR du chantier notifications — implémente le client Discord REST
(`src/lib/discord-rest.ts`) qui servira aux futurs salons/fils/MP.
**Aucun appelant existant ne l'utilise, aucune notification actuelle ne
change** : `src/lib/discord.ts` (webhook) reste intact et actif, aucune
action métier ni cron n'est branché à ce nouveau module. Aucune Gateway,
commande slash ou interaction — uniquement des appels REST sortants,
compatibles avec l'exécution serverless actuelle (voir l'audit du
chantier notifications pour le détail de cette distinction).

### Périmètre

`sendChannelMessage`/`editChannelMessage` (salon, fil ou MP — même
endpoint Discord pour les trois), `startThreadFromMessage`/
`sendThreadMessage`/`archiveThread`, `openDmChannel`. Réutilise
`DISCORD_BOT_TOKEN` — déjà présent dans `.env.example` et déjà utilisé par
`discord-profile.ts` (repli de rafraîchissement de profil) — et la même
base d'API que ce module déjà en prod, `https://discord.com/api/v10`
(vérifiée dans le code existant, pas une valeur inventée). Endpoints,
formats de réponse et codes d'erreur revérifiés contre la documentation
Discord actuelle au moment de l'écriture (`docs.discord.com/developers`).

### Contrat avec les fondations de livraison (#95)

Aucun import dans le sens `discord-rest.ts` → `notification-delivery.ts`
— ce module ne connaît rien des réservations. Chaque fonction qui fait un
appel réseau prend un paramètre `deadline: Date` obligatoire, à la charge
de l'appelant (futur exécuteur) de dériver de `reservedUntil` (voir
`hasSufficientLeaseRemaining`, notification-delivery.ts). Avant tout
`fetch` : si le budget restant (`deadline - now`) est sous 1s, retour
immédiat `insufficient_lease` SANS aucun appel réseau. Sinon, le timeout
HTTP (`AbortSignal.timeout`) est borné au budget restant, avec un plafond
absolu de 10s (protège contre un `deadline` aberrant côté appelant) —
jamais un timeout fixe indépendant du bail.

**Pas de retry ni d'attente cachée** : chaque appel renvoie un résultat
typé (`DiscordRestResult<T>`) — `{ok:true, data}` ou `{ok:false, kind,
retryable, message, ...}` — jamais de boucle interne. C'est au futur
exécuteur de décider s'il retente, avec quel délai, en fonction de `kind`/
`retryable`/`retryAfterMs`.

**Classification des échecs** (`DiscordRestErrorKind`) : `not_configured`
(token absent, jamais tenté), `insufficient_lease` (bail trop court,
jamais tenté), `invalid_request` (400/payload invalide, non-retryable),
`auth_or_permission` (401/403 générique, non-retryable), `dm_unavailable`
(403 spécifique à un envoi de MP — voir ci-dessous), `not_found` (404,
non-retryable), `rate_limited` (429, retryable, `retryAfterMs` dérivé du
corps `retry_after` ou de l'en-tête `Retry-After`), `server_error` (5xx,
retryable), `network_uncertain` (timeout, erreur réseau, ou réponse 2xx
au corps illisible/de forme inattendue — retryable, mais résultat
GENUINEMENT incertain, pas un échec confirmé).

**Refus de MP — ambiguïté assumée, pas de fausse certitude** : le code
d'erreur Discord 50007 ("Cannot send messages to this user") recouvre
plusieurs causes distinctes (bloqué, MP fermés, a quitté le serveur) sans
que Discord les distingue dans sa réponse. `dm_unavailable` reflète
explicitement cette incertitude dans son message plutôt que d'inventer
une cause précise.

**Succès = réponse exploitable, jamais supposé** : un statut HTTP 2xx dont
le corps ne peut pas être lu/parsé dans la forme attendue (id de message,
de fil...) N'EST PAS traité comme un succès — Discord a peut-être accepté
la requête, mais sans identifiant exploitable ce module renvoie
`network_uncertain` plutôt que de mentir sur l'issue. Même limite
"pas d'exactement une fois" que dans notification-delivery.ts, jamais
présentée comme résolue par ce module.

**Mentions — contrôle explicite obligatoire** : `allowedMentions` est un
paramètre REQUIS (pas de valeur implicite) sur tout appel envoyant du
contenu — création ET édition partagent la même construction de corps
(`buildMessageBody`), donc les mentions sont désactivées par défaut dans
les deux cas, jamais seulement à la création. `NO_MENTIONS`
(= `{parse: []}`) exporté pour supprimer tout ping par défaut ; un
appelant qui veut mentionner un rôle/utilisateur précis doit le lister
explicitement.

**Réponse perdue ou malformée = résultat incertain, jamais un succès ni un
échec silencieux, jamais de retry auto** : si un create/edit a
potentiellement été accepté par Discord mais que la réponse est
illisible/de forme inattendue, ou si `fetch` lui-même rejette (timeout,
abort, coupure réseau), le résultat renvoyé est `network_uncertain` —
jamais traité comme un succès (pas d'id exploitable garanti), jamais
traité comme un échec propre (l'action a pu réussir côté Discord). Le
client ne boucle jamais lui-même sur cette incertitude : un seul `fetch`
est tenté, point, c'est à l'appelant (futur exécuteur de livraison) de
décider s'il retente — testé explicitement (`fetch` appelé exactement une
fois après un `network_uncertain`).

**Budget de bail = en-têtes ET lecture du corps, pas seulement l'attente
des en-têtes (vérifié, pas supposé)** : `discordRequest` englobe le
`fetch` ET la lecture du corps de réponse ensemble dans une course
(`Promise.race`) contre une minuterie dérivée du même budget — la
garantie que le budget couvre aussi une lecture de corps qui traînerait
est donc vraie par construction, pas seulement supposée d'un comportement
implicite d'`AbortSignal` sur les flux de lecture (comportement conforme
aux specs des runtimes actuels, mais qu'on ne voulait pas se contenter de
supposer). Testé avec un corps de réponse qui ne finit jamais de streamer
(`ReadableStream` sans `close()`) : l'appel renvoie bien `network_uncertain`
dans le budget imparti au lieu de rester bloqué indéfiniment.

**MP : ouverture + envoi partagent le même `deadline`, jamais réinitialisé**
— `sendDirectMessage` (nouvelle fonction composée) enchaîne
`openDmChannel` puis `sendChannelMessage` en propageant EXACTEMENT le même
`deadline` (et le même `now`, si fourni) aux deux appels, sans jamais le
recalculer entre les deux — un enchaînement manuel des deux fonctions
existantes resterait possible mais exposerait l'appelant au risque de
recalculer `deadline` entre les deux et de doubler le budget réel accordé
à l'invitation MP ; `sendDirectMessage` élimine ce risque structurellement.
Si l'ouverture du canal échoue, l'envoi n'est jamais tenté (pas de second
appel réseau sur un échec déjà classifié) — testé explicitement, ainsi que
le partage effectif du budget entre les deux appels (même valeur de
timeout dérivée pour les deux, via `AbortSignal.timeout` espionné).

### Tests — HTTP entièrement simulé, aucun appel réseau réel

`src/lib/discord-rest.test.ts` (33 tests, `fetch` mocké via
`vi.stubGlobal`) : succès + capture des identifiants (message, fil,
canal de MP), erreurs HTTP (400/404/500) et réponses malformées (corps
illisible ou de forme inattendue sur un statut 2xx), rate limit avec
`retry_after` dérivé du corps ET de l'en-tête, timeout/erreur réseau,
budget de bail insuffisant (aucun `fetch` tenté) et plafonnement du
timeout (`AbortSignal.timeout` espionné pour vérifier la valeur exacte
transmise), absence de fuite du token (vérifié dans le résultat renvoyé,
alors que l'en-tête de requête le contient bien), configuration
manquante, contrôle explicite des mentions (création ET édition),
l'ambiguïté du refus de MP (50007 en contexte MP → `dm_unavailable` ; le
même code hors contexte MP → classification générique), l'absence de
retry auto après un résultat incertain, la couverture du budget sur la
lecture du corps (corps qui ne finit jamais de streamer), et le flux MP
composé (`sendDirectMessage`) — enchaînement, budget partagé non
réinitialisé, échec précoce sans second appel, propagation de
l'ambiguïté 50007.

### Vérification

- `npx tsc --noEmit`, `npx eslint .` : clean.
- `npx vitest run` avec `TEST_DATABASE_URL` : **303 tests, tout vert**
  (les 18 tests d'intégration Postgres de #95 rejoués à l'identique — non
  modifiés par cette PR — confirment qu'aucune régression n'a été
  introduite). Sans `TEST_DATABASE_URL` : 285 verts, 18 skippés
  explicitement.
- `npx next build` : compile sans erreur, aucune nouvelle route générée.
- Aucun appel Discord réel à aucun moment. `src/lib/discord.ts` (webhook)
  et tous les crons existants inchangés (diff vide vérifié).

### Procédure de configuration du bot (à faire manuellement, plus tard)

Étapes pour un serveur Discord de test — **aucune de ces étapes n'a été
faite par cette PR**, aucun token demandé ici, aucune configuration réelle
ni aucun envoi réel effectué :

1. **Application dédiée aux tests, distincte de l'application de
   production** — correction par rapport à une version précédente de cette
   documentation, qui recommandait à tort de réutiliser l'application
   existante. **Le choix du serveur d'invitation ne suffit PAS à isoler
   test et production** : un jeton de bot donne accès à TOUTES les
   guildes où ce bot a été ajouté, quel que soit le serveur visé par un
   appel donné — rien dans l'API Discord ne fait dépendre l'autorisation
   d'un appel REST du serveur "visé" par un test. La seule isolation
   fiable est un jeton distinct : créer une seconde application Discord
   (Developer Portal → "New Application", ex. "GameNight (test)"), activer
   un bot dessus, générer son propre `DISCORD_BOT_TOKEN` — jamais réutiliser
   celui de l'application de production pour des essais.
2. **Variable d'environnement Preview uniquement** : configurer ce second
   token dans les variables d'environnement Vercel du scope **Preview**
   exclusivement (jamais Production) — voir la note plus bas sur ce que
   l'isolation Neon Preview/production ne couvre PAS. Aucune configuration
   Vercel n'est faite par cette PR ; ceci reste une étape manuelle future.
3. **Permissions minimales, jamais Administrateur** — lors de
   l'invitation du bot de test (OAuth2 URL Generator, scope `bot`) : `View
   Channel`, `Send Messages`, `Send Messages in Threads`, `Create Public
   Threads`, `Embed Links`, `Read Message History`. Rien d'autre par
   défaut — voir la section Permissions ci-dessous pour le cas spécifique
   de l'archivage (`Manage Threads`) et pourquoi ne jamais accorder
   `Administrator`.
4. **Serveur ET salons de test, comptes de test explicitement consentants**
   : inviter le bot de test sur un serveur Discord séparé du serveur réel
   du groupe, et restreindre tout essai manuel futur aux salons créés pour
   ces tests. Pour les MP, n'envoyer qu'à des comptes explicitement
   informés et volontaires pour servir de cible de test — jamais à un
   membre réel du groupe sans son accord explicite pour ce rôle.
5. **L'isolation de la base Neon (Preview vs production) ne garantit
   RIEN sur l'isolation des envois Discord** — ce sont deux mécanismes
   totalement indépendants. Un déploiement Preview branché sur une base
   Preview isolée peut très bien, s'il utilise par erreur le token de
   production, envoyer de vrais messages sur le vrai serveur : ne jamais
   présenter l'un comme garantissant l'autre. L'isolation des envois
   Discord ne peut venir que d'un token de bot distinct (étape 1) combiné
   à des salons/comptes de test dédiés (étape 4).
6. **Essai manuel à faire plus tard** (pas dans cette PR — aucun appelant
   n'existe encore) : une fois une future PR branchée à une route de test,
   avec le bot de test (étape 1) sur le serveur de test (étape 4)
   uniquement — vérifier dans cet ordre : envoi simple dans un salon de
   test, édition de ce message, création d'un fil depuis ce message, envoi
   dans le fil, archivage du fil (sans `locked: true` dans un premier
   temps — voir Permissions ci-dessous), ouverture d'un MP vers un compte
   de test consentant, envoi puis édition du MP. Confirmer qu'aucune
   mention involontaire ne part avant tout essai, y compris sur le serveur
   de test.

### Permissions — archivage de fil, y compris l'asymétrie verrouillage

Le bot n'archive dans ce module que des fils qu'il a lui-même créés (via
`startThreadFromMessage`) — c'est le seul usage prévu d'`archiveThread`
ici. Dans ce cas, **`Manage Threads` n'est pas nécessaire pour un
archivage simple** (`locked` omis ou `false`) : un créateur de fil peut
archiver son propre fil sans cette permission. `Manage Threads` reste
nécessaire pour archiver un fil créé par quelqu'un d'autre (hors du
périmètre de ce module).

**Asymétrie vérifiée contre la documentation Discord actuelle** :
si `locked: true` est utilisé en plus de l'archivage, un fil VERROUILLÉ ne
peut ensuite être DÉSARCHIVÉ que par quelqu'un détenant `Manage Threads`
— même si le bot est le créateur du fil. Verrouiller un fil créé par ce
bot sans qu'il détienne `Manage Threads` risque donc de le rendre
irréversible pour ce bot seul (une intervention humaine avec les bonnes
permissions serait alors nécessaire pour le désarchiver). Documenté
directement dans le code (`archiveThread`, `src/lib/discord-rest.ts`).
**Jamais `Administrator`** pour contourner cette limite : si le
verrouillage s'avère réellement nécessaire pour un usage futur, accorder
`Manage Threads` explicitement et de façon ciblée, rien de plus large.

## Exécuteur de notifications (PR 3/N) — désactivé par défaut

Troisième PR du chantier notifications — relie enfin les fondations de
livraison persistées (`src/lib/notification-delivery.ts`, #95) au client
Discord REST (`src/lib/discord-rest.ts`, #96) via un nouveau module,
`src/lib/notification-executor.ts`. **Aucune notification métier n'est
branchée par cette PR** : `src/lib/discord.ts` (webhook) reste l'unique
chemin actif pour toutes les notifications actuelles, aucun producteur
d'événement réel n'existe encore, et la route cron dédiée est **strictement
désactivée par défaut**.

### Ce que cette PR réutilise, sans le réimplémenter

Rien de ce qui suit n'est reconstruit en vérification applicative parallèle
— tout est délégué aux modules des deux PR précédentes :

- Réservation persistée exclusive par cible, dépendance SEND→EDIT/ARCHIVE,
  convergence vers l'édition la plus récente, finalisation conditionnée au
  `reservationToken` : entièrement porté par `claimNextDelivery`/
  `finalizeDeliverySuccess`/`finalizeDeliveryFailure`
  (`notification-delivery.ts`).
- Récupération des réservations expirées : `recoverExpiredReservations`
  est désormais **appelée à chaque batch** (`runExecutorBatch`) — c'est le
  balayage périodique que la doc de #95 documentait explicitement comme
  "absent de cette PR" ; il est enfin branché ici, porté par chaque
  exécution du cron plutôt qu'un processus séparé.
- Budget réseau couvrant requête ET lecture de réponse, MP à deadline
  partagé (ouverture + envoi) : entièrement porté par `discordRequest`/
  `sendDirectMessage` (`discord-rest.ts`).

### Le cycle d'une livraison (`processNextDelivery`)

Claim atomique (hors de toute portée réseau) → chargement de
l'événement → résolution du contenu/destination **juste à temps** (jamais
mise en cache depuis l'enqueue — un résolveur relit l'état métier courant à
chaque appel) → vérification du budget de bail restant (marge dédiée à la
finalisation, `MIN_CALL_MARGIN_MS`) → **UN** appel Discord, hors
transaction SQL → finalisation. Jamais de retry synchrone dans cette
requête : un échec retryable repasse simplement la livraison à `PENDING`
avec `nextAttemptAt`, repris par une future exécution du cron.

Une erreur sur une livraison (résolveur non configuré, dépendance pas
prête, échec Discord) ne fait jamais planter le traitement des autres
cibles éligibles — chaque livraison est traitée indépendamment,
`runExecutorBatch` continue toujours vers la suivante.

### Actions Discord représentables (`ResolvedAction`)

Correspondance directe 1:1 avec les fonctions exportées de
`discord-rest.ts`, sans abstraction supplémentaire : `send_channel_message`,
`edit_channel_message` (salon ou MP via `isDirectMessage`),
`send_direct_message` (ouverture + envoi à deadline partagé, via
`sendDirectMessage`), `create_thread`, `send_thread_message`,
`archive_thread`. Une opération inconnue n'est PAS représentable — le type
`ResolvedAction` ferme la liste, un résolveur ne peut rien inventer au-delà.

### Contrat de résolution (`DeliveryResolver`) — aucun producteur réel branché

Un futur résolveur métier reçoit, pour une livraison réservée donnée : la
livraison elle-même (avec `targetMessage` déjà résolu pour une EDIT/ARCHIVE
sur la MÊME cible), l'événement source, et l'instant courant. Il répond soit
`{eligible: true, action}` (avec un `stateVersion` optionnel, typé mais non
exploité par cette PR — réservé à un futur contrôle de concurrence
optimiste, aucune logique dessus aujourd'hui), soit `{eligible: false,
reason}` (`preference_declined`, `expired`, `not_configured`,
`dependency_not_ready`, `unresolvable`).

**Aucune fonctionnalité métier n'est inventée ici** : pas de session
instantanée, pas d'interface de préférences. Le résolveur utilisé par la
route cron en production, tant qu'aucun résolveur réel n'existe,
est `NOT_CONFIGURED_RESOLVER` — il refuse systématiquement d'envoyer quoi
que ce soit, jamais de repli implicite vers une autre notification.
Matérialise directement l'exigence : en l'absence de résolution ou de
configuration sûre, ne rien envoyer.

Une dépendance métier inter-`targetSlot` (ex. un SEND de création de fil
qui a besoin du message id d'un SEND d'annonce sur un AUTRE `targetSlot`)
n'est PAS résolue automatiquement par ce module — `claimNextDelivery` ne
résout `targetMessage` que pour une EDIT/ARCHIVE sur le MÊME `targetSlot`
que son SEND. Un futur résolveur métier réel doit chercher lui-même une
telle référence croisée ; `dependency_not_ready` existe précisément pour ce
cas (retryable, backoff court, voir plus bas).

### Succès partiels — reprise de la seule étape manquante

Un SEND réussi (ex. l'annonce) et une opération dépendante en échec (ex. la
création de son fil) sont deux livraisons **distinctes**, sur des
`targetSlot` différents — c'est la conséquence directe de la conception du
schéma (#95), pas un mécanisme ajouté par cette PR. Si le SEND réussit puis
que la création du fil échoue, seule la ligne du fil repasse à `PENDING`
pour reprise ; l'annonce, déjà `SENT`, n'est jamais reconsidérée par
`claimNextDelivery`. Testé explicitement (voir plus bas).

### Erreurs et reprises

Le `kind`/`retryable` déjà posé par `discord-rest.ts` est propagé tel quel
(rien à redécider), sauf `MAX_DELIVERY_ATTEMPTS` (8, borne pas dérivée
d'une contrainte plateforme précise — choisie pour éviter une notification
bloquée indéfiniment en re-tentative silencieuse tout en laissant plusieurs
heures de marge) : au-delà, un échec par ailleurs retryable devient
terminal (`FAILED`). `rate_limited` respecte exactement le délai indiqué
par Discord (`retryAfterMs`, dérivé du corps `retry_after` ou de l'en-tête
`Retry-After`) ; les autres échecs retryable utilisent un backoff
exponentiel (1 min de base, doublé par tentative, plafonné à 30 min) ; une
dépendance métier pas prête (`dependency_not_ready`) utilise un backoff
court dédié (2 min).

**Résultat réseau incertain — distinction création/édition documentée, pas
résolue** : un `network_uncertain` reste retryable (comme documenté par
`discord-rest.ts`/`notification-delivery.ts`), mais le risque résiduel
diffère selon l'opération :
- **SEND** : Discord a peut-être déjà créé le message avant que la réponse
  ne se perde — retenter peut produire un second message distinct. Risque
  accepté, déjà documenté comme limite structurelle dans
  `notification-delivery.ts` (pas d'exactly-once, pas d'absence absolue de
  doublon externe promise).
- **EDIT/ARCHIVE** : retenter est sûr par nature — ré-appliquer le même
  contenu ou le même état d'archivage ne produit jamais de doublon, au pire
  un appel réseau redondant.

Jamais de cause précise attribuée à un refus de MP quand Discord lui-même
ne la distingue pas (hérité tel quel de `discord-rest.ts`, `dm_unavailable`).

### Budget et concurrence

Chaque livraison est réclamée et traitée **une par une**
(`processNextDelivery` en boucle dans `runExecutorBatch`) — jamais un gros
lot réservé d'avance, donc aucun bail ne peut expirer "en attendant son
tour" dans un lot. `runExecutorBatch` s'arrête au premier des trois : plus
rien à réclamer, `DEFAULT_MAX_DELIVERIES_PER_RUN` (25) atteint, ou
`DEFAULT_BATCH_BUDGET_MS` (50s, sous le `maxDuration` explicite de 60s de
la route) épuisé. Aucun appel réseau n'est jamais fait à l'intérieur d'une
transaction SQL (hérité de `claimNextDelivery`, qui retourne avant tout
appel Discord).

**Correctif suite à revue ciblée avant validation** : le budget vérifié
juste avant CHAQUE appel Discord (`hasSufficientLeaseRemaining`) — et donc
la `deadline` transmise au client — respecte désormais la PLUS PROCHE de
DEUX échéances, jamais seulement le bail de la réservation. La première
version ne consultait que `reservedUntil` : une livraison réclamée alors
que le budget global du batch (`runExecutorBatch`) était presque épuisé
pouvait engager un appel réseau dont le bail, lui, restait largement
valide (30s par défaut) — un seul appel aurait alors pu, à lui seul,
pousser l'exécution bien au-delà de `DEFAULT_BATCH_BUDGET_MS`, vers la
`maxDuration` de 60s de la route. `runExecutorBatch` transmet
maintenant sa propre échéance (`batchDeadline`) à `processNextDelivery` à
CHAQUE appel ; la deadline effective (et donc celle transmise au client
Discord) est `min(reservedUntil, batchDeadline) - MIN_CALL_MARGIN_MS`,
jamais `reservedUntil` brut seul — avec un `errorClass` distinct
(`insufficient_batch_budget` vs `insufficient_lease`) selon laquelle des
deux échéances est la plus proche. Un appel `processNextDelivery` direct,
hors batch (`batchDeadline` omis), reste contraint uniquement par le bail
— comportement inchangé pour cet usage. Testé explicitement (budget de
batch plus proche que le bail sans jamais tenter d'appel, et propagation
réelle depuis `runExecutorBatch` vers une livraison déjà réclamée).

Un traitement ayant perdu sa réservation (bail expiré, repris par un
autre) après un appel Discord RÉUSSI ne réécrit jamais l'état en base et
ne retente JAMAIS l'envoi (le message a déjà été accepté par Discord) —
juste loggué, résultat `lost_reservation_after_success`.

### Route cron dédiée — `/api/cron/notification-executor`, désactivée par défaut

Authentification identique aux autres routes cron de ce dépôt
(`verifyCronRequest` — `CRON_SECRET` absente → 503, en-tête
absent/incorrect → 401). **Strictement désactivée par défaut** : sans
`NOTIFICATION_EXECUTOR_ENABLED=true` (exactement cette valeur), la route
répond `{enabled:false, processed:0}` immédiatement après authentification
— aucun claim, aucune consommation de tentative, aucun appel Discord. Même
activée, cette PR ne branche aucun producteur métier réel : le résolveur
utilisé (`NOT_CONFIGURED_RESOLVER`) refuse systématiquement d'envoyer quoi
que ce soit — activer la variable aujourd'hui n'a donc aucun effet visible
au-delà du balayage de récupération des réservations expirées (en pratique
sans effet, aucune livraison n'existe encore).

Ne fournit AUCUN endpoint permettant d'envoyer un message arbitraire ou de
choisir librement un destinataire — elle ne fait que réclamer/traiter des
livraisons déjà persistées par un futur code métier, jamais un paramètre
venant de la requête. Ne modifie pas `/api/cron/close-sessions` ni aucune
route existante.

**Rien n'est configuré par cette PR** : aucun cron externe (cron-job.org ou
autre) n'est mis en place, aucune variable n'est définie sur Vercel.
Procédure d'activation future (documentée, PAS exécutée) : une fois un
résolveur métier réel branché dans une PR ultérieure, définir
`CRON_SECRET` (déjà requis par les autres crons) et
`NOTIFICATION_EXECUTOR_ENABLED=true` sur Vercel (Production ET/OU Preview
selon le besoin), puis configurer un cron externe pointant vers
`/api/cron/notification-executor` avec l'en-tête
`Authorization: Bearer <CRON_SECRET>` — même mécanique que
`/api/cron/reminders`.

### Tests — PostgreSQL isolé + Discord HTTP entièrement simulé

`src/lib/notification-executor.integration.test.ts` (24 tests, même
dérogation Postgres que `notification-delivery.integration.test.ts` +
`fetch` mocké comme `discord-rest.test.ts`, **aucun appel réseau réel**) :
cycle complet réservation→appel→finalisation, deux exécuteurs concurrents
sur la même cible, progression de cibles indépendantes dans un même batch,
refus d'une finalisation tardive avec un `reservationToken` périmé (sans
écraser l'état repris), SEND réussi puis création de fil échouée (le SEND
n'est jamais renvoyé), dépendance EDIT au message initial (`targetMessage`
résolu automatiquement), édition dépassée (l'ancienne jamais vue par le
résolveur), résolution non éligible (préférence refusée, événement expiré,
transport non pris en charge), MP à deadline partagé (mêmes appels
`AbortSignal.timeout`), rate limit avec `Retry-After` respecté exactement
(un seul appel réseau, jamais de retry immédiat caché), échec permanent
sans retry (idem), résultat réseau incertain avec backoff (idem), arrêt
sur budget de bail insuffisant avant tout appel, arrêt sur budget GLOBAL
de l'exécuteur insuffisant même quand le bail seul serait large
(`processNextDelivery` avec `batchDeadline`, ET propagation réelle depuis
`runExecutorBatch` vers une livraison déjà réclamée), plafond de
tentatives (bascule exacte retryable → `FAILED` terminal à
`MAX_DELIVERY_ATTEMPTS`, et toujours retryable juste en dessous), route
cron désactivée par défaut (aucun claim/tentative/appel — vérifié aussi
sur les deux cas d'authentification refusée, 401 et 503), route cron
activée sans résolveur réel (`NOT_CONFIGURED_RESOLVER` refuse tout),
authentification cron (401/503, chacun avec une livraison enqueuée pour
prouver qu'elle reste intouchée).

### Vérification

- `npx tsc --noEmit`, `npx eslint .` : clean.
- `npx vitest run` avec `TEST_DATABASE_URL` : **327 tests, tout vert** (303
  hérités de #95/#96 rejoués à l'identique — non modifiés par cette PR —
  confirment l'absence de régression, + 24 nouveaux, dont 4 ajoutés lors
  de la revue ciblée avant validation). Sans `TEST_DATABASE_URL` : 285
  verts, 42 skippés explicitement (18 + 24). Suite rejouée 3× de suite
  sans échec pour écarter tout flake temporel sur le nouveau test de
  budget global de batch.
- `npx next build` : compile sans erreur ; nouvelle route
  `/api/cron/notification-executor` générée, aucune autre route modifiée.
- Aucun appel Discord réel à aucun moment. `src/lib/discord.ts` (webhook)
  et tous les crons existants (y compris `/api/cron/close-sessions`)
  inchangés (diff vide vérifié). Aucune migration Prisma dans cette PR
  (aucune évolution de schéma nécessaire — `notification-delivery.ts` et
  `discord-rest.ts` ne sont pas modifiés).

## Préférences de notifications par catégorie

`/profil/parametres` expose uniquement les catégories dont tous les chemins
actuels appliquent le refus : **Soirées** (`SESSION`) et **Roulettes**
(`ROULETTE`). Un refus retire les mentions Discord et les notifications
internes personnelles équivalentes ; l'annonce collective continue d'être
publiée dans son salon. Les tournois, récompenses et récapitulatifs restent
annoncés comme catégories futures tant que leur intégration n'est pas complète.

`UserNotificationPreference` est la source de vérité lorsqu'une ligne existe.
En son absence, `User.silenceReminders` reste le repli compatible pour les deux
catégories qu'il gouvernait historiquement. La migration initialise donc les
deux lignes avec `enabled = NOT silenceReminders`. Le défaut est activé afin de
préserver le comportement des comptes qui recevaient déjà ces sollicitations.
Le réglage `SESSION` maintient le champ legacy synchronisé pendant la
transition ; `ROULETTE` peut ensuite évoluer indépendamment.

Le filtrage partagé vit dans `src/lib/notification-preferences.ts`. Les futurs
résolveurs du nouvel exécuteur doivent l'appeler juste avant de résoudre une
livraison personnelle et retourner `preference_declined` en cas de refus ; ils
ne doivent jamais convertir ce refus en MP, notification interne ou autre
fallback. L'exécuteur reste désactivé et aucun événement métier n'est branché
par ce chantier.

## Chantier annonces Discord bot — salons et fils par soirée

Relie enfin les fondations de livraison (#95), le client REST (#96),
l'exécuteur (#97) et les préférences par catégorie (#98) à un premier vrai
producteur métier : les annonces de **soirées** dans `#🎮-soirées`, une
annonce principale + un fil par soirée. **TOURNOIS explicitement différé à
une prochaine PR** — aucun code tournoi dans celle-ci ; toute catégorie
autre que `SESSION` continue de retomber sur `NOT_CONFIGURED_RESOLVER`
(voir `src/app/api/cron/notification-executor/route.ts`).

### Ce qui est livré

- `src/lib/discord-bot-config.ts` — configuration serveur (jamais un
  formulaire utilisateur) : `DISCORD_BOT_GUILD_ID`,
  `DISCORD_BOT_SESSION_CHANNEL_ID`, `DISCORD_BOT_SESSION_ANNOUNCE_ENABLED`.
- `Session.announceViaBot` (migration additive) — décision webhook/bot
  figée **une seule fois, à la création de chaque session**, jamais relue
  depuis l'environnement ensuite. Garantit qu'une session ne peut jamais
  utiliser les deux chemins à la fois, et que les sessions créées avant un
  bascule ou après un rollback gardent leur comportement d'origine.
- `src/lib/session-announce.ts` — quatre fonctions d'enqueue
  (`enqueueSessionCreationDeliveries`, `enqueueSessionAnnounceUpdate`,
  `enqueueSessionResultThreadSummary`, `enqueueSessionReminderDelivery`)
  appelées depuis `session-lifecycle.ts`/`sessions.ts`/le cron rappels
  UNIQUEMENT quand `announceViaBot` est vrai — sinon le chemin webhook
  existant (`discord-announce.ts`/`discord-session-created.ts`/
  `discord-session-modified.ts`) reste strictement inchangé et actif.
- `sessionAnnounceResolver` — premier vrai `DeliveryResolver` métier,
  branché dans `/api/cron/notification-executor` (dispatché par
  `category === "SESSION"`), rendant chaque message depuis l'état COURANT
  de la session en base, jamais un texte figé à l'enqueue.

### Organisation des cibles (`targetSlot`)

Quatre rôles, quatre lignes `NotificationDelivery` indépendantes par
soirée (`default-guild:SESSION:<sessionId>:<rôle>`) :

- `announce` — SEND une fois à la création, puis une EDIT à chaque
  changement d'état (modification de créneau, clôture, annulation) —
  jamais republiée, jamais une nouvelle édition n'écrase un état plus
  récent (convergence garantie par `claimNextDelivery`, #95).
- `thread` — SEND une fois, crée le fil à partir du message d'annonce ;
  dépend explicitement que `announce` soit `SENT` (résolu manuellement, la
  dépendance porte sur un AUTRE `targetSlot`).
- `thread-reminder-<minutes>` — SEND, un par palier de rappel dû, posté
  DANS le fil ; dépend que `thread` soit `SENT`. Une dépendance non prête
  ne consomme jamais un cycle "épuisé" : elle repasse `PENDING` avec un
  backoff court dédié (2 min), pas le backoff générique des échecs réseau.
- `thread-summary` — SEND, résumé posté DANS le fil à la clôture ; même
  dépendance sur `thread`.

### Préférences et destinataires

Réutilise telle quelle la résolution centrale de #98
(`filterUsersByNotificationPreference`, catégorie `SESSION`) : un refus
retire la mention Discord et la notification interne équivalente pour ce
seul utilisateur, jamais l'annonce collective (elle part toujours, même si
tout le monde a refusé). La sélection de destinataires du créateur
(`notifiedUserIds`) et le filtre de préférence sont tous deux des filtres
de RETRAIT uniquement, jamais additifs — leur ordre de composition ne
change donc jamais le résultat, et la sélection du créateur ne peut jamais
réintégrer un refus. Exactement les mêmes destinataires alimentent la
mention Discord ET la notification interne (`createNotifications`), jamais
un ensemble différent. Aucune duplication : une session `announceViaBot`
n'appelle jamais les fonctions webhook, dont les propres notifications
internes ne s'exécutent donc jamais pour elle.

### Comportements explicitement définis

- **Sessions créées avant le switch** : `announceViaBot=false` figé à leur
  création, elles continuent d'utiliser le webhook existant indéfiniment,
  même une fois le bot activé.
- **Sessions créées après le switch** : `announceViaBot=true` figé à leur
  création, elles restent sur le chemin bot même après un rollback de
  `DISCORD_BOT_SESSION_ANNOUNCE_ENABLED`.
- **Rollback avec une livraison bot déjà en attente** : limite assumée —
  si la configuration Discord (`DISCORD_BOT_GUILD_ID`/
  `DISCORD_BOT_SESSION_CHANNEL_ID`) est retirée pendant qu'une livraison
  bot patiente encore, elle échoue en `resolver:not_configured`,
  **terminal** (comportement hérité de `notification-executor.ts`, jamais
  réimplémenté ici) — elle ne reprendra PAS automatiquement si la
  configuration est restaurée plus tard. Observable via `status`/
  `errorClass` en base, jamais un secret exposé ; aucun repli automatique
  vers le webhook n'est jamais tenté.
- **Message supprimé manuellement côté Discord** : une EDIT qui reçoit un
  404 échoue en `discord:not_found`, terminal — jamais de republication
  automatique d'un nouveau message (l'ID du message ciblé serait de toute
  façon inconnu pour la suite).
- **Renvoi manuel (bonus F6)** : `resendSessionAnnouncement` refuse
  explicitement (`non_disponible_pour_les_sessions_bot`) pour une session
  `announceViaBot` — ce bouton poste toujours un NOUVEAU message webhook,
  un concept qui ne s'applique pas au chemin bot (annonce persistante
  unique, éditée, jamais republiée).
- **Fil auto-archivé + rappel** : cette PR conserve l'auto-archivage natif
  Discord (aucune opération ARCHIVE utilisée). D'après la documentation
  Discord (Threads), envoyer un message dans un fil archivé-mais-non-
  verrouillé le désarchive automatiquement — comme ce chantier ne
  verrouille jamais un fil de soirée, un rappel envoyé après
  auto-archivage réactive le fil sans action supplémentaire.
- **`allowed_mentions`** : contrôlé explicitement sur chaque création ET
  édition (`parse: []` + liste explicite des `users` éligibles) — jamais
  de mention implicite, jamais `@everyone`/`@here`.

### Variables à configurer plus tard (aucune définie par cette PR)

```
DISCORD_BOT_GUILD_ID=                      # ID du serveur Discord
DISCORD_BOT_SESSION_CHANNEL_ID=            # ID du salon #🎮-soirées
DISCORD_BOT_SESSION_ANNOUNCE_ENABLED=      # "true" exactement pour activer
```

Voir aussi `NOTIFICATION_EXECUTOR_ENABLED` (#97) — verrou **entièrement
indépendant**, requis EN PLUS pour qu'une livraison SESSION parte
réellement.

### Permissions Discord minimales du bot (jamais Administrateur)

Sur le salon `#🎮-soirées` uniquement : **Voir le salon**, **Envoyer des
messages**, **Intégrer des liens** (embeds), **Créer des fils publics**,
**Envoyer des messages dans les fils**. Aucune permission `Gérer les
salons`/`Gérer les fils` n'est nécessaire dans cette PR — aucune opération
ARCHIVE n'est utilisée (voir plus haut). Ne jamais accorder
`Administrateur` : chaque permission listée ici est ciblée sur ce seul
salon.

### Procédure de test manuel (bot et serveur Discord séparés)

1. Créer un **serveur Discord de test** dédié (jamais le serveur réel du
   groupe) et un **bot Discord séparé** (Developer Portal → New
   Application → Bot), invité sur ce serveur de test avec les permissions
   ci-dessus, jamais Administrateur.
2. Configurer `DISCORD_BOT_TOKEN` (déjà utilisé par #96),
   `DISCORD_BOT_GUILD_ID` (serveur de test) et
   `DISCORD_BOT_SESSION_CHANNEL_ID` (salon de test) sur un environnement
   Preview Vercel dédié — jamais Production.
3. Activer `DISCORD_BOT_SESSION_ANNOUNCE_ENABLED=true` ET
   `NOTIFICATION_EXECUTOR_ENABLED=true` sur ce même environnement
   Preview uniquement.
4. Configurer un cron externe temporaire pointant vers
   `/api/cron/notification-executor` sur cet environnement Preview,
   jamais Production.
5. Créer une soirée de test, vérifier : l'annonce apparaît, le fil se
   crée, un rappel programmé apparaît dans le fil, une modification de
   créneau édite l'annonce existante, une clôture édite l'annonce et
   poste un résumé dans le fil.
6. Désactiver les deux variables à la fin du test — ne jamais laisser cet
   environnement Preview actif sans supervision.

### Activation progressive et rollback (production, non exécutés par cette PR)

1. Configurer `DISCORD_BOT_GUILD_ID`/`DISCORD_BOT_SESSION_CHANNEL_ID` sur
   Vercel Production, sans activer `DISCORD_BOT_SESSION_ANNOUNCE_ENABLED`
   — aucun effet, sessions existantes et nouvelles restent sur le
   webhook.
2. Activer `DISCORD_BOT_SESSION_ANNOUNCE_ENABLED=true` — SEULES les
   nouvelles sessions créées à partir de ce moment passent sur le chemin
   bot ; les sessions déjà en cours (`VOTING`/`SCHEDULED`) restent sur le
   webhook jusqu'à leur clôture.
3. Activer `NOTIFICATION_EXECUTOR_ENABLED=true` (si pas déjà fait) pour
   que les livraisons enqueue-ées soient réellement traitées.
4. **Rollback** : désactiver `DISCORD_BOT_SESSION_ANNOUNCE_ENABLED` —
   aucune NOUVELLE session ne passe plus sur le bot ; les sessions déjà
   `announceViaBot=true` en base continuent de l'être jusqu'à leur
   clôture (limite documentée plus haut si leur config Discord est
   retirée en même temps).

### Tests — PostgreSQL isolé + Discord HTTP entièrement simulé

`src/lib/session-announce.integration.test.ts` (18 tests, même dérogation
Postgres que les suites #95/#97 + `fetch` mocké, **aucun appel réseau
réel**) : annonce puis création de fil (parcours nominal) ; annonce
réussie/fil échoué, reprise sans réannoncer (le SEND initial n'est jamais
revu) ; rappel en attente de fil sans épuiser les tentatives (backoff
court dédié, jamais le backoff générique) puis devenant éligible une fois
le fil créé ; éditions concurrentes convergeant vers l'état COURANT de la
session (jamais un texte figé à l'enqueue) ; préférence refusée (aucune
sollicitation personnelle, annonce collective conservée, y compris quand
TOUT LE MONDE refuse, et que la sélection du créateur ne peut jamais
réintégrer un refus) ; configuration absente (`not_configured` terminal,
aucun appel Discord) ; dispatch réel de la route cron par catégorie
(SESSION → ce résolveur, TOURNAMENT/différé → toujours
`NOT_CONFIGURED_RESOLVER`) ; permission refusée (403, terminal) ; message
supprimé manuellement (404 sur une EDIT, terminal, observable, jamais
republié) ; résultat réseau incertain (retryable, un seul appel tenté) ;
bascule webhook/bot figée à la création (session avant le switch reste
webhook même une fois le bot activé ; session après le switch reste bot
même après un rollback) ; rollback avec config retirée pendant une
livraison en attente ; renvoi manuel refusé pour une session bot.

### Vérification

- `npx tsc --noEmit`, `npx eslint .` : clean sur tout le dépôt.
- `npm run test:postgres` avec `TEST_DATABASE_URL` : **359 tests, tout
  vert** (341 hérités des chantiers précédents, non modifiés par cette
  PR, rejoués à l'identique pour confirmer l'absence de régression, + 18
  nouveaux). Sans `TEST_DATABASE_URL` : suite d'intégration explicitement
  SKIPPÉE (pas de faux vert), reste distinguée clairement dans la sortie
  Vitest.
- `npx next build` (sans migration distante) : compile sans erreur,
  nouvelle route existante `/api/cron/notification-executor` mise à jour
  (dispatch par catégorie), aucune autre route modifiée. Migration
  `20260917090000_add_session_announce_via_bot` (additive uniquement,
  `ALTER TABLE ... ADD COLUMN ... DEFAULT false`) testée sur la base
  Postgres isolée locale, jamais appliquée à Neon par cette PR/ce build.
- Aucun appel Discord réel à aucun moment. Aucune variable définie sur
  Vercel/Neon/cron-job.org par cette PR. `NOTIFICATION_EXECUTOR_ENABLED`
  et `DISCORD_BOT_SESSION_ANNOUNCE_ENABLED` restent tous deux désactivés
  par défaut — deux verrous indépendants, aucun effet tant que les DEUX
  ne sont pas activés ensemble.
- **Bug trouvé et corrigé pendant l'écriture des tests** : le SEND initial
  de l'annonce n'incluait pas l'embed (seule l'EDIT le faisait), et le
  rappel dans le fil ne portait aucun texte visible quand personne n'était
  éligible à être mentionné (le contenu Discord ne portait alors QUE des
  mentions, jamais le texte du rappel lui-même) — les deux corrigés dans
  `session-announce.ts`, couverts par les tests ci-dessus.

### Revue ciblée avant merge — retour arrière et atomicité

Revue demandée sur le comportement de rollback (choix bot/webhook figé par
soirée vs. livraisons pouvant échouer définitivement si la configuration
change). Cinq points vérifiés, tous couverts par 7 tests supplémentaires
dans `session-announce.integration.test.ts` (17 → 24 tests) :

1. **`DISCORD_BOT_SESSION_ANNOUNCE_ENABLED` désactivé seul** (config Discord
   ET `NOTIFICATION_EXECUTOR_ENABLED` intacts) : `sessionAnnounceResolver`
   ne lit JAMAIS ce flag — seulement `getSessionAnnounceConfig()`
   (guildId/channelId). Le flag n'est lu qu'UNE fois, à la création d'une
   session (`isSessionAnnounceViaBotEnabled()` dans `createSession`).
   Confirmé : ce rollback n'affecte QUE les futures sessions ; une
   livraison déjà en file pour une session déjà bot continue son cycle
   normal (SEND, fil, rappels, éditions) jusqu'au bout.
2. **Trois bascules distinctes, trois comportements différents** :
   - Flag catégorie seul désactivé → **aucun effet** sur l'existant (voir
     point 1) — recouvrable trivialement.
   - `NOTIFICATION_EXECUTOR_ENABLED=false` → la route s'arrête avant même
     de réclamer une livraison (`{enabled:false, processed:0}`) — **aucune
     tentative consommée, aucun backoff posé** ; reprise identique en tout
     point à l'état avant la panne dès la réactivation. Seule bascule des
     trois qui garantit une reprise "comme si rien ne s'était passé".
   - `DISCORD_BOT_GUILD_ID`/`DISCORD_BOT_SESSION_CHANNEL_ID` retirés PENDANT
     que l'exécuteur tourne → `not_configured`, classification **terminale**
     héritée telle quelle de `notification-executor.ts` (#97, jamais
     réimplémentée) : une livraison surprise en plein traitement à ce
     moment-là échoue définitivement et ne reprend PAS automatiquement si
     la config est restaurée plus tard. C'est la SEULE des trois bascules
     avec une perte réelle, et elle nécessite les DEUX conditions à la fois
     (exécuteur actif ET config absente) — documenté comme limite assumée,
     observable via `status`/`errorClass` en base, jamais un secret exposé.

   **Procédure opérationnelle pour éviter cette perte** (rollback ou
   rotation de la configuration Discord) : **1)** désactiver
   `NOTIFICATION_EXECUTOR_ENABLED` en premier et attendre la fin de
   l'exécution en cours (aucune livraison n'est alors en plein traitement,
   voir point 2 ci-dessus — la reprise est garantie identique) ; **2)**
   modifier `DISCORD_BOT_GUILD_ID`/`DISCORD_BOT_SESSION_CHANNEL_ID` ; **3)**
   avant de réactiver `NOTIFICATION_EXECUTOR_ENABLED`, vérifier que la
   configuration Discord est de nouveau complète et correcte, PUIS
   réactiver. Respectée, cette procédure élimine la fenêtre `not_configured`
   décrite au point 2 — elle ne peut apparaître QUE si la config est
   retirée pendant que l'exécuteur tourne encore.
3. Confirmé : succès partiel (annonce envoyée, fil échoué) ne renvoie
   jamais l'annonce, et un rappel en attente de fil ne consomme aucun
   appel réseau tant que la dépendance n'est pas prête (déjà couvert par
   les tests initiaux de cette PR).
4. **Préférences relues au moment de l'envoi, pas à l'enqueue** — nouveau
   test explicite : un utilisateur qui se désabonne de `SESSION` APRÈS
   qu'une annonce a été mise en file (mais avant que l'exécuteur ne la
   traite) n'est PAS mentionné. `resolveEligibleMentions`/
   `filterUsersByNotificationPreference` interrogent la base à chaque
   résolution (`resolve()`, appelé juste avant l'appel Discord — jamais
   mis en cache depuis l'enqueue), et `loadSession` recharge elle aussi la
   session depuis la base à chaque passage.
5. **Atomicité mutation métier / intention de notification** — défaut
   confirmé et corrigé, PUIS étendu à tous les points d'entrée d'une
   session bot (suite à la revue de ce round) : `createNotificationEvent`/
   `enqueueDelivery` (`notification-delivery.ts`, #95) acceptent un client
   Prisma optionnel (`NotificationDb`, additif — comportement par défaut
   inchangé), et les quatre points où une session bot mute ET notifie
   enveloppent désormais les deux dans un seul `prisma.$transaction` :
   - **Création** (`createSession`) — déjà en place au round précédent.
   - **Modification** (`updateSessionSchedule`, `sessions.ts`, appelée par
     `editSessionAction`) — mutualisée dans une fonction dédiée et
     directement testable plutôt que dupliquée dans l'action.
   - **Annulation** (`cancelSession`).
   - **Clôture** (`claimSessionCloseWithAnnounce`, remplace l'ancien
     `claimSessionClose` non transactionnel) — couvre les deux branches
     avec annonce (annulée sans proposition jouable, décidée avec
     gagnant). La branche silencieuse "0 votant" (`discord: null`,
     jamais d'annonce ni webhook ni bot) garde un simple `updateMany` :
     rien à coupler, aucune intention de notification n'existe pour ce
     cas.
   Dans les quatre cas, un échec d'enqueue fait échouer/rollback la
   transaction ENTIÈRE : la mutation métier concernée (créneau, statut
   `CANCELLED`, statut `SCHEDULED`) n'est jamais persistée sans son
   intention de notification, et réciproquement. Le webhook (chemin
   non-bot) et les effets de bord XP/badges restent HORS de ces
   transactions, inchangés : le webhook parce qu'un appel réseau ne doit
   jamais être tenu dans une transaction SQL, XP/badges parce qu'ils
   suivent le même schéma séquentiel pré-existant ailleurs dans l'app
   (non modifié, non déplacé) — seule la paire mutation+intention-de-
   notification devait devenir atomique, pas la totalité de la fonction.
   Idempotence vérifiée par test : ré-enqueue de la création après une
   panne résolue (occurrence FIXE, #95) comme après un rollback de
   transaction (occurrence perdue avec la mutation annulée) ne crée
   jamais de livraison en double.
   **Protection contre un rappel obsolète après annulation/clôture** —
   déjà en place, vérifiée explicitement par un nouveau test : un rappel
   enqueue AVANT une annulation/clôture mais traité APRÈS échoue en
   `expired` (terminal, jamais envoyé) — `resolveThreadReminder` relit
   `session.status` à chaque résolution et refuse tout statut hors
   `SCHEDULED`/`VOTING`.

**Suite de la revue (ce round)** : 6 tests supplémentaires
(`session-announce.integration.test.ts`, 24 → 31 tests) — un échec
d'enqueue injecté (`vi.spyOn` sur `enqueueSessionAnnounceUpdate`) annule
la mutation associée pour la modification, l'annulation, et les deux
branches de clôture avec annonce ; une répétition après une panne résolue
ne laisse aucune trace de la tentative annulée et ne crée qu'une seule
livraison pour la tentative réussie ; deux enqueue de création identiques
(occurrence fixe) ne créent jamais de doublon. `npm run test:postgres` :
**372/372 verts** (366 hérités + 6 nouveaux). `tsc`/`eslint` clean sur
tout le dépôt. `next build` sans migration distante : OK. Toujours aucune
activation, aucun appel Discord réel, aucune surveillance récurrente.

## Chantier annonces Discord tournois — salon #🏆-tournois et fil par tournoi

Étend le chantier ci-dessus (#95/#96/#97/#98/#99, tous fusionnés) à la
catégorie `TOURNAMENT`, sans en dupliquer aucun mécanisme : mêmes
fondations de livraison, même client REST, même exécuteur, même principe
"transport figé par entité à la création". `#🎮-soirées` (chemin ci-dessus)
reste totalement inchangé. `#🎖️-récompenses` reste un chantier futur,
explicitement hors de cette PR (aucune notion de récompense/XP touchée
ici).

### Inventaire des chemins métier réels (avant implémentation)

| Événement métier | Comportement actuel (avant cette PR) | Comportement Discord retenu | Fichier |
|---|---|---|---|
| Création (`createTournamentAction`) | Webhook `postToDiscord` : "inscriptions ouvertes" + lien | `announceViaBot=true` : SEND annonce + SEND création de fil (dans la même transaction que `tournament.create`) ; sinon webhook inchangé | `src/app/tournois/actions.ts` |
| Inscription/désinscription (`register`/`unregisterFromTournamentAction`) | Aucune notification (webhook ou interne) | Aucune nouvelle notification — respecte explicitement "pas de message par inscription/désinscription" (spec) | `src/app/tournois/actions.ts` |
| Lancement du bracket, places pleines OU anticipé (`buildBracketInTransaction`, appelée par `registerForTournamentAction` et par `generateBracket`/`launchTournamentAction`) | Aucune notification (jamais eu de notif de lancement) | `announceViaBot=true` : EDIT de l'annonce ("en cours", places, rounds), enqueue DANS la même transaction que `status: IN_PROGRESS` | `src/lib/tournaments.ts` |
| Match résolu (`declareWinner`, hors finale) | Aucune notification par match (jamais eu, et explicitement exclu par la spec : "pas d'annonce par match/score") | Inchangé — aucune notification par match, ni webhook ni bot | `src/lib/tournaments.ts` |
| Clôture / finale (`declareWinner` → `tournamentFinalized`, effets dans `announceTournamentFinalization`) | Webhook `postToDiscord` : "X remporte le tournoi" + XP (1er/2e/demi-finalistes) + badges | `announceViaBot=true` : EDIT annonce ("terminé", champion) + SEND résumé de fil (champion/finaliste/demi-finalistes), enqueue DANS la même transaction que `status: DONE`/`championId` ; webhook explicitement SKIPPÉ pour un tournoi bot (jamais les deux). XP/badges **inchangés, mêmes règles, jamais dupliqués, jamais déplacés** dans cette PR | `src/lib/tournaments.ts` |
| Annulation | **N'existe pas** : `TournamentStatus` n'a que `REGISTRATION`/`IN_PROGRESS`/`DONE`, aucune fonction `cancelTournament`, aucun statut `CANCELLED` | Non implémenté — aucune règle de tournoi inventée par cette PR (spec : "pas de nouvelle règle de tournoi") | — |
| Suppression | **N'existe pas** (aucune fonction `deleteTournament`) | Non implémenté, même raison | — |
| Correction de résultat après clôture | **N'existe pas** : `declareWinner` réclame `completedAt: null`, un match déjà tranché ne peut plus être rejoué | Non implémenté, même raison | — |
| Cron dédié aux tournois | **N'existe pas** — aucun cron de tournoi (contrairement aux rappels de soirée, F7) | Rien à ajouter : pas de notion de rappel de tournoi dans le produit actuel | — |

### Organisation des livraisons (`src/lib/tournament-announce.ts`)

Trois `targetSlot` par tournoi (`default-guild:TOURNAMENT:<id>:<rôle>`),
même contrat que les soirées :
- **`announce`** — SEND à la création ("inscriptions ouvertes"), EDIT au
  lancement du bracket ("en cours") et à la clôture ("terminé"). Rendue
  depuis l'état COURANT du tournoi en base à chaque traitement (jamais un
  texte figé à l'enqueue) — une annonce en retard après que le tournoi a
  déjà progressé rend l'état RÉEL, jamais une fausse invitation à
  s'inscrire pour un tournoi déjà lancé/terminé.
- **`thread`** — SEND une fois, crée le fil à partir du message
  d'annonce ; dépend explicitement que `announce` soit `SENT`.
- **`thread-summary`** — SEND à la clôture, résumé (champion, finaliste,
  demi-finalistes, tous en texte brut, jamais mentionnés) posté dans le
  fil ; dépend que `thread` soit `SENT`.

Pas de rôle "rappel" (contrairement aux soirées, F7) : aucune notion de
rappel n'existe pour les tournois dans le produit actuel, non inventée
ici.

### Aucune mention, jamais de sollicitation personnelle nouvelle

Conformément à la spec (§5) : `allowedMentions` vaut explicitement
`{ parse: [] }` (aucun `users`, aucun `roles`) sur TOUS les messages de ce
module — SEND et EDIT, sans exception. Les noms de participants
apparaissent en texte brut (`champion.discordName`, etc.), jamais sous
forme `<@id>`. Aucune notification interne (`createNotifications`)
n'est écrite par ce module : le chemin webhook actuel n'en écrivait déjà
aucune pour les tournois (vérifié : ni `tournaments.ts` ni
`src/app/tournois/actions.ts` n'importent `createNotifications`), donc
rien n'est retiré ni ajouté silencieusement. `SESSION`/`ROULETTE`
(`UserNotificationCategory`, #98) ne sont ni réutilisées ni étendues pour
simuler une préférence `TOURNAMENT` — aucune n'existe, aucune n'est
introduite par cette PR.

### Configuration (variables ajoutées)

```
DISCORD_BOT_GUILD_ID=              # partagé avec le chantier soirées
DISCORD_BOT_TOURNAMENT_CHANNEL_ID= # ID du salon #🏆-tournois
DISCORD_BOT_TOURNAMENT_ANNOUNCE_ENABLED= # "true" exact pour activer, sinon legacy webhook
```

Deux verrous indépendants, comme pour les soirées : `NOTIFICATION_EXECUTOR_ENABLED`
ET `DISCORD_BOT_TOURNAMENT_ANNOUNCE_ENABLED` doivent être activés
ENSEMBLE pour qu'une annonce/fil de tournoi bot parte réellement — aucun
des deux n'est activé par cette PR. `getTournamentAnnounceConfig()`
(`src/lib/discord-bot-config.ts`) applique EXACTEMENT le même contrat que
`getSessionAnnounceConfig()` : `null` si `guildId`/`channelId` absents,
jamais une valeur partielle exploitable, relue à chaque appel (pas de
cache module-level).

**Corrigé lors de la revue ciblée avant merge (voir section dédiée
ci-dessous, "Revue ciblée avant merge — contrôle de destination")** : la
version initiale de cette PR ne faisait qu'une vérification de PRÉSENCE
de la paire `guildId`/`channelId`, sans confirmer que `channelId`
appartient réellement à `guildId`. Corrigé : le tout premier SEND d'un
tournoi vérifie désormais via un VRAI appel Discord
(`GET /channels/{id}`) que le salon appartient au bon serveur ET que son
type supporte le parcours annonce+fil, AVANT tout envoi — voir
`verifyChannelDestination`/`sendChannelMessageVerified`
(`src/lib/discord-rest.ts`). Cette vérification n'est PAS refaite pour
chaque EDIT/fil ultérieur (inutile : ils ciblent la référence du message
déjà confirmé, voir plus bas) — cette limite reste donc partagée avec les
soirées (#99) pour LEURS propres éditions, chantier non retouché ici (pas
de refonte générale des soirées demandée).

### Transport figé à la création — jamais deux annonces pour un même tournoi

`Tournament.announceViaBot` (migration additive
`20260918100000_add_tournament_announce_via_bot`, `DEFAULT false`) fige
EXACTEMENT le même contrat que `Session.announceViaBot` : décidé une
seule fois dans `createTournamentAction` (`DISCORD_BOT_TOURNAMENT_ANNOUNCE_ENABLED
=== "true"` ET configuration de salon complète, lues ensemble avec la
destination — voir la section "contrôle de destination" ci-dessous),
jamais relu depuis l'env ensuite. Garanties vérifiées par test
(`tournament-announce.integration.test.ts`) :
- Un tournoi créé AVANT le switch reste sur webhook même après activation
  du flag — `announceViaBot=false` ne consulte jamais `getTournamentAnnounceConfig()`
  ni n'enqueue quoi que ce soit.
- Un tournoi créé APRÈS le switch reste sur bot même après un rollback du
  flag — la décision ne dépend que de la colonne persistée, jamais de
  l'état courant de l'env.
- **Précision demandée avant merge #100** : `DISCORD_BOT_TOURNAMENT_ANNOUNCE_ENABLED`
  détermine UNIQUEMENT le transport des NOUVEAUX tournois, lu une seule
  fois à la création — `tournamentAnnounceResolver` ne le consulte JAMAIS
  (sa seule porte est `getTournamentAnnounceConfig()`, la présence de
  `DISCORD_BOT_GUILD_ID`/`DISCORD_BOT_TOURNAMENT_CHANNEL_ID`, jamais ce
  flag). Désactiver ce flag APRÈS la création d'un tournoi
  `announceViaBot=true` n'empêche donc ni son premier SEND encore en
  attente, ni son fil, ni ses éditions (lancement, clôture), ni son
  résumé final — tant que l'exécuteur (`NOTIFICATION_EXECUTOR_ENABLED`)
  reste actif et que la configuration de salon reste présente. Vérifié
  par un test dédié qui traite RÉELLEMENT les 4 rôles de livraison via la
  vraie route cron, flag catégorie désactivé du début à la fin (voir
  `tournament-announce.integration.test.ts`, describe "transport figé à
  la création").
- Jamais les deux transports pour la même clôture : `announceTournamentFinalization`
  (webhook) est explicitement SKIPPÉE pour un tournoi `announceViaBot=true`
  (l'EDIT + le résumé de fil bot ont déjà été enqueue dans la transaction
  de `declareWinner`).
- **Changement de destination sans mélange, y compris avant le tout
  premier SEND** — corrigé lors de la revue ciblée (voir section dédiée
  ci-dessous) : `Tournament.discordGuildId`/`discordChannelId`
  (migration additive `20260919090000_add_tournament_discord_destination`)
  persistent la destination EN MÊME TEMPS que `announceViaBot`, à la
  création. Le résolveur n'utilise plus JAMAIS `getTournamentAnnounceConfig()`
  comme source de destination (seulement comme porte d'activation globale
  de la catégorie) — un changement de `DISCORD_BOT_TOURNAMENT_CHANNEL_ID`
  n'a donc plus AUCUN effet sur un tournoi déjà créé, même avant son tout
  premier SEND. Les EDIT/fil qui suivent ciblent ensuite la référence du
  message RÉELLEMENT créé (`discordChannelId` persisté sur la livraison
  SEND finalisée), jamais la config ni la colonne du tournoi à nouveau —
  élimine structurellement le mélange, plutôt que de compter sur un 404 de
  Discord comme filet de sécurité. Testé explicitement pour les deux
  fenêtres (changement avant le premier SEND, changement après).

### Atomicité mutation métier / intention de notification

Même pattern que la revue ciblée de #99 (client Prisma transactionnel
`NotificationDb`, `notification-delivery.ts`) — appliqué à TOUS les points
d'entrée d'un tournoi bot qui mutent ET notifient, pas seulement la
création :
- **Création** (`createTournamentAction`) — `tournament.create` +
  `enqueueTournamentCreationDeliveries` dans le même `prisma.$transaction`.
- **Lancement du bracket** (`buildBracketInTransaction`) — l'EDIT
  ("en cours") est enqueue DANS la transaction qui pose `status: IN_PROGRESS`,
  au même niveau que la génération des matchs elle-même. Atteint aussi
  bien par un lancement automatique (dernière place prise, dans la
  transaction de `registerForTournamentAction`) que par un lancement
  anticipé manuel (`launchTournamentAction` → `generateBracket`, sa PROPRE
  transaction) — les deux appellent cette même fonction, aucune logique
  dupliquée entre les deux chemins.
- **Clôture** (`advanceWinner`, appelée par `declareWinner`) — l'EDIT
  ("terminé") ET le résumé de fil sont enqueue DANS la transaction qui
  pose `status: DONE`/`championId`.

Dans les trois cas, un échec d'enqueue fait échouer/rollback la
transaction ENTIÈRE : la mutation métier concernée (création du tournoi,
passage `IN_PROGRESS` + génération du bracket, passage `DONE` + résolution
du dernier match) n'est jamais persistée sans son intention de
notification, et réciproquement — testé explicitement par injection de
panne (`vi.spyOn` sur `enqueueTournamentAnnounceUpdate`) pour les trois
chemins. XP/badges (`awardXp`, `checkTournamentBadges`, dans
`announceTournamentFinalization`) restent **entièrement inchangés, mêmes
règles, hors de toute transaction de notification** — best-effort après
commit, exactement comme avant cette PR ; cette PR n'en modifie ni ne
duplique aucun.

**Pourquoi pas les autres chemins listés dans l'inventaire ?** Annulation,
suppression et correction de résultat n'existent PAS dans le produit
actuel (voir le tableau d'inventaire ci-dessus) — il n'y a donc aucune
mutation à coupler pour ces chemins, pas une garantie d'atomicité
manquante : les qualifier de "hors périmètre" serait inexact, ils sont
simplement absents du code réel que cette PR inspecte et étend.

Idempotence vérifiée par test : deux `enqueueTournamentCreationDeliveries`
identiques (occurrence FIXE) ne créent jamais de livraison en double ;
répéter `declareWinner` sur un match déjà tranché renvoie `ok: false` sans
toucher à la notification déjà enqueue pour ce tournoi.

### Tests (`tournament-announce.integration.test.ts`, 25 tests)

Même philosophie que la suite soirées : PostgreSQL isolé (`TEST_DATABASE_URL`)
+ `fetch` entièrement simulé. Couvre : parcours nominal (création → fil,
lancement, clôture + résumé, sans aucun XP/badge ré-attribué par ce
module) ; succès partiel (annonce envoyée, fil échoué, reprise ciblée) ;
dépendance de fil jamais épuisée (`dependency_not_ready`, aucun appel
réseau tant que non résolue) ; **contrôle de destination** (salon d'un
autre serveur → aucun POST, type de salon incompatible → aucun POST,
échec/timeout de la vérification → aucun envoi, changement de config
avant le premier SEND, changement de config après création de l'annonce —
voir section dédiée ci-dessous) ; erreurs Discord (404 sur EDIT terminal,
jamais republié) ; atomicité (création/lancement/clôture, rollback
complet sur échec d'enqueue, répétition sans doublon) ; transport figé
(avant/après switch, config absente, exécuteur désactivé, dispatch réel
par la route cron, **flag catégorie désactivé après création sans effet
sur les 4 rôles de livraison d'un tournoi déjà bot** — voir ci-dessus) ;
péremption (SEND traité après progression du tournoi rend l'état réel,
éditions successives convergent vers la plus récente) ; aucune mention
(même avec un nom d'utilisateur ressemblant à une syntaxe de mention
Discord).

`npm run test:postgres` : **397/397 verts** (372 hérités de tous les
chantiers précédents, non modifiés par cette PR sauf un commentaire de
test corrigé pour rester exact — voir note ci-dessous —, + 25 nouveaux).
Sans `TEST_DATABASE_URL` : suite explicitement SKIPPÉE (101 tests
d'intégration au total, répartis sur les deux chantiers), reste
distinguée clairement dans la sortie Vitest. `npx tsc --noEmit`/`npx eslint .` :
clean sur tout le dépôt. `npx next build` (sans migration distante) :
compile sans erreur, toutes les routes existantes inchangées hors
`/api/cron/notification-executor` (dispatch étendu à `TOURNAMENT`).
Les deux migrations (`20260918100000_add_tournament_announce_via_bot`,
`20260919090000_add_tournament_discord_destination`, additives
uniquement) sont testées sur la base Postgres isolée locale, jamais
appliquées à Neon par cette PR — la migration déjà appliquée en Preview
(`20260918100000_...`) n'a pas été modifiée, la seconde est un fichier
séparé.

**Note de précision** : un test existant de `session-announce.integration.test.ts`
("catégorie autre que SESSION... toujours NOT_CONFIGURED_RESOLVER")
affirmait que TOURNAMENT retombait systématiquement sur
`NOT_CONFIGURED_RESOLVER` — devenu inexact depuis que cette PR branche
`tournamentAnnounceResolver` dans la route cron. Le RÉSULTAT du test reste
identique (`resolver:not_configured`, car ce test précis ne configure
jamais `DISCORD_BOT_TOURNAMENT_CHANNEL_ID`), mais son intitulé/commentaire
a été corrigé pour ne plus affirmer que TOURNAMENT n'est "jamais" le
chantier annonces — c'est désormais le cas, simplement sans configuration
de salon dans CE test précis.

### Revue ciblée avant merge #100 — contrôle de destination

Revue demandée avant le merge de #100 : vérifier uniquement la présence
de `guildId`/`channelId` ne garantissait pas que le salon configuré
appartienne réellement au serveur prévu, et le 404 attendu sur une EDIT
après changement de configuration ne couvrait pas un premier SEND vers un
mauvais salon. Trois corrections, chacune testée explicitement :

1. **Vérification réseau réelle avant le tout premier envoi** —
   `verifyChannelDestination`/`sendChannelMessageVerified`
   (`src/lib/discord-rest.ts`, nouveau) : un `GET /channels/{id}` PUIS,
   seulement si le salon appartient au `guildId` attendu ET que son type
   (`THREAD_CAPABLE_CHANNEL_TYPES` = texte de guilde ou annonces, les
   seuls supportant `POST .../threads`) permet le parcours annonce+fil,
   le `POST` d'envoi. Aucun POST si le GET échoue, si le salon appartient
   à un autre serveur, ou si son type est incompatible — nouveau kind
   `destination_mismatch` (non-retryable) pour les deux derniers cas,
   distingué des échecs réseau (`network_uncertain`, retryable). Même
   budget réseau que tout autre appel de ce client (`deadline`/`now`
   partagés entre le GET et le POST, jamais recalculés entre les deux —
   même garantie de composition que `sendDirectMessage`). Nouveau kind
   `ResolvedAction`, `send_channel_message_verified`
   (`notification-executor.ts`), réservé au tout premier SEND d'une
   annonce de tournoi — jamais utilisé pour une EDIT ni un fil, qui
   n'ont pas besoin d'être revérifiés (voir point 3).
2. **Destination persistée, stable dès la création, avant même le
   premier SEND** — `Tournament.discordGuildId`/`discordChannelId`
   (migration additive `20260919090000_add_tournament_discord_destination`,
   colonnes nullables) : figées EN MÊME TEMPS que `announceViaBot` dans
   `createTournamentAction`, une seule lecture de
   `getTournamentAnnounceConfig()` pour les trois valeurs ensemble
   (jamais deux lectures séparées qui pourraient voir des valeurs
   différentes). Le résolveur (`tournamentAnnounceResolver`) n'utilise
   plus JAMAIS la config live comme source de destination — seulement
   comme porte d'activation globale de la catégorie
   (`not_configured` si retirée). Un changement de
   `DISCORD_BOT_TOURNAMENT_CHANNEL_ID` n'a donc plus AUCUN effet sur un
   tournoi déjà créé, même si son annonce n'a pas encore été envoyée au
   moment du changement — testé explicitement.
3. **Éditions et fil référencent le message RÉELLEMENT créé** — corrigé :
   `resolveAnnounceDelivery` (branche EDIT) et `resolveThreadCreation`
   utilisaient jusqu'ici le `channelId` de la config (live), PAS le
   `discordChannelId` persisté sur la livraison SEND finalisée
   (`findSentDelivery`), alors même que cette référence était déjà lue
   pour le `messageId`. Corrigé : les deux utilisent désormais
   `sent.discordChannelId` — un changement de configuration survenu
   APRÈS le premier SEND ne peut donc plus jamais faire cibler une EDIT
   ou une création de fil vers un salon différent de celui où l'annonce
   existe réellement, testé explicitement (avant, ce cas produisait un
   404 "accidentellement correct" ; désormais, la référence exacte est
   utilisée directement, sans dépendre d'un rejet Discord comme filet de
   sécurité).

**Portée** : ces trois corrections sont propres au chantier tournois — le
client REST (`discord-rest.ts`) et l'exécuteur (`notification-executor.ts`)
sont étendus (nouveau kind d'action, nouvelle fonction de vérification),
jamais réécrits, et `session-announce.ts` (soirées, #99) n'est PAS
retouché : aucune refonte générale des soirées n'a été demandée ni faite,
elles gardent leur limite déjà documentée (vérification de présence
uniquement pour LEUR propre premier SEND). Rien n'empêche une future PR
de leur appliquer le même mécanisme si nécessaire.

**Tests ajoutés** (`tournament-announce.integration.test.ts`) : salon
appartenant à un autre serveur (aucun POST, `destination_mismatch`) ;
type de salon incompatible — vocal (aucun POST, même kind) ; échec/timeout
du GET de vérification (aucun POST, `network_uncertain` retryable) ;
changement de configuration AVANT le premier SEND (la destination
persistée à la création est utilisée, jamais la nouvelle config) ;
changement de configuration APRÈS création de l'annonce (l'édition cible
le salon réel de l'annonce, jamais la nouvelle config). Les tests
préexistants du parcours nominal ont été mis à jour pour simuler le GET
de vérification en plus du POST sur le tout premier SEND (`mockChannelOk`/
`mockSendOk`/`mockVerifiedSendOk`, helpers ajoutés dans la suite).

### Événements couverts vs explicitement hors périmètre

**Couverts** : création (annonce + fil), lancement du bracket (EDIT
annonce), clôture/finale (EDIT annonce + résumé de fil).

**Explicitement hors périmètre de cette PR** (aucun n'existe dans le
produit actuel, aucun n'est inventé ici) : annulation de tournoi,
suppression de tournoi, correction de résultat après clôture, notification
par match individuel (exclue par la spec elle-même), rappels de tournoi,
mentions/pings personnels, nouvelles préférences de notification,
attribution XP/badge liée à Discord (XP/badges restent gérés exactement
comme avant, par le code métier existant, jamais par ce module),
multi-serveur, boutons/interactions Discord, commandes slash.

### Comportement des tournois pré-existants

Tout tournoi créé avant cette migration a `announceViaBot=false` par
défaut de colonne — reste indéfiniment sur le chemin webhook existant,
sans aucune action de backfill nécessaire, exactement comme pour les
soirées pré-#99.

### Procédure de validation manuelle future (préparée, non exécutée)

Identique dans l'esprit à celle des soirées (#99) : une application/bot
Discord séparée dédiée aux tests, un token scopé Preview uniquement, un
serveur/salon de test dédiés (jamais `#🏆-tournois` réel), une base Preview
isolée de Production, aucune destination de production utilisée en test.

### Procédure de retour arrière (préparée, non exécutée)

1. Désactiver `DISCORD_BOT_TOURNAMENT_ANNOUNCE_ENABLED` si nécessaire — 
   n'affecte que les FUTURS tournois (même garantie que pour les soirées,
   voir section "Transport figé" ci-dessus).
2. Pour retirer/changer `DISCORD_BOT_GUILD_ID`/`DISCORD_BOT_TOURNAMENT_CHANNEL_ID` :
   d'abord désactiver `NOTIFICATION_EXECUTOR_ENABLED` et attendre la fin
   de l'exécution en cours — variable partagée avec le chantier soirées,
   la désactiver arrête TOUTE catégorie, pas seulement TOURNAMENT.
3. Vérifier qu'aucun appel Discord n'est plus en vol (pas de réservation
   `RESERVED` active pour `TOURNAMENT` — `SELECT` sur `NotificationDelivery`).
   Un changement de variable n'interrompt jamais un appel HTTP déjà engagé.
4. Modifier la configuration.
5. Vérifier sa cohérence AVANT de réactiver `NOTIFICATION_EXECUTOR_ENABLED`.

Non exécutée par cette PR — instructions seules, comme pour le chantier
soirées.

## Correctif production — sessions Roulette n'honoraient jamais le chemin bot

Bug remonté en production après activation de
`DISCORD_BOT_SESSION_ANNOUNCE_ENABLED=true` (variables `DISCORD_BOT_GUILD_ID`/
`DISCORD_BOT_SESSION_CHANNEL_ID`/`DISCORD_BOT_TOKEN` présentes, redéploiement
effectué) : les deux dernières soirées créées avaient `announceViaBot=false`
en base et avaient chacune produit une annonce webhook avec un lien
distinct.

### Diagnostic

**Chemin normal (`createSession`, `src/app/sessions/actions/session-lifecycle.ts`)** —
vérifié ligne par ligne, **aucun défaut trouvé** : `isSessionAnnounceViaBotEnabled()`
(`src/lib/discord-bot-config.ts`) vaut `process.env.DISCORD_BOT_SESSION_ANNOUNCE_ENABLED
=== "true" && getSessionAnnounceConfig() !== null`, et `getSessionAnnounceConfig()`
exige `DISCORD_BOT_GUILD_ID`/`DISCORD_BOT_SESSION_CHANNEL_ID` non vides —
toutes deux lues à chaque appel (pas de cache), toutes deux correctes. La
condition EST correctement évaluée pour une session créée via ce chemin.

**Preuve du chemin réel emprunté** — recherche de tous les sites créant une
`Session` en base (`grep session\.create`) : **deux autres call sites
existaient**, tous deux hors du chemin `createSession`/`isSessionAnnounceViaBotEnabled()` :
- `spinRoulette` (`src/lib/roulette.ts`) — tirage roulette asynchrone,
  déclenché par le cron `/api/cron/close-sessions` (`processOpenRoulettes`)
  ou paresseusement au chargement de `/roulette/[id]`.
- `createSessionFromRouletteAction` (`src/app/roulette/actions.ts`) —
  roulette instantanée, déclenchée par un clic utilisateur sur `/roulette`.

Les deux créaient la `Session` par un `prisma.session.create` NU, sans
jamais poser le champ `announceViaBot` ni consulter
`isSessionAnnounceViaBotEnabled()` — la colonne retombait donc TOUJOURS sur
son défaut de schéma (`false`), quelle que soit la configuration du
chantier bot, et les deux appelaient ensuite INCONDITIONNELLEMENT leur
propre fonction webhook (`announceRouletteResult`/`announceSessionResult`,
`postToDiscord` → `DISCORD_WEBHOOK_URL`, jamais `DISCORD_BOT_*`). Ceci
explique exactement les symptômes observés :
- `announceViaBot=false` malgré la catégorie activée — ces deux chemins ne
  lisent jamais cette configuration.
- Deux annonces avec des liens Discord distincts — `postToDiscord` fait un
  `POST` webhook qui crée TOUJOURS un nouveau message avec son propre lien,
  comportement du webhook depuis l'origine, pas une anomalie du chantier
  bot.
- Le cron `/api/cron/notification-executor` répond 200 et ne loggue que
  « Handler appelé » — cohérent : sans le correctif, ces sessions
  n'enqueuent JAMAIS la moindre `NotificationDelivery`, donc rien à traiter
  pour ce cron ; ses logs sont sans rapport avec le défaut.

**Les deux créations à 3,5 secondes d'écart** — examinées séparément, sans
supposer un double clic : le code révèle DEUX déclencheurs distincts et
indépendants pour une création de session Roulette (le cron
`processOpenRoulettes` ET le déclenchement paresseux `spinRouletteIfDue` au
chargement d'une page `/roulette/[id]`, qui peuvent se chevaucher — protégé
contre un double tirage de la MÊME roulette par `claimRouletteSpin`, mais
rien n'empêche DEUX roulettes différentes, ou une roulette async et une
roulette instantanée, d'aboutir à deux créations de session rapprochées
dans le temps). **Non vérifié directement en base de production** (aucun
accès à la base Neon de production dans cette session) : l'hypothèse la
plus probante au vu du code est que les deux sessions concernées ont
`createdViaRoulette=true` — vérifiable par l'utilisateur via l'onglet
"Historique" de `/roulette` (liste les sessions `createdViaRoulette: true`,
`src/app/roulette/page.tsx`) ou une requête directe sur la base de
production, aucune des deux non exécutée ici.

### Logs ciblés ajoutés (aucune valeur secrète)

- `src/lib/sessions.ts`, nouvelle fonction `createRouletteResultSession` :
  `logger.info("sessions", "Décision de transport à la création (session
  issue d'une roulette).", { announceViaBot })` — un seul booléen, avant
  toute écriture.
- `src/lib/roulette.ts`, fin de `spinRoulette` : le log existant porte
  désormais aussi `{ announceViaBot }`.

### Correctif

Nouvelle fonction partagée `createRouletteResultSession` (`src/lib/sessions.ts`) —
même contrat que `createSession`/`updateSessionSchedule` : lit
`isSessionAnnounceViaBotEnabled()` UNE fois, crée la `Session` (avec
`announceViaBot` correctement posé) ET enqueue
`enqueueSessionCreationDeliveries` dans LA MÊME transaction SQL si le bot
est activé — aucun appel Discord dans la transaction. `spinRoulette` et
`createSessionFromRouletteAction` appellent désormais cette fonction
PARTAGÉE au lieu de dupliquer chacun un `prisma.session.create` incomplet,
et sautent leur propre appel webhook quand `announceViaBot` est vrai
(jamais les deux transports à la fois, même garde que `createSession`).

**Défaut connexe découvert en corrigeant celui-ci** (conséquence directe,
pas un sujet séparé mis de côté) : le résolveur bot
(`resolveAnnounceDelivery`, `src/lib/session-announce.ts`) supposait
jusqu'ici que le tout premier SEND concernait TOUJOURS une session encore
`VOTING` (seule vraie pour `createSession`, seul appelant connu à
l'écriture de #99) — type et titre de la notification interne étaient
donc figés en dur (`SESSION_CREATED` / "📣 Nouvelle soirée"), alors que
l'embed Discord, lui, était déjà correctement dérivé de l'état courant. Une
session Roulette est créée DIRECTEMENT `SCHEDULED` avec un jeu déjà décidé :
son premier SEND aurait affiché un embed Discord correct ("🎮 Soirée
validée : [Jeu]") accompagné d'une notification interne incohérente.
Corrigé via `resolveSendNotificationMeta`, qui dérive désormais type et
titre de l'état courant pour le SEND — sans changer le texte du cas
`VOTING` (comportement historique de `createSession` inchangé à
l'identique).

### Tests ajoutés

`session-announce.integration.test.ts`, describe "sessions Roulette —
honorent enfin announceViaBot" (2 tests) :
- bot activé : `spinRoulette` enqueue une livraison bot (jamais le
  webhook), et le SEND traité rend l'état "validée" avec le bon
  type/titre de notification interne (`SESSION_RESULT`, jamais "Nouvelle
  soirée").
- bot désactivé (non-régression) : comportement historique inchangé —
  webhook appelé, `announceViaBot=false` persisté, aucune livraison bot
  enqueue.

### Vérification

- `npx tsc --noEmit` / `npx eslint .` : clean sur tout le dépôt.
- `npm run test:postgres` : **399/399 verts** (397 hérités + 2 nouveaux).
- Sans `TEST_DATABASE_URL` : suite explicitement SKIPPÉE, distinguée dans
  la sortie Vitest.
- `npx next build` : compile sans erreur.
- Aucune session existante n'a été modifiée (`announceViaBot` NON forcé
  rétroactivement sur les deux sessions déjà en base — hors périmètre,
  décision produit à prendre séparément si un rattrapage est souhaité).
- Aucune annonce Discord réelle envoyée, aucune configuration distante
  modifiée.

### Revue complémentaire — catégorie de préférence et double tirage concurrent

Deux points vérifiés en complément avant de sortir cette PR du mode Draft.

**1. Chemins roulette → helper partagé, et catégorie de préférence.**
`spinRoulette` (`src/lib/roulette.ts`) et `createSessionFromRouletteAction`
(`src/app/roulette/actions.ts`) appellent tous les deux réellement
`createRouletteResultSession` (relu ligne à ligne sur l'état actuel des deux
fichiers, pas seulement supposé) — confirmé, aucun défaut sur ce point.

En revanche, un second défaut connexe a été trouvé et corrigé :
`resolveEligibleMentions` (`src/lib/session-announce.ts`), qui filtre les
destinataires des mentions/notifications internes du chemin BOT, filtrait
TOUJOURS via la catégorie de préférence `"SESSION"` — y compris pour une
session `createdViaRoulette=true`, alors que le chemin webhook équivalent
(`announceRouletteResult`, `discord-roulette.ts`) filtre bien via
`"ROULETTE"` (catégorie déjà existante, `UserNotificationCategory`, #98 —
rien inventé ici). Une personne ayant désactivé les notifications Roulette
mais gardé les Soirées activées aurait donc continué d'être mentionnée sur
un résultat de roulette passé par le chemin bot ; à l'inverse, quelqu'un
ayant désactivé les Soirées mais gardé les Roulettes activées aurait été
exclu à tort. Corrigé : `resolveEligibleMentions` choisit désormais
`"ROULETTE"` si `session.createdViaRoulette`, sinon `"SESSION"` (comportement
historique inchangé pour toute session non-Roulette).

Ce filtre est résolu par `sessionAnnounceResolver`, appelé PAR L'EXÉCUTEUR
au traitement réel de la livraison (jamais à l'enqueue, jamais mis en
cache) — la préférence est donc bien relue à l'envoi effectif, y compris
pour un SEND différé traité longtemps après l'enqueue, même garantie déjà
établie pour la catégorie SESSION (#98/#99). Les deux `NotificationEvent
.category` restés en dur sur `"SESSION"` dans `enqueueSessionCreationDeliveries`
et consorts ne sont PAS le même concept : c'est la catégorie de routage
interne de l'événement (`NotificationCategory` — SESSION/TOURNAMENT/…,
distingue quel résolveur traite l'événement), pas la préférence utilisateur
(`UserNotificationCategory` — SESSION/ROULETTE) ; une session Roulette
reste un `Session` et relève donc bien du résolveur SESSION, ce n'était pas
un défaut.

**2. Protection contre un double tirage concurrent de la MÊME roulette.**
Le cron (`processOpenRoulettes` → `spinRouletteIfDue`) et un chargement de
page paresseux (`spinRouletteIfDue` sur `/roulette/[id]`) peuvent tous deux
appeler `spinRoulette` pour la même roulette au même instant.
`claimRouletteSpin` (déjà en place, même mécanique que `claimSessionClose` :
un seul `updateMany` conditionné sur `status: "OPEN"`, atomique côté
Postgres) protégeait déjà contre ce cas par construction, mais n'était
jusqu'ici vérifié par AUCUN test de concurrence réelle. Un test l'a
maintenant mis à l'épreuve contre un vrai moteur Postgres
(`Promise.all` de deux appels concurrents à `spinRoulette` sur le même id,
même dérogation "pas de mock" déjà en place pour ces garanties) : **la
garantie tient sans aucun correctif** — une seule session, un seul
`NotificationEvent`, un seul jeu de `NotificationDelivery` créés, quel que
soit l'ordre d'arrivée des deux appels. Un second test complémentaire
confirme que cette protection ne bloque jamais deux créations
volontairement distinctes : deux roulettes DIFFÉRENTES tirées en même temps
sont toutes deux traitées normalement, chacune avec sa propre session.

**Origine des deux sessions Production espacées de 3,5 secondes** — reste
une hypothèse non confirmée (aucun accès à la base de production dans
cette session, voir plus haut) ; ce point de revue ne change rien à ce
statut : la protection anti-double-tirage vérifiée ici concerne la MÊME
roulette, elle n'exclut donc toujours pas deux roulettes distinctes ou une
roulette async et une instantanée aboutissant à deux créations rapprochées.

**Tests ajoutés** (`session-announce.integration.test.ts`, mêmes describe
"sessions Roulette…") :
- catégorie ROULETTE honorée au SEND différé — deux comptes aux
  préférences SESSION/ROULETTE délibérément opposées, seule la bonne
  catégorie relue à l'envoi réel peut produire le résultat attendu.
- double tirage concurrent de la même roulette — une seule session, un
  seul événement, aucune livraison en double.
- deux roulettes distinctes tirées en même temps — toutes deux traitées,
  aucun blocage croisé.

**Vérification** : `npx tsc --noEmit` / `npx eslint .` clean ;
`npm run test:postgres` — **402/402 verts** (399 hérités + 3 nouveaux) ;
`npx next build` sans erreur. Aucun renvoi Discord réel, aucune session
existante modifiée, PR gardée en Draft.

## Chantier confidentialité des soirées — remplace les annonces collectives

Nouvelle règle produit, universelle : **seuls le créateur et les invités
actifs d'une soirée peuvent la consulter ou agir dessus — sur le site ET
sur Discord.** Ceci remplace explicitement l'ancien modèle (toute
personne connectée à l'app pouvait consulter/voter/proposer sur
n'importe quelle soirée ; toute annonce Discord, webhook ou bot, était
publique dans un salon partagé). Chantier volontairement délimité — voir
"Ce qui reste hors périmètre" en fin de section.

### Audit de départ — faits vérifiés (pas d'accès Production dans cette
session, uniquement le code et une base Postgres isolée)

- **Aucun modèle d'invitation n'existait avant ce chantier.** `Session.notifiedUserIds`
  et `Roulette.notifiedUserIds` étaient déjà là, mais documentés dans leur
  propre commentaire comme un simple filtre de MENTIONS Discord, "jamais
  relu ailleurs" — jamais une liste d'accès. Toute personne authentifiée
  pouvait déjà lire/agir sur n'importe quelle soirée.
- **Zéro filtre par soirée** sur `/sessions` (liste), `/sessions/[id]`
  (détail complet : propositions, votes, chat, pronostics, paris,
  superlatifs), `/roulette` (les deux onglets), `/roulette/[id]` (y
  compris, une fois le tirage fait, les jeux proposés par TOUT LE MONDE —
  défaisant l'effet "surprise" que la page revendiquait déjà dans son
  propre commentaire), `/calendrier`, `/` (accueil — prochaine soirée +
  activité récente), et les server actions de vote/proposition/chat
  (`proposeGame`, `toggleVote`, `getChatMessagesAction`/`sendChatMessageAction`,
  `submitRouletteEntriesAction`).
- Les mutations de cycle de vie (modifier/clôturer/annuler/supprimer une
  session) étaient déjà réservées au créateur (`createdById === user.id`)
  — bon pattern existant, réutilisé tel quel pour la nouvelle gestion des
  invités.
- Aucune trace en base des messages postés via le webhook legacy
  (`postToDiscord` ne persiste jamais l'id du message envoyé) — limite
  qui borne directement ce que l'inventaire des anciennes annonces
  publiques peut couvrir (voir plus bas).

### 1. Autorisation centralisée — `src/lib/session-access.ts`

Nouveau modèle **`SessionInvite`** (migration `20260921100000_add_session_invite`,
additive, jamais touché depuis) — source de vérité persistante,
granulaire par personne, historisée :
- `status: ACTIVE | REVOKED` plutôt qu'une suppression de ligne — un
  retrait doit rester observable (`revokedAt`/`revokedById`), jamais
  effacer l'historique.
- `@@unique([sessionId, userId])` — une seule ligne par (soirée,
  personne) pour toujours ; réinviter après un retrait RÉUTILISE la même
  ligne (repasse `ACTIVE`) plutôt que d'en créer une seconde.
- Le créateur n'a jamais besoin d'une ligne — son accès vient uniquement
  de `Session.createdById`.

Fonctions exportées, **seule source de vérité du contrôle d'accès
serveur**, appelées AVANT toute lecture/écriture sensible (jamais après) :
- `accessibleSessionWhere(userId)` — fragment `Prisma.SessionWhereInput`
  réutilisable pour restreindre n'importe quelle requête `Session` (liste
  ou détail) : `createdById === userId OR invites.some({userId, status: ACTIVE})`.
  Toujours injecté dans la requête, jamais un filtrage en mémoire après
  coup.
- `getSessionAccessRole(userId, sessionId)` → `"creator" | "guest" | null`
  — `null` indistinguable entre "soirée inexistante" et "soirée
  existante mais accès refusé" (jamais confirmer l'existence à un
  non-autorisé).
- `canAccessSession(userId, sessionId)` — booléen pratique.
- `inviteToSession` / `revokeSessionInvite` — CRUD des invitations,
  idempotents, vérification "créateur uniquement" faite par l'APPELANT
  (jamais dans ce module, qui reste un pur outil d'accès).
- `filterByActiveSessionInvite(sessionId, creatorId, candidates)` — filtre
  RESTRICTIF uniquement (jamais un ajout), utilisé par `session-announce.ts`
  pour qu'une révocation coupe aussi toute NOUVELLE mention/notification.

**Aucun contournement pour les administrateurs de l'app** (`UserRole.ADMIN`)
n'a été introduit — un accès global implicite aux soirées privées pour
les admins n'était pas demandé. `resendDiscordAction` autorisait déjà,
AVANT ce chantier, un admin à renvoyer l'annonce webhook d'une session
dont il n'est ni créateur ni invité (PR "Accès & secrets") — ce bypass
préexistant n'a pas été étendu à la lecture des données de soirée, mais
reste un besoin d'accès global existant, documenté ici, jamais tranché
silencieusement par ce chantier (voir "Ce qui reste ouvert").

### 2. Chemins branchés (lecture ET écriture)

- `/sessions` (liste), `/sessions/[id]` (détail complet — un seul
  contrôle d'accès en tête de page couvre propositions/votes/chat/
  pronostics/paris/superlatifs, qui n'ont plus besoin de leur propre
  garde puisque toute la page 404 pour un non-autorisé), `/sessions/[id]/vote-superlatifs`.
- Server actions : `proposeGame`, `toggleVote`, `withdrawProposalAction`
  (proposals-votes.ts), `submitPronosticAction`/`placeBetAction`
  (predictions.ts, défense en profondeur), `submitSuperlativeVotesAction`
  (superlatives.ts, idem), `getChatMessagesAction`/`sendChatMessageAction`/
  `toggleReactionAction` (chat/actions.ts — canal `sessionId: null` reste
  global, inchangé ; le canal de soirée est vérifié À CHAQUE appel de
  polling, pas seulement au chargement de page).
- `/` (accueil) — "Prochaine soirée" et "Activité récente" (uniquement la
  ligne "Soirée jouée", qui expose un nom de jeu + un créateur précis ;
  les 3 autres types du flux — badges, superlatifs, niveaux — restent un
  flux global d'accomplissements personnels, hors périmètre, voir plus
  bas). `getRecentActivity`/`getWeekAvailability` prennent désormais un
  `viewerId` obligatoire.
- `/calendrier` — `getCalendarData` prend désormais un `viewerId`
  obligatoire ; les cards de soirée affichées sont restreintes, la grille
  de disponibilité elle-même (aucune donnée de soirée) n'est pas
  concernée.
- **Roulette** — deux mécanismes distincts, volontairement :
  - AVANT tirage (`Roulette`, pas encore de `Session`) : accès gouverné
    par `Roulette.notifiedUserIds` (déjà la seule intention d'invitation
    existante) — appliqué à `/roulette` (onglet "En cours", filtré en
    mémoire après un fetch complet, échelle "groupe d'amis" assumée),
    `/roulette/[id]` (page entière, `notFound()` pour un non-invité) et
    `submitRouletteEntriesAction`.
  - APRÈS tirage (`createRouletteResultSession`, chemins instantané ET
    async) : la session résultante reçoit des `SessionInvite` RÉELS pour
    `participantIds`, dans la MÊME transaction que sa création — dès lors
    gérée exactement comme une session classique (page, invites, Discord).
  - `/roulette` (onglet "Historique") — filtré via `accessibleSessionWhere`,
    comme `/sessions`.

### 3. Création des invitations — jamais de liste vide transformée en "tout le monde"

Les DEUX chemins réels de création de `Session` (`createSession`,
session-lifecycle.ts ; `createRouletteResultSession`, sessions.ts —
partagé par `spinRoulette` et `createSessionFromRouletteAction`) posent
désormais des `SessionInvite` EXACTS pour la sélection réelle, DANS LA
MÊME transaction SQL que la création de la session — un crash entre les
deux ne peut jamais laisser une session sans le moindre invité
accessible, visible du seul créateur en silence. Prouvé par un test
d'intégration Postgres dédié (`session-lifecycle.integration.test.ts`) :
sélection exacte reprise, liste vide → créateur seul (jamais "tout le
monde"), id forgé dans la sélection silencieusement ignoré (jamais de
ligne orpheline).

### 4. Gestion des invités — `/sessions/[id]/invites`, réservée au créateur

Nouvelle page (lien "👥 Gérer les invités" sur `/sessions/[id]`, visible
au seul créateur) : liste les invités actifs, permet d'en inviter de
nouveaux (parmi tous les potes non encore actifs) et d'en retirer, et
distingue explicitement l'historique des retraits (réinvitation en un
clic). Les deux actions serveur (`src/app/sessions/actions/invites.ts`)
vérifient elles-mêmes `session.createdById === user.id` — jamais délégué
à `canAccessSession`, qui autoriserait aussi un simple invité actif.

Le retrait :
- coupe l'accès applicatif IMMÉDIATEMENT (`revokeSessionInvite`, dès le
  `updateMany` commité — relu à CHAQUE lecture ultérieure, jamais mis en
  cache) ;
- empêche toute NOUVELLE mention/notification (`filterByActiveSessionInvite`,
  relu au traitement réel par l'exécuteur — pas seulement à l'enqueue) ;
- déclenche une synchronisation Discord TRAÇABLE (`enqueueSessionInviteSync`,
  voir section 5) — jamais un appel Discord réel depuis l'action elle-même ;
- NE touche JAMAIS les contributions déjà écrites par cette personne
  (`Vote`/`Proposal`/`ChatMessage` restent visibles aux autres invités) —
  seul l'accès FUTUR est coupé.

La synchronisation Discord n'est jamais présentée comme instantanée :
`getSessionInviteSyncStatuses` lit l'état RÉEL de la dernière livraison
connue (`pending`/`synced`/`failed`, jamais un optimisme "ça vient de
partir") et l'affiche par invité sur la page de gestion — **pour les
invités actifs ET pour l'historique des retraits** (revue ciblée : un
statut affiché seulement côté "actifs" aurait pu laisser croire qu'un
retrait Discord ayant échoué avait quand même réussi, puisque rien ne
l'aurait jamais signalé). Les libellés du retrait sont volontairement
distincts de ceux de l'ajout (`REVOKE_SYNC_LABELS` vs `SYNC_LABELS`,
`src/app/sessions/[id]/invites/page.tsx`) : **l'accès Discord n'est
jamais annoncé comme coupé avant confirmation** — `"pending"` affiche
explicitement "accès Discord pas encore coupé", `"failed"` affiche
explicitement "cette personne peut encore avoir accès au fil Discord".

Un échec de synchronisation (ajout ou retrait) est **terminal** — aucun
cron ne le retente jamais automatiquement (`NotificationDelivery.status
= "FAILED"`, hors du balayage PENDING/RETRYING). Sans recours, un tel
échec resterait bloqué indéfiniment. Nouveau bouton "Réessayer",
affiché pour toute invitation (active OU révoquée) dont le dernier
statut connu est `"failed"`, qui ré-enqueue une synchronisation
(`retrySessionInviteSyncAction` → `enqueueSessionInviteSync`, même
mécanisme et mêmes garanties d'idempotence/convergence que les actions
inviter/retirer — le résolveur relit le statut ACTUEL de l'invitation au
traitement, retente donc toujours la bonne opération). Testé par
`invites.test.ts` : refusé sans session utilisateur, refusé à un
non-créateur, no-op si la session est restée sur le chemin webhook,
refusé pour une invitation appartenant à une autre soirée (id forgé), et
ré-enqueue bien pour le créateur légitime.

### 5. Discord privé — fils privés par soirée

**Faits vérifiés auprès de la documentation officielle Discord** —
`discord.com`/`docs.discord.com`/`support.discord.com` sont bloqués par
le proxy réseau sortant de CETTE session ; vérifiés à la place via une
copie brute (`raw.githubusercontent.com/discord/discord-api-docs`) du
même contenu source, jamais depuis la seule mémoire d'entraînement :
- Un fil privé (`GUILD_PRIVATE_THREAD`, `type: 12`) ne peut exister que
  sous un salon parent `GUILD_TEXT` (jamais `GUILD_ANNOUNCEMENT`) — **le
  salon configuré par `DISCORD_BOT_SESSION_CHANNEL_ID` doit être un
  salon texte classique**, pas un salon d'annonces.
- `POST /channels/{channel.id}/threads` SANS `message_id` crée un fil
  jamais rattaché à un message existant — aucune information de soirée
  ne transite donc jamais par un message visible du salon public.
- `invitable` (uniquement significatif pour un fil privé) : posé à
  `false` par ce chantier — SEUL le créateur du fil (ce bot) et les
  titulaires Discord de `MANAGE_THREADS` peuvent y ajouter des membres,
  jamais un simple invité depuis Discord lui-même.
- Ajout de membre : `PUT /channels/{id}/thread-members/{user.id}` —
  idempotent par nature (204 que le membre soit déjà présent ou non).
- Retrait de membre : `DELETE /channels/{id}/thread-members/{user.id}` —
  sur un fil PRIVÉ créé par ce bot, son statut de créateur suffit (**pas
  besoin de `MANAGE_THREADS` guilde-wide pour retirer quelqu'un**).
- **Limite honnête, documentée, non contournable depuis ce client** : un
  titulaire Discord de `MANAGE_THREADS` (admin/modérateur du serveur) voit
  et accède TOUJOURS à un fil privé, quelle que soit la liste de membres
  gérée applicativement. Aucune API Discord ne permet de masquer un fil
  privé à un modérateur du serveur.

**Permissions Discord exactes à configurer sur le bot**, salon
`DISCORD_BOT_SESSION_CHANNEL_ID` (un salon texte `GUILD_TEXT`) :
`VIEW_CHANNEL`, `CREATE_PRIVATE_THREADS`, `SEND_MESSAGES_IN_THREADS`.
`MANAGE_THREADS` n'est PAS nécessaire pour ce chantier (le bot est
toujours le créateur de ses propres fils).

**Architecture** (`src/lib/session-announce.ts`, réutilise intégralement
l'exécuteur/le client REST/les fondations de livraison de #95-#98,
aucune réécriture) — l'organisation d'origine (annonce publique → fil
créé dessus) est **inversée** :
- `thread` — SEND une fois, crée le fil PRIVÉ (`startPrivateThread`,
  discord-rest.ts) — AUCUNE dépendance, c'est désormais le tout premier
  appel Discord de la soirée.
- `announce` — SEND puis EDIT à chaque changement d'état, désormais
  POSTÉ DANS LE FIL (`send_thread_message`/`edit_channel_message` avec
  `channelId = threadId`) — dépend que `thread` soit `SENT` (dépendance
  INVERSÉE par rapport à l'organisation d'origine).
- `thread-summary`/`thread-reminder-<n>` — inchangés, toujours postés
  dans le fil, toujours dépendants de `thread`.
- **Nouveau rôle `invite:<inviteId>`** — un par ligne `SessionInvite`,
  synchronise l'appartenance au fil avec le statut RÉEL de l'invitation,
  relu au TRAITEMENT (jamais depuis un instantané pris à l'enqueue) :
  `ACTIVE` → `add_thread_member` (PUT) ; `REVOKED` → `remove_thread_member`
  (DELETE). Un `404` sur le retrait ("déjà absent du fil") est traité
  comme un SUCCÈS par le résolveur (l'état cible est déjà atteint),
  jamais un échec.

**Courses traitées, toutes couvertes par un test d'intégration Postgres
dédié** (`session-announce.integration.test.ts`, describe "invite-sync") :
- retrait AVANT le traitement d'un ajout enqueue — le résolveur relit le
  statut ACTUEL au traitement, résout donc vers un retrait, jamais un
  ajout périmé qui rétablirait un accès déjà coupé ;
- retrait PENDANT une livraison en cours — même garantie, la relecture
  est toujours "juste à temps" ;
- répétition d'un ajout/retrait (double clic, invite→revoke rapprochés) —
  convergence "seule la plus récente survit" (`claimNextDelivery`, #95),
  jamais réimplémentée ici, réutilisée telle quelle ;
- suppression/annulation de la soirée pendant une livraison — l'invite
  n'existe alors plus (cascade), le résolveur renvoie `expired`, jamais
  retenté ;
- modification des invitations pendant que le fil est encore en création
  — `dependency_not_ready`, retenté automatiquement une fois le fil créé.

En cas d'échec Discord (permission refusée, salon supprimé...), la trace
reste exploitable en base (`NotificationDelivery.status`/`errorClass`,
visible sur `/sessions/[id]/invites`) — reprise contrôlée par le cron
existant, jamais un repli vers un webhook ou un salon public.

**Protection contre un ancien fil PUBLIC référencé en base (revue ciblée)** —
la ligne `NotificationDelivery` "thread" `SENT` d'une soirée est produite
UNE SEULE FOIS, à sa création (occurrence fixe, jamais ré-enqueue-ée,
voir #95). Pour une soirée créée AVANT le déploiement de ce chantier,
cette ligne référence encore l'ANCIEN fil **PUBLIC** — et rien dans la
base ne distingue cette situation d'un fil privé légitime : `announce`
(SEND et EDIT), `thread-summary`, `thread-reminder-<n>` et `invite:<id>`
lisent tous ce même `discordThreadId` stocké pour y écrire. Sans
protection, un déploiement de ce chantier aurait pu faire écrire du
contenu de soirée PRIVÉ (annonce, rappel, résumé, appartenance au fil)
dans un fil resté PUBLIC.

Corrigé par une vérification Discord réelle (GET) immédiatement avant
CHAQUE écriture qui s'appuie sur un `discordThreadId` lu en base —
`verifyThreadIsPrivate` (`src/lib/discord-rest.ts`) relit le salon
(`GET /channels/{id}`) et refuse (`destination_mismatch`, non-retryable)
si son `type` n'est pas `12` (fil privé) — même principe que
`verifyChannelDestination`/`sendChannelMessageVerified`, déjà utilisé
pour les annonces de tournoi (#100). Trois nouvelles fonctions
"vérifiées" (`sendThreadMessageVerified`/`addThreadMemberVerified`/
`removeThreadMemberVerified`) remplacent leurs équivalents non vérifiés
pour TOUT chemin session qui lit un fil déjà existant : le SEND de
l'annonce (`send_thread_message_verified`), le résumé de fin de soirée,
les rappels, et l'ajout/retrait de membre par invite-sync.

**Seules la création initiale du fil (`thread` SEND, `startPrivateThread`)
et l'EDIT de l'annonce (`edit_channel_message`) restent SANS cette
vérification GET supplémentaire — pour deux raisons DIFFÉRENTES, jamais
la même** (une version antérieure de cette section et du commentaire de
code affirmait à tort que l'EDIT était sûr "parce que son SEND était déjà
vérifié" — faux pour une soirée pré-#102, corrigé ci-dessous) :
- la création ne lit aucune référence stockée (elle en produit une,
  fraîche, qu'elle vient de créer elle-même) ;
- l'EDIT ne lit jamais `discordThreadId` sur la ligne `thread` (déjà
  protégée par sa propre dépendance), mais sur la ligne **`announce`** —
  et ce champ précis n'est JAMAIS peuplé pour une soirée créée avant
  #102 : son ancienne architecture (`thread` créé DEPUIS le message
  d'annonce, dépendance inversée par rapport à aujourd'hui) postait
  l'annonce directement dans le salon PUBLIC via `send_channel_message`,
  qui ne pose que `discordChannelId` — jamais `discordThreadId`. Ce champ
  n'est écrit qu'au moment du SEND réel, jamais rétroactivement, donc une
  ligne `announce` legacy ne le porte JAMAIS, quel que soit le code
  déployé au moment où l'EDIT est traitée. La garantie est donc
  STRUCTURELLE (une propriété permanente des données), pas temporelle
  (jamais "le SEND qui l'a produit était déjà vérifié"). `resolveAnnounceDelivery`
  distingue explicitement les deux refus : `dependency_not_ready`
  (retryable) si le SEND n'a simplement pas encore eu lieu, `unresolvable`
  (terminal IMMÉDIAT, jamais des tentatives inutiles avant l'échec) si la
  ligne `announce` est de cette forme legacy.

Prouvé par un nouveau describe dédié dans
`session-announce.integration.test.ts` ("protection contre un ancien fil
PUBLIC référencé en base") : SEND annonce/thread-summary/invite-sync vers
un fil dont la vérification révèle un `type` ≠ 12 → échec terminal
observable (`discord:destination_mismatch`), AUCUN POST/PUT/DELETE tenté,
statut Discord affiché comme `"failed"` (jamais silencieusement ignoré) ;
et un test dédié à l'EDIT reconstruisant littéralement l'état d'une
soirée pré-#102 (annonce SENT avec `discordChannelId` mais sans
`discordThreadId`, fil SENT référençant un ancien fil PUBLIC) puis
déclenchant une EDIT — `resolver:unresolvable`, **zéro appel réseau
Discord tenté**, pas même une vérification refusée.

### 6. Transition et retour arrière — chemin webhook legacy, préférences

Le chemin webhook (`announceViaBot: false`, `DISCORD_WEBHOOK_URL`) pointe
par construction un salon **public**, sans la moindre notion de membres
— aucun mécanisme privé équivalent au fil bot n'existe pour lui. La
nouvelle règle de confidentialité interdit catégoriquement d'y publier
quoi que ce soit qui décrive une soirée précise. Corrigé en supprimant
l'appel réseau ET la construction de l'embed eux-mêmes (jamais un simple
masquage de contenu envoyé quand même) dans les quatre fonctions
concernées : `announceSessionCreated`, `announceSessionModified`,
`announceSessionResult` (discord-announce.ts, discord-session-created.ts,
discord-session-modified.ts) et `sendSessionReminder` (discord-reminder.ts) —
ainsi que les quatre fonctions équivalentes côté roulette
(`announceRouletteCreated`/`Reminder`/`Result`/`Cancelled`,
discord-roulette.ts). Toutes renvoient désormais un code d'erreur partagé,
observable et distinct d'un échec réel :
`WEBHOOK_ANNOUNCE_DISABLED_FOR_PRIVACY` (src/lib/discord.ts).

Conséquences directes traitées, pas laissées de côté :
- **Notifications internes préservées** (`createNotifications`, jamais
  publiques, déjà protégées par `session-access.ts`) — EN PLUS
  restreintes aux invités `SessionInvite` encore ACTIFS
  (`filterByActiveSessionInvite`), même garantie que le chemin bot : un
  retrait coupe aussi les notifications internes du chemin webhook.
- **Cron de rappels** (`/api/cron/reminders`) — sans traitement
  spécifique, ce code d'erreur permanent aurait fait retenter le même
  rappel TOUTES les 15 minutes indéfiniment (spam de notifications
  internes dupliquées jusqu'à la soirée). Corrigé : ce code précis est
  traité comme "traité avec succès" pour `remindersSent`, distinct d'un
  échec réel (webhook down) qui reste réessayé normalement.
- **Bandeaux UI "envoi Discord échoué"** — sans traitement spécifique,
  CHAQUE création/modification/clôture d'une soirée webhook afficherait
  ce bandeau en permanence (bruit constant pour un état attendu et
  permanent, pas un échec). Nouvelle fonction `isRealDiscordFailure`
  (src/lib/discord.ts) : `true` uniquement pour un échec RÉEL, jamais
  pour ce code précis — utilisée par les 5 points d'affichage concernés
  (`session-lifecycle.ts` ×4, `roulette/actions.ts` ×1). Le renvoi manuel
  (`resendDiscordAction`) affiche un nouveau message honnête et distinct
  ("Renvoi désactivé — ce salon Discord est public...") plutôt qu'un faux
  "envoyé" ou un "échec" trompeur.

**Préférences** (`UserNotificationPreference`, catégories `SESSION`/
`ROULETTE`, #98) — contrat existant PRÉSERVÉ à l'identique, repli legacy
(`silenceReminders`) inchangé. La nouvelle distinction "invités
autorisés" (accès, `SessionInvite`) vs "invités autorisés à recevoir une
sollicitation" (notification, `UserNotificationPreference`) est
STRUCTURELLEMENT indépendante — les deux systèmes ne se lisent jamais
l'un l'autre, un refus de préférence ne touche jamais l'accès, un retrait
d'invitation ne touche jamais la préférence de la personne pour d'autres
soirées.

**Retour arrière** : revenir en arrière sur ce chantier (revert du code)
ne réexpose AUCUNE soirée déjà rendue privée — les fils Discord déjà
créés restent privés côté Discord (état qui ne dépend pas du code
applicatif), et aucune donnée n'est supprimée ni modifiée en base par un
revert. Seul le comportement des FUTURES actions reviendrait à l'ancien
modèle (public, accès non restreint).

### 7. Migration des anciennes soirées

Migration additive `20260921100000_add_session_invite` (jamais retouché
depuis) — backfill des `SessionInvite` pour les soirées déjà en base :
- `notifiedUserIds` explicitement posé par le créateur (même tableau
  vide) — SEULE source fiable retenue : reprise littéralement, jamais
  déduite d'un vote, d'une proposition, d'une mention ou d'une présence
  (chacune aurait pu inclure des gens jamais réellement invités — un pote
  ayant voté par curiosité sur une soirée alors ouverte à tous n'a jamais
  été "invité" au sens de la nouvelle règle).
- `notifiedUserIds IS NULL` (soirées créées avant l'introduction du ping
  sélectif) — aucune source fiable, accès CRÉATEUR SEUL, réinvitation
  possible depuis `/sessions/[id]/invites`, jamais automatique.
- Le créateur est explicitement exclu du backfill même s'il apparaissait
  dans son propre `notifiedUserIds`. Un id halluciné/supprimé depuis dans
  `notifiedUserIds` est silencieusement ignoré (`EXISTS` sur `User`),
  jamais une ligne orpheline.

Testé sur une base Postgres isolée en exécutant l'INSERT RÉEL de cette
migration (lu depuis le fichier, jamais réimplémenté dans le test — pour
ne jamais tester une réécriture qui diverge du SQL réellement appliqué en
production) contre des soirées "legacy" insérées directement
(`session-access.integration.test.ts`, describe "migration legacy").

### 8. Inventaire des anciennes annonces Discord publiques

Outil **en lecture seule**, `/admin?tab=confidentialite`
(`src/lib/legacy-discord-announces.ts` + `ConfidentialiteTab.tsx`) —
liste les annonces/fils Discord publics déjà envoyés AVANT ce chantier
(chemin bot uniquement, tracé en base via `NotificationDelivery`).
**Aucune suppression, édition ni modification Discord n'est exécutée par
cet outil ni par ce chantier** — ces messages resteront visibles
publiquement tant qu'une opération spécifique (hors de ce chantier) ne
les aura pas traités ; l'outil prépare seulement la décision humaine à
venir.

**Limite assumée et documentée** : cet inventaire ne couvre QUE ce que la
base sait. Les annonces émises par le chemin WEBHOOK legacy ne laissent
AUCUNE trace en base (`postToDiscord` ne persiste jamais l'id du message
envoyé) — leur revue reste entièrement MANUELLE, directement dans le
salon Discord. Fenêtre de fiabilité pour la partie bot : à exécuter juste
après le déploiement de ce chantier, avant qu'une nouvelle session ne
déclenche sa propre synchronisation (sans quoi de nouveaux fils PRIVÉS se
mêleraient aux anciens fils PUBLICS dans la même requête) — un paramètre
`sentBefore` permet de fixer explicitement cette borne si l'inventaire
est exécuté plus tard.

**Inventaire lui-même NON exécuté en Production dans cette session** —
aucun accès à la base Neon de production, l'outil est livré prêt à
l'emploi mais son résultat réel sur les données de production n'a pas été
consulté.

### 9. Ce qui reste hors périmètre (délimitation explicite du chantier)

- **Récompenses et récapitulatifs** (`monthly-recap.ts`, group achievements,
  badges, `profile-stats.ts`) — explicitement exclus par la demande
  ("Ne mélange pas avec... les récompenses et récapitulatifs"). Ces flux
  restent des agrégats GLOBAUX, non filtrés par soirée — un recap mensuel
  peut donc encore citer un nom de jeu issu d'une soirée privée. Décision
  produit à trancher séparément (filtrer, anonymiser, ou assumer que ce
  sont des agrégats de groupe, pas le contenu d'une soirée précise).
- **Refonte complète Soirée → Roulette** — explicitement exclue. Une
  roulette encore OUVERTE (avant tirage) n'a donc plus AUCUNE annonce
  Discord (webhook supprimé par confidentialité, aucun mécanisme privé
  équivalent construit pour elle — contrairement à la session résultante,
  qui en a un dès le tirage effectué). Un vrai mécanisme privé pour la
  roulette elle-même (fil privé dès la création, pas seulement au
  résultat) reste à construire dans une future PR dédiée.
- **Séparation multi-communauté** — implémentée derrière les flags acquis
  par PR A/B ; destinations par configuration et login OAuth guilds. Les
  contrôles réels et l'activation restent distincts : voir le rollout.
- **Soirées instantanées** (mode roulette instantané) — respectent déjà
  la confidentialité (même `createRouletteResultSession` que le mode
  async), aucune UI/flux supplémentaire construit spécifiquement pour
  elles au-delà de ça.
- **Bot avancé (V2)** — objectif final toujours nécessaire, cette PR ne
  couvre que cette étape (fils privés + synchronisation de membres pour
  les soirées, pas au-delà).

### 10. Problèmes déjà remontés — statut

- Absence de mentions sur une soirée classique malgré des personnes
  sélectionnées : **non reproduit/non lié à ce chantier**, aucune cause
  identifiée en lien direct avec les changements ci-dessus.
- Bandeau "envoi Discord échoué" malgré une annonce effectivement
  envoyée : **partiellement adressé** — ce chantier corrige spécifiquement
  le cas où le bandeau apparaîtrait à tort pour le nouveau code
  `WEBHOOK_ANNOUNCE_DISABLED_FOR_PRIVACY` (`isRealDiscordFailure`), mais
  ne prétend pas avoir traité toute occurrence historique de ce bug
  ailleurs dans le code.
- Rappel "dans 24h" envoyé le matin pour le soir même : **reste ouvert**,
  aucune cause en lien avec ce chantier identifiée (logique de calcul des
  timings, `computeTimingsDue`/`reminders.ts`, non touchée ici).
- Absence d'annonce de création de tournoi : **reste ouvert**, hors
  périmètre (les tournois ne sont pas concernés par ce chantier —
  "soirées" désigne exclusivement `Session` ici).

### 11. Tests

**462/462 verts** avec `TEST_DATABASE_URL` (`npm run test:postgres`) ;
321/462 verts, 141 explicitement skippés sans elle (`npx vitest run`,
pas de faux vert). `npx tsc --noEmit` / `npx eslint .` clean sur tout le
dépôt. `npx next build` compile sans erreur (route
`/sessions/[id]/invites` bien générée).

Nouveaux fichiers de test :
- `src/lib/session-access.integration.test.ts` (19 tests, Postgres réel)
  — créateur/invité/non-invité/id forgé, idempotence invite/revoke,
  révocation concurrente, filtre restrictif uniquement, migration legacy
  (SQL réel exécuté).
- `src/lib/session-announce.integration.test.ts` (49 tests, dont ~30
  réécrits pour la nouvelle architecture fil-privé-avant-annonce, +19
  nouveaux) — fil privé (type 12, invitable false), annonce postée dans
  le fil, invite-sync (ajout/retrait/course/répétition/suivi d'état),
  révocation coupant les mentions déjà enqueue-ées, et (revue ciblée) le
  describe "protection contre un ancien fil PUBLIC référencé en base"
  (5 tests : SEND annonce/thread-summary/invite-sync refusés sans écrire
  quoi que ce soit dès que la vérification Discord détecte un fil qui
  n'est plus PRIVÉ ; une EDIT sur une annonce/un fil legacy reconstruits
  littéralement en base — `resolver:unresolvable`, zéro appel réseau
  Discord tenté ; le réessai manuel d'invite-sync après un échec relit le
  statut ACTUEL de l'invitation, jamais l'intention figée au moment de
  l'échec initial).
- `src/app/sessions/actions/session-lifecycle.integration.test.ts` (3
  tests, Postgres réel) — `createSession` persiste des invitations
  exactes.
- `src/app/sessions/actions/invites.test.ts` (12 tests, mocké) — gestion
  des invités réservée au créateur, y compris avec un id de session réel,
  + (revue ciblée) `retrySessionInviteSyncAction` (5 tests) : réservé au
  créateur, no-op sans bot, refusé pour une invitation d'une autre soirée.
- `src/app/sessions/actions/proposals-votes.access.test.ts` (4 tests,
  mocké) — `proposeGame`/`toggleVote` refusés à un non-invité.
- `src/app/chat/actions.access.test.ts` (6 tests, mocké) — chat de
  soirée refusé à un non-invité, canal global inchangé.
- `discord-session-created.preferences.test.ts`/`discord-roulette.preferences.test.ts`
  — réécrits pour la nouvelle suppression permanente du webhook public.

### 12. Procédure de déploiement et de test manuel

1. `npx prisma migrate deploy` (applique la migration additive
   `SessionInvite`, backfille les soirées existantes).
2. Configurer sur le bot Discord les permissions du salon
   `DISCORD_BOT_SESSION_CHANNEL_ID` : `VIEW_CHANNEL`, `CREATE_PRIVATE_THREADS`,
   `SEND_MESSAGES_IN_THREADS` — **vérifier que ce salon est bien de type
   texte classique (`GUILD_TEXT`), jamais un salon d'annonces**.
3. Immédiatement après déploiement, AVANT toute nouvelle création de
   soirée, consulter `/admin?tab=confidentialite` (inventaire en lecture
   seule des anciennes annonces publiques) — la fenêtre de fiabilité de
   cet inventaire se referme dès la première nouvelle synchronisation.
4. Test manuel : créer une soirée avec 1-2 potes cochés → vérifier que
   `/sessions/[id]` est invisible pour un compte non coché (404) ;
   vérifier `/sessions/[id]/invites` (créateur) → retirer un invité →
   vérifier l'accès coupé immédiatement pour ce compte, puis le
   réinviter → accès rétabli.
5. Si le bot est configuré : vérifier dans Discord qu'un FIL PRIVÉ
   (jamais un message public) apparaît sous le salon configuré après le
   prochain passage de `/api/cron/notification-executor`, et que retirer
   un invité le retire bien du fil au passage suivant.

**Aucune migration distante, modification Vercel/Discord réelle,
suppression d'annonce réelle ni envoi Discord réel n'a été effectué dans
cette session.**

## V2 — parcours tournois : notifications maîtrisées, annulation/suppression, délai d'envoi

Étend le chantier annonces Discord tournois (section "Chantier annonces
Discord tournois" ci-dessus, #100) sans en dupliquer aucun mécanisme —
mêmes fondations de livraison, même client REST, même exécuteur, même
principe "transport figé par entité à la création". **Confidentialité des
soirées (section dédiée ci-dessus) explicitement NON transposée aux
tournois** : un tournoi reste consultable et inscriptible par tout le
monde selon les règles d'accès actuelles de l'application — ce chantier
n'introduit aucune notion d'accès restreint pour les tournois.

### Faits constatés en production — clarifiés avant toute correction

- **L'annonce de création arrive bien** dans `#🏆-tournois`, avec un fil
  Discord — confirmé par lecture du code existant (#100) : aucune
  absence totale d'annonce, aucun blocage d'accès au salon/fil constaté
  ni plausible dans le code (aucune vérification de permission
  restrictive n'existe côté application).
- **L'annonce ne mentionnait personne** — confirmé : `allowedMentions`
  était `{parse: []}` STRICT sur tous les messages de ce module, par
  choix explicite de la version initiale (#100). Corrigé ci-dessous
  (partie 1).
- **Délai d'environ deux minutes constaté avant une annonce** — voir
  partie 3 : aucune preuve trouvée d'un délai artificiel introduit par ce
  code pour le SEND de l'annonce elle-même (aucune dépendance,
  immédiatement réclamable dès l'enqueue). La seule explication plausible
  identifiée est la CADENCE du cron externe qui appelle
  `/api/cron/notification-executor` — configuration qui vit HORS de ce
  dépôt (jamais un cron Vercel natif ici, voir la section "Exécuteur de
  notifications" ci-dessus) et donc hors de la visibilité de cette
  session. Non promis "instantané" : instrumentation ajoutée pour mesurer
  ce délai en production, jamais une affirmation non vérifiée.
- **Absence de parcours de suppression pour un tournoi de test** —
  confirmé : `cancelTournament`/`deleteTournament` n'existaient pas avant
  ce chantier. Corrigé (partie 2).

### 1. Notifications maîtrisées à la création

**`Tournament.notifiedUserIds`** (migration additive
`20260922090000_add_tournament_v2`, `Json?`) — même contrat EXACT que
`Session.notifiedUserIds` : `null` = comportement préservé (aucune
mention) pour tout tournoi créé avant cette colonne, un tableau (même
vide) est une sélection explicite du créateur respectée littéralement.
**Jamais une liste d'accès ni des participants inscrits automatiquement**
— purement une liste de personnes à MENTIONNER dans le premier message.
`TournamentCreateForm` réutilise tel quel `NotifyRecipientsField` (déjà
utilisé par les soirées/roulettes) : "Tout sélectionner/désélectionner"
déjà fourni par ce composant partagé, plus un texte explicatif dédié
précisant que la sélection déclenche une mention Discord et n'affecte ni
l'accès ni l'inscription.

**Mentions au SEND initial uniquement** — `resolveEligibleTournamentMentions`
(tournament-announce.ts) relit la préférence `TOURNAMENT`
(`UserNotificationPreference`, voir ci-dessous) **au traitement RÉEL**,
jamais à l'enqueue : un opt-out posé après l'enqueue mais avant le
passage du cron retire quand même la mention (testé). Liste EXPLICITE
`allowed_mentions.users` (jamais `parse: ["users"]`), dédupliquée
(`Set` implicite via le filtrage Prisma `id: {in: [...]}`, testé avec un
id en double dans la sélection), jamais `@everyone`/`@here`/un rôle.
Aucune limite de taille ajoutée (comme pour `Session.notifiedUserIds`,
jamais plafonné) — sans objet à l'échelle de ce groupe de potes (très
en-dessous des 100 mentions maximum de Discord).

**TOUTES les autres livraisons restent `allowed_mentions: {parse: []}`
STRICT, sans exception** : EDIT de l'annonce (lancement, clôture,
annulation, suppression), résumé de fil, fermeture de fil — jamais un
reping sur une mise à jour, une inscription, une désinscription ou un
compteur (aucune de ces actions n'enqueue quoi que ce soit qui mentionne,
inchangé).

**Nouvelle catégorie `TOURNAMENT`** (`UserNotificationCategory`, migration
`20260922090001_backfill_tournament_notification_preferences`,
séparée de l'ajout d'enum car PostgreSQL interdit d'utiliser une valeur
tout juste ajoutée par `ADD VALUE` dans la MÊME transaction) — n'existait
tout simplement pas avant ce chantier (aucune préférence tournoi
n'existait à réutiliser/simuler). Backfill EXPLICITE, même règle que
SESSION/ROULETTE à leur introduction (`20260916140000_add_user_notification_preferences`) :
`enabled = NOT "silenceReminders"` pour chaque compte existant — un
utilisateur ayant déjà demandé le silence global ne reçoit JAMAIS une
réactivation silencieuse pour cette nouvelle catégorie. `/profil/parametres`
l'affiche automatiquement (boucle générique sur
`AVAILABLE_NOTIFICATION_CATEGORIES`, aucune modification de page
nécessaire au-delà d'ajouter la catégorie à cette liste).

**Absence de compte Discord liée à rien** — structurellement impossible
dans cette app (authentification exclusivement Discord, `User.discordId`
non-nullable) ; garanti malgré tout par construction : la création d'un
tournoi ne dépend d'AUCUN état lié aux mentions (`createTournamentAction`
persiste `notifiedUserIds` sans jamais bloquer sur la résolution des
mentions elles-mêmes, qui n'a lieu que plus tard, au traitement réel du
SEND). Accès, inscription et notification restent trois préoccupations
strictement séparées dans le code : aucune fonction ne consulte
`notifiedUserIds` pour décider qui peut voir/rejoindre un tournoi.

### 2. Annulation et suppression

**Nouveau statut `CANCELLED`** (`TournamentStatus`, migration additive) —
un tournoi DÉMARRÉ (`IN_PROGRESS`) interrompu par son créateur :
`cancelTournament` (src/lib/tournaments.ts) préserve INTÉGRALEMENT
`TournamentMatch`/`TournamentParticipant` (aucune donnée retirée), pose
`cancelledAt` pour affichage. Un tournoi `REGISTRATION` (non démarré) se
**supprime** au lieu de s'annuler (`deleteTournament`, suppression réelle
de la ligne — rien à préserver, aucun match n'existe encore à ce stade) ;
un tournoi `DONE` ne peut ni s'annuler ni se supprimer (aucun chemin
ajouté pour ces deux statuts, jamais une suppression destructive de
l'historique/des récompenses). Aucun bypass administrateur implicite :
seul `createdById === actorUserId` autorise l'appel dans les deux
fonctions, vérifié serveur, jamais délégué à l'UI (les boutons ne sont
même rendus que côté créateur, mais c'est la garde serveur qui protège
réellement).

**Confirmation explicite côté UI** — `CancelTournamentDialog`/
`DeleteTournamentDialog` (`src/components/tournois/`), même pattern
Radix Dialog que `DeleteSessionDialog` : un clic ouvre une boîte de
dialogue qui explique la conséquence exacte (annulation : matchs
conservés ; suppression : définitive), le formulaire réel n'est soumis
qu'après un second clic explicite.

**Effets Discord, testés pour les DEUX transitions** :
- **Annulation** — `enqueueTournamentAnnounceUpdate` (EDIT existante,
  réutilisée telle quelle) rend désormais un état `CANCELLED` ("annulé
  par son créateur", plus de lien d'inscription — le champ "Détails"
  reste neutre, jamais présenté comme une inscription encore possible) ;
  nouveau rôle `thread-close` (SEND occurrence fixe) ferme
  (`archive_thread`, déjà présent dans l'exécuteur depuis #97 mais jamais
  câblé jusqu'ici) le fil associé. Enqueue-és DANS LA MÊME TRANSACTION que
  `status: CANCELLED` (même garantie d'atomicité que le reste du module).
- **Suppression AVANT tout envoi** — rien à enqueue-r : un SEND encore
  `PENDING` (annonce ou fil) se refuse LUI-MÊME (`expired`, jamais un
  envoi tardif) dès qu'il constate, au traitement réel, que la ligne
  `Tournament` a disparu — jamais une invitation à rejoindre un tournoi
  qui n'existe plus.
- **Suppression APRÈS que l'annonce ait déjà été postée** — cas
  particulier traité explicitement : `isTournamentAnnounceSent` vérifie
  AVANT de supprimer si l'annonce est `SENT` ; si oui, l'EDIT "supprimé" +
  la fermeture du fil sont enqueue-ées DANS LA MÊME TRANSACTION que la
  suppression de la ligne. Ce rendu "supprimé" est **entièrement
  générique** (`resolveTournamentAnnounceRendering(null)`) — il ne dépend
  d'AUCUNE donnée du tournoi (la ligne n'existe déjà plus au moment où
  cette EDIT est réellement traitée, potentiellement bien après la
  suppression selon la cadence du cron) : seul cas de tout ce module où
  le contenu n'est pas rendu depuis l'état courant en base, par nécessité
  structurelle plutôt que par choix.
- **`resolveThreadClose`** (nouveau) ne dépend JAMAIS de l'état du
  tournoi — seulement de la référence du fil déjà persistée (`thread`
  SENT) — pour continuer à fonctionner même après une suppression (ligne
  disparue). Relit l'état RÉEL de la livraison `thread` elle-même pour
  décider (`SENT` → archive ; encore PENDING/RESERVED → attend ; jamais
  envoyé/FAILED → rien à fermer, `expired`).

**Courses vérifiées** (revue ciblée, testées explicitement) :
- **Annulation vs clôture du dernier match** — `advanceWinner`
  (src/lib/tournaments.ts) posait jusqu'ici `status: DONE` via un
  `update` INCONDITIONNEL : une annulation commitée exactement entre le
  claim du dernier match et cette écriture aurait été silencieusement
  écrasée (le tournoi redeviendrait `DONE` malgré l'annulation). Corrigé :
  `updateMany` conditionné sur `status: "IN_PROGRESS"` (même garantie que
  `cancelTournament`) — le match reste tranché dans tous les cas (déjà
  committé), seule la transition `DONE` (et ses effets : annonce, résumé
  de fil, XP, badges) est retenue si l'annulation n'a pas gagné la
  course. Testé avec une VRAIE concurrence (`Promise.all`, même style que
  "deux appels concurrents de spinRoulette" du chantier confidentialité)
  sur le dernier match : l'état final reste cohérent quel que soit l'ordre
  réel choisi par Postgres, jamais `DONE` avec un match non tranché ni
  `CANCELLED` avec un champion posé.
- **Suppression concurrente (double clic)** — verrou `SELECT ... FOR
  UPDATE` sur la ligne `Tournament` (même verrou que
  `buildBracketInTransaction`/`registerForTournamentAction`/
  `unregisterFromTournamentAction`) : un seul appel supprime réellement,
  l'autre trouve la ligne disparue et s'arrête proprement. Testé.
- **Suppression vs lancement anticipé/inscription concurrente** — même
  verrou partagé, sérialise automatiquement avec les trois autres
  fonctions qui le prennent déjà.
- **Livraison différée qui ressusciterait un tournoi supprimé** — testé
  explicitement : une livraison `announce` SEND restée `PENDING`, traitée
  APRÈS la suppression (cron en retard), se refuse (`resolver:expired`),
  zéro appel réseau.

**Jamais un envoi Discord "exactement une fois" garanti** — ce chantier
ne change rien à cette limite déjà assumée par toute la base de livraison
(#95) : les garanties sont "au plus une fois par occurrence idempotente"
et "convergence vers l'état le plus récent", jamais un "exactly-once"
distribué classique (hors de portée sans un vrai protocole
transactionnel avec Discord, qui n'existe pas).

### 3. Délai d'envoi et état fidèle

**Chemin retracé** : création (`createTournamentAction`, transaction SQL
avec `enqueueTournamentCreationDeliveries`) → enqueue (écriture seule,
`NotificationDelivery.nextAttemptAt` reste `NULL`, donc immédiatement
réclamable) → claim (`claimNextDelivery`, `runExecutorBatch` boucle sur
TOUTES les livraisons dues d'un même passage, jusqu'à
`DEFAULT_MAX_DELIVERIES_PER_RUN` = 25 ou `DEFAULT_BATCH_BUDGET_MS` = 50s)
→ envoi (`send_channel_message_verified`) → création du fil (`thread`,
dépend que `announce` soit `SENT`, résolu DANS LE MÊME passage si le
budget le permet — ce qui est le cas à l'échelle de ce groupe, largement
sous les 25 livraisons/50s).

**Aucune attente artificielle identifiée dans ce code pour le SEND de
l'annonce** : contrairement à `thread`/`thread-summary`/`thread-close`
(qui dépendent explicitement d'une autre livraison, avec un backoff de
2 minutes — `DEPENDENCY_RETRY_BACKOFF_MS`, notification-executor.ts —
s'ils sont réclamés avant que leur dépendance ne soit `SENT`), `announce`
n'a AUCUNE dépendance et est immédiatement réclamable dès son enqueue.
**Coïncidence notée, non retenue comme preuve** : ce backoff de 2 minutes
existe dans le code (pour `thread`, pas `announce`), ce qui correspond
numériquement au délai remonté — mais rien n'indique que c'est le `thread`
qui a mis 2 minutes plutôt que l'`announce` elle-même (le rapport ne
distingue pas les deux messages). Sans mesure réelle, aucune conclusion
tirée sur la cause exacte.

**Instrumentation ajoutée** (`notification-executor.ts`,
`processNextDelivery`) — un log structuré (`logger.info`, niveau déjà
utilisé dans tout le dépôt, capturé nativement par Vercel Logs) à CHAQUE
livraison qui aboutit, pour N'IMPORTE QUELLE catégorie (SESSION,
ROULETTE, TOURNAMENT) : `targetSlot`, `operation`, `attempts`, et
`delayMs` = temps RÉEL entre la création de la ligne
(`NotificationDelivery.createdAt`, posée au moment de l'enqueue, souvent
dans la même transaction que la mutation métier) et son envoi effectif —
couvre tout le chemin réel (enqueue → claim → envoi), pas seulement le
dernier appel réseau. Aucun secret, aucune donnée personnelle : seuls des
identifiants déjà loggués ailleurs dans ce module et des nombres.
Permet, une fois déployé, de confirmer ou d'infirmer précisément la
cause du délai constaté en production (cadence du cron externe vs. un
vrai problème de code) — jamais affirmé par cette PR faute de preuve.

**État d'envoi fidèle** — `getTournamentAnnounceStatus` (nouveau,
tournament-announce.ts) : lit l'état RÉEL de la dernière livraison SEND
connue pour `announce` ET `thread` séparément (`pending`/`sent`/`failed`,
jamais `failed` pour un simple envoi différé qui n'a pas encore eu lieu
— seul un `NotificationDelivery.status === "FAILED"` explicite produit
`"failed"`). Affiché sur `/tournois/[id]` (créateur uniquement, tournoi
`announceViaBot`) : deux lignes distinctes ("Annonce" / "Fil"), jamais
confondues — un message envoyé pendant que le fil est encore en attente
s'affiche correctement comme tel (testé).

**Rien de modifié côté cron/Vercel** — aucun fichier de configuration
cron, aucune variable d'environnement Vercel, aucune modification de
`/api/cron/notification-executor` au-delà de ce qui existait déjà
(dispatch déjà branché sur `TOURNAMENT` depuis #100, non retouché).

### Migrations (additives, testées sur Postgres isolé local)

- `20260922090000_add_tournament_v2` — `TournamentStatus.CANCELLED`,
  `Tournament.notifiedUserIds` (`Json?`), `Tournament.cancelledAt`
  (`DateTime?`), `UserNotificationCategory.TOURNAMENT`.
- `20260922090001_backfill_tournament_notification_preferences` —
  backfill explicite `UserNotificationPreference` pour `TOURNAMENT`
  (`enabled = NOT "silenceReminders"`), séparée de la précédente pour la
  raison PostgreSQL expliquée plus haut.

Aucune migration appliquée à Neon/Production dans cette session — testées
uniquement contre la base Postgres isolée locale utilisée par
`npm run test:postgres`.

### Tests

`src/lib/tournament-announce.integration.test.ts` passe de 25 à 47 tests
(22 nouveaux, PostgreSQL isolé + Discord HTTP entièrement simulé, même
suite que #100) : mentions (sélection exacte, dédupliquées, préférence
respectée y compris opt-out posé après l'enqueue, silence global jamais
réactivé, jamais de reping sur EDIT/réessai), annulation (statut +
horodatage, matchs/participants conservés, non-créateur refusé,
statuts REGISTRATION/DONE refusés, EDIT "annulé" + fermeture de fil,
garde `declareWinner` déjà existante étendue à CANCELLED, VRAIE course
`Promise.all` sur le dernier match), suppression (avant tout envoi —
zéro appel réseau —, avant que l'annonce n'ait été traitée — SEND en
attente se refuse lui-même —, après un envoi déjà réussi — EDIT
générique + fermeture de fil fonctionnant sans la ligne Tournament —,
non-créateur refusé, statuts IN_PROGRESS refusé, course de suppression
concurrente), état d'envoi (`pending`/`sent`/`sent+pending`/`failed`,
jamais un faux `failed`).

`src/app/tournois/actions.cancel-delete.test.ts` (7 tests, mocké) —
autorisation et transmission fidèle des deux nouvelles actions serveur
(session requise, id validé, acteur authentifié jamais substitué).

`src/lib/notification-preferences.test.ts` — `TOURNAMENT` déplacée de
"non disponible" à "disponible" (le chemin d'envoi l'applique désormais
réellement), + 2 tests dédiés (indépendance vis-à-vis de
`silenceReminders` comme ROULETTE, repli identique en l'absence de
ligne).

`npm run test:postgres` : **493/493 verts** (462 hérités inchangés + 31
nouveaux). Sans `TEST_DATABASE_URL` : suite skippée proprement (330
verts, 163 explicitement skippés, pas de faux vert). `npx tsc --noEmit`/
`npx eslint .` : clean sur tout le dépôt. `npx next build` : compile sans
erreur, toutes les routes existantes inchangées (`/tournois`,
`/tournois/[id]`, `/tournois/creer` toujours générées).

Vérification manuelle en direct (navigateur) **non exécutée** dans cette
session — l'app exige une authentification Discord OAuth réelle,
indisponible dans cet environnement sans compte Discord ; la procédure
de vérification manuelle ci-dessous est préparée mais pas exécutée,
même limite assumée que les chantiers précédents pour tout parcours
nécessitant une session Discord authentifiée.

### Procédure de validation manuelle (préparée, non exécutée)

1. `npx prisma migrate deploy` (applique les deux migrations additives).
2. Créer un tournoi en cochant 1-2 potes dans "Qui prévenir ?" → vérifier
   que la création réussit même sans bot configuré, et que le tournoi
   reste accessible/inscriptible par un compte NON sélectionné.
3. Si le bot est configuré (`DISCORD_BOT_TOURNAMENT_ANNOUNCE_ENABLED=true`) :
   vérifier que l'annonce mentionne bien les potes sélectionnés (et
   seulement eux), avec leurs pseudos Discord cliquables.
4. Sur `/tournois/[id]` (créateur), vérifier l'état "Annonce"/"Fil"
   (en attente → envoyée), puis lancer le tournoi et vérifier l'EDIT
   ("en cours", sans nouvelle mention).
5. Annuler un tournoi démarré → vérifier les matchs déjà joués restent
   visibles, l'annonce Discord affiche "annulé", le fil est archivé.
6. Créer un second tournoi (non démarré), le supprimer → vérifier sa
   disparition de `/tournois`, et si son annonce avait déjà été postée,
   qu'elle affiche bien "supprimé" sans lien cassé.

### Ce qui reste hors périmètre (V2, suite)

Refonte Soirée → Roulette, multi-serveur Discord, et les autres
fonctions du "bot avancé" (boutons/interactions, commandes slash)
restent les étapes suivantes de la V2, non abordées par ce chantier —
conformément à la demande.

**Aucun envoi Discord réel, aucune modification de données de
production, aucune migration distante, aucun merge ni changement de
configuration externe n'a été effectué dans cette session.**

## Correctifs V2 remontés en test réel — accès au fil Discord, suppression de tournoi, roue instantanée, historique à 7 jours

Cinq problèmes remontés lors de tests réels (pas d'audit théorique) sur
la base de `main` (#104 fusionnée, confirmé par `git log` avant de
démarrer) : le créateur d'une soirée classique n'accédait pas au fil
Discord malgré un fil créé ; la suppression d'un tournoi laissait la
page bloquée ; les libellés de la roue instantanée étaient illisibles ;
l'historique gardait des soirées/tournois vieux de plusieurs semaines ;
et les notifications de tournois, présentées jusqu'ici comme non
fonctionnelles, sont maintenant confirmées opérationnelles par le
testeur. Chaque section ci-dessous distingue la cause DÉMONTRÉE (lecture
de code + test reproduisant le bug) de ce qui reste une hypothèse.

### 1. Accès au fil Discord — créateur ET invités jamais ajoutés à la création

**Cause 1 (créateur)** — `resolveInviteSync` (session-announce.ts), seul
code ajoutant un membre au fil privé, ne lit QUE les lignes
`SessionInvite`. Or `inviteToSession` exclut structurellement le
créateur de sa propre sélection (il a accès via `createdById`, jamais
via une invitation) : le créateur n'a donc JAMAIS de `SessionInvite`, et
n'était donc JAMAIS ajouté au fil. Il pouvait néanmoins le VOIR listé
("Plus de fils actifs") si son compte Discord détenait par ailleurs
`MANAGE_THREADS` sur le serveur — simple effet de bord des permissions
de modération, jamais une garantie applicative, ce qui explique le
symptôme "je vois le fil mais je n'y accède pas normalement".

**Cause 2 (invités), trouvée en creusant un second signalement** (fils
sans le moindre membre autre que le bot malgré des invités
sélectionnés) : `createSession` (classique) ET `createRouletteResultSession`
(roulette) posent bien une ligne `SessionInvite` par invité choisi au
formulaire de création, mais n'enqueue-aient JAMAIS la synchronisation
Discord correspondante (`enqueueSessionInviteSync`) — seul le bouton
"inviter" MANUEL de la page `/sessions/[id]/invites` le faisait. Un
invité choisi À LA CRÉATION n'était donc jamais ajouté au fil tant que
le créateur ne le réinvitait pas explicitement ensuite. Ce bug touche
LES DEUX parcours de création également — la roulette n'était pas
épargnée, contrairement à l'hypothèse initiale (un créateur qui participe
à sa propre roulette a bien un `SessionInvite`, mais son ajout au fil
souffrait du même défaut d'enqueue que n'importe quel autre invité).

**Vérifié, jamais supposé** : `resolveInviteSync` ne consulte JAMAIS
`UserNotificationPreference` ni `silenceReminders` — seul
`resolveEligibleMentions` (mentions/notifications internes) les
consulte, un chemin de code entièrement séparé. Accès au fil et
préférence de ping sont donc déjà indépendants ; un test dédié le
démontre explicitement plutôt que de le supposer.

**Corrigé** : nouveau rôle `creator-member` (SEND, ajoute le créateur dès
que `thread` est `SENT`, jamais retiré ensuite — l'accès du créateur
n'est jamais révocable) ; `createSession`/`createRouletteResultSession`
enqueue-ent désormais l'invite-sync de CHAQUE invité créé, dans la même
transaction que la mutation métier (même garantie d'atomicité que le
reste du module). État honnête exposé au créateur sur
`/sessions/[id]/invites` (préparation / synchronisation en cours / prêt /
échec, avec réessai manuel pour les soirées créées avant ce correctif).
Aucun envoi Discord direct hors file transactionnelle n'a été ajouté.

**Délai de ~2 minutes constaté** — même conclusion que pour les
tournois (#104) : aucune attente artificielle identifiée dans ce code
pour `thread`/`announce`/`creator-member`/`invite:*` (aucune dépendance
autre que `thread` → `announce`, résolue dans le même passage cron si le
budget le permet). La cadence réelle du cron externe (Vercel, hors de ce
dépôt) reste la seule cause plausible non exclue — jamais affirmée
faute de données de production.

**Tests** : `session-announce.integration.test.ts` (50 tests, dont un
nouveau couvrant explicitement l'invité silencieux) et
`session-lifecycle.integration.test.ts` (2 nouveaux, Postgres isolé)
prouvant l'enqueue d'une livraison `invite:<id>` par invité choisi à la
création, jamais un doublon, jamais rien pour une création sans invité.

### 2. Suppression de tournoi — page bloquée après suppression

**Cause démontrée** : `deleteTournamentAction` redirige déjà
correctement pour un SEUL clic (`redirect()` jamais entouré d'un
try/catch). Le vrai coupable était `DeleteTournamentDialog`, sans
AUCUNE protection contre un double clic sur "Oui, supprimer" (bouton
jamais désactivé) : un second clic pendant que le premier est en vol
relance l'action, qui trouve alors le tournoi déjà supprimé
(`deleteTournament` retourne `{ ok: false }`, la ligne "course perdue"
de sa transaction) et se termine SANS `redirect()` — deux résolutions
concurrentes d'une même transition React (l'une avec navigation, l'autre
sans) pouvant laisser le client dans un état incohérent, nécessitant un
F5.

**Corrigé** : `useActionState` remplace le `<form action={fn}>` brut —
bouton désactivé tant que `pending` (double soumission structurellement
impossible), et une erreur RÉELLE (tournoi déjà lancé entre l'ouverture
du dialogue et la confirmation, etc.) s'affiche maintenant au lieu de ne
rien faire silencieusement.

**Limite de cohérence base/Discord démontrée, pas prétendue résolue** :
un test d'intégration reproduit RÉELLEMENT (pas seulement dans l'ordre
séquentiel avant/après, déjà couvert par #104) la suppression PENDANT
que le SEND de l'annonce est en vol côté réseau, en exécutant
`deleteTournament` DEPUIS L'INTÉRIEUR du mock réseau du SEND. Résultat
observé : l'annonce part quand même (déjà engagée avant la suppression),
le fil dépendant s'auto-annule proprement (`expired`, déjà garanti),
mais RIEN n'enqueue jamais l'édition "supprimé" de l'annonce déjà
publiée — elle reste visible telle quelle pour un tournoi qui n'existe
plus en base, jusqu'à intervention manuelle. Corriger cette fenêtre
précise demanderait une revérification de l'existence du tournoi au
moment du commit du SEND, hors du périmètre de ce correctif (qui porte
sur la navigation après suppression) — documenté honnêtement plutôt que
"résolu" sans preuve.

**Tests** : `actions.cancel-delete.test.ts` (2 nouveaux : message
d'erreur lisible, repli générique sans raison) et
`tournament-announce.integration.test.ts` (1 nouveau, l'entrelacement
ci-dessus).

### 3. Roue instantanée — libellés mal orientés et chevauchants

**Trois causes démontrées** (vérification VISUELLE via Playwright,
Chromium pré-installé, sur une reproduction fidèle de la même logique
CSS/JS — jamais dans l'app réelle elle-même, l'authentification Discord
OAuth étant hors de portée de cet environnement) :

1. Décalage de rotation de 90° — chaque libellé était positionné avec un
   `left` (pointant par défaut vers l'est/3h) puis pivoté de l'angle du
   secteur en convention `conic-gradient` (0° = nord/midi), sans jamais
   corriger cet écart de repère.
2. Trouvé à la vérification visuelle, invisible en relisant seulement le
   code : même corrigé, la moitié gauche du disque restait tête en bas
   (une rotation de plus de 90° retourne le texte à l'écran) — +180°
   supplémentaire pour cette moitié, avec ancrage inversé.
3. Positionnement en pixels bruts (`sizePx / 2 - 30`) sur un conteneur
   qui ne s'adaptait jamais à un rendu redimensionné en CSS pur —
   remplacé par un conteneur responsive (`aspect-square` + `max-width`)
   et des libellés en pourcentage, avec police et rayon de départ
   adaptés au nombre de secteurs pour éviter le chevauchement près du
   centre quand le groupe est nombreux.

Une légende accessible (texte complet, jamais seulement une info-bulle
au survol — inutilisable au tactile) liste désormais chaque jeu avec sa
pastille de couleur. La sélection aléatoire (`computeWinningRotation`)
n'est pas touchée — la correction est purement visuelle, vérifiée à
2/4/8/16 secteurs, titres longs, et un viewport mobile étroit.

**Tests** : `RouletteWheelDisplay.test.ts` (12 tests, géométrie pure).

### 4. Historique — soirées/tournois terminés depuis 7 jours

Nouvelle fenêtre partagée (`history-visibility.ts`, 7 jours) masquant
UNIQUEMENT la liste affichée (`/sessions`, `/roulette` onglet
historique, `/tournois` onglets Terminés/Annulés) — jamais la base
(statistiques/XP/récompenses/résultats intacts), jamais l'accès direct
par id. Point de départ dérivé des champs RÉELS du modèle : `date` pour
les soirées (repli prudent faute de colonne dédiée — toujours postérieur
ou égal à la fin/annulation réelle, donc jamais masqué trop tôt),
`Tournament.cancelledAt` pour les annulations, le plus récent
`TournamentMatch.completedAt` (celui de la finale) pour les tournois
terminés. Repli prudent (jamais masqué) si aucun horodatage fiable
n'est trouvé — jamais une date inventée, jamais `updatedAt`.

**Audit fermeture/archivage Discord** (distinct de ce retrait
d'historique) : les tournois ferment déjà leur fil sur annulation et
suppression (jamais sur une fin normale — délibéré, discussion
post-tournoi). Les soirées n'ont AUCUN mécanisme de fermeture de fil, y
compris à la suppression — déjà documenté comme un choix volontaire
("suppression = ménage silencieux, jamais un événement Discord") : fils
privés, votes de superlatifs et échanges post-soirée justifient de ne
jamais les fermer automatiquement. Aucun oubli démontré nécessitant une
correction.

**Tests** : `history-visibility.test.ts`, plus les cas ajoutés à
`sessions.test.ts`/`tournaments.test.ts` (frontière exacte à 7 jours,
soirée/tournoi du 21 septembre encore visible le 22, repli prudent sans
horodatage fiable).

### 5. Notifications de tournois — correction des affirmations obsolètes

Les derniers tests réels confirment : sélection des destinataires
fonctionnelle, annonce reçue, mentions reçues, délai observé d'environ
une minute. Les sections ci-dessus (#104) documentant "l'état d'envoi
fidèle"/les mentions/l'absence d'inscription automatique et l'absence de
reping restent EXACTES et ne sont pas modifiées — seule l'AFFIRMATION
selon laquelle les tournois n'enverraient aucune notification (obsolète,
vraie uniquement avant #100/#104) ne doit plus être comprise comme
l'état actuel : la génération de notifications de tournois EST
fonctionnelle, confirmée en conditions réelles.

Concernant le délai d'~1 minute : en relisant `notification-executor.ts`
et `tournament-announce.ts`, aucune attente artificielle n'existe dans
ce code pour le SEND d'une annonce (`announce` n'a aucune dépendance,
immédiatement réclamable dès l'enqueue ; `thread` dépend de `announce`
mais est résolu dans le même passage cron si le budget le permet —
largement suffisant à l'échelle de ce groupe). L'instrumentation
`delayMs` déjà ajoutée par #104 (log structuré à chaque livraison
aboutie, capturé par Vercel Logs) reste le seul moyen de confirmer la
cause exacte — non consultée ici, cette session n'ayant accès à aucune
donnée de production. La cadence réelle du cron externe (configurée
côté Vercel, hors de ce dépôt) est l'hypothèse la plus plausible non
exclue, jamais affirmée comme prouvée. **Aucun cron ni configuration
Vercel n'a été modifié dans cette session.**

### Vérifications

`npm run test:postgres` : tous les tests passent (527, aucune
régression). `npx tsc --noEmit`/`npx eslint .` : clean sur tout le
dépôt. Vérification VISUELLE de la roue via Playwright (voir section 3)
— seule vérification "interface" possible dans cet environnement,
l'app réelle exigeant une authentification Discord OAuth hors de portée
ici ; limite assumée et documentée plutôt que contournée.

### Procédure de validation manuelle (préparée, non exécutée)

1. Créer une soirée classique avec 1-2 invités → vérifier que le
   créateur ET les invités accèdent au fil privé une fois synchronisés
   (voir l'état affiché sur `/sessions/[id]/invites`).
2. Créer une soirée via la roulette avec plusieurs participants → même
   vérification.
3. Retirer un invité qui a désactivé ses notifications SESSION →
   vérifier qu'il perd l'accès malgré ses préférences (accès ≠ ping).
4. Créer un tournoi non démarré, le supprimer en double-cliquant vite
   sur "Oui, supprimer" → vérifier une redirection propre vers
   `/tournois`, jamais de page bloquée.
5. Lancer une roulette instantanée à 2, 8 puis 16 jeux → vérifier que
   tous les libellés sont lisibles, dans leur secteur, jamais tête en
   bas ni chevauchants.
6. Vérifier qu'une soirée/un tournoi terminé il y a plus d'une semaine
   n'apparaît plus dans l'historique, mais reste accessible par son lien
   direct et compte toujours dans les statistiques/XP.

**Aucun envoi Discord réel, aucune modification de données de
production, aucune migration distante, aucune suppression d'ancienne
annonce, aucun merge ni changement de configuration externe n'a été
effectué dans cette session.**

## V2 — nettoyage réel du stockage et cohérence du cycle de vie Discord (soirées et tournois)

### Statut vérifié des PR #95 à #106 (avant tout travail de ce chantier)

Vérifié via `pull_request_read` (méthode `get`) sur CHAQUE PR individuellement
— jamais via `list_pull_requests`, dont le champ `merged` s'est révélé
peu fiable (retourne `false` pour toutes les entrées y compris des PR
confirmées fusionnées par ailleurs) :

| PR | Sujet | Fusionnée | Date de fusion |
|----|-------|-----------|-----------------|
| #95 | Fondations de livraison (`NotificationEvent`/`NotificationDelivery`) | ✅ | 2026-09-16 |
| #96 | Client Discord REST (bot) | ✅ | 2026-09-16 |
| #97 | Exécuteur de notifications | ✅ | 2026-09-17 |
| #98 | Préférences de notification par catégorie | ✅ | 2026-09-17 |
| #99 | Annonces Discord bot — soirées | ✅ | 2026-09-18 |
| #100 | Revue ciblée — contrôle de destination | ✅ | 2026-09-19 |
| #101 | Roulette — `announceViaBot` | ✅ | 2026-09-19 |
| #102 | Confidentialité des soirées — fils privés | ✅ | 2026-09-21 |
| #103 | Chantier confidentialité (suite) — vérification fil privé | ✅ | 2026-09-21 |
| #104 | Annonces Discord tournois + V2 notifications/annulation/suppression | ✅ | 2026-09-22 |
| #105 | Correctifs V2 remontés en test réel (accès fil, suppression tournoi, roue, historique 7j) | ✅ | 2026-09-22 |
| #106 | Soirée → Roulette (tirage inline) | ✅ | 2026-09-23 |

**Toutes les PR #95 à #106 sont fusionnées dans `main`.** `main` était à jour
au commit `1eedbd0` au démarrage de ce chantier — aucune n'est restée au
stade "déployée en Preview seulement".

### Causes démontrées des problèmes Discord remontés

1. **Suppression manuelle d'une soirée n'a jamais touché Discord** —
   `deleteSessionAction` (session-lifecycle.ts) faisait un simple
   `prisma.session.delete()`, explicitement documenté "ménage silencieux,
   aucune notification Discord". Pour une soirée `announceViaBot`, son fil
   privé (et tous ses messages) restait donc indéfiniment accessible à ses
   membres après la suppression de la soirée elle-même.
2. **Suppression d'un tournoi éditait l'annonce et ARCHIVAIT le fil, ne
   supprimait jamais rien** — `deleteTournament` (tournaments.ts)
   appelait `enqueueTournamentAnnounceUpdate` (EDIT "supprimé") +
   `enqueueTournamentThreadClose` (`archive_thread`, réversible). Le
   message annonçant l'inscription restait affiché (édité, jamais retiré)
   et le fil restait consultable (archivé, jamais supprimé) — aucune
   réduction réelle de données conservées.
3. **Aucune adhésion automatique au fil des tournois** — le fil de
   tournoi (`create_thread`, PUBLIC) n'ajoutait jamais personne
   automatiquement ; seuls l'annonce et les pings arrivaient, l'ouverture
   du fil restait un geste manuel côté Discord (contrairement aux
   soirées, qui ajoutent déjà créateur + invités via `creator-member`/
   `invite:<id>` depuis #105).
4. **Aucune politique de rétention réelle** — `isSessionVisibleInHistory`/
   `isTournamentVisibleInHistory` (#105) ne font que MASQUER la liste
   `/sessions`/`/tournois` après 7 jours ; aucune donnée n'était jamais
   réellement supprimée (ni le chat, ni les notifications de saisons
   closes, ni les livraisons techniques terminales).

### Ce qui n'a PAS changé (comportements confirmés fonctionnels, non retouchés)

Conformément à la demande explicite ("les autres parcours récemment
testés fonctionnent, ne repars pas dans une refonte générale") : aucun
changement aux flux d'annonce/rappel/résultat des soirées et tournois
(#99–#105), à la confidentialité des soirées (#102/#103), à
`cancelTournament` (reste EDIT + `archive_thread`, jamais transformée en
suppression définitive), ni à `drawSessionGame`/roulette (#106).

### 1. Suppression manuelle → suppression Discord définitive

**Nouveaux kinds Discord** (`src/lib/discord-rest.ts`) :
- `deleteThreadPermanently` — `DELETE /channels/{channel.id}` sur un fil
  (soirée ou tournoi). Distinct d'`archiveThread` (réversible, toujours
  utilisée par `cancelTournament`).
- `deleteChannelMessage` — `DELETE /channels/{channel.id}/messages/{message.id}`,
  utilisée pour retirer l'annonce d'un tournoi supprimé dans son salon
  parent (jamais une édition).
- `addThreadMember` (déjà existante, réutilisée SANS revérification de
  type — un fil de tournoi a toujours été PUBLIC, jamais migré depuis un
  autre type, contrairement aux soirées).

**Nouveaux rôles de `targetSlot`** (mêmes fondations de livraison #95,
même exécuteur #97, occurrence ALÉATOIRE — appelables plusieurs fois,
retry manuel inclus) :
- `thread-delete` (soirées ET tournois) — supprime définitivement le fil.
- `announce-delete` (tournois uniquement) — supprime le message d'annonce
  dans le salon parent.

Les deux résolveurs (`resolveSessionThreadDelete`/`resolveThreadDelete`/
`resolveAnnounceDelete`) sont dispatchés **avant** le chargement de
l'entité métier (comme `thread-close` déjà existant) : ils ne dépendent
JAMAIS de l'existence de la `Session`/du `Tournament`, par construction
(l'entité a déjà disparu au moment où ces livraisons sont réellement
traitées).

**Enqueue atomique** — `deleteSessionAction`/`deleteTournament` enqueue
l'intention de nettoyage **dans la même transaction SQL** que la
suppression de la ligne métier. Aucune transaction atomique DB+Discord
n'est jamais promise : seule l'écriture de l'intention est garantie
atomique avec la suppression, l'appel Discord réel a nécessairement lieu
après, via l'exécuteur.

**Races traitées et testées** (`session-announce.integration.test.ts`/
`tournament-announce.integration.test.ts`, describe "V2 — suppression
manuelle définitive") :
- suppression avant tout envoi Discord → le SEND encore PENDING se
  refuse lui-même (`expired`) ;
- suppression pendant l'appel réseau du SEND (déjà en vol) → le SEND
  aboutit quand même, le nettoyage programmé attend (`dependency_not_ready`)
  puis supprime RÉELLEMENT la ressource créée après coup — compensation
  durable, jamais un fil/une annonce orpheline permanente ;
- ressource déjà absente (404) → traité comme un résultat **idempotent**
  (objectif déjà atteint), jamais un échec ;
- permission insuffisante (403) ou erreur réseau → **jamais** un succès,
  reste `FAILED` terminal ;
- réessai manuel (occurrence aléatoire, même mécanisme que le bouton
  "Réessayer" des invitations) : une nouvelle intention converge, l'ancien
  échec reste visible comme trace (jamais réutilisé pour rejouer
  l'événement).

**État honnête + réessai manuel, même hors des listes normales** — un
nouvel onglet **`/admin?tab=nettoyage`** ("Nettoyage") liste les
suppressions Discord en échec terminal (`listFailedDiscordCleanupDeliveries`,
`src/lib/discord-cleanup-status.ts`) avec un bouton "Réessayer"
(`retryDiscordCleanupAction`), réservé aux admins (l'entité elle-même
n'existe plus, aucune garde "créateur" n'est possible).

**Confirmation UI mise à jour** — `DeleteSessionDialog`/`DeleteTournamentDialog`
expliquent désormais explicitement que le fil (et, pour un tournoi,
l'annonce) sera **définitivement supprimé, avec ses messages**. Les
soirées privées restent traitées à l'identique (confidentialité
inchangée, aucune donnée exposée par cette page).

### 2. Adhésion automatique aux fils de tournois

**Nouveau rôle `member:<userId>`** (`src/lib/tournament-announce.ts`,
`enqueueTournamentThreadMember`) — ajoute UNE personne au fil du tournoi
(action `add_thread_member`, PUT idempotent côté Discord) :
- à la création (`createTournamentAction`) : le créateur + chaque
  destinataire sélectionné (`notifiedUserIds`), dans la même transaction ;
- à l'inscription (`registerForTournamentAction`) : le joueur qui vient
  de s'inscrire, dans la même transaction que son inscription.

**Jamais l'inverse** : `enqueueTournamentThreadMember` n'écrit AUCUNE
ligne `TournamentParticipant` — rejoindre le fil n'inscrit jamais au
tournoi. Le tournoi reste ouvert selon ses règles actuelles (jamais
transformé en fil privé réservé aux destinataires — confidentialité des
soirées non transposée ici). Adhésion **monotone** : jamais de retrait
(se désinscrire du tournoi ne retire jamais du fil), aucun rôle de
retrait n'existe pour les tournois.

**Séparation stricte** : inscription au tournoi (`TournamentParticipant`) /
adhésion au fil (`member:<userId>`) / préférence de notification
(`UserNotificationPreference`, catégorie `TOURNAMENT`, inchangée) —
trois mécanismes indépendants. Respecte les opt-out existants pour les
**pings** (l'annonce continue de filtrer par préférence, inchangé) ;
l'adhésion au fil elle-même n'envoie jamais de message ni de mention
supplémentaire.

**Déduplication** — même personne notifiée puis inscrite : deux
livraisons sur le MÊME `targetSlot` (`member:<userId>`), convergence
"la plus récente gagne" (#95) + idempotence native du `PUT` Discord.
Jamais un double ajout traité comme deux opérations distinctes.

**Aucune garantie d'affichage dans la barre latérale** — cette
fonctionnalité confirme l'adhésion côté API Discord (`PUT` réussi),
jamais une garantie sur le comportement du client Discord lui-même
(certains clients n'affichent un fil dans la barre latérale qu'après une
première activité/notification — comportement du client, hors contrôle
de ce code).

**Permissions Discord vérifiées** (documentation officielle, `raw.githubusercontent.com/discord/discord-api-docs`
— `discord.com` bloqué en sortie réseau dans cette session) :
- `PUT /channels/{channel.id}/thread-members/{user.id}` requiert que le
  bot puisse envoyer des messages dans les fils (`SEND_MESSAGES_IN_THREADS`).
- `DELETE /channels/{channel.id}` sur un FIL requiert `MANAGE_THREADS`
  sur le salon parent — **contrairement** à l'archivage simple, qui
  bénéficie d'une exception pour le créateur du fil sans cette
  permission. Le bot doit donc détenir `MANAGE_THREADS` explicitement sur
  #🎮-soirées/#🏆-tournois pour que la suppression définitive fonctionne
  réellement (jamais `Administrateur`).
- `DELETE /channels/{channel.id}/messages/{message.id}` sur le PROPRE
  message du bot ne nécessite aucune permission supplémentaire
  (`MANAGE_MESSAGES` n'est requise que pour supprimer le message d'un
  tiers, jamais le cas ici).

**Resynchronisation créateur** — `resyncTournamentThreadMembers`
(mirroir exact de `resyncSessionThreadMembers`, #105) : réservée au
créateur, réajoute créateur + destinataires persistés + inscrits ACTUELS,
sans jamais recréer le fil ni renvoyer l'annonce/reping. Bouton "Resynchroniser
le fil" sur `/tournois/[id]` (visible dès que le fil existe). **Non
exécutée en production par cette PR** — livrée comme outil pour les
tournois créés avant ce correctif.

### 3. Audit du stockage (lecture seule)

`src/lib/storage-audit.ts` (`generateStorageAuditReport`) — inventaire
en lecture seule (agrégats SQL `count()`, jamais un chargement complet
des tables), affiché dans **`/admin?tab=nettoyage`** :

| Catégorie | Constat |
|---|---|
| Notifications utilisateur (`Notification`) | Aucune FK vers Session/Tournament (`relatedSessionId` libre) — jamais cassées par une future purge de ces lignes. |
| Événements/livraisons de notification (`NotificationEvent`/`NotificationDelivery`) | Volumétrie proportionnelle à l'activité Discord bot ; rôles à occurrence FIXE (thread/announce/thread-summary/thread-close) protégés contre toute purge automatique — voir §5. |
| Messages de chat (`ChatMessage`/`ChatReaction`) | Rattachés exclusivement à une `Session` (`sessionId`), cascade sur suppression du message parent. **Aucun message de chat indépendant d'une soirée** dans ce schéma — un seul chemin d'écriture connu. |
| Soirées/tournois, propositions/votes, inscriptions | `Proposal`/`Vote` cascadent avec `Session` ; `TournamentParticipant`/`TournamentMatch` cascadent avec `Tournament`. |
| Pièces jointes | **Aucune** pour soirées/tournois/chat — `ChatMessage.content` est un texte simple. Vercel Blob (`banner-blob.ts`) sert UNIQUEMENT la bannière de profil, scope utilisateur, hors de cette politique. |
| XP/streaks/récompenses/classements/saisons (`XpEvent`, `LevelUpEvent`, `SeasonSnapshot`, `UserBadge`) | **Aucune FK** vers `Session`/`Tournament` (`sourceId` libre) — déjà structurellement à l'abri d'une purge de ces lignes. |
| `SessionResult` (podium, lu par `/profil/historique` et `revanche.ts`) | **CASCADE avec `Session`** (`onDelete: Cascade`) — le seul modèle "résultat utile" identifié comme VULNÉRABLE si `Session` venait à être supprimée. Voir §6 pour la décision prise. |

Distinction explicite demandée : **messages GameNight** (`ChatMessage`,
en base, stockage/rétention propres à cette app) vs **messages privés
Discord** (jamais stockés par cette app, hors de son contrôle) vs
**messages de fil Discord** (annonces/résumés — référencés par id
uniquement dans `NotificationDelivery`, le CONTENU n'est jamais persisté
côté GameNight, seul Discord le détient réellement) — trois stockages et
politiques de rétention **différents**, jamais confondus dans ce
chantier.

**Sans accès aux données de production**, les chiffres exacts (volumes,
gains) ne sont jamais affirmés — seule la structure (modèles, cascades,
critères d'éligibilité) est garantie exacte. `generateStorageAuditReport()`
donne des chiffres réels une fois exécuté contre la vraie base.

### 4. Politique de rétention (`src/lib/retention.ts`, centralisée)

| Type de donnée | Règle | Purge |
|---|---|---|
| Soirées/tournois **actifs** | Jamais purgés, quel que soit l'âge (statut ≠ terminal). | — |
| Soirées/tournois **terminés/annulés** | Fenêtre de 7 jours depuis la fin/l'annulation RÉELLE (`Session.date` pour une soirée, `cancelledAt`/dernier `completedAt` de match pour un tournoi — même référence EXACTE que le masquage historique existant #105, jamais une date de création). | La **ligne** `Session`/`Tournament` n'est **PAS** supprimée dans cette PR (voir §6) — seuls son fil/son annonce Discord (si `announceViaBot`) sont programmés pour suppression définitive une fois la fenêtre dépassée. |
| Anciennes données sans date fiable | Statut terminal mais `cancelledAt`/`completedAt` absent (ne devrait jamais arriver — replis défensifs déjà en place, #105). | **Jamais purgées** — signalées `noReliableDate` dans l'audit, aucune date inventée. |
| Messages de chat rattachés à une soirée éligible | Suivent la rétention de leur soirée (7 jours après la fin réelle). | **Suppression réelle** (`ChatMessage`+`ChatReaction` cascade), pas un masquage. |
| Notifications utilisateur | Purgées si **lues** ET créées avant le début de la saison **active** (`Season.startDate`, cycle réel `src/lib/seasons.ts`, jamais un calendrier inventé — toute notification antérieure à la saison active a nécessairement été créée pendant une saison désormais close). | Suppression réelle. **Jamais** les notifications non lues (encore "en cours" pour l'utilisateur) ni celles de la saison active. |
| Fil/annonce Discord d'un événement éligible **toujours existant** | Même fenêtre de 7 jours que ci-dessus. | Programmé (enqueue, jamais un balayage du serveur par nom/approximation) via les MÊMES rôles `thread-delete`/`announce-delete` que la suppression manuelle — jamais si déjà tenté (`"never_enqueued"` uniquement, un échec `"failed"` attend un réessai manuel). |
| Livraisons techniques (`NotificationDelivery`) | Statut TERMINAL (`SENT`/`SKIPPED`) ET occurrence NON FIXE (retry-safe) ET plus vieilles que 30 jours. | Suppression réelle. **Jamais** `PENDING`/`RESERVED` (en attente/en cours), **jamais** `FAILED` (visibilité admin/réessai), **jamais** une occurrence FIXE (`thread`/`announce`/`thread-summary`/`thread-close`/premier SEND — la ligne EST la garantie contre un rejeu qui recréerait un fil/une annonce). |

Chaque critère est une fonction **pure**, testée indépendamment
(`src/lib/retention.test.ts`), et **partagée à l'identique** entre le
mode dry-run et le mode effectif (`src/lib/retention.ts`, chaque
fonction `purge*`/`schedule*` prend un paramètre `dryRun` unique — jamais
deux chemins de décision).

### 5. Préservation des résultats utiles (XP, récompenses, classements)

> **Mise à jour** : le paragraphe ci-dessous décrivait l'état initial de
> cette PR, où `Session`/`Tournament` n'étaient volontairement **jamais**
> supprimées (gap explicite). Ce gap est désormais **comblé** — voir
> « V2 (suite) — purge réelle des lignes `Session`/`Tournament` » plus
> bas dans ce document pour le résumé durable implémenté et la purge
> réelle de ces lignes. Ce paragraphe reste tel quel pour l'historique.

**Décision prise, documentée honnêtement** : cette PR ne supprime
**jamais** la ligne `Session`/`Tournament`/`Proposal`/`Vote`/
`SessionResult`/`TournamentParticipant`/`TournamentMatch` elle-même.
Raison : `SessionResult.placement` (podium) est lu par `/profil/historique`
et `src/lib/revanche.ts`, et **cascade avec `Session`** (`onDelete: Cascade`)
— le supprimer avec la session perdrait cette donnée sans aucun résumé
durable indépendant existant aujourd'hui. XP (`XpEvent`), niveaux
(`LevelUpEvent`), classements de saison (`SeasonSnapshot`) et badges
(`UserBadge`) sont, eux, **déjà** sans FK vers `Session`/`Tournament`
(id libre non contraint) — donc **déjà à l'abri**, sans action
nécessaire dans cette PR.

**Ce qui EST réellement purgé** : les messages de chat (contenu textuel,
le plus volumineux et le plus sensible en confidentialité) et le
fil/l'annonce Discord — le nettoyage le plus impactant sur le stockage
réel sans risquer la moindre statistique. **Ce qui reste un GAP
explicite, signalé plutôt que forcé** : purger `Session`/`Tournament`
eux-mêmes nécessiterait d'abord un résumé durable et idempotent
détachant `SessionResult` de la ligne `Session` (ex. dénormaliser les
champs nécessaires, ou une nouvelle table découplée écrite avant la
purge) — **non implémenté ici**, aucune donnée n'est donc perdue par
cette PR, mais la réduction de stockage réelle sur `Session`/`Tournament`
elles-mêmes reste à faire dans un chantier séparé.

### 6. Exécution automatique — cron `retention-cleanup`

> **Mise à jour** : `runRetentionCleanup` orchestre désormais **six**
> volets, pas quatre — la purge réelle des lignes `Session` et
> `Tournament` (voir « V2 (suite) » plus bas) a été insérée entre le
> nettoyage Discord programmé et les notifications de saison close, dans
> cet ordre précis pour que le nettoyage Discord soit toujours au moins
> programmé avant que la ligne ne disparaisse.

`src/lib/retention-runner.ts` (`runRetentionCleanup`) orchestre les 4
volets ci-dessus en un seul passage **borné** :
- lots de taille fixe (`RETENTION_BATCH_SIZE = 50`) par volet ;
- budget de temps mur (`RETENTION_MAX_BATCH_DURATION_MS = 45s`, sous le
  `maxDuration` de 60 s de la route) — s'arrête proprement (`stoppedReason: "budget_exhausted"`)
  sans jamais planter ;
- **reprenable sans curseur persisté** : chaque volet interroge "que
  reste-t-il à faire MAINTENANT" (ex. sessions DONE/CANCELLED encore
  dotées d'au moins un `ChatMessage`) plutôt que de suivre un état —
  testé explicitement (`retention.integration.test.ts`, describe
  "reprise après interruption") ;
- **protégé contre les exécutions concurrentes** (mode effectif
  uniquement) par un verrou dédié `CronLock` (`name: "retention-cleanup"`,
  même mécanisme que le verrou `reminders` existant — nouvelle ligne
  singleton créée par la migration `20260923120000_add_retention_cleanup_lock`,
  aucune donnée applicative touchée) ;
- **aucun chargement intégral d'une table en mémoire** (`take: limit`
  partout, jamais un `findMany` non borné) ;
- respecte les limites Discord (réutilise entièrement l'exécuteur #97 —
  budget de bail, backoff, un seul appel réseau à la fois par livraison
  réclamée) ;
- **ne journalise jamais** de contenu de message/secret/donnée
  personnelle inutile (uniquement des ids, statuts, compteurs).

`dryRun: true` partage EXACTEMENT les mêmes fonctions d'éligibilité que
`dryRun: false` — seule la mutation réelle (DELETE/enqueue Discord) est
court-circuitée.

**Bilan lisible** (`RetentionRunReport`, `JSON` exposé par la route et
l'onglet admin) : candidats/suppressions/conservés/bloqués par volet,
`errors[]`, `durationMs`, `stoppedReason`.

### Route cron (`/api/cron/retention-cleanup`) — désactivée par défaut

**Deux verrous indépendants**, comme `NOTIFICATION_EXECUTOR_ENABLED`/
`DISCORD_BOT_*_ANNOUNCE_ENABLED` avant elle :

```
# 1. Active la route elle-même (répond, mais reste en dry-run par défaut)
RETENTION_CLEANUP_ENABLED=true

# 2. SEULE façon d'obtenir des mutations réelles — à poser UNIQUEMENT
#    après avoir observé le dry-run en production pendant au moins
#    quelques passages
RETENTION_CLEANUP_MODE=execute
```

**Aucune des deux n'est définie par cette PR.** Aucun cron externe n'est
configuré (ni sur Vercel ni ailleurs) — à ajouter manuellement après
revue, même modèle que `notification-executor`/`reminders` :

```
GET https://<domaine>/api/cron/retention-cleanup
Authorization: Bearer <CRON_SECRET>
```

**Commande de vérification du dry-run** (avant toute activation
`execute`) :
```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" \
  https://<domaine>/api/cron/retention-cleanup | jq .
```
Répond `{"enabled":false,...}` tant que `RETENTION_CLEANUP_ENABLED`
n'est pas posée ; `{"enabled":true,"dryRun":true,"report":{...}}` une
fois activée mais avant `RETENTION_CLEANUP_MODE=execute`.

### Retour arrière

- **Avant `RETENTION_CLEANUP_MODE=execute`** : aucune donnée n'a jamais
  été modifiée — retirer `RETENTION_CLEANUP_ENABLED` suffit à tout
  arrêter, sans aucune trace.
- **Après activation `execute`** : repasser `RETENTION_CLEANUP_MODE` à
  une valeur différente de `"execute"` (ou retirer `RETENTION_CLEANUP_ENABLED`)
  arrête immédiatement toute nouvelle mutation — **n'importe pas de
  données déjà purgées**, aucune procédure de cette PR ne restaure des
  messages de chat, des notifications ou une ressource Discord déjà
  supprimés (suppression réelle = irréversible, comme documenté partout
  dans ce chantier). Les livraisons `FAILED` (nettoyage Discord non
  réussi) restent visibles et réessayables indéfiniment via
  `/admin?tab=nettoyage`, indépendamment de l'état du cron.
- La migration `20260923120000_add_retention_cleanup_lock` est purement
  additive (une ligne `CronLock`) — un `DELETE FROM "CronLock" WHERE
  name = 'retention-cleanup'` l'annule sans toucher au reste du schéma,
  si nécessaire (non fait par cette PR).

### Limites connues, explicitement assumées

- ~~Purger `Session`/`Tournament`/`Proposal`/`Vote`/`SessionResult`/
  `TournamentParticipant`/`TournamentMatch` eux-mêmes reste un chantier
  séparé~~ **Fait** dans « V2 (suite) » (`Session`/`Tournament` sont
  désormais réellement purgées ; `Proposal`/`Vote`/`TournamentParticipant`/
  `TournamentMatch` cascadent avec elles ; `SessionResult` survit via le
  résumé durable — voir plus bas pour le détail et le gap qui, lui,
  reste assumé).
- Les chats "indépendants" éventuels (hors `ChatMessage.sessionId`)
  n'existent pas dans ce schéma — rien à documenter au-delà de ce
  constat (aucune suppression globale non définie n'est jamais tentée).
- Aucun rattrapage n'est lancé contre les anciennes données/anciens fils
  existants en production par cette PR — seuls l'inventaire (lecture
  seule) et les outils (dry-run, resync créateur, réessai admin) sont
  livrés, une activation ultérieure reste une décision humaine explicite.
- Suppression de lignes en base ne garantit **jamais** une baisse
  immédiate de l'espace disque physique alloué (Postgres/Neon) —
  `VACUUM`/`VACUUM FULL` reste une opération de maintenance séparée,
  jamais déclenchée automatiquement par cette route.
- "Jouer maintenant" n'est pas implémenté par cette PR (hors périmètre
  explicite de ce chantier).

### Migrations

- `20260923120000_add_retention_cleanup_lock` — additive, une ligne
  `CronLock` (`name: "retention-cleanup"`). Aucune colonne, aucune table,
  aucun enum modifié — `prisma/schema.prisma` **inchangé** par ce
  chantier.
- `20260924090000_add_durable_result_summaries` (V2, suite) — voir plus
  bas pour le détail complet (FK `SetNull`, colonnes dénormalisées,
  nouvelle table `UserLifetimeStats`, backfill des lignes existantes).

### Tests

- `src/lib/discord-rest.test.ts` — `deleteThreadPermanently`/
  `deleteChannelMessage`/`addThreadMember` (unitaires, `fetch` mocké) :
  succès, 404 honnêtement classifié `not_found` (jamais un succès depuis
  ce module), 403 non-retryable, budget de bail insuffisant.
- `src/lib/retention.test.ts` — éligibilité PURE (sessions/tournois
  actifs/terminés/sans date fiable, limites exactes de la fenêtre de 7
  jours — juste avant/pile/juste après).
- `src/lib/retention.integration.test.ts` (Postgres isolé + Discord
  simulé) — purge chat réelle vs dry-run, programmation du nettoyage
  Discord (jamais en double), purge de notifications de saison close
  (aucun cycle exploitable → gap exposé), purge technique (terminal +
  retry-safe uniquement, jamais `FAILED`/occurrence fixe), préservation
  XP/badges/résultats, **reprise après interruption** (lot borné, deux
  passages), **isolation entre soirées** (purger l'une ne touche jamais
  l'autre), verrou de concurrence (`lock_not_acquired`), réessai manuel
  jamais automatique.
- `src/lib/session-announce.integration.test.ts` (nouveau describe "V2 —
  suppression manuelle définitive du fil privé") et
  `src/lib/tournament-announce.integration.test.ts` (tests de suppression
  mis à jour pour DELETE réel + nouveau describe "V2 — adhésion
  automatique au fil du tournoi") — toutes les races listées ci-dessus,
  contre une vraie base Postgres et Discord entièrement simulé.
- `src/app/sessions/actions/session-lifecycle.delete.test.ts` /
  `src/app/tournois/actions.resync.test.ts` — comportement propre aux
  actions serveur (autorisation, ordre transaction/enqueue).

Résultats à la livraison (état initial de cette PR, avant « V2, suite »
ci-dessous) : suite Postgres complète **630/630**, suite rapide (hors
Postgres) **402/402** (226 suites Postgres-only marquées `skip` sans base
disponible), `npx tsc --noEmit` et `npx eslint .` sans erreur, `npx next
build` réussi (nouvelle route `/api/cron/retention-cleanup` apparaît dans
le manifeste de routes). Voir « V2, suite » pour les résultats mis à jour
après l'ajout de la purge réelle Session/Tournament.

### Ce qui reste hors périmètre (délimitation explicite)

Aucune suppression réelle en production, aucun envoi Discord réel,
aucune migration distante, aucun changement de configuration externe
(Vercel, cron), aucun merge, aucun rattrapage des anciennes données/
anciens fils, aucune resynchronisation lancée en production. "Jouer
maintenant" et le reste du bot avancé restent dans la suite du chantier
V2.

---

## V2 (suite) — purge réelle des lignes Session/Tournament : résumé durable des résultats

Complète le point explicitement laissé ouvert au §5 ci-dessus
(« purger `Session`/`Tournament` eux-mêmes nécessiterait d'abord un
résumé durable [...] non implémenté ici ») : la demande porte sur une
**réduction réelle du stockage des historiques**, pas seulement des
messages de chat. Ce chantier supprime désormais réellement les lignes
`Session`/`Tournament` 7 jours après leur fin, en préservant les
résultats/XP/badges/classements/statistiques par un **résumé durable
minimal** — jamais une copie intégrale dans une table d'archive.

### Pourquoi `Session`/`Tournament` ne pouvaient pas être purgées avant (analyse des dépendances)

Avant ce chantier, quatre modèles portaient une FK **`onDelete: Cascade`**
vers `Session` et seraient donc partis avec elle : `SessionResult`
(podium, lu par `/profil/historique`, `/profil` et `revanche.ts`),
`SuperlativeAward` (récompenses par jeu, lues par `/profil/superlatifs`
et `/potes/[id]/superlatifs`), `Pronostic` (pronostics, taux de réussite
lifetime sur `/profil`) et `XpBet` (paris XP). `Proposal`/`Vote`
cascadent également mais ne sont lus qu'à la vie de la soirée (jamais
après coup) — leur perte est sans conséquence. Côté `Tournament` :
`TournamentParticipant`/`TournamentMatch` cascadent, mais **aucune**
lecture de calcul lifetime ne s'appuyait sur eux directement — les
critères de badges `TOURNAMENTS_WON`/`TOURNAMENTS_PARTICIPATED`
(`src/lib/badges.ts`) comptaient respectivement `Tournament.count({championId})`
et `TournamentParticipant.count({userId})`, deux requêtes qui seraient
devenues silencieusement fausses (sous-comptage) après une purge sans
compensation. C'est cette dépendance — pas une limite technique de
Postgres ni de Prisma — qui bloquait toute purge réelle : supprimer la
ligne `Session`/`Tournament` sans rien d'autre aurait cassé ces lectures
et fait régresser silencieusement des statistiques déjà affichées aux
utilisateurs (violation explicite de la contrainte « vérifie que les
lectures et calculs existants continuent de fonctionner »).

Deux catégories de données étaient déjà **structurellement à l'abri**,
sans dépendance à corriger : `XpEvent`/`LevelUpEvent`/`SeasonSnapshot`/
`UserBadge` (aucune FK vers `Session`/`Tournament`, `sourceId` est un id
libre non contraint) et le `MonthlyRecap` mensuel
(`generateMonthlyRecapIfDue`, inchangé) — son snapshot JSON permanent du
mois précédent est calculé et figé le jour 1 du mois suivant, donc
**toujours** avant que la fenêtre de purge de 7 jours ne se referme sur
la moindre soirée de ce mois-là (vérifié par lecture de code, aucun
changement nécessaire).

### Décision de conception : `SetNull` + dénormalisation à l'écriture, jamais une table d'archive

Deux approches étaient possibles pour découpler `SessionResult` (et
consorts) de `Session` : (a) copier chaque ligne pertinente dans une
table d'archive séparée au moment de la purge, ou (b) rendre la FK
optionnelle (`onDelete: SetNull`) et dénormaliser, **au moment de
l'écriture originale**, les quelques champs qu'une lecture ultérieure
peut encore réclamer une fois la `Session` disparue (`gameId`,
`gameName`, `sessionDate`). La demande excluait explicitement la
première option ("Ne déplace pas simplement toutes les données dans une
table d'archive") — (b) est retenue :

- **`SessionResult`** : `sessionId` devient `String?` (`onDelete: SetNull`
  au lieu de `Cascade`), + colonnes `gameId String?`/`gameName String?`/
  `sessionDate DateTime?`, remplies à la création
  (`submitSessionResultsAction`, `src/app/sessions/actions/results.ts`).
  Devient de facto **le résumé durable lui-même** : la ligne survit
  intacte à la suppression de sa `Session`, avec tout ce qu'une lecture
  ultérieure (`/profil/historique`, `/profil`, `revanche.ts`) réclame.
- **`SuperlativeAward`** : même traitement (`gameName`, `sessionDate`,
  écrits dans `finalizeSuperlativeVoting`, `src/lib/superlative-voting.ts`).
- **`Pronostic`** : `sessionId` nullable + `SetNull` (aucune colonne
  dénormalisée nécessaire — seul le champ `correct` compte pour le taux
  de réussite lifetime, déjà porté par la ligne elle-même).
- **`XpBet`** : `sessionId` nullable + `SetNull` + `gameName String?`
  (écrit dans `placeBet`, `src/lib/xp-bets.ts`, pour l'affichage
  `/profil`).
- **`Debt`** (gages) : schéma **inchangé** (reste `Cascade` des deux
  côtés) — volontairement, voir « Condition bloquante » ci-dessous : une
  dette impayée bloque la purge de sa soirée plutôt que d'être
  dénormalisée, jamais effacée silencieusement pendant qu'elle est due.

Ce choix coûte 4 colonnes ajoutées (2 sur `SuperlativeAward`, 3 sur
`SessionResult`, 1 sur `XpBet`) et 4 FK rendues optionnelles — contre une
table d'archive qui aurait dupliqué un schéma entier, exigé une logique
de copie transactionnelle supplémentaire à chaque purge, et risqué un
double comptage (ligne vivante + ligne archivée coexistant un instant).
Aucune copie n'a jamais lieu : la ligne `SessionResult`/`SuperlativeAward`/
`Pronostic`/`XpBet` purgée avec sa `Session` n'existe pas — elle **est**
purgée avec elle si (et seulement si) elle n'a jamais existé en premier
lieu ; celle qui existe déjà continue d'exister, seule sa FK devient
`NULL`.

### `UserLifetimeStats` — la seule pièce de schéma réellement neuve

Sur les 5 critères de badges à risque, 4 avaient déjà un remplaçant
durable disponible sans nouveau schéma : `checkSessionsCreatedBadges` et
le calcul équivalent (`backfill-badges.ts`, `profile-stats.ts`) comptent
désormais `XpEvent.count({userId, reason: "CREATE_SESSION"})` au lieu de
`Session.count({createdById})` ; `checkTournamentBadges` compte les
victoires via `XpEvent.count({userId, reason: "TOURNAMENT_RESULT",
sourceId: {endsWith: ":1st"}})` au lieu de `Tournament.count({championId})`
— ces `XpEvent` existaient déjà, écrits à chaque événement, jamais liés
par FK à `Session`/`Tournament`. Seul le nombre de tournois **participés**
(`TOURNAMENTS_PARTICIPATED`) n'avait aucun proxy durable existant : d'où
`UserLifetimeStats` (`userId String @id`,
`tournamentsParticipatedCount Int @default(0)`), incrémenté/décrémenté
**au moment exact** de l'inscription/désinscription
(`registerForTournamentAction`/`unregisterFromTournamentAction`,
`src/app/tournois/actions.ts`, dans la même transaction) plutôt que
recalculé après coup sur des lignes potentiellement déjà purgées. Un seul
entier par utilisateur — la définition même du « minimal » demandé, pas
une table miroir de `TournamentParticipant`.

### Conditions bloquantes — jamais une purge qui efface un résultat non finalisé

`sessionPurgeBlockReason` (`src/lib/retention.ts`) bloque la purge d'une
soirée par ailleurs éligible (terminée, hors fenêtre de 7 jours) si :

| Raison | Condition | Pourquoi |
|---|---|---|
| `superlative_voting_pending` | `Session.superlativeVotingClosed === false` | Le vote de superlatifs n'est pas clôturé — purger maintenant effacerait la possibilité même de le clôturer, jamais un `SuperlativeAward` créé après coup sur une soirée qui n'existe plus. |
| `debt_unpaid` | Un `Debt` lié (`sessionId`) avec `paidAt: null` existe | Une dette (gage) encore due entre deux potes — la purger silencieusement effacerait une obligation réelle non soldée. `Debt` cascade toujours avec `Session` (schéma inchangé), donc le blocage est la seule protection ; une fois payée (`paidAt` renseigné), elle cesse de bloquer et disparaît normalement avec sa soirée. |

Une soirée bloquée reste candidate aux passages suivants du cron — dès
que le blocage se lève (vote clôturé, dette payée), elle redevient
purgeable sans action supplémentaire. Jamais de purge forcée ignorant
ces conditions.

### Sécurité des accès concurrents

`purgeEligibleSessionsBatch`/`purgeEligibleTournamentsBatch` reprennent
le pattern déjà utilisé par `deleteTournament`/
`registerForTournamentAction` : `SELECT ... FOR UPDATE` sur la ligne
candidate **dans la transaction de suppression**, puis re-vérification
complète de l'éligibilité et des conditions bloquantes juste avant le
`DELETE` — une dette créée ou un vote rouvert entre la sélection du lot
et l'exécution de la transaction annule la purge de cette ligne au lieu
de l'exécuter sur un état déjà obsolète (testé explicitement, voir
Tests).

**Nettoyage Discord — jamais un rejeu automatique d'un échec** : comme
`scheduleDiscordCleanupForEligibleEvents`, `purgeEligibleSessionsBatch`/
`purgeEligibleTournamentsBatch` ne programment `thread-delete`/
`announce-delete` que si le statut de livraison est encore
`"never_enqueued"` — jamais si `"failed"` (qui attend un réessai manuel
explicite via `/admin?tab=nettoyage`) ni `"pending"`/`"done"`. Bug
auto-détecté pendant l'écriture des tests de ce chantier (voir Tests) :
la première version enqueue-ait sans cette garde, ce qui aurait
silencieusement retenté un nettoyage Discord déjà en échec terminal à
chaque passage de purge — corrigé avant livraison.

### Ce qui doit rester en l'état — quoi, pourquoi, coût estimé

> **Mise à jour** : le gap `home.ts` décrit ci-dessous a été **comblé**
> (plus un gap assumé, un défaut corrigé) — voir « V2 (suite, 2) —
> préservation des stats de groupe de la Home » plus bas dans ce
> document. Ce paragraphe reste tel quel pour l'historique de la
> décision initiale.

Un seul gap assumé, documenté plutôt que corrigé : **`src/lib/home.ts`
(`getGroupStats`)** calcule des statistiques **de groupe** (nombre total
de soirées jouées tous utilisateurs confondus, jeu le plus joué du
groupe) directement à partir des lignes `Session`/`SessionResult`
vivantes. Ces chiffres **dégraderont en exactitude** au fil des purges
(une soirée purgée sort du calcul groupe, même si son
`SessionResult` individuel survit et reste exact pour l'utilisateur
concerné). Non corrigé dans ce chantier car cela demanderait un nouveau
compteur durable **par jeu, au niveau du groupe entier** (pas juste par
utilisateur) — une pièce de schéma et de logique d'écriture
supplémentaire, disproportionnée par rapport à la demande explicite d'un
« résumé durable **minimal** » centré sur les résultats/XP/badges/
classements/statistiques **individuels**. Coût estimé pour combler ce
gap plus tard : un nouveau modèle (ex. `GroupGameStat` ou équivalent,
clé `gameId`, compteur incrémenté à chaque `SessionResult` créé) +
migration additive + une écriture supplémentaire dans
`submitSessionResultsAction` — un chantier de l'ordre d'une demi-journée
à une journée, **hypothèse d'estimation, jamais une mesure**. Aucune
autre donnée n'a été identifiée comme nécessitant un maintien de la
ligne `Session`/`Tournament` elle-même au-delà des deux conditions
bloquantes déjà listées ci-dessus.

### Distinction mesures vs hypothèses

Aucun volume de production n'a été inventé nulle part dans ce chantier
(ni ici, ni dans `storage-audit.ts`, ni dans ce README) — cette session
tourne contre une base de développement/test locale, jamais contre la
production. Tout chiffre présenté comme un **volume** (nombre de lignes,
octets) est soit une mesure réelle exécutée contre CETTE base de test
(explicitement qualifiée comme telle), soit absent. Le seul chiffre de
nature différente présenté ici — le coût estimé (aujourd'hui obsolète,
voir mise à jour ci-dessus) du gap `home.ts` — était explicitement
qualifié d'**hypothèse d'estimation d'effort**, jamais d'une mesure.

### Migration (`20260924090000_add_durable_result_summaries`)

Écrite à la main (pas de `prisma migrate dev` contre une base de
développement partagée), vérifiée **sans dérive** via `npx prisma migrate
diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma
--script` après application :

1. `SessionResult`/`SuperlativeAward`/`Pronostic`/`XpBet` : FK `sessionId`
   recréée `ON DELETE SET NULL` (au lieu de `CASCADE`).
2. Ajout des colonnes dénormalisées (`gameId`/`gameName`/`sessionDate`
   selon le modèle, voir ci-dessus) + un index
   `SessionResult(userId, gameId)`.
3. **Backfill des lignes déjà existantes** (`UPDATE ... FROM "Session"
   s LEFT JOIN "Game" g ...`) — toute ligne déjà en base au moment de la
   migration récupère immédiatement ses champs dénormalisés depuis sa
   `Session`/son `Game` encore vivants à cet instant ; seules les lignes
   créées APRÈS ce backfill dépendent du code applicatif modifié pour les
   renseigner (pas de fenêtre où une ligne resterait dénormalisée à
   vide).
4. `CREATE TABLE "UserLifetimeStats"` + FK vers `User` (`Cascade` — une
   ligne de stats n'a aucun sens sans son utilisateur) + backfill
   (`INSERT ... SELECT userId, COUNT(*) FROM "TournamentParticipant"
   GROUP BY userId ON CONFLICT DO NOTHING`) : les utilisateurs déjà
   inscrits à des tournois avant cette migration récupèrent leur
   compteur correct dès l'application de la migration, jamais à zéro.

Purement additive/décontraignante (aucune donnée existante n'est
supprimée ou tronquée par cette migration) — aucune procédure de retour
arrière dédiée n'est nécessaire au-delà du retour arrière standard de
migration Prisma (non exécuté par cette PR).

### Tests ajoutés (`src/lib/retention.integration.test.ts`)

Contre Postgres isolé réel + Discord entièrement simulé, deux nouveaux
describe :

**`purgeEligibleSessionsBatch`** — dry-run sans mutation ; soirée active
jamais purgée ; soirée dans la fenêtre de 7 jours jamais purgée ; dette
impayée bloque avec la bonne raison (`debt_unpaid`) ; dette payée ne
bloque pas (et la ligne `Debt` elle-même disparaît, cascade normal) ;
`superlativeVotingClosed: false` bloque puis débloque au passage suivant
une fois clôturé ; **préservation vérifiée individuellement** pour
`SessionResult`/`SuperlativeAward`/`Pronostic`/`XpBet` (données
dénormalisées correctes, `sessionId: null` après purge) ; correction de
`checkSessionsCreatedBadges` vérifiée AVANT et APRÈS purge (avec un vrai
badge `SESSIONS_CREATED` seedé) ; **isolation** entre deux utilisateurs
(soirée de l'un purgée, soirée de l'autre intacte, son `SessionResult`
reste lié) ; **reprise après interruption** (deux passages `limit: 1`
puis un troisième passage vide) ; **race concurrente** — une dette créée
juste avant l'exécution de la transaction est rattrapée par la
re-vérification `FOR UPDATE`.

**`purgeEligibleTournamentsBatch`** — dry-run ; tournoi actif jamais
purgé ; préservation complète (seed de `Badge` `TOURNAMENTS_WON`/
`TOURNAMENTS_PARTICIPATED`, `Tournament`+`TournamentMatch`+
`TournamentParticipant`+`XpEvent(TOURNAMENT_RESULT)`+`UserLifetimeStats`
réels, `checkTournamentBadges` vérifié avant/après purge,
`TournamentParticipant`/`TournamentMatch` à 0 après purge tandis que
`XpEvent`/`UserLifetimeStats` survivent intacts) ; reprise après
interruption (deux passages `limit: 1`).

Un troisième describe (`runRetentionCleanup — inclut désormais la purge
réelle des lignes Session/Tournament`) vérifie l'intégration complète du
runner en dry-run et en mode réel.

**Résultats mis à jour** (après cette suite) : Postgres complet
**651/651** (up de 630/630), rapide (hors Postgres) **402/402**,
`npx tsc --noEmit` / `npx eslint .` sans erreur, `npx next build` réussi
(`/api/cron/retention-cleanup` toujours présente dans le manifeste de
routes).

**Nettoyage reste désactivé par défaut** — aucun changement à
`RETENTION_CLEANUP_ENABLED`/`RETENTION_CLEANUP_MODE`, le dry-run reste
partagé à l'identique entre les deux modes (mêmes fonctions
d'éligibilité, seule la mutation réelle est court-circuitée) — reconfirmé
par les tests de ce chantier.

### Procédure concrète — consulter le dry-run puis activer le nettoyage

1. **Variables d'environnement exactes** (aucune autre ne contrôle ce
   comportement) :
   - `RETENTION_CLEANUP_ENABLED=true` — active la route (répond, reste en
     dry-run par défaut).
   - `RETENTION_CLEANUP_MODE=execute` — **seule** valeur qui déclenche des
     mutations réelles (suppression de messages/notifications/lignes
     `Session`/`Tournament`, suppression Discord). Toute autre valeur (ou
     absence) reste en dry-run.
   - `CRON_SECRET` — jeton d'authentification du endpoint (même variable
     que les autres crons existants, `notification-executor`/`reminders`).
2. **Endpoint du cron** : `GET /api/cron/retention-cleanup`
   (`src/app/api/cron/retention-cleanup/route.ts`).
3. **Authentification** : en-tête `Authorization: Bearer <CRON_SECRET>` —
   requête sans cet en-tête ou avec un jeton incorrect refusée avant tout
   traitement (`verifyCronRequest`, même garde que les autres crons).
4. **Consulter le dry-run** (avant toute activation `execute`) :
   ```bash
   curl -s -H "Authorization: Bearer $CRON_SECRET" \
     https://<domaine>/api/cron/retention-cleanup | jq .
   ```
   Répond `{"enabled":false,...}` tant que `RETENTION_CLEANUP_ENABLED`
   n'est pas posée. Une fois posée (sans `RETENTION_CLEANUP_MODE=execute`),
   répond `{"enabled":true,"dryRun":true,"report":{...}}` — le `report`
   inclut désormais `sessionRowPurge`/`tournamentRowPurge`
   (`candidateSessionIds`/`purgedSessionIds`/`blockedSessions` avec leur
   `reason`, et l'équivalent tournoi) en plus des volets existants (chat,
   nettoyage Discord, notifications, données techniques). **Relire ce
   rapport sur plusieurs passages** avant d'activer `execute` — en
   particulier vérifier que `blockedSessions` correspond bien aux soirées
   avec vote/dette en attente réels, et qu'aucune soirée inattendue
   n'apparaît dans `purgedSessionIds` en dry-run (qui liste alors les
   soirées qui SERAIENT purgées).
5. **Activer réellement** : poser `RETENTION_CLEANUP_MODE=execute` en plus
   de `RETENTION_CLEANUP_ENABLED=true`, puis configurer un cron externe
   (cron-job.org ou équivalent, même modèle que `notification-executor`/
   `reminders`) appelant périodiquement le endpoint ci-dessus avec le
   même en-tête `Authorization`.
6. **Retour arrière** : avant `execute`, retirer `RETENTION_CLEANUP_ENABLED`
   arrête tout sans aucune trace. Après `execute`, repasser
   `RETENTION_CLEANUP_MODE` à une valeur différente de `"execute"` (ou
   retirer `RETENTION_CLEANUP_ENABLED`) arrête toute nouvelle mutation —
   **n'importe pas** les lignes `Session`/`Tournament` déjà purgées
   (suppression réelle = irréversible, comme le reste de ce chantier).

**Aucune action réelle n'a été effectuée en production par ce
chantier** : aucune des deux variables n'est posée nulle part, aucun cron
externe n'est configuré, aucune migration n'a été appliquée ailleurs que
sur une base Postgres de test locale isolée.

---

## V2 (suite, 2) — préservation des stats de groupe de la Home avant déploiement de #107

Ferme le dernier gap explicitement signalé au chantier précédent (« Ce
qui doit rester en l'état ») : **la perte d'exactitude des statistiques
de groupe de la Home (`src/lib/home.ts::getGroupStats`) n'était pas
acceptable comme simple limite documentée** — elles sont désormais
préservées par des agrégats durables minimaux, jamais en conservant les
anciennes soirées elles-mêmes.

### Ce qui était affecté, ce qui ne l'était pas

`getGroupStats()` retourne 4 indicateurs. Seuls deux dépendaient de
lignes `Session` purgeables :

| Indicateur | Source avant ce lot | Affecté par la purge ? |
|---|---|---|
| `totalSessionsPlayed` | `Session.count({status:"DONE"})` | **Oui** — sous-compté dès qu'une soirée DONE est purgée. |
| `mostPlayedGame` | `Session.groupBy({by:"decidedGameId"})` | **Oui** — même cause, et pouvait en plus désigner un AUTRE jeu "le plus joué" une fois les soirées du vrai gagnant purgées. |
| `bestActiveStreak` | `User.streakCount`/`streakLastActiveAt` | Non — aucune dépendance à `Session`, fenêtre de 24h inchangée, non retouché. |
| `activePlayers` | `User.streakLastActiveAt` (fenêtre 7 jours) | Non — idem, non retouché. |

### Agrégats durables minimaux — jamais une conservation des anciennes soirées

Deux modèles, volontairement les plus petits possibles (`prisma/schema.prisma`) :

```prisma
model GroupSessionStats {
  id                  String @id @default("global") // singleton, même principe que CronLock.name
  totalSessionsPlayed Int    @default(0)
}

model GroupGameStat {
  gameId    String @id
  playCount Int    @default(0)
  game      Game   @relation(fields: [gameId], references: [id], onDelete: Cascade)
}
```

Un entier global + un entier par jeu — jamais une ligne par soirée,
jamais une copie du contenu d'une `Session`. `mostPlayedGame` reste
`{name, coverUrl, count}` en joignant `GroupGameStat` → `Game` (jamais
dénormalisé : `Game` elle-même n'est jamais purgée par ce chantier, la
jointure reste fiable à 100 % même pour un jeu dont toutes les soirées
ont depuis été purgées).

### Point d'écriture unique, atomique avec la transition de statut

`Session.status → "DONE"` n'a qu'un seul point d'écriture dans tout le
code : `markSessionDone` (`src/lib/sessions.ts`), appelé aussi bien par
le bouton créateur (`markSessionDoneAction`) que par le cron d'auto-
clôture (`closeOverdueScheduledSessions`). L'incrément des deux
compteurs est posé **dans la même transaction Prisma** que le
`updateMany` conditionnel (`WHERE status = 'SCHEDULED'`) qui opère cette
transition :

```ts
const decided = await prisma.$transaction(async (tx) => {
  const result = await tx.session.updateMany({
    where: { id: sessionId, status: "SCHEDULED" },
    data: { status: "DONE" },
  });
  if (result.count === 0) return null; // déjà DONE — rien à incrémenter

  const updated = await tx.session.findUnique({ where: { id: sessionId }, select: { decidedGameId: true } });
  await tx.groupSessionStats.upsert({
    where: { id: "global" },
    create: { id: "global", totalSessionsPlayed: 1 },
    update: { totalSessionsPlayed: { increment: 1 } },
  });
  if (updated?.decidedGameId) {
    await tx.groupGameStat.upsert({
      where: { gameId: updated.decidedGameId },
      create: { gameId: updated.decidedGameId, playCount: 1 },
      update: { playCount: { increment: 1 } },
    });
  }
  return updated;
});
```

### Pourquoi aucun double comptage n'est possible — même en reprise ou en exécution concurrente

- **Jamais retouché par la purge elle-même** : `purgeEligibleSessionsBatch`/
  `purgeEligibleTournamentsBatch` n'écrivent JAMAIS dans
  `GroupSessionStats`/`GroupGameStat` — aucune re-dérivation depuis des
  lignes `Session` vivantes après coup. `getGroupStats()` ne lit QUE ces
  deux tables, jamais un mélange avec `Session`/`SessionResult` en
  direct : par construction, il n'existe qu'une seule source de vérité,
  donc aucun risque de compter une même soirée deux fois (une fois via
  une lecture live, une fois via le compteur).
- **Reprise après interruption** : la purge peut s'arrêter et reprendre
  sur plusieurs passages bornés (`limit`) sans jamais toucher ces deux
  tables — leur valeur reste strictement identique avant, pendant et
  après n'importe quel nombre de passages de purge (testé, voir
  ci-dessous).
- **Exécution concurrente de `markSessionDone`** : le `updateMany`
  conditionnel sur `status: "SCHEDULED"` est une opération atomique
  Postgres — sur deux appels concurrents pour la même soirée (double
  clic, cron + bouton créateur simultanés), le verrou de ligne implicite
  du `UPDATE` sérialise les deux, un seul obtient `count: 1` et
  incrémente, l'autre obtient `count: 0` et ressort sans rien écrire.
  Aucun incrément ne peut donc jamais s'exécuter deux fois pour la même
  soirée.
- **Rappel sur une soirée déjà DONE** (bouton recliqué, cron qui retombe
  dessus) : même garde — `count: 0`, retour immédiat, aucun second
  incrément.

### Migration des données existantes — les compteurs sont peuplés AVANT que la purge ne puisse jamais s'exécuter

Une nouvelle migration additive, `20260924150000_add_group_session_stats`,
crée les deux tables puis les **backfille immédiatement** avec les
soirées DONE déjà présentes au moment où elle s'exécute :

```sql
INSERT INTO "GroupSessionStats" ("id", "totalSessionsPlayed")
SELECT 'global', COUNT(*)::int FROM "Session" WHERE "status" = 'DONE';

INSERT INTO "GroupGameStat" ("gameId", "playCount")
SELECT "decidedGameId", COUNT(*)::int FROM "Session"
WHERE "status" = 'DONE' AND "decidedGameId" IS NOT NULL
GROUP BY "decidedGameId";
```

Exactement le même raisonnement que le backfill `UserLifetimeStats` de
la migration précédente : cette migration s'exécute AVANT tout
déploiement du code de purge, donc TOUTES les soirées DONE existent
encore à cet instant — le compte est exact au moment de la migration,
jamais un compteur qui redémarrerait à zéro à l'activation de ce
chantier. Vérifiée **sans dérive** via `npx prisma migrate diff
--from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma
--script` après application.

### Vérification explicite du backfill de la migration PRÉCÉDENTE (`20260924090000_add_durable_result_summaries`)

Demande explicite de ce lot : ne pas se contenter d'affirmer que le
backfill de la migration précédente (`gameId`/`gameName`/`sessionDate`
sur `SessionResult`/`SuperlativeAward`/`XpBet`) fonctionne — le prouver
par un test qui rejoue le `UPDATE` **exact** de cette migration (copié
depuis le fichier `.sql` réel, jamais une réimplémentation qui pourrait
diverger silencieusement) contre une "ancienne soirée" simulée : ses 4
lignes (`SessionResult`, `SuperlativeAward`, `Pronostic`, `XpBet`) créées
avec les colonnes dénormalisées explicitement `NULL` — l'état exact
qu'une dénormalisation limitée aux nouvelles écritures aurait laissé
indéfiniment. Le test (voir Tests ci-dessous) vérifie que le `UPDATE`
les remplit correctement, PUIS purge la soirée et vérifie que les 4
lignes survivent avec les bonnes données — une ancienne soirée se
comporte désormais exactement comme une nouvelle.

### Tests ajoutés (`src/lib/retention.integration.test.ts`)

Deux nouveaux describe, contre Postgres isolé réel :

**« Stats du groupe (Home) »** :
- incrément unique par soirée + rappel idempotent sur une soirée déjà
  DONE (aucun second incrément) ;
- exécution CONCURRENTE de `markSessionDone` sur la même soirée (deux
  appels en `Promise.all`) — un seul incrément ;
- **`getGroupStats()` avant/après purge, sur les mêmes données** : 3
  soirées d'un jeu (purgeables) + 1 soirée récente d'un autre jeu
  (protégée par la fenêtre de 7 jours), comparaison stricte
  (`toEqual`) du rapport complet avant et après purge — **identique** ;
- **reprise après interruption** : deux passages bornés (`limit: 1`),
  les compteurs restent strictement stables après chaque passage.

**« Migration ... — backfill d'une ANCIENNE soirée déjà existante »** :
scénario complet avec résultat, récompense, pronostic et pari, colonnes
dénormalisées `NULL`, `UPDATE` de backfill rejoué tel quel, vérification
du remplissage, puis purge réelle et vérification de la survie des 4
lignes avec leurs données correctes.

**Résultats mis à jour** : Postgres complet **656/656** (up de
651/651 — 5 nouveaux tests), rapide (hors Postgres) **402/402**
(inchangé, ces tests sont Postgres-only et correctement skippés sans
`TEST_DATABASE_URL`), `npx tsc --noEmit` / `npx eslint .` sans erreur,
`npx next build` réussi (toutes les routes générées sans erreur, aucune
régression).

### Respect des règles d'accès et de la période de calcul

Aucun changement de périmètre : `totalSessionsPlayed`/`mostPlayedGame`
comptaient déjà **toutes** les soirées DONE sans filtre de
confidentialité (décision produit déjà actée au chantier confidentialité
§9, « agrégats globaux non filtrés par soirée ») et sur une fenêtre **à
vie** (aucun découpage par saison) — ce lot rend cette même portée
durable, il ne la durcit ni ne l'assouplit. `bestActiveStreak`/
`activePlayers` restent lus depuis `User`, entièrement inchangés.

### Nettoyage reste désactivé, PR toujours Draft, aucune action réelle

Aucun changement à `RETENTION_CLEANUP_ENABLED`/`RETENTION_CLEANUP_MODE`
— le dry-run partage toujours les mêmes fonctions d'éligibilité que le
mode réel, reconfirmé par les tests ci-dessus. Aucune migration
appliquée ailleurs que sur la base Postgres de test locale isolée,
aucune donnée réelle modifiée, PR #107 reste en Draft.

### Gap signalé ici — comblé, ne PAS relire comme une limite restante

> **Mise à jour** : le paragraphe ci-dessous, écrit à la livraison de ce
> lot, signalait `group-achievements.ts::checkGroupAchievements` comme
> une dépendance de même nature que celle corrigée ici mais laissée hors
> périmètre. Reconsidéré : la purge doit préserver les récompenses de
> groupe et leur calcul futur — ce gap est **comblé** dans « V2 (suite, 3)
> — préservation des trophées de groupe » plus bas. Conservé tel quel
> pour l'historique.

`src/lib/group-achievements.ts::checkGroupAchievements` recalcule
certains trophées de groupe encore **verrouillés** (ex. "Century" — 100
soirées) via un `Session.findMany({status:"DONE"})` en direct — une
dépendance de même nature que celle corrigée ici, mais sur un fichier
différent, non mentionné par cette demande (qui cible explicitement
`home.ts`). Les trophées déjà débloqués ne sont jamais affectés (recalcul
limité aux trophées `unlockedAt: null`), donc aucune régression visible
tant qu'un trophée à seuil élevé n'est pas sur le point de se débloquer
au moment même où ses soirées constitutives commencent à être purgées —
un cas limite, non corrigé ici, signalé plutôt que passé sous silence.

---

## V2 (suite, 3) — préservation des trophées de groupe (GroupAchievement)

Le gap signalé au lot précédent (`group-achievements.ts` a une
dépendance de même nature que `home.ts` mais laissée hors périmètre) est
**réintégré dans le périmètre** : la purge doit préserver les
récompenses de groupe et leur calcul futur, pas seulement les stats
d'affichage de la Home.

### Quels succès sont concernés, et l'effet EXACT d'une purge

10 trophées de groupe (`GROUP_ACHIEVEMENT_DEFS`, `src/lib/group-achievements.ts`),
recalculés à chaque `markSessionDone` (`checkGroupAchievements`).
Analyse prédicat par prédicat :

| Trophée | Seuil | Dépendait de | Effet exact d'une purge (AVANT ce lot) |
|---|---|---|---|
| Première soirée | ≥1 soirée | `doneSessions.length` | Aucun en pratique — voir "immunisés" ci-dessous (mais lisait la même variable que les 2 suivants). |
| Marathoniens | ≥10 soirées | `doneSessions.length` | **Régression quasi systématique** : dès qu'une 11ᵉ soirée ferme après que les premières ont dépassé 7 jours, `totalDone` (direct) ne peut plus jamais atteindre 10 en une seule lecture — le trophée ne se débloque plus. |
| Century | ≥100 soirées | `doneSessions.length` | Même cause, encore plus systématique (100 soirées simultanément vivantes est hautement improbable avec une purge à 7 jours). |
| Diversité | ≥10 jeux distincts | `Set` sur `decidedGameId` des soirées vivantes | Même régression : les jeux des soirées les plus anciennes purgées "disparaissent" du calcul. |
| Squad | ≥5 participants distincts | Voteurs de la proposition gagnante, recalculés depuis `Proposal`/`Vote` des soirées vivantes | Même régression : `Proposal`/`Vote` cascadent avec `Session` (purgés avec elle), les participants des soirées les plus anciennes disparaissent du calcul. |
| Réguliers | 4 semaines calendaires consécutives | `Set` de semaines dérivé des dates des soirées vivantes | Même régression : une semaine dont la soirée a été purgée disparaît du calcul, cassant la continuité. |
| Noctambules | 1 soirée après 23h | `doneSessions` vivantes | **Aucun effet réel** — voir "immunisés" ci-dessous. |
| Full House | 1 soirée réunissant tout le groupe | `doneSessions` vivantes + `Proposal`/`Vote` | **Aucun effet réel** — voir "immunisés" ci-dessous. |
| Collectionneur collectif | ≥500 jeux en bibliothèque | `UserGame` (jamais lié à `Session`) | **Aucun** — pas de dépendance à `Session`. |
| Légendaire | 1 membre rang Légende | `User.xpTotal` (jamais lié à `Session`) | **Aucun** — pas de dépendance à `Session`. |

**Pourquoi "Noctambules"/"Full House" sont immunisés PAR CONSTRUCTION,
sans avoir besoin d'un correctif** : ce sont des prédicats à seuil
**unique** (1 occurrence suffit), et `checkGroupAchievements` est
appelée **inconditionnellement à chaque `markSessionDone`** — la soirée
qui vient de passer `DONE` est donc *toujours* encore vivante au moment
de **son propre check** (la purge exige 7 jours d'ancienneté minimum,
largement après ce premier passage). Une fois débloqué, `unlockedAt` ne
revient jamais à `null` — la purge d'une soirée plus ancienne ne peut
donc jamais "reverrouiller" un trophée déjà acquis. Démontré par test
(`« noctambules »/« full-house » restent corrects après purge`,
`retention.integration.test.ts`) plutôt qu'affirmé sans preuve : **aucun
nouveau schéma pour ces deux-là**.

Les 6 autres (premiere-soiree/marathoniens/century/diversite/squad/
reguliers) partagent une même cause : un **seuil cumulatif** qui doit
être observé en une seule lecture de `Session.findMany({status:"DONE"})`
— une lecture qui, une fois la purge active, ne voit plus jamais
l'historique complet.

### Correctif — réutilisation des agrégats durables déjà existants, un seul ajout minimal

4 des 6 prédicats affectés se réparent **sans le moindre nouveau
schéma**, en réutilisant des agrégats déjà introduits aux lots
précédents de ce chantier :

- **Première soirée / Marathoniens / Century** (`totalDone`) → lisent
  désormais `GroupSessionStats.totalSessionsPlayed` (déjà écrit par
  `markSessionDone`, jamais retouché par la purge).
- **Diversité** (`distinctGames`) → lit désormais
  `prisma.groupGameStat.count()` : une ligne `GroupGameStat` existe tant
  qu'un jeu a été décidé au moins une fois, **même si toutes ses soirées
  ont depuis été purgées** (elle n'est supprimée que si le `Game`
  lui-même l'était — jamais le cas dans ce chantier).
- **Squad** (`allParticipantIds`) → lit désormais
  `prisma.xpEvent.findMany({where:{reason:"PARTICIPATE"}, distinct:["userId"]})`.
  `XpEvent` `PARTICIPATE` est écrit pour **exactement la même population**
  que l'ancien calcul (voteurs de la proposition gagnante, à la clôture
  du vote dans `closeSession`, src/lib/sessions.ts) — sans FK vers
  `Session`, déjà à l'abri de toute purge, comme tous les `XpEvent`.

Seul **Réguliers** (4 semaines consécutives) n'avait **aucun** agrégat
durable existant capable de le remplacer : ni `GroupSessionStats`
(un entier global, pas de granularité hebdomadaire) ni `SessionResult`
(créé seulement si le créateur saisit les résultats — **optionnel**,
donc incomplet pour couvrir *toutes* les soirées DONE) ne suffisaient.
Seul nouvel ajout de schéma de ce lot :

```prisma
model GroupActiveWeek {
  weekStart DateTime @id // lundi 00:00 UTC de la semaine, même calcul que getWeekStart()
}
```

Une ligne PAR SEMAINE ayant eu ≥1 soirée DONE — jamais une ligne par
soirée, jamais un compteur incrémenté (upsert idempotent, `update: {}`
— seule l'existence de la semaine compte). Écrite dans **la même
transaction** que `GroupSessionStats`/`GroupGameStat`, au même point
unique (`markSessionDone`), donc soumise aux mêmes garanties
d'atomicité et de non-concurrence (voir « V2 (suite, 2) »).

### Aucune double attribution — mécanisme inchangé, revérifié

Le verrou existant (`groupAchievement.updateMany({where:{id, unlockedAt:null}, ...})`,
inchangé par ce lot) garantissait déjà qu'un trophée n'est jamais
débloqué/annoncé deux fois, y compris en cas d'appels concurrents à
`checkGroupAchievements` — revérifié explicitement par un nouveau test
de concurrence (deux appels `Promise.all` sur un trophée à un pas du
déblocage : un seul des deux l'obtient, une seule notification créée).
Un rappel séquentiel (ex. clôture d'une autre soirée juste après)
retourne `[]` et ne touche ni `unlockedAt` ni les notifications déjà
posées — testé explicitement.

### Tests ajoutés (`src/lib/retention.integration.test.ts`, describe « Trophées de groupe »)

Chaque test construit le scénario où l'**ancien** calcul (`doneSessions`
en direct) aurait échoué : les soirées contributrices sont purgées
**avant** que le trophée ne soit vérifié, jamais après — la preuve porte
sur la résilience à la purge, pas seulement sur un calcul en conditions
normales :

- **Marathoniens** : 9 soirées anciennes closes puis purgées, une 10ᵉ
  soirée récente ferme ensuite — débloqué (10 en durable), "Century"
  reste correctement verrouillé (10 < 100, même mécanisme partagé).
- **Diversité** : 9 jeux distincts joués puis purgés, un 10ᵉ jeu ferme
  ensuite — débloqué.
- **Squad** : 5 soirées d'autant de participants distincts, **toutes**
  purgées avant toute nouvelle vérification (aucune soirée vivante au
  moment du check) — débloqué via `XpEvent` seul.
- **Réguliers** : 3 premières semaines consécutives closes puis
  purgées, la 4ᵉ ferme ensuite — débloqué via `GroupActiveWeek` seul.
- **Noctambules/Full House** : débloqués à la clôture de LA soirée
  qualifiante, puis 3 AUTRES vieilles soirées purgées — état
  strictement identique avant/après (`toEqual`), ni reverrouillés ni
  redébloqués.
- **Idempotence séquentielle** : un rappel explicite ne redébloque rien,
  ne réécrit pas `unlockedAt`, ne crée pas de notification
  supplémentaire.
- **Concurrence** : deux appels `Promise.all` sur le même trophée
  prêt à se débloquer — un seul déblocage, une seule notification.

**Résultats mis à jour** : Postgres complet **663/663** (up de
656/656 — 7 nouveaux tests), rapide (hors Postgres) **402/402**
(inchangé, Postgres-only), `npx tsc --noEmit` / `npx eslint .` sans
erreur, `npx next build` réussi.

### Migration (`20260925090000_add_group_active_week`)

Additive : `CREATE TABLE "GroupActiveWeek"` + backfill des semaines déjà
représentées par les soirées DONE existantes, calculé en SQL avec la
**même arithmétique exacte** que `getWeekStart()` (jour ISO de la
semaine, UTC, aucune conversion de fuseau horaire) — vérifié
manuellement par comparaison (`2026-09-01` → lundi `2026-08-31` des deux
côtés) et **sans dérive** via `prisma migrate diff`. S'exécute avant
tout déploiement du code de purge, donc toutes les soirées DONE
existent encore à cet instant — même principe que les deux backfills
précédents (`UserLifetimeStats`, `GroupSessionStats`/`GroupGameStat`).

### Pas de nouvelle refonte, rien d'autre modifié

Aucun changement à `RETENTION_CLEANUP_ENABLED`/`RETENTION_CLEANUP_MODE`
(nettoyage désactivé par défaut, dry-run inchangé), aucune migration
appliquée ailleurs que sur la base Postgres de test locale isolée,
aucune donnée réelle modifiée, PR #107 reste en Draft. Aucun autre
prédicat/fichier retouché au-delà de `group-achievements.ts`/`sessions.ts`/
`prisma/schema.prisma` — en particulier, `Collectionneur collectif` et
`Légendaire` sont restés inchangés (jamais dépendants de `Session`,
rien à corriger).

## V2 — sessions spontanées « Jouer maintenant » 🎮

Nouveau parcours, distinct des soirées planifiées et de la roulette
instantanée : n'importe qui peut démarrer une session « on joue
maintenant » à durée bornée, que d'autres potes rejoignent librement
sans invitation préalable, avec une XP de participation réutilisant la
règle existante des soirées.

### Parcours

- Bouton « 🎮 Jouer maintenant » sur l'accueil (`src/app/page.tsx`) et
  entrée dans la navigation via un `ButtonLink` en tête de `/sessions`
  (`src/app/sessions/page.tsx`) — même emplacement que Roulette/Tournois,
  ni l'un ni l'autre n'étant dans la barre de navigation du bas (6
  icônes déjà occupées) : précédent réutilisé directement, pas une nouvelle
  exception.
- `/jouer-maintenant` — liste des sessions actives + formulaire de
  création (jeu + potes à prévenir, composants `TournamentGameField`/
  `NotifyRecipientsField` réutilisés tels quels).
- `/jouer-maintenant/[id]` — détail : jeu, créateur, participants,
  temps restant, actions rejoindre/quitter, outils créateur (changer de
  jeu, terminer). Actualisation 30 s si l'onglet est visible (même
  garde anti-boucles-concurrentes que le chat), countdown visuel
  recalculé chaque seconde depuis `expiresAt` (jamais une dérive locale
  qui ignore le serveur).

### Règles métier (`src/lib/instant-sessions.ts`)

- Durée max **3 h**, `expiresAt` posée une seule fois à la création,
  **jamais repoussée** par une jonction ou un changement de jeu.
- Le créateur devient participant **dans la même transaction** que la
  création.
- Un utilisateur ne peut être membre que **d'une seule** session
  instantanée active à la fois — garanti par un **index Postgres
  unique partiel**, pas seulement une vérification applicative :
  ```sql
  CREATE UNIQUE INDEX "InstantSessionPresenceInterval_userId_open_key"
    ON "InstantSessionPresenceInterval"("userId") WHERE "endedAt" IS NULL;
  ```
  (inexprimable dans le schéma Prisma — même situation déjà documentée
  pour d'autres contraintes partielles de ce dépôt.)
- N'importe qui peut rejoindre librement, à tout moment tant que la
  session est active — aucune notion d'invitation requise pour
  participer (l'invitation ne sert qu'à prévenir, jamais à autoriser).
- Le créateur ne peut pas « quitter » — seulement **terminer** la
  session (bouton avec confirmation explicite côté UI,
  `EndInstantSessionDialog.tsx`), ce qui la clôt pour tout le monde.
  Un autre participant peut quitter et revenir librement tant qu'elle
  reste active.
- Changer de jeu (créateur uniquement) ne touche **ni `expiresAt` ni
  les intervalles de présence** — seuls le jeu et les invitations déjà
  envoyées sont mis à jour.
- Le serveur fait autorité sur l'expiration : un règlement paresseux
  (`settleInstantSessionIfDue`) tourne avant toute jonction/changement
  de jeu, **et** un passage batch inconditionnel
  (`settleAllDueInstantSessions`) est greffé sur le cron existant
  `/api/cron/close-sessions` (déjà appelé toutes les 15 min en
  production, aucune nouvelle configuration externe requise) — une
  session expire donc même si personne ne rouvre jamais l'app.

### Présence conjointe et XP

- Éligible après **15 minutes cumulées** en présence d'**au moins un
  autre participant** — jamais une simple somme individuelle. Calcul
  par balayage (sweep-line) sur l'historique complet des intervalles
  arrivée/départ, testé unitairement sur les trois exemples exacts de
  la demande (20 min seul → 0 ; 10+5+5 → 15 min chacun ; 10 min à trois
  → 10 min chacun, jamais multiplié/divisé).
- Réutilise **exactement** la règle XP existante des soirées
  (`awardXp(userId, "PARTICIPATE", instantSessionId, XP_AMOUNTS.PARTICIPATE)`),
  gardée par la même contrainte unique `[userId, reason, sourceId]` sur
  `XpEvent` — idempotente par construction, aucun état séparé
  « déjà récompensée » à maintenir. `checkSessionsParticipatedBadges`
  est appelée (même définition, source-agnostique) ; le streak se
  met à jour via `touchStreak()`, déjà invoquée à chaque requête
  authentifiée — aucun nouveau code, aucun risque de double
  actualisation le même jour.
- **N'appelle jamais** `checkGroupAchievements()` ni ne touche
  `GroupSessionStats`/`GroupGameStat`/`GroupActiveWeek` : une session
  instantanée n'est pas une soirée planifiée, étendre silencieusement
  cette définition n'a jamais été demandé. Vérifié explicitement par
  test.
- La présence est **déclarée** (rejoindre/quitter dans l'app), jamais
  une mesure réelle du temps joué sur Steam — disclaimer affiché sur la
  page de détail. Fermer l'onglet ne compte jamais comme un départ
  automatique ; le règlement final à l'expiration (batch cron) couvre
  ce cas sans dépendre d'un navigateur ouvert.

### Invitations rapides (MP Discord + notification interne)

- Réutilise l'infrastructure de livraison existante
  (`NotificationEvent`/`NotificationDelivery`, exécuteur cron) — aucun
  appel Discord direct, aucun nouveau salon/fil.
- SEND à occurrence **fixe** (une fois par destinataire, jamais
  dupliqué même en cas de rappel) ; changement de jeu ou fin de session
  programment une **EDIT** du MP déjà envoyé, **jamais** un nouveau
  SEND — le résolveur relit toujours l'état courant au moment du
  traitement effectif, jamais un instantané figé à l'enqueue.
- Nouvelle catégorie de préférence dédiée `INSTANT_SESSION` (« Jouer
  maintenant »), activée par défaut sauf si l'utilisateur a
  `silenceReminders` (même migration de backfill que `TOURNAMENT`
  avant elle) — vérifiée **au traitement réel du SEND**, jamais à
  l'enqueue (une préférence désactivée après l'enqueue bloque bien
  l'envoi).
- Limite connue, assumée et documentée en commentaire de code : la
  **notification interne** (`Notification`, cloche du site) est écrite
  **une seule fois** à l'invitation initiale et n'est jamais éditée par
  la suite (aucun mécanisme de mise à jour n'existe nulle part ailleurs
  dans ce dépôt pour ce type de ligne) — seul le MP Discord bénéficie
  du SEND/EDIT complet. L'état à jour reste toujours consultable sur la
  page de la session elle-même.
- Nouveau flag dédié, sans configuration de salon/guilde (un MP ne
  cible qu'un utilisateur) :
  ```
  DISCORD_BOT_INSTANT_SESSION_INVITE_ENABLED=true
  ```
  Désactivé par défaut, comme tous les flags bot de ce dépôt.

### Accès

Authentification obligatoire pour tout le parcours. Le modèle
de frontière communautaire suit les Membership/communautés ACTIVE sous
`COMMUNITY_ISOLATION_ENABLED` (PR A/B). Les invitations rapides
préviennent uniquement, elles n'inscrivent jamais automatiquement qui
que ce soit à la session.

### Intégration au nettoyage réel du stockage (#107)

- Ajout de `instantSessionPurgeEligibility`/
  `purgeEligibleInstantSessionsBatch` dans `retention.ts`, avec un 7ᵉ
  volet dans `retention-runner.ts` — **même fenêtre de 7 jours** que le
  reste de la politique, appliquée sur `endedAt` (jamais `createdAt`/
  `expiresAt`), et **seulement** une fois la session `ENDED` (jamais
  une session active, quel que soit son âge).
- Par construction, une session `ENDED` a **toujours déjà** ses
  récompenses XP réglées avant que la fenêtre de purge ne puisse
  jamais s'appliquer (7 jours au plus tôt) — `endInstantSession` règle
  les récompenses immédiatement après le commit qui la termine.
- La purge cascade le journal de présence
  (`InstantSessionPresenceInterval`) mais **jamais** les `XpEvent`
  (pas de FK vers `InstantSession`, déjà à l'abri comme pour les
  soirées planifiées) — l'XP/le streak/les badges survivent
  intacts à la purge.
- Les MP Discord déjà envoyés ne sont **pas** supprimés du seul fait
  que les détails internes sont purgés — aucune suppression Discord
  n'a été ajoutée par ce lot (contrairement au chantier confidentialité
  des soirées, hors périmètre ici).
- Audit en lecture seule (`storage-audit.ts`, onglet Nettoyage) étendu
  avec le même échantillonnage borné que sessions/tournois.
- **Aucun changement** à `RETENTION_CLEANUP_ENABLED`/
  `RETENTION_CLEANUP_MODE` — nettoyage réel désactivé par défaut,
  dry-run inchangé, comme pour tous les lots précédents de ce chantier.

### Limites connues

- Pas de frontière multi-communauté (app mono-guilde par conception
  actuelle).
- Notification interne (cloche) jamais éditée après l'invitation
  initiale — seul le MP Discord reflète l'état courant en continu.
- Aucune récompense collective Discord, récapitulatif ou fonctionnalité
  multi-serveur pour ce type de session — chantiers suivants explicitement
  hors périmètre de ce lot.

### Tests

- **Unitaires** (`src/lib/instant-sessions.test.ts`) — `computeCoPresenceMs`
  pure, reproduisant exactement les 3 exemples de la demande + cas
  limites (seuil pile 15 min, intervalle encore ouvert, intervalle
  dégénéré, aucun intervalle) ; `instantSessionPurgeEligibility` pure.
- **Intégration Postgres isolée + Discord simulé**
  (`src/lib/instant-sessions.integration.test.ts`, 33 tests) — règles
  métier (créateur/jonction/départ/fin/idempotence), présence conjointe
  et XP (seuil, non-effet de bord sur les trophées de groupe, badges,
  passage de minuit, expiration sans navigateur ouvert), concurrence
  (créations/jonctions simultanées, jonction vs fin, expiration
  paresseuse vs mutation, changement de jeu vs invitation en attente,
  règlements concurrents), invitations rapides (SEND unique, préférence
  déclinée, EDIT sur changement/fin, invitation périmée bloquée),
  rétention (dry-run, session active jamais purgée, purge réelle avec
  cascade, reprise bornée).
- **Résultats** : Postgres complet **710/710** (49 fichiers, +47 tests
  vs. avant ce lot), rapide (hors Postgres) **416/416** (292 sautés,
  Postgres-only), `npx tsc --noEmit` / `npx eslint .` sans erreur,
  `npx next build` réussi (`/jouer-maintenant` et `/jouer-maintenant/[id]`
  bien générées).
- **Non testé manuellement** (honnêteté explicite) : parcours UI réel
  dans un navigateur (création, polling visuel, dialogue de
  confirmation, réception effective d'un MP Discord) — seule la
  logique serveur/DB/Discord simulé a été vérifiée par ce lot.

### Procédure de test manuel courte (à faire avant tout déploiement réel)

1. `DISCORD_BOT_INSTANT_SESSION_INVITE_ENABLED=true` en local/preview.
2. Créer une session sur `/jouer-maintenant` avec un jeu + un pote à
   prévenir → vérifier le MP Discord reçu et la notification interne.
3. Rejoindre avec un second compte, vérifier le countdown et le
   polling 30 s (couper/rallumer l'onglet).
4. Changer de jeu (créateur) → vérifier que le MP existant est
   **édité**, jamais un nouveau MP.
5. Quitter avec le second compte puis revenir → vérifier que la
   session reste active et le temps déjà passé conservé.
6. Terminer la session (créateur, avec confirmation) → vérifier le
   badge "Terminée", le MP mis à jour, et (si ≥15 min conjointes
   simulées) l'XP effectivement créditée.

### Migrations

Additives, appliquées et vérifiées **sans dérive** via
`prisma migrate diff` sur la base de test locale isolée uniquement —
**aucune migration distante appliquée** :

- `20260926090000_add_instant_sessions` — tables `InstantSession`/
  `InstantSessionPresenceInterval` + l'index unique partiel ci-dessus.
- `20260926090001_add_instant_session_notification_category` —
  `ALTER TYPE "UserNotificationCategory" ADD VALUE 'INSTANT_SESSION'`
  (migration séparée du backfill suivant — restriction Postgres sur les
  valeurs d'enum ajoutées dans la même transaction qu'un usage).
- `20260926090002_backfill_instant_session_notification_preferences` —
  backfill des préférences existantes (activée sauf `silenceReminders`).
- `20260926090003_add_instant_session_invite_notification_type` —
  `ALTER TYPE "NotificationType" ADD VALUE 'INSTANT_SESSION_INVITE'`.

### Rien d'autre modifié

Aucun changement aux réglages de rétention/nettoyage, aucune action
Discord réelle, aucune migration distante, aucun merge — PR ouverte en
**Draft**.

## Fix bug remonté : rappels de rattrapage tardifs (rafale + contenu mensonger)

Bug remonté en usage réel : une soirée décidée/validée tard (proposition
choisie tout près de l'heure de la soirée) faisait partir les 4 rappels
configurés (ex. 12h/2h/45min/30min) **tous à la même minute**, chacun
affichant son propre libellé figé — y compris "dans 12h !" pour une
soirée qui commençait en réalité dans 20 minutes. Une première
correction (spike, jamais mergée) avait simplement étalé les rattrapages
sur plusieurs passages du cron — insuffisante : un seuil ancien pouvait
encore partir avec son libellé d'origine mensonger avant d'être atteint
par le rattrapage suivant. Cette version corrige le contenu à la racine,
pas seulement le rythme d'envoi.

### Comportement exact (`src/lib/reminders.ts::computeTimingsDue`)

- **Au premier passage tardif** (plusieurs seuils dus en même temps) :
  au maximum **un seul** rappel est traité, avec le **temps réellement
  restant** (calculé à cet instant), jamais le libellé du seuil
  configuré. C'est le seuil le **plus proche de l'échéance** parmi ceux
  dus qui est choisi (le plus actionnable), pas le plus ancien.
- **Les seuils plus anciens que lui** (dépassés par le même retard) sont
  marqués résolus **sans être envoyés** — ils ne repartiront jamais
  ensuite avec un contenu obsolète.
- **Les rappels futurs continuent normalement** : un seuil pas encore dû
  reste intact et partira à son propre passage, avec le temps restant
  réel à ce moment (qui coïncide alors avec le seuil, cas courant
  inchangé).
- **Après le début de la soirée**, plus aucun rappel n'est envoyé — ni un
  message isolé, ni un flush groupé (l'ancienne version de ce fix en
  avait un ; il a été retiré, un compte à rebours n'a plus aucun sens
  une fois la soirée commencée).

Exemple exact (seuils 720/120/45/30 min) :

| Passage | Temps restant réel | Résultat |
|---|---|---|
| 1 | 40 min | 1 rappel envoyé — **« dans 40 min »** (jamais « 45 min », « 2h » ou « 12h ») ; 720/120/45 marqués dépassés |
| 2 | 39 min | rien (30 pas encore dû, le reste déjà résolu) |
| 3 | 30 min | rappel normal — « dans 30 min » |
| 4 (après le début) | négatif | rien — aucun compte à rebours pour une soirée déjà en cours |

### Contenu recalculé au TRAITEMENT réel, jamais figé à l'enqueue

Le chemin **bot** (`enqueueSessionReminderDelivery`/`resolveThreadReminder`,
`session-announce.ts`) passe par une file asynchrone
(`NotificationDelivery`) — le traitement réel peut avoir lieu plus tard
que l'enqueue si l'exécuteur a lui-même du retard. `resolveThreadReminder`
ne dérive donc **plus jamais** son libellé du seuil configuré : il
recalcule le temps réellement restant (`wallClockNow()`) **au moment du
traitement effectif**, et refuse purement et simplement l'envoi
(`expired`) si la soirée a depuis commencé — qu'il s'agisse d'une
livraison enqueue-ée avant ce fix ou de la seule désormais enqueue-able
par passage. Aucun message n'est jamais posté pour une soirée déjà en
cours, quel que soit le seuil d'origine de la livraison en file.

Le chemin **webhook legacy** (`sendSessionReminder`, `discord-reminder.ts`,
qui n'écrit plus que la notification interne — voir "Chantier
confidentialité des soirées") est appelé de façon **synchrone**, dans le
même passage que le calcul — le temps réel restant lui est transmis
directement par l'appelant, sans recalcul supplémentaire nécessaire.

### Mécanismes réutilisés, aucune nouvelle refonte

- `Session.remindersSent` (`String[]`, inchangé) reste l'unique état
  persisté — les seuils "consommés sans envoi" y sont ajoutés
  **inconditionnellement** (`applyReminderResults`, nouveau 3ᵉ paramètre
  `staleToMark`), les seuils réellement envoyés seulement après succès
  confirmé (comportement inchangé, anti-doublon préexistant).
- `formatReminderTimingShort` (`reminder-timings.ts`, préexistant,
  générique) est réutilisé tel quel pour formatter le temps réel restant
  — aucune nouvelle fonction de formatage.
- Verrou `CronLock` (protection contre deux exécutions concurrentes du
  cron), idempotence du `targetSlot` d'enqueue (`thread-reminder-<n>`,
  occurrence fixe), préférences de notification et filtrage aux invités
  actifs (`filterByActiveSessionInvite`) : **tous inchangés**, aucun
  nouveau mécanisme de concurrence/déduplication introduit par ce fix.

### Limites connues (documentées, pas contournées)

- Si le retard dépasse la fenêtre restante (ex. session décidée à
  35 min de son heure avec un cron toutes les 15 min et un gros
  rattrapage), un ou plusieurs des seuils les plus anciens peuvent
  malgré tout ne **jamais** être tentés — la route cron filtre déjà les
  soirées sur `date > now`, donc une fois la soirée commencée, plus
  aucun passage ne la revoit. C'est un compromis assumé : mieux vaut ne
  jamais tenter un rappel devenu sans objet que d'en envoyer un
  mensonger ou d'en retarder un pertinent.
- Le rythme réel d'étalement dépend de la fréquence du cron externe
  (15 min, inchangée par ce fix, voir README section F7).

### Tests (`reminders.test.ts` + `session-announce.integration.test.ts`)

- **Unitaires, horloge contrôlée** (`reminders.test.ts`) : cas courant
  (seuils un par un, DST, minuit — inchangés), rattrapage (premier
  passage tardif avec temps réel affiché, seuils plus anciens marqués
  dépassés, passage suivant sans rien, passage normal au dernier seuil,
  enchaînement complet des 4 passages de l'exemple), soirée déjà
  commencée (aucun envoi, aucun flush groupé, y compris pile à
  `minutesUntil === 0`), passages concurrents (deux lectures avec le
  même `remindersSent` renvoient exactement le même résultat — la
  convergence réelle vient de l'idempotence de l'enqueue, revérifiée),
  `applyReminderResults` avec seuils obsolètes marqués sans envoi.
- **Intégration Postgres isolée + Discord simulé, horloge système
  contrôlée** (`session-announce.integration.test.ts`) : un rappel
  enqueue-é avec du temps restant mais résolu APRÈS le début de la
  soirée est refusé sans aucun appel réseau ; un rappel enqueue-é sous
  un vieux seuil (12h) mais traité alors qu'il ne reste réellement que
  10 minutes affiche bien "10 min" dans le message posté, jamais "12h".
- **Résultats** : Postgres complet **677/677**, rapide (hors Postgres)
  **414/414**, `npx tsc --noEmit` / `npx eslint .` sans erreur,
  `npx next build` réussi.

### Rien d'autre modifié

Branche dédiée (`claude/gamenight-fix-reminders-burst`), indépendante de
la PR #108 (V2 "Jouer maintenant", non touchée). Aucun changement aux
réglages de rétention, aucun envoi Discord réel, aucune migration
(schéma inchangé), aucun merge — PR ouverte en **Draft**.

## V2 — Nettoyage automatique des fils Discord (soirées et tournois)

Les fils « Soirée — <id> » et « Tournoi — <id> » restaient actifs après la
fin de l'événement. Règle désormais appliquée
(`src/lib/discord-thread-cleanup.ts`) :

1. **Fin de l'événement** (soirée `DONE`/`CANCELLED`, tournoi `DONE`/`CANCELLED`)
   → au passage cron suivant, le fil est **archivé et verrouillé**
   (plus personne n'y écrit).
2. **24 h après cet archivage** (horodatage réel `sentAt` de la livraison)
   → le fil est **supprimé définitivement**, avec ses messages.

Une soirée ou un tournoi **supprimé** garde son chemin existant (suppression
immédiate du fil). Annuler un tournoi verrouille désormais aussi le fil
(`thread-close`, `locked: true`).

### Garanties

- **Jamais un fil encore utile** : les résolveurs relisent le statut au
  moment du traitement. Une soirée/un tournoi encore actif (ou redevenu
  actif) fait refuser l'archivage comme la suppression, même si une
  intention existe déjà (`resolver:expired`, aucun appel Discord).
- **Jamais de verrouillage prématuré** : l'archivage attend
  (`dependency_not_ready`) tant qu'une autre livraison de l'événement
  (résumé, rappel, ajout de membre…) doit encore passer par le fil.
- **Relançable** : occurrences fixes (un passage répété ou concurrent
  retombe sur la même livraison) ; un fil déjà absent (404) à l'archivage
  ou à la suppression compte comme l'objectif atteint.
- **Traçable** : chaque étape est une ligne `NotificationDelivery`
  (`thread-archive`/`thread-close` puis `thread-delete`). Un archivage en
  échec terminal (ex. 403, permission manquante) bloque la suppression et
  apparaît dans `archiveFailed` du rapport + un log `warn`.
- **Aucun appel Discord dans la route** : elle n'enqueue que des
  intentions, traitées par `/api/cron/notification-executor` (retries,
  `retry_after` des 429, budget de bail).

### Activation (non faite par cette PR)

1. **Permission Discord** : accorder au bot `Gérer les fils`
   (`MANAGE_THREADS`) sur #🎮-soirées et #🏆-tournois uniquement (jamais
   `Administrateur`). Doc Discord : verrouiller (`locked`) et supprimer un
   fil exigent tous deux cette permission.
2. **Variables Vercel** : `DISCORD_THREAD_CLEANUP_ENABLED=true`, laisser
   `DISCORD_THREAD_CLEANUP_MODE` vide pour observer d'abord le rapport en
   dry-run, puis `execute`.
3. **Cron externe** (cron-job.org, même compte que les autres) :
   `GET /api/cron/discord-thread-cleanup` toutes les 15 min, en-tête
   `Authorization: Bearer <CRON_SECRET>`. Le cron `notification-executor`
   doit lui aussi tourner.

### Archivage immédiat à la fin (drapeau optionnel)

Sans rien d'autre, le fil est archivé au passage cron **suivant** la fin
(au plus ~15 min). Le drapeau **`DISCORD_THREAD_CLOSE_ON_END_ENABLED=true`**
(éteint par défaut, exactement `true`) programme l'archivage **dès** que la
soirée passe `DONE`/`CANCELLED` ou que le tournoi passe `DONE`
(`src/lib/thread-close-on-end.ts`). C'est la même décision que le cron
(`decideThreadCleanup`), prise plus tôt, et rien d'autre ne change :

- le drapeau ne fait **rien tout seul** : il exige aussi
  `DISCORD_THREAD_CLEANUP_ENABLED=true` et `DISCORD_THREAD_CLEANUP_MODE=execute`
  (en dry-run ou nettoyage éteint, aucun fil n'est touché) ;
- **jamais sans fil réellement créé** : l'archivage serait sinon refusé
  définitivement ; le cron rattrape ce cas plus tard ;
- appelé **après** le commit de la clôture : une panne est journalisée
  (`thread-close-on-end`), jamais remontée à la clôture, et le cron reste le
  filet de sécurité ;
- la **suppression à 24 h**, les réessais, les échecs Discord (fil déjà
  supprimé 404 / code 10003, permission manquante 403) et l'idempotence sont
  ceux du chemin existant. L'annulation d'un tournoi archivait déjà
  immédiatement le fil (inchangé) ; la suppression manuelle d'une soirée ou
  d'un tournoi garde son chemin propre.

Au premier passage en `execute`, toutes les soirées/tournois déjà terminés
avec un fil bot sont archivés ; leur suppression suit 24 h plus tard (les
tournois annulés avant cette PR, déjà archivés, sont supprimés dès le
passage suivant). Les anciens fils de l'époque webhook, sans identifiant
persisté, ne sont jamais touchés (aucune recherche par nom).

## V2 — MP des soirées (annonce, mise à jour, rappels)

> Aligné sur les règles de ping de la PR #116 (sources : `src/lib/session-announce.ts`,
> `buildMessageContent` l. 1179-1239, `enqueueSessionAnnounceUpdate` l. 463,
> `enqueueSessionDirectMessageEdits` l. 494). Les versions antérieures de cette
> section (« la mention est retirée du fil ») sont périmées.

Avec `DISCORD_DM_SESSION_ENABLED=true` (désactivé par défaut), une soirée
bot prévient chaque pote concerné **en message privé EN PLUS de la mention
dans le fil** (double ping) :

| Événement | MP | Fil de la soirée |
| :-- | :-- | :-- |
| Création | « 📣 Nouvelle soirée » + embed (`dm:announce`) | annonce **avec mention** des invités éligibles |
| Changement de date | **nouveau** MP « 📅 Date modifiée » (`dm:date:<id>`), seulement aux potes déjà prévenus par le MP d'invitation | message « 📅 Date modifiée » **avec mention** ; annonce éditée |
| « Soirée validée » (vote clos, jeu retenu) | **nouveau** MP « 🎮 Soirée validée : {jeu} » (`dm:validated`) | message « Soirée validée » **avec mention** des joueurs du jeu retenu |
| Rappel | **nouveau** MP « ⏰ Rappel — dans … » (`dm:reminder:<min>`) | message de rappel **avec mention** |
| Modification de la soirée | le MP d'invitation déjà envoyé est **édité** (statut courant) — **jamais de nouveau MP** | annonce **éditée** (une édition ne notifie personne) |
| Fin de soirée (terminée / annulée) | le MP d'invitation est **édité** (« ✅ Soirée terminée » / « ❌ Soirée annulée »), aucun nouveau MP | annonce éditée + résumé dans le fil à la clôture (sans mention) |

Les destinataires sont exactement ceux qui sont mentionnés
(`resolveEligibleMentions` : sélection du créateur, invitation active,
préférence `SESSION`/`ROULETTE`), **relus juste avant l'envoi** : une
préférence désactivée, une invitation retirée, une soirée annulée ou
commencée entre-temps empêche le MP (échec traçable `resolver:*`).

- **Le créateur reçoit aussi les MP** (création, changement de date,
  « Soirée validée », rappels, et l'édition du MP d'invitation), comme les
  invités, même s'il n'est ni invité ni dans la sélection ; seule sa
  préférence `SESSION` (`ROULETTE` pour une soirée issue d'une roulette)
  s'applique, relue avant l'envoi (`resolveCreatorDmRecipient`, l. 267).
  **Il n'est jamais mentionné dans le fil**, sauf en secours si son MP est
  fermé (voir ci-dessous).
- **Double ping** : la mention d'un invité dans le fil est **conservée** quand
  son MP est mis en file (`buildMessageContent`, l. 1211 : « TOUS les invités
  éligibles restent mentionnés, MP ou non »).
- **Modification ou fin = édition, pas de nouvelle notification** : un EDIT sur le
  même `targetSlot` que le SEND d'origine, uniquement pour les potes dont le MP
  `announce` est `SENT` ; un MP jamais envoyé, fermé ou encore en attente est
  ignoré. L'ancien type `update:<event>` n'est plus mis en file ; ses lignes
  déjà en file sont abandonnées (`expired`).
- **Pas de doublon** : un `targetSlot` par `[soirée, type, pote]`
  (`…:dm:announce|date:<event>|validated|reminder:<minutes>:<userId>`) ; un retry
  retombe sur la même livraison.
- **MP fermé** (code Discord `50007`, classé `discord:dm_unavailable`,
  non retentable) : la livraison passe en `FAILED` avec cette classe
  d'erreur et aucune nouvelle tentative de MP n'est faite. Une **mention de
  secours** (`…:dm-fallback:…`) n'est postée dans le fil que pour le
  **créateur** (dans la même transaction que l'échec,
  `DeliveryResolver.onTerminalDiscordFailure`, `enqueueDirectMessageFallback`
  l. 293) : les invités sont déjà mentionnés dans le fil, un secours serait un
  second ping. Les autres échecs terminaux (permission, etc.) sont tracés sans
  mention de secours.
- **Rate limits** : les MP passent par l'exécuteur existant (un envoi à la
  fois, `retry_after` respecté). La doc Discord déconseille l'ouverture
  massive de MP (« create DM ») et compte les 403 dans la limite de
  10 000 requêtes invalides / 10 min : d'où l'absence de retry sur un MP
  fermé.

Le cron `notification-executor` doit tourner.

## V2 — MP des tournois et de la roulette

Même modèle que les MP des soirées (`DISCORD_DM_SESSION_ENABLED`), avec deux
interrupteurs **séparés**, éteints par défaut : `DISCORD_DM_TOURNAMENT_ENABLED`
et `DISCORD_DM_ROULETTE_ENABLED` (exactement `true`). Ils ne gouvernent que la
création de nouveaux MP : ceux déjà en file sont toujours traités.

### Tournois
| Événement | MP | Salon / fil |
| :-- | :-- | :-- |
| Ouverture des inscriptions (tournoi bot) | « 🏆 Tournoi … — inscriptions ouvertes » + embed, à chaque pote sélectionné **et au créateur** | annonce du salon **sans mention** ; message `thread-invite` **dans le fil** avec mention des joueurs sélectionnés (créateur jamais mentionné) |
| Lancement, clôture, annulation | le MP d'invitation déjà envoyé est **édité** (statut courant), aucun nouveau MP | annonce du salon éditée, sans mention |
| Arrivée / départ d'un joueur | — | aucun ping |

- Préférence `TOURNAMENT` relue avant l'envoi ; un pote doit toujours figurer
  dans la sélection du créateur (le créateur n'est soumis qu'à sa préférence).
  Le MP d'ouverture n'est envoyé que tant que le tournoi est en `REGISTRATION` :
  lancé/annulé/supprimé entre-temps → MP refusé (`resolver:expired`). L'édition,
  elle, s'applique à tout état.
- **Double ping** : le seul message qui mentionne quelqu'un est `thread-invite`
  (dans le fil) ; la mention d'un joueur y est conservée même si son MP est mis
  en file (`tournament-announce.ts`, en-tête l. 95-118 et l. 1074-1114).
- **MP fermé** (`discord:dm_unavailable`, jamais retenté) : échec tracé en
  `FAILED`. **Mention de secours dans le fil du tournoi pour le créateur
  seulement** (les joueurs sont déjà mentionnés), même transaction que
  l'échec, via `DeliveryResolver.onTerminalDiscordFailure`. Les autres échecs
  terminaux (permission…) sont tracés sans mention de secours.

### Roulette
| Événement | MP |
| :-- | :-- |
| Création | « 🎰 Roulette du gambling » — participants **et créateur** |
| Rappel (deadline − 1 h) | « ⏰ … dernier rappel » — seulement ceux qui n'ont pas proposé leurs 2 jeux (créateur inclus s'il en fait partie) ; ce MP est **conservé** |
| Fin (tirage ou annulation, moins de 2 participants) | le MP d'invitation déjà envoyé est **édité** (« 🎰 La roue a choisi : … » ou « Roulette annulée »), **aucun nouveau MP** de résultat (`enqueueRouletteDirectMessageEdits`, `roulette-dm.ts` l. 38) |

- **Jamais de mention** : une roulette n'a ni fil ni annonce publique (les
  annonces webhook sont supprimées pour confidentialité, voir
  `discord-roulette.ts`) ; tous les MP sont envoyés avec `allowedMentions: {parse: []}`.
- Préférence `ROULETTE` filtrée à la mise en file ET relue à l'envoi ; la roulette
  doit être `OPEN` (création), `OPEN` et deadline non dépassée (rappel) ; l'édition
  finale exige `DONE` avec sa soirée et le pote toujours invité (tirage). L'ancien
  kind `result` n'est plus mis en file ; ses lignes déjà en file sont abandonnées
  (`expired`).
- **Pas de mention de secours** : un MP fermé est seulement tracé, et le pote ne
  reçoit aucun autre MP de cette roulette (aucune nouvelle tentative).
- Nouvelle valeur d'enum `NotificationCategory.ROULETTE` (migration
  `20260930160000_add_roulette_notification_category`, purement additive) :
  le résolveur SESSION charge une `Session` par `sourceId`, ce qui ne
  convient pas à une roulette.

### Code
`src/lib/discord-dm.ts` (mise en file, exclusion des MP déjà fermés, édition des
MP déjà envoyés — mutualisés tournois/roulette), `src/lib/roulette-dm.ts`
(résolveur roulette), `tournament-announce.ts` (résolveurs `dm:`/`dm-fallback:`).
Les MP des soirées (`session-announce.ts`) gardent leur propre copie de ce
code ; les rapprocher est un refactor volontairement hors de cette PR.

## V2 — Phase 5 : crons longs (202 + `after()`)

`/api/backfill/seed-reconcile` et `/api/cron/steam-library-full-sync` dépassaient
les 30 s de cron-job.org (faux « Échec (délai d'attente) » alors que le travail
finissait côté Vercel). Les deux répondent désormais `202` immédiatement et
traitent dans `after()`, `maxDuration = 300` (Hobby + Fluid compute), budget
interne 240 s.

- **seed-reconcile** : voir sa section ci-dessus (réponse 202, plus de `results`).
- **steam-library-full-sync** : sélection du compte + `steamFullSyncAttemptedAt`
  synchrones, import dans `after()`. `importSteamLibrary(userId, steamId64, { deadlineMs })`
  s'arrête au budget et renvoie `partial` **sans** badges/wishlist/`steamLastSyncAt`
  (réservé au succès complet) ; sans option, comportement inchangé (bouton « Réimporter »,
  lien initial). Logs (`cron:steam-library-full-sync`) : `début userId=…` puis
  `fin stopReason=completed|time_budget userId=… jeux=n/total durée=<ms>` ; en cas d'erreur
  `logger.error` avec `stopReason: "error"`. Un `début` sans `fin` = coupure plateforme.
- **Sans migration, sans curseur, sans CronLock** (décision) : un passage `time_budget`
  repart de zéro au prochain tour du compte. Si les logs montrent des dépassements,
  prévoir une PR avec curseur + migration.
- Chevauchement : idempotence existante (uniques `XpEvent`/`UserBadge`/`UserGame`/`Game.steamAppId`).
  `unlockBadge` retourne avant l'annonce Discord sur violation unique → pas de double notification.
- Tests : `route.test.ts` des deux routes ; `src/lib/cron-longs.integration.test.ts`
  (Postgres isolé : deux passages = mêmes lignes qu'un seul, budget épuisé).

## V2 — Référence : variables d'environnement

Relevé par `process.env.*` sur tout `src/` (hors tests ; 32 variables). Les interrupteurs
sont **tous éteints par défaut** : actifs uniquement si la valeur vaut exactement `true`
(`RETENTION_CLEANUP_MODE` / `DISCORD_THREAD_CLEANUP_MODE` : `execute` exactement, sinon dry-run).
La colonne « présente dans `.env.example` » dit seulement si le nom y figure (les valeurs ne sont jamais lues).

### Interrupteurs et configuration Discord V2

| Variable | Rôle | Défaut | Lue dans |
| :-- | :-- | :-- | :-- |
| `NOTIFICATION_EXECUTOR_ENABLED` | Sans elle l'executor ne réclame ni n'envoie rien (`{enabled:false, processed:0}`) | éteint | `src/app/api/cron/notification-executor/route.ts:95` |
| `DISCORD_BOT_SESSION_ANNOUNCE_ENABLED` | Annonces de soirées via le bot (fil dédié) ; exige aussi `DISCORD_BOT_GUILD_ID` + `DISCORD_BOT_SESSION_CHANNEL_ID`, sinon repli webhook | éteint | `src/lib/discord-bot-config.ts:46` |
| `DISCORD_BOT_TOURNAMENT_ANNOUNCE_ENABLED` | Annonces de tournois via le bot ; exige aussi `DISCORD_BOT_GUILD_ID` + `DISCORD_BOT_TOURNAMENT_CHANNEL_ID` | éteint | `src/lib/discord-bot-config.ts:73`, `src/app/tournois/actions.ts:110` |
| `DISCORD_BOT_INSTANT_SESSION_INVITE_ENABLED` | Invitation « Jouer maintenant » par MP (aucun salon requis) | éteint | `src/lib/discord-bot-config.ts:86` |
| `DISCORD_DM_SESSION_ENABLED` | Création de nouveaux MP de soirée (les MP déjà en file sont traités) ; sans effet sans le chemin bot des soirées | éteint | `src/lib/discord-bot-config.ts:101` |
| `DISCORD_DM_TOURNAMENT_ENABLED` | Création de nouveaux MP de tournoi | éteint | `src/lib/discord-bot-config.ts:114` |
| `TOURNAMENT_SCORES_ENABLED` | Saisie facultative des scores de match, affichés dans le bracket seulement ; exige la migration `tournament_match_scores` | éteint | `src/lib/tournament-scores.ts` |
| `VOTE_VETO_ENABLED` | Veto au vote de jeu (1 par personne et par soirée) et au jeu tiré par la roulette asynchrone (relance) ; exige les migrations `add_session_veto` et `add_roulette_veto` | éteint | `src/lib/session-veto.ts` |
| `ROULETTE_PLAYER_FILTER_ENABLED` | Roulette : filtre « nombre de joueurs » (asynchrone et instantanée), repli sur tous les jeux si aucun ne convient ; aussi « Relancer » sans doublon et « Recommencer » (instantanée) | éteint | `src/lib/roulette-draw.ts` |
| `DISCORD_DM_ROULETTE_ENABLED` | Création de nouveaux MP de roulette | éteint | `src/lib/discord-bot-config.ts:124` |
| `DISCORD_THREAD_CLEANUP_ENABLED` | Active `/api/cron/discord-thread-cleanup` (sinon `{enabled:false, dryRun:true, report:null}`) | éteint | `src/app/api/cron/discord-thread-cleanup/route.ts:33` |
| `DISCORD_THREAD_CLEANUP_MODE` | `execute` = archive/supprime réellement les fils ; toute autre valeur = dry-run (rapport seul) | dry-run | `src/app/api/cron/discord-thread-cleanup/route.ts:37` |
| `DISCORD_THREAD_CLOSE_ON_END_ENABLED` | `true` = archive le fil dès la fin de la soirée/du tournoi au lieu d'attendre le cron ; sans effet si `DISCORD_THREAD_CLEANUP_ENABLED` n'est pas `true` et `DISCORD_THREAD_CLEANUP_MODE` n'est pas `execute` | éteint | `src/lib/thread-close-on-end.ts` |
| `RETENTION_CLEANUP_ENABLED` | Active `/api/cron/retention-cleanup` | éteint | `src/app/api/cron/retention-cleanup/route.ts:56` |
| `RETENTION_CLEANUP_MODE` | `execute` = purge réelle ; toute autre valeur = dry-run | dry-run | `src/app/api/cron/retention-cleanup/route.ts:61` |
| `DISCORD_BOT_GUILD_ID` | Serveur Discord unique de l'app (partagé soirées/tournois) | absent (⇒ chemin bot inactif) | `src/lib/discord-bot-config.ts:33`, `:65` |
| `AUTH_REQUIRE_GUILD_MEMBER` | Porte OAuth `guilds` : nouveau compte sans communauté ACTIVE autorisée refusé ; existants/admins exemptés de l'admission uniquement. Snapshot partiel/en erreur refusé sans révocation. | éteint | `src/auth.ts`, `src/lib/discord-user-guilds.ts`, `src/lib/community-oauth.ts` |
| `DISCORD_BOT_SESSION_CHANNEL_ID` | Salon des soirées | absent | `src/lib/discord-bot-config.ts:34` |
| `DISCORD_BOT_TOURNAMENT_CHANNEL_ID` | Salon des tournois | absent | `src/lib/discord-bot-config.ts:66` |
| `DISCORD_BOT_TOKEN` | Jeton du bot (REST : fils, MP, rafraîchissement de profils en repli) | absent (⇒ `null`, bot inutilisable) | `src/lib/discord-rest.ts:162`, `src/lib/discord-profile.ts:380` |

### Sécurité des crons

| Variable | Rôle | Défaut | Lue dans |
| :-- | :-- | :-- | :-- |
| `CRON_SECRET` | Jeton `Authorization: Bearer …` de toutes les routes `/api/cron/*` et `/api/backfill/*` ; **absent = 503** (fail-closed) | absent | `src/lib/cron-auth.ts:29`, `src/app/api/admin/force-relogin/route.ts:17` |

### Application, auth, intégrations

| Variable | Rôle | Défaut | Lue dans |
| :-- | :-- | :-- | :-- |
| `DATABASE_URL` | Connexion Postgres (Neon, adapter Prisma) | requise | `src/lib/prisma.ts:4` |
| `AUTH_SECRET` | Secret Auth.js | requise | non référencée dans `src/` (lue implicitement par Auth.js — non vérifié dans son code) |
| `AUTH_URL` | URL publique de base (liens dans les messages Discord, force-relogin) | `http://localhost:3000` | `src/lib/force-relogin.ts:33`, `src/lib/monthly-recap.ts:153`, `src/lib/session-announce.ts:1021`, `src/lib/tournament-announce.ts:588` |
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` | OAuth Discord (connexion, rafraîchissement des profils) | requises | `src/auth.ts:10-11`, `src/lib/discord-profile.ts:61-62` |
| `DISCORD_TOKEN_ENCRYPTION_KEY` | Clé de chiffrement des jetons OAuth persistés (Base64, 32 octets décodés) ; erreur contrôlée si absente/invalide | absent | `src/lib/discord-token-crypto.ts:28` (lue l. 46) |
| `DISCORD_WEBHOOK_URL` | Webhook historique (annonces hors chemin bot, rappels, recap mensuel) ; absent = dégradation propre | absent | `src/lib/discord.ts:60` |
| `ADMIN_DISCORD_IDS` | `discordId` des admins, séparés par des virgules | aucun admin | `src/lib/admin.ts:27` |
| `STEAM_API_KEY` | Import de bibliothèque / activité Steam | absent | `src/lib/steam.ts:88`, `:153` |
| `STEAM_NOW_PLAYING_ENABLED` | `true` = « 🟢 En jeu · X » sur `/potes` (un appel `GetPlayerSummaries` groupé par passage de `steam-library-sync`) ; sinon aucun appel, aucune écriture, aucun affichage | éteint | `src/lib/steam-now-playing.ts` |
| `IGDB_CLIENT_ID` / `IGDB_CLIENT_SECRET` | IGDB via Twitch (recherche, fiche jeu, backfill Coop) ; absentes = backfill sauté (log `warn`) | absentes | `src/lib/igdb.ts:13-14`, `src/lib/backfill-igdb-coop.ts:87` |
| `DEEPL_API_KEY` | Traduction FR des descriptions IGDB (optionnelle) | absente = description en VO | `src/lib/deepl.ts:17` |
| `BLOB_READ_WRITE_TOKEN` | Upload d'images de bannière (Vercel Blob) ; absent = upload désactivé | absent | `src/app/profil/actions.ts:194`, `src/app/profil/parametres/page.tsx:122` |

### Fournies par la plateforme (ne pas définir à la main)

| Variable | Rôle | Lue dans |
| :-- | :-- | :-- |
| `VERCEL_ENV`, `VERCEL_URL`, `VERCEL_PROJECT_PRODUCTION_URL` | Résolution de l'URL absolue des liens (prod → domaine de production, sinon URL du déploiement), via `src/lib/app-url.ts` | `src/app/tournois/actions.ts:150-152`, `src/lib/instant-session-announce.ts:208-210`, `src/lib/roulette-dm.ts:77-79` |
| `NODE_ENV` | Cache du client Prisma hors production | `src/lib/prisma.ts:12` |

**Pas des variables d'environnement** : `SEED_RECONCILE_TIME_BUDGET_MS` est une constante de code
(`export const … = 240_000`, `src/lib/seed-reconciliation.ts:42`) ; de même les budgets `TIME_BUDGET_MS`
(`backfill-igdb-coop.ts:53`, `backfill-steam-coop.ts:46`, `steam-library-sync/route.ts:46`) et
`FULL_SYNC_TIME_BUDGET_MS` (`steam-library-full-sync/route.ts:13`).
`TEST_DATABASE_URL` n'est lue que par les tests d'intégration et `scripts/test-postgres.mjs:3`.

**Présentes dans le code mais absentes de `.env.example`** (vérifié par comparaison des noms) :
`DISCORD_BOT_INSTANT_SESSION_INVITE_ENABLED`, `RETENTION_CLEANUP_ENABLED`, `RETENTION_CLEANUP_MODE`
(+ les variables plateforme `VERCEL_*` / `NODE_ENV`, normales). À l'inverse, `AUTH_SECRET` est dans
`.env.example` sans être référencée dans `src/`.

## V2 — Référence : routes cron et backfill

Relevé route par route (`src/app/api/cron/*`, `src/app/api/backfill/*`). Toutes exigent
`Authorization: Bearer <CRON_SECRET>` (`verifyCronRequest` : 503 sans secret, 401 si invalide).
« non déclaré » = pas d'`export const maxDuration` dans la route : c'est alors le défaut Vercel,
soit **300 s** sur Hobby avec Fluid compute (activé sur le projet ; doc Vercel « Duration limits »,
mise à jour le 2026-08-24 : défaut 300 s, maximum 300 s). Les 60 s / 45 s déclarés plus bas sont des
choix de route, pas le plafond du plan. Fréquences : celles réellement configurées sur cron-job.org. cron-job.org coupe à 30 s : les routes longues
répondent donc `202` et travaillent dans `after()`.

**Pause nocturne (budget Neon Free)** : tous les jobs cron-job.org sont réglés en `Europe/Paris` et ne tournent pas de 03:00 à 07:59 (heures 0, 1, 2 et 8 à 23), sur une grille de 15 min (:00, :15, :30, :45) pour qu'un même réveil serve plusieurs jobs. Les jobs quotidiens sont groupés avant 03:00 (02:00 à 02:45). Une soirée dont le vote se clôt ou qui commence dans la pause est traitée à 08:00 ; les envois déclenchés par une action (annonce, MP) partent immédiatement, hors cron. « Backfill IGDB Coop » (00:00 et 12:00) est inchangé.

| Route | Méthodes | `maxDuration` | Mode | Fréquence (cron-job.org) | Log à surveiller |
| :-- | :-- | :-- | :-- | :-- | :-- |
| `/api/cron/close-sessions` | GET | non déclaré (défaut 300 s) | synchrone | toutes les 15 min | `cron:close-sessions` (erreurs par tâche/session) |
| `/api/cron/reminders` | GET | 60 s | synchrone (verrou `CronLock`) | toutes les 15 min | `cron:reminders` (`Handler appelé`, `already_running`, échecs d'enqueue) |
| `/api/cron/notification-executor` | GET | 60 s | synchrone (batch ≤ 25 livraisons / 50 s) | toutes les 15 min (filet : l'envoi courant part par événement, `after()`) | `cron:notification-executor` (`Batch terminé.` + résumé) ; `{enabled:false}` si éteint |
| `/api/cron/discord-thread-cleanup` | GET | 60 s | synchrone | toutes les 15 min | `cron:discord-thread-cleanup` (`Passage terminé.`, `archiveFailed`) |
| `/api/cron/retention-cleanup` | GET | 60 s | synchrone (verrou `CronLock`) | aucun job cron-job.org configuré à ce jour | `cron:retention-cleanup` (`Passage terminé.`) |
| `/api/cron/steam-library-sync` | GET | 45 s (budget interne 25 s) | synchrone | toutes les 15 min | `cron:steam-library-sync` |
| `/api/cron/steam-library-full-sync` | GET, POST | 300 s (budget 240 s) | **202 + `after()`** | toutes les 2 h (0, 2, 8, 10 … 22 h) | `cron:steam-library-full-sync` : `début userId=…` puis `fin stopReason=completed\|time_budget\|error` ; un `début` sans `fin` = coupure plateforme |
| `/api/cron/monthly-tasks` | GET | non déclaré (défaut 300 s) | synchrone | quotidien à 02:45 | `cron:monthly-tasks` |
| `/api/cron/refresh-discord-profiles` | GET | non déclaré (défaut 300 s) | synchrone | toutes les heures | `cron:refresh-discord-profiles` |
| `/api/cron/community-guild-sync` | GET | non déclaré (défaut 300 s ; budget Discord 20 s) | synchrone | quotidien (à configurer sur cron-job.org) | `cron:community-guild-sync` (`Passage terminé.` + résumé) ; `{enabled:false}` si éteint |
| `/api/backfill/seed-reconcile` | GET, POST | 300 s (budget 240 s) | **202 + `after()`** | quotidien à 02:30 | `seed-reconcile` : `fin stopReason=completed\|time_budget\|error` (`warn` si `time_budget`) |
| `/api/backfill/igdb-coop` | GET, POST | 300 s (budget 240 s) | **202 + `after()`** | 00:00 et 12:00 | `igdb-coop` (`Processing n/N`, `stopReason`) |
| `/api/backfill/steam-store` | POST | 60 s (budget 50 s) | **202 + `after()`** | quotidien à 02:00 | `steam-store` (`Processing n/N`) |
| `/api/backfill/game-news` | POST | 60 s | **202 + `after()`** | quotidien à 02:15 | `game-news` |

Le tableau « I5 » plus haut (« Tableau récapitulatif des crons ») date d'avant la V2 : celui-ci fait foi.

**Executor de notifications par événement** (budget Neon Free) : quand `NOTIFICATION_EXECUTOR_ENABLED=true`, toute écriture de livraison (`enqueueDelivery`, lot d'invitations de `enqueueSessionInviteSyncForNewInvites`) planifie un passage de `runExecutorBatch` juste après la réponse de la requête en cours (`after()`, `src/lib/notification-executor-kick.ts`, owner `event:<uuid>`). Une seule demande en attente par instance ; l'indicateur est levé au début du passage, une livraison écrite pendant qu'il tourne en obtient un nouveau (l'executor est sûr en concurrence : bail, `FOR UPDATE SKIP LOCKED`). Meilleur effort : un échec est journalisé (`executor-kick`) et ne casse jamais la mutation métier ; hors requête (script, test), `after()` jette, c'est journalisé en info. Le cron `/api/cron/notification-executor` reste le **filet de sécurité** : retries (backoff 1 à 30 min, arrondis au passage suivant), éditions différées derrière un envoi non terminé (2 min), kick perdu. Sa fréquence cron-job.org passe de 1 min à 15 min avec le plan Neon S2 ; mettre ce tableau à jour à ce moment-là. Les gains XP « récompense » gardent leur envoi immédiat dédié (`attemptDefaultRewardDelivery`).

**Sonde de santé** : `GET /api/health` (`Authorization: Bearer <CRON_SECRET>`, mêmes codes que les crons : 503 sans `CRON_SECRET`, 401 si mauvais en-tête) répond `200 {"ok":true,"db":"ok"}` si la base répond à un `SELECT 1`, `503 {"ok":false,"db":"error"}` sinon. À brancher sur un monitoring externe (alerte si non-200) ; aucune donnée métier ni secret dans la réponse. Aucun cron n'est configuré par le dépôt.

## Guide : sections « Jouer maintenant » et tournois (drapeau `GUIDE_V2_ENABLED`)

`/guide` ajoute deux sections (`src/lib/guide-sections.ts`) uniquement si `GUIDE_V2_ENABLED` vaut exactement `true` (éteint par défaut, lu à chaque requête). Texte seul, aucune donnée.

## Titres de page (drapeau `PAGE_TITLES_ENABLED`)

Chaque page (sauf l'accueil) déclare un titre d'onglet via `pageMetadata("…")` (`src/lib/page-title.ts`), affiché `<Titre> · GameNight` (gabarit du layout racine). **Éteint par défaut** : actif uniquement si `PAGE_TITLES_ENABLED` vaut exactement `true` ; sinon les pages n'exportent aucun titre et gardent « GameNight ». La valeur est lue au build pour les pages statiques et à la requête pour les pages dynamiques : après un changement, redéployer. Pour les pages avec identifiant (`/sessions/[id]`, `/jeux/[id]`…) le titre est générique (pas de nom de soirée ou de jeu).

**Titres dynamiques** (drapeau supplémentaire `PAGE_TITLES_DYNAMIC_ENABLED`, éteint par défaut, exige aussi `PAGE_TITLES_ENABLED`) : `/jeux/[id]` affiche le nom du jeu et `/potes/[id]` le pseudo du pote (`dynamicPageMetadata`, `src/lib/dynamic-page-title.ts`), seulement pour une session valide (sinon titre générique, aucune requête de nom) ; nom tronqué à 80 caractères. Une requête `select` d'une seule colonne en plus par chargement de ces deux pages, uniquement drapeau activé. Pas de titre dynamique pour les soirées, tournois et roulettes (accès restreints aux invités : le nom ne doit pas fuiter dans l'onglet).

## Indicateur « 🟢 En jeu » sur /potes (drapeau `STEAM_NOW_PLAYING_ENABLED`)

Demande de Yuichiro. **Éteint par défaut** : sans la variable, aucun appel
Steam de plus, aucune écriture, aucun changement à l'écran.

**Pourquoi un appel de plus** : l'activité déjà récupérée (`GetOwnedGames`,
`GetRecentlyPlayedGames`) décrit un passé (minutes jouées sur 2 semaines,
aucun horodatage fiable en production) ; le libellé « Joue à » avait déjà
été retiré une fois parce qu'il prétendait à tort une activité en cours. Seul
`ISteamUser/GetPlayerSummaries` (champ `gameextrainfo`, présent pendant une
partie) donne l'état courant.

| Élément | Détail |
| :-- | :-- |
| Données | `User.steamNowPlaying` (nom du jeu) et `User.steamNowPlayingSeenAt` (horodatage réel de la dernière observation « en jeu »), nullables — migration additive `20261003120000_add_steam_now_playing` |
| Rafraîchissement | `refreshSteamNowPlaying` (`src/lib/steam-now-playing.ts`), appelé par `/api/cron/steam-library-sync` **en parallèle** des lots d'activité : un seul appel pour tous les comptes liés (100 par lot), donc ~720 appels/jour à la cadence de 2 min, très en deçà des quotas Steam ; le pire cas de durée de la route ne change pas |
| Écriture | en jeu → nom + horodatage ; appel réussi mais pas en jeu → `null` ; échec Steam → **rien n'est écrit** ; compte absent de la réponse → inchangé |
| Affichage | `/potes` : pastille violette « En jeu · X » (`NowPlayingBadge`) à la place de la ligne « A joué récemment », **seulement** si l'observation a moins de 10 min (`NOW_PLAYING_FRESH_MS`) : un cron arrêté éteint l'indicateur tout seul |
| Limite | Steam ne renvoie le jeu en cours que si les « Détails du jeu » du profil sont publics ; un compte privé n'apparaît jamais « en jeu » |

Activation : (1) merger la migration (`prisma migrate deploy` au build) ;
(2) poser `STEAM_NOW_PLAYING_ENABLED=true` ; (3) le cron `steam-library-sync`
(déjà en place, toutes les ~2 min) fait le reste. La réponse de la route
contient `nowPlaying: { enabled, checked, playing, error }`, et un log
`en jeu maintenant — …` à chaque passage quand le drapeau est actif.

## Reporté après V2

Hors périmètre de la V2, volontairement. Les colonnes « pourquoi » et « ce que ça demanderait » sont
des estimations tirées de l'état actuel du code, pas des décisions déjà documentées ailleurs dans le repo
(seul le suivi par curseur y est mentionné : `seed-reconcile` et Phase 5 ci-dessus).

| Item | Pourquoi reporté | Ce que ça demanderait |
| :-- | :-- | :-- |
| Récaps et récompenses Discord | Le recap mensuel existe déjà, via le webhook (`src/lib/monthly-recap.ts:3`, `postToDiscord`) ; la V2 s'est concentrée sur le chemin bot (fils, MP, nettoyage, « Jouer maintenant ») | Porter recap/récompenses sur le chemin bot (nouvelle catégorie `NotificationCategory` → migration additive, résolveur dans l'executor, interrupteur dédié) |
| Multi-serveur Discord | Infrastructure et isolation PR A/B acquises, login OAuth paginé, destinations en base ; flags production OFF | [Rollout](docs/COMMUNITY_ROLLOUT.md), contrôles Discord réels et essai limité The Tower avant ouverture. Le préfixe technique historique de slot contient aussi l'ID globalement unique du parent, pas une autorisation de guild. |
| Application Expo / mobile | L'app est une web app mobile-first (App Router), sans client natif | Projet Expo séparé, API authentifiée pour mobile (aujourd'hui : Auth.js avec session JWT en cookie + server actions), notifications push |
| ~~Indicateur « en jeu maintenant » sur `/potes`~~ | **Fait derrière le drapeau `STEAM_NOW_PLAYING_ENABLED`** (éteint par défaut) : `GetPlayerSummaries` en un appel groupé par passage de `steam-library-sync`, deux colonnes nullables sur `User` (migration additive `20261003120000_add_steam_now_playing`). Voir « Indicateur en jeu maintenant » | À activer et vérifier en production |
| Suivi par curseur des crons longs | Décision explicite Phase 5 : sans migration, sans curseur, sans `CronLock` ; un passage `time_budget` repart de zéro | Seulement si les logs montrent des `time_budget` répétés : PR dédiée avec curseur persistant + migration (README Phase 5 ; `seed-reconcile` : « signal pour passer à un traitement avec curseur ») |

## Lien d'évitement « Aller au contenu » (drapeau `SKIP_LINK_ENABLED`)

Accessibilité clavier (WCAG 2.4.1) : un lien `Aller au contenu` (`src/components/SkipLink.tsx`) est le premier élément focalisable de chaque page ; invisible tant qu'il n'a pas le focus, il s'affiche en haut à gauche (pastille violette) au premier appui sur Tab, et Entrée place le focus sur `<main id="contenu">`. **Éteint par défaut** : actif uniquement si `SKIP_LINK_ENABLED` vaut exactement `true` (lu à chaque requête, le layout étant dynamique) ; éteint, le lien et l'`id` n'existent pas dans le HTML.

## Collecte des violations CSP (drapeau `CSP_REPORT_ENABLED`)

La CSP est envoyée en `Content-Security-Policy-Report-Only` (`src/lib/csp-policy.ts`, utilisée par `next.config.ts`). **Éteint par défaut** : actif uniquement si `CSP_REPORT_ENABLED` vaut exactement `true`, auquel cas la politique ajoute `report-uri /api/csp-report` et la route `POST /api/csp-report` journalise chaque violation signalée par un navigateur (ligne `csp-report` dans les logs Vercel, niveau `warn`). Sans le drapeau, la politique est inchangée et la route répond 404.

- **Redéploiement nécessaire** après un changement du drapeau : les en-têtes sont calculés au démarrage/build.
- **Point d'entrée public** (les navigateurs n'ont pas de session) donc borné : corps limité à 16 Ko (413), 60 rapports par minute et par instance (429), aucun stockage en base.
- **Données minimales** : seuls `document-uri`, `blocked-uri`, `violated-directive`, `effective-directive`, `source-file`, `disposition` et `line-number` sont gardés ; les URI sont tronquées avant `?` et `#`, `script-sample` et la politique d'origine sont ignorés.
- Étape 1 du plan « CSP bloquante » (`docs/rapport-csp-bloquant.md`) : observer 1 à 2 semaines avant de bloquer.

## Accueil v2 (`/accueil-v2`, drapeau `HOME_V2_ENABLED`)

Page de comparaison de l'accueil : **mêmes requêtes** (`src/lib/home-data.ts`, copie des requêtes de `src/app/page.tsx`, mêmes filtres de confidentialité), **mêmes cartes et mêmes libellés**, même en-tête et même navigation (ceux du layout) ; seules la hiérarchie et l'espacement changent : prochaine soirée en grand, puis les trois actions (« Jouer maintenant » en violet, « Mes dispos », « Soirées »), puis « cette semaine » (dispos, activité), « le groupe » (classement, stats), et le reste dans l'ordre de l'accueil actuel. **Éteint par défaut** : sans `HOME_V2_ENABLED=true` la route répond 404 ; `/` n'est pas modifié. Page en lecture seule : elle ne déclenche ni la clôture automatique d'une soirée ni l'onboarding (que `/` continue de gérer). Captures avant/après : `docs/captures-accueil-v2/`.

## Checklist de préparation (L3-06)

`SESSION_PREPARATION_ENABLED=true` active installé / mis à jour / micro testé / lobby prêt sur les soirées prévues avec un jeu retenu. OFF par défaut, lecture et écriture désactivées. Appliquer la migration additive `20261016120000_session_preparation` avant activation. Chaque participant modifie uniquement ses cases ; les personnes autorisées à voir la soirée voient le collectif. Participants : places confirmées si capacité active, sinon votants du jeu retenu, toujours restreints aux accès actifs et à la communauté. Un changement de jeu affiche une checklist distincte. Aucun envoi Discord, aucune estimation de téléchargement. Désactiver le flag conserve les données.
