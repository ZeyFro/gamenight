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
l'envoi ou l'échec, même mécanisme que la clôture manuelle.

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
  protection est côté serveur, pas le masquage UI. Proposer un jeu, voter
  et renvoyer l'annonce Discord (`resendDiscordAction`, non destructif)
  restent ouverts à tout le monde. La clôture **automatique**
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

Même esprit que `/admin/messages` : pas de rôle admin dédié, tout le monde
peut configurer. Liste des jeux de la biblio commune →
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
— même esprit que `/admin/messages` : pas de rôle admin dédié, tout le
monde peut gérer la liste, traçabilité seule via `AuditLine` (crainte
déjà documentée plus haut : un pote pourrait truquer un superlatif pour se
farmer de l'XP — pas bloqué, juste tracé).

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
| `npm run seed` | Seed des messages Discord par défaut (rappels + création/modification de soirée + level up, idempotent par catégorie) |
| `npm run fix-invalid-templates` | Désactive (silencieusement) les `MessageTemplate` en base avec une variable invalide pour l'une de leurs catégories — idempotent, aussi lancé automatiquement à chaque build (Fix 4, PR 30, bug "texte à trous") |
| `npm run backfill-xp` | Backfill XP manuel (sessions créées, votes, participations, dispos/Steam) — idempotent, aussi lancé automatiquement à chaque build |
| `npm run backfill-coop` | Resynchronise `isCoop`/`maxPlayers` depuis IGDB pour les jeux avec cache existant, jamais confirmés manuellement — idempotent, aussi lancé automatiquement à chaque build (PR 32, Bug 2) |
| `npm run backfill-steam-coop` | Resynchronise `isCoop` depuis Steam Store API pour les jeux `source=STEAM` jamais confirmés manuellement — idempotent, tourne après `backfill-coop`, aussi lancé automatiquement à chaque build (PR 32.6, Bloc A) |
| `npm run seed-game-stats` | Seed manuel des stats/superlatifs pour les jeux populaires de la biblio commune — idempotent, aussi lancé automatiquement à chaque build (chantier dormant depuis PR 5/9, laissé fonctionnel) |
| `npm run seed-superlatives` | Seed manuel des 6 superlatifs génériques par défaut (vote entre potes) — idempotent par nom, aussi lancé automatiquement à chaque build |
| `npm run seed-badges` | Seed manuel des 15 badges par défaut — idempotent par nom, aussi lancé automatiquement à chaque build |
| `npm run backfill-badges` | Backfill badges manuel (attribution rétroactive) — idempotent, jamais de notif Discord (voir § Badges automatiques), aussi lancé automatiquement à chaque build |
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
src/lib/steam-store.ts      # Client Steam Store API (categories → isCoop), duplique sa logique dans prisma/backfill-steam-coop.mjs (PR 32.6, Bloc A)
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
src/components/GameFilterDrawer.tsx     # Panneau des 6 filtres biblio, sync URL (PR 31, Bloc B) — sliders année remplacés par des <select> (PR 32, Bug 1)
src/components/CoopEnrichmentTrigger.tsx # Déclenche l'enrichissement IGDB à la demande quand le filtre Coop est actif (PR 32, Bug 2B)
src/components/ToVerifierList.tsx       # Liste "À vérifier" : toggle rapide Coop/Multijoueur/Solo + Ignorer, sortie animée (PR 32.6, Bloc B)
src/components/MarkAllCoopButton.tsx    # Bonus /bibliotheque : confirme en coop tous les jeux affichés quand seul le filtre Coop est actif (PR 32.6, Bloc B)
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
src/app/jeux/[id]/page.tsx              # Fiche jeu détaillée (IGDB à la demande, cache)
src/app/jeux/actions.ts                 # Server action "Rafraîchir les infos"
src/app/disponibilites/page.tsx         # Planning hebdo + exceptions
src/app/disponibilites/actions.ts       # Server actions dispos
src/app/sessions/page.tsx               # Liste des soirées + création
src/app/sessions/[id]/page.tsx          # Détail : proposer, voter, clôturer
src/app/sessions/[id]/resultats/page.tsx # Saisie/consultation du podium ou du bonus coop (Axe 2)
src/app/sessions/[id]/vote-superlatifs/page.tsx # Vote de superlatifs entre potes (PR 5/9)
src/app/sessions/actions.ts             # Server actions soirées
src/components/SessionResultsForm.tsx   # Formulaire podium/coop de la page résultats
src/app/api/auth/[...nextauth]/route.ts # Route handler Auth.js
src/app/api/steam/link/route.ts         # Redirige vers Steam (OpenID)
src/app/api/steam/callback/route.ts     # Vérifie le retour Steam, importe
src/app/api/igdb/search/route.ts        # Recherche IGDB (utilisée par le form)
src/app/classement/page.tsx             # Podium + tableau complet, filtres Global/Mois/Semaine (PR 9/9)
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
4. Sur `/bibliotheque`, filtrer uniquement sur "Coop" → bouton "Marquer
   les N jeux affichés comme coop" visible ; avec un autre filtre en plus
   (ex. genre), le bouton disparaît.
