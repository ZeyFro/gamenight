# SPEC — App « Soirée Jeux » (nom provisoire : GameNight)

> Fichier destiné à Claude Code. Objectif : construire une web app privée pour un
> groupe d'amis Discord, utilisée **tous les jours**, qui organise les soirées de
> jeu et affiche qui joue à quoi en direct.
>
> **Langue de l'interface : français.** Le code, les commentaires et les commits
> peuvent être en anglais.

---

## 1. Vision & principe

Boucle de valeur (ce qui doit donner envie de revenir chaque jour) :

1. Chacun règle **une fois** son planning de dispo hebdo (récurrent).
2. On propose des jeux et on **vote** pour une soirée donnée.
3. Le résultat (jeu + heure) est **poussé automatiquement dans Discord**.
4. Un **rappel** part avant la session (message drôle personnalisable).
5. En permanence, l'app montre **qui est en train de jouer à quoi** (via Steam).

Contrainte de départ : **minimum 2 joueurs** pour valider une soirée, mais le
nombre pertinent est **par jeu** (voir §5).

---

## 2. Stack technique (imposée)

- **Next.js** (App Router, TypeScript) — front + API dans un seul projet.
- **Tailwind CSS** + **shadcn/ui** pour l'UI.
- **Auth.js (NextAuth v5)** — login **Discord** (provider natif).
- **Prisma** ORM + **Neon** (Postgres serverless). Utiliser l'adapter Neon serverless.
- **Vercel** pour l'hébergement (plan Hobby, usage non-commercial) + **Vercel Cron**
  pour les rappels.
- Steam : **OpenID 2.0** pour lier le compte + **Steam Web API** pour biblio/présence.
- IGDB : enrichissement des métadonnées de jeux (nombre de joueurs).

> Justification : tout tient dans les offres gratuites, zéro serveur à maintenir.
> Le polling de présence se fait côté client (page ouverte) → pas besoin de
> service always-on en v1.

---

## 3. Comptes & variables d'environnement à prévoir

Créer un `.env.example` avec :

```
# Base de données (Neon)
DATABASE_URL=

# Auth.js
AUTH_SECRET=
AUTH_URL=http://localhost:3000

# Discord (Developer Portal → New Application → OAuth2)
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
# Webhook du salon où poster les résultats/rappels (Salon → Intégrations → Webhooks)
DISCORD_WEBHOOK_URL=

# Steam (https://steamcommunity.com/dev/apikey — compte avec ≥5$ dépensés requis)
STEAM_API_KEY=

# IGDB (compte Twitch dev → https://dev.twitch.tv/console → application)
IGDB_CLIENT_ID=
IGDB_CLIENT_SECRET=
```

Documenter dans le README **où récupérer chaque valeur**.

---

## 4. Contraintes externes à respecter (importantes, vérifiées)

- **Steam login = OpenID 2.0** : renvoie uniquement le `SteamID64`. On ne récupère
  ni email ni mot de passe. Le login **principal reste Discord** ; Steam est un
  **lien secondaire** ajouté depuis le profil.
- **Biblio & présence Steam nécessitent un profil public.** `GetOwnedGames` et le
  jeu en cours renvoient **vide** si le profil / les détails de jeu sont privés.
  → Gérer ce cas proprement dans l'UI (message « ton profil Steam est privé, la
  biblio ne peut pas être importée » + lien vers les réglages de confidentialité).
- **Pas de push Steam** : la présence se récupère par **polling** de
  `GetPlayerSummaries` (jusqu'à 100 SteamID en un seul appel — batcher).
- **IGDB : couverture incomplète** pour le nombre de joueurs. `multiplayer_modes`
  (`onlinecoopmax`, `onlinemax`, etc.) est parfois vide même quand le jeu est
  co-op. → **Toujours** proposer une saisie/correction manuelle.
- **Jeux hors Steam** (Minecraft, modpacks type ATM11, etc.) : l'**ajout manuel
  est obligatoire**, ce n'est pas une option de confort.

---

## 5. Modèle de données (Prisma — schéma indicatif)

```
User
  id            (cuid)
  discordId     (unique)
  discordName
  discordAvatar
  steamId64     (nullable, unique)
  steamPublic   (bool, cache du statut de visibilité)
  createdAt

Game
  id
  name
  source        (enum: STEAM | IGDB | MANUAL)
  steamAppId    (nullable)
  igdbId        (nullable)
  coverUrl      (nullable)
  isCoop        (bool)
  minPlayers    (int, nullable)   // rempli par IGDB si dispo, sinon manuel
  maxPlayers    (int, nullable)
  addedById     -> User
  createdAt

UserGame                         // biblio / possession
  userId  -> User
  gameId  -> Game
  owned   (bool)
  @@id([userId, gameId])

WeeklyAvailability               // dispo récurrente par défaut
  id
  userId     -> User
  dayOfWeek  (0-6)
  startTime  (HH:mm)
  endTime    (HH:mm)

AvailabilityOverride             // exception ponctuelle sur une date précise
  id
  userId  -> User
  date    (date)
  available (bool)
  startTime (nullable)
  endTime   (nullable)

Session                          // une soirée
  id
  date
  status        (enum: VOTING | SCHEDULED | DONE | CANCELLED)
  decidedGameId (nullable) -> Game
  decidedTime   (nullable)
  createdAt

Proposal
  id
  sessionId -> Session
  gameId    -> Game
  proposedById -> User

Vote
  id
  proposalId -> Proposal
  userId     -> User
  @@unique([proposalId, userId])

ReminderTemplate                 // messages de rappel drôles perso
  id
  text        // supporte variables {pote} {jeu} {heure}
  createdById -> User

PresenceSnapshot                 // cache optionnel de présence
  userId    -> User
  gameName  (nullable)
  state     (enum: OFFLINE | ONLINE | IN_GAME)
  updatedAt
```

---

## 6. Périmètre v1 (à livrer)

### F1 — Auth Discord
- Login via Discord, récup pseudo + avatar automatiquement.
- **Critère d'acceptation** : un nouvel utilisateur se connecte et voit son profil
  peuplé sans rien saisir.

### F2 — Lien Steam + import biblio + ajout manuel
- Bouton « Lier mon compte Steam » (OpenID) → stocke le `SteamID64`.
- Import biblio via `GetOwnedGames` (gérer le cas profil privé).
- Ajout manuel d'un jeu (nom + éventuellement recherche IGDB pour la cover).
- **Critère** : je peux lier Steam, voir mes jeux importés, et ajouter « Minecraft »
  à la main.

### F3 — Enrichissement joueurs (IGDB)
- À l'ajout d'un jeu, tenter de récupérer `isCoop` / `min` / `maxPlayers` via IGDB.
- Si absent → champ éditable manuellement (défaut `minPlayers = 2`).
- **Critère** : un jeu sans data IGDB reste utilisable après saisie manuelle.

### F4 — Dispos récurrentes
- Éditeur de planning hebdo (jour + créneau), + exceptions ponctuelles.
- **Critère** : je règle « mardi/jeudi/dimanche 21h-00h » une fois, ça persiste.

### F5 — Proposition + vote de soirée
- Créer une session pour une date.
- Proposer des jeux ; les autres votent.
- L'app croise **dispos × possession × nombre de joueurs** et ne propose comme
  « valides » que les jeux jouables (≥ `minPlayers` de joueurs dispos qui possèdent
  le jeu, sans dépasser `maxPlayers`).
- **Critère** : une option n'apparaît jouable que si assez de gens sont dispos ET
  possèdent le jeu.

### F6 — Résultat poussé dans Discord
- À la clôture du vote, poster dans le salon via `DISCORD_WEBHOOK_URL`
  (ex. « 🎮 Ce soir 21h : **Valheim** — 4 joueurs »).
- **Critère** : la clôture d'un vote génère un message Discord lisible.

### F7 — Rappel avant session (Vercel Cron)
- Cron qui, X min avant `decidedTime`, poste un rappel via webhook.
- Message tiré au hasard parmi les `ReminderTemplate`, avec variables remplacées.
- **Critère** : un rappel personnalisé part automatiquement avant la session.

### F8 — Présence « qui joue à quoi » (poll)
- Route API interne qui appelle `GetPlayerSummaries` (batch de tous les SteamID liés).
- Le front rafraîchit toutes les 30-60 s tant que la page est ouverte.
- Affichage : liste des potes avec statut (hors-ligne / en ligne / **en jeu : X**).
- **Critère** : quand un pote lance un jeu Steam (profil public), je le vois passer
  « en jeu » en < 1 min sans recharger.

---

## 7. Roadmap v2 (ne PAS implémenter maintenant, mais concevoir le schéma pour)

- **Bot Discord présence 24/7** : vrai temps réel via l'intent *presence* (service
  always-on, hébergeable sur homelab). Remplace/complète le poll Steam.
- **File de jeux co-op** (« Feature 2 » d'origine) : liste ordonnée de jeux à
  enchaîner (Factorio → Valheim → Minecraft/ATM11…), statut *en cours / bloqués /
  terminé*, désignation du **host** (celui qui héberge le monde/save).
- **Alerte nouvelle maj** : surveiller les mises à jour (Steam news / buildid, ou
  branche *beta/public test* quand elle existe) et prévenir dans Discord.

---

## 8. Conventions pour Claude Code

- Avancer **feature par feature** dans l'ordre F1 → F8. Ne pas tout coder d'un bloc.
- Après chaque feature : vérifier le critère d'acceptation avant de passer à la suite.
- Toujours gérer les cas d'erreur des API externes (profil privé, quota, data
  manquante) sans planter l'UI.
- Ne jamais coder en dur une clé/API : tout passe par les variables d'env.
- Fournir un `README.md` avec : prérequis, où obtenir chaque credential, commandes
  d'install, de migration Prisma et de lancement local.
- Mobile-friendly : les potes voteront depuis leur téléphone.
```
