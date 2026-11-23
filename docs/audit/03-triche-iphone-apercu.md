# Audit 03 : triche et abus, notifications sur iPhone, aperçu du lien dans Discord

> Audit en **lecture du code** (main `f13626ac`, 23/11/2026), sans exécution contre Discord, Vercel ni la base de production. Un constat par ligne. Gravité : **Élevée** (exploitable maintenant, impact visible), **Moyenne**, **Faible**, **OK** (garde vérifiée). « Test » = test existant qui verrouille la garde ; « aucun test » = la garde n'est pas verrouillée. Aucune exploitation n'a été lancée : chaque constat cite le fichier et la ligne à relire.

## 1. Triche et abus

| # | Gravité | Où | Preuve | Correctif proposé |
| --- | --- | --- | --- | --- |
| 1.1 | OK | Voter sa propre preuve Tower | `src/lib/tower-challenges.ts:460-463` : `SELF_VOTE` pour l'auteur et pour tout participant d'un défi d'équipe ; `tower-challenge-voting.ts` rejette un vote de l'auteur. Tests : `tower-discord-votes.integration.test.ts`, `tower-challenges.integration.test.ts` | — |
| 1.2 | OK | Quorum et égalité | `evaluateChallengeVote` (`tower-challenge-voting.ts:35-67`) : 3 votants distincts, vote dupliqué refusé, égalité = rejet, prolongation unique de 24 h | — |
| 1.3 | **Moyenne** | Ancienneté des votants (7 jours) | `tower-challenges.ts:466-471` : `towerVoterEligibility` n'est exécuté que si `TOWER_DISCORD_VOTES_ENABLED` est allumé. Flag éteint, tout membre actif vote dès son arrivée. L'ancienneté est celle de la Membership GameNight (`tower-vote-eligibility.ts`), pas celle du compte Discord | Appliquer les 7 jours quel que soit le flag (sortir le contrôle du `if (discordVotes)`) et exiger un compte Discord de plus de 30 jours (date lisible dans l'identifiant, sans appel réseau). Test : un membre de 2 jours est refusé flag éteint |
| 1.4 | **Élevée** | Faux comptes qui valident la preuve de leur propriétaire | 3 faux comptes inscrits depuis 7 jours suffisent (quorum 3, majorité stricte). Aucune garde ne relie les comptes entre eux. Seuls remparts : la contestation et la vigilance des autres membres | (a) Ne compter dans le quorum que des votants ayant déjà réussi un défi ou joué une soirée ; (b) montrer au staff, dans `/admin/tower-appeals`, les votes décisifs avec ancienneté et activité de chaque votant ; (c) journaliser. Test d'intégration : 3 votants récents sans activité ne valident pas |
| 1.5 | **Élevée** | Défi d'équipe : coéquipier fantôme | `joinTowerTeamChallenge` (`tower-challenges.ts:384-401`) : tout membre actif de l'équipe rejoint la tentative et **chaque participant est récompensé**, sans avoir rien fait. Une équipe de 8 comptes (créée librement) rapporte 8× les étages pour une preuve. Les participants ne votent pas, mais d'autres faux comptes le peuvent (1.4) | La preuve doit nommer les participants, confirmés par le capitaine ; plafonner les récompenses par personne et par jour ; exiger au moins 2 membres de plus de 7 jours. Test : un membre qui rejoint sans être confirmé n'est pas récompensé |
| 1.6 | Moyenne | Validation automatique Steam | Mesure = temps de jeu ou succès depuis l'attribution : le temps de jeu se farme en laissant le jeu ouvert (AFK). Profil privé = repli sur le vote (OK). Test : `api/cron/tower-steam-autovalidate/route.test.ts` | Plafonner le temps compté par jour (ex. 2 h) et garder « Signaler un doute » ; documenter la limite dans `TOWER_STEAM_AUTOVALIDATE.md` |
| 1.7 | OK | Rejouer un gain d'XP | `xp-actions.ts:61-70` : `createMany(skipDuplicates)` sur la clé unique communauté/joueur/raison/sourceId ; voter, dévoter, revoter ne recrédite pas (`proposals-votes.ts:105-111`) | — |
| 1.8 | OK, sans test | Plafond « soirée créée » | `xp-actions.ts:47-55` : 3 gains `CREATE_SESSION` par membre et par 24 h. **Aucun test** ne le verrouille | Test d'intégration : 4 créations en 24 h = 3 gains |
| 1.9 | **Élevée** | XP « présence » farmée par des soirées fantômes | `sessions.ts:371` et `:527` : `PARTICIPATE` (20 XP) est versé à **chaque votant de la proposition gagnante** à la clôture, **sans preuve de présence**. Le créateur clôt lui-même (`session-lifecycle.ts:334-349`). Le plafond de 3 ne protège que le gain « créer ». Un créateur avec des comptes complices crée autant de soirées qu'il veut (limite en mémoire, 10 par minute et par instance, `rate-limit.ts`) : 20 XP par complice et par soirée, sans plafond | (a) Plafonner `PARTICIPATE` par joueur et par jour ; (b) exiger ≥ 3 participants distincts et une présence vocale ou une date passée ; (c) ne rien verser pour une soirée supprimée ou annulée. Test d'intégration : 5 soirées fantômes en 1 h = 2 crédits |
| 1.10 | Moyenne | XP « voter » | `proposals-votes.ts:111` : 5 XP par proposition votée ; aucun plafond de propositions par soirée trouvé : un créateur ajoute N propositions et les vote | Plafonner les propositions par soirée (ex. 10) et les gains `VOTE` par soirée. Test |
| 1.11 | Moyenne | Tournoi à comptes complices | `tournaments.ts:107` : bracket ≥ 4 participants et nombre pair (un tournoi à 1 joueur est donc impossible, OK), mais 4 comptes complices donnent XP de tournoi à volonté (`:580-591`) | Plafond d'XP de tournoi par joueur et par semaine ; XP seulement si ≥ 3 participants ont 7 jours d'ancienneté |
| 1.12 | OK | Série (streak) | `xp-actions.ts:138-165` : un incrément au plus toutes les 12 h, rupture à 24 h, bonus plafonné à +50 % | — |
| 1.13 | OK | `@everyone` / `@here` | `notification-policy.ts` neutralise les mentions, appliqué dans `discord-rest.ts` même flag éteint. Test : `notification-policy.test.ts` | — |
| 1.14 | **Moyenne** | MP en masse | `createSession` n'est limité que par `checkRateLimit` en mémoire (`session-lifecycle.ts:71`) ; chaque soirée peut déclencher un MP par invité. La garde « seuls les MP personnels partent » n'est pas câblée (CAHIER_FINAL D08) | Limite partagée (`checkSharedRateLimit`) : 10 soirées et 5 tournois par jour et par personne ; plafond de MP reçus par destinataire et par jour. Test : la 11ᵉ soirée du jour est refusée |
| 1.15 | OK, sans test | Demandes d'ami | 10 par minute et 20 par jour (limite partagée) ; aucune notification. **Aucun test** de la limite quotidienne | Test d'action : la 21ᵉ demande du jour ne crée aucune ligne |
| 1.16 | Faible | Limites en mémoire | `checkRateLimit` est propre à chaque instance ; seules les actions sensibles utilisent la limite partagée | Étendre `checkSharedRateLimit` aux créations (soirée, tournoi, annonce) |

À vérifier (non tranché en lecture) : les pronostics de tournoi empêchent-ils de parier sur sa propre équipe ? Pas d'enjeu (ni mise ni XP) : gravité Faible.

## 2. Notifications sur iPhone

Rappel Apple : sur iPhone, le Web Push n'existe que depuis iOS 16.4 **et seulement pour un site ajouté à l'écran d'accueil** ; la permission se demande par un geste de l'utilisateur, dans l'application installée.

| # | Gravité | Où | Preuve | Correctif proposé |
| --- | --- | --- | --- | --- |
| 2.1 | OK | Manifest | `public/manifest.json` : `display: standalone`, `start_url: /`, icônes 192 et 512, `theme_color` | — |
| 2.2 | OK | Service worker | `public/service-worker.js` : gestionnaires `push` et `notificationclick`, destination restreinte à l'origine | — |
| 2.3 | OK | VAPID et points d'entrée | `web-push-config.ts` (clé privée de 32 octets, test `web-push-config.test.ts`), `web.push.apple.com` autorisé (`web-push-subscription.ts`), 5 appareils par personne, opt-in par appareil | — |
| 2.4 | **Élevée** | `src/components/WebPushSettings.tsx` | L'état « activé » est cherché avec `getRegistration("/sw.js")` alors que le service worker s'enregistre sous `/service-worker.js` : après un rechargement l'abonnement existant n'est jamais détecté, le bouton affiche « Activer » et un second clic tente de se réabonner | Remplacer par `"/service-worker.js"` ; test jsdom : abonnement existant = bouton « Désactiver » |
| 2.5 | **Élevée** | Aucune détection iOS ni mode installé | Aucun code ne teste `navigator.standalone`, `display-mode: standalone` ni `PushManager`. Dans Safari sur iPhone, `PushManager` est absent : le clic échoue avec le message générique « Impossible de modifier les notifications push… » | Détecter : (a) iPhone/iPad hors mode installé = afficher le guide ci-dessous à la place du bouton ; (b) `PushManager` absent = « Cet appareil ou ce navigateur ne prend pas en charge les notifications. » ; (c) permission refusée = expliquer Réglages > GameNight > Notifications. Tests jsdom pour les trois cas |
| 2.6 | Moyenne | Texte d'aide absent | Rien n'explique « Sur l'écran d'accueil » | Texte proposé (iPhone, hors mode installé) : « **Pour recevoir les notifications sur iPhone** : 1. Ouvre GameNight dans **Safari**. 2. Touche **Partager** (le carré avec la flèche). 3. Choisis **Sur l'écran d'accueil**, puis **Ajouter**. 4. Ouvre GameNight **depuis la nouvelle icône**, va dans Paramètres et touche **Activer sur cet appareil**. Il faut iOS 16.4 ou plus récent. » |
| 2.7 | Moyenne | Icône Apple | `layout.tsx` : `icons.apple` = `icon-192.png` (iOS attend 180×180) ; même image en `any maskable` : risque de rognage | Ajouter `apple-touch-icon.png` 180×180 et une icône `maskable` dédiée (zone sûre de 80 %) |
| 2.8 | Faible | Notification sans icône ni badge | `showNotification` (`service-worker.js`) ne passe ni `icon` ni `badge` | Ajouter `icon: "/icon-192.png"` et un `badge` monochrome |
| 2.9 | Faible | Manifest minimal | Pas de `id`, `scope`, `lang` | Ajouter `id: "/"`, `scope: "/"`, `lang: "fr"` |
| 2.10 | Faible | Parcours non testable sans appareil | Impossible à vérifier sans iPhone réel | Procédure dans `SEMAINE_1.md` : installer l'icône, activer, envoyer une notification de test, vérifier la réception écran verrouillé |

## 3. Aperçu du lien partagé dans Discord

Un robot Discord lit les balises `og:*` sans être connecté : il voit la page de connexion de l'accueil (toute autre adresse y redirige).

| # | Gravité | Où | Preuve | Correctif proposé |
| --- | --- | --- | --- | --- |
| 3.1 | **Élevée** | Image d'aperçu | Aucun `opengraph-image`, `twitter-image` ni `openGraph.images` (`src/app` ne contient que `icon.svg`) : Discord n'affiche ni image ni vignette | Ajouter `src/app/opengraph-image.tsx` (`ImageResponse` de `next/og`, sans dépendance), 1200×630, fond sombre, nom « GameNight » et une phrase d'accroche ; `alt` renseigné. Test : la route répond en `image/png` |
| 3.2 | **Élevée** | Balises `og:` et Twitter absentes | `layout.tsx:41-55` : seulement `title`, `description`, `manifest`, `appleWebApp`, `icons.apple` ; **ni `openGraph`, ni `twitter`, ni `metadataBase`** | Ajouter `metadataBase` (URL du site), `openGraph` (`type: website`, `siteName`, `title`, `description`, `locale: fr_FR`), `twitter: { card: "summary_large_image" }`. Test : métadonnées présentes |
| 3.3 | Moyenne | Titre et description | « GameNight » / « Organise tes soirées jeux avec tes potes. » : exacts mais sans contexte | Proposition : « GameNight, l'appli des soirées jeux de The Tower : votes, tournois, défis et classements entre potes. Connexion avec Discord. » |
| 3.4 | Moyenne | `robots.txt` | `src/app/robots.ts` : `Disallow: /` pour tous. Discord ne fait pas d'indexation, mais le comportement de son robot d'aperçu face à ce fichier est **à vérifier en réel** (coller le lien dans un salon de test) | Si l'aperçu manque : règle `Discordbot` avec `allow: "/"`, `Disallow: /` pour les autres |
| 3.5 | OK | Couleur d'embed | `viewport.themeColor = #8b5cf6` sert de liseré | — |
| 3.6 | OK | Pages privées | `/guide`, `/sessions/[id]` renvoient à la connexion : aucun titre de soirée privée ne fuit dans un aperçu | Ne jamais produire de métadonnées dynamiques pour un visiteur non connecté |
| 3.7 | Faible | Icône du site | `icon.svg` seul, pas de `favicon.ico` | Ajouter un `favicon.ico` |

## Les trois constats les plus graves

1. **1.9** : l'XP de présence se farme avec des soirées fantômes et des comptes complices (20 XP par complice et par soirée, sans plafond ni preuve de présence).
2. **1.4 et 1.5** : une preuve Tower peut être validée par 3 faux comptes, et un défi d'équipe récompense tous les membres inscrits, même sans effort.
3. **2.4 et 2.5** : les notifications iPhone sont inutilisables en l'état (abonnement non détecté après rechargement, aucun guide d'installation) ; **3.1 et 3.2** : le lien dans Discord n'a ni image ni balises d'aperçu.
