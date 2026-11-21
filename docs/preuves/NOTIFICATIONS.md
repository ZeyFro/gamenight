# Audit « pings et notifications côté application » — nouveau joueur

Worktree `/home/user/gamenight/.claude/worktrees/preuves`, branche `preuves/20261121` (issue de main). Audit en lecture seule, 2026-11-21.

## Résumé (10 lignes)

1. Un joueur sans aucune ligne en base a TOUTES les catégories (SESSION, ROULETTE, TOURNAMENT, INSTANT_SESSION, REWARD) et TOUS les canaux activés par défaut ; rien n'est créé à la connexion (`notification-preferences.ts:50-57`, `notification-channel-preferences.ts:42`). Le Web Push exige en plus un opt-in par appareil.
2. @everyone/@here : aucun chemin d'émission trouvé. `parse=everyone` est retiré dans `discord-rest.ts:128`, le webhook legacy n'autorise que des `<@id>` (`discord.ts:59-65`), et aucune chaîne `@everyone`, `@here` ni `<@&` n'est construite à la main hors `buildGameRolePing` (non branchée). TESTÉ (§3).
3. Les pings de rôle de jeu et l'opt-in `GamePingOptIn` sont du code mort : `buildGameRolePing` et `notifyGamePingOptIns` n'ont aucun appelant. L'écran `/notifications` promet pourtant une notification et un ping.
4. ÉCART HAUT : un nouveau joueur reçoit un MP « Bienvenue » automatique au premier rendu de page (`layout.tsx:66-71`, `onboarding-reminder.ts:10-27`), sans interrupteur dédié ni catégorie de préférence, hors des 4 types de MP autorisés.
5. ÉCART HAUT : les MP de rappel, de validation, de changement de date et de rappel de roulette partent en MP + mention. Ils sont hors des 4 types autorisés, et `isDirectMessageAllowed` n'est appelée nulle part.
6. ÉCART HAUT : chaque level-up, chaque badge (même COMMUN) et les awards de soirée sont annoncés publiquement avec mention `<@id>` (`xp-actions.ts:86`, `badges.ts:148`, `superlative-voting.ts:248`). Ce ne sont pas des « moments marquants ».
7. Scénario 100 joueurs : l'executor traite 25 livraisons par passage, une à la fois (`notification-executor.ts:106`). Un MP = 2 appels REST. Les 75 MP restants attendent le cron externe (cadence NON VÉRIFIABLE).
8. Risque haut à 100 invités : `notifyUserIds` n'a aucun plafond (`validations.ts:73`) et la liste de mentions du fil n'est ni bornée ni découpée (`session-announce.ts:1327`).
9. Risque moyen : un 429 n'arrête pas le lot (pas de pause globale), consomme une tentative sur 8, et les en-têtes `X-RateLimit-*` ne sont pas lus. Un rejeu du résolveur d'annonce de soirée réécrit les notifications in-app (`session-announce.ts:1310`).
10. Tests unitaires lancés : 24 fichiers, 223 tests passés, 0 échec, 0 skipped. Intégration et benchmark non lancés (base requise) : NON VÉRIFIABLE EN LOCAL.

## 0. Méthode et légende

- **LU** : lu dans le code, aucune exécution.
- **TESTÉ (nom)** : test unitaire exécuté ici, passé.
- **NON VÉRIFIABLE EN LOCAL** : dépend d'une variable Vercel, du cron externe, de Discord ou de Neon, ou d'un test d'intégration qui exige `TEST_DATABASE_URL`.
- Aucun appel réseau, aucune écriture hors de ce fichier.
- Tests lancés avec `npx vitest run` :
  - Lot A, 10 fichiers, 115 tests passés : `notification-policy`, `notification-preferences`, `notification-channel-preferences`, `game-ping-optin`, `discord-rest`, `discord-dm`, `notification-delivery.pure`, `notification-executor-kick`, `notification-delivery-kick`, `notification-executor.preview`.
  - Lot B, 14 fichiers, 108 tests passés : `session-announce.channel`, `session-announce.pure`, `tournament-announce.channel`, `tournament-team-notify`, `team-application-notify`, `community-announce`, `reward-notifications.channel`, `tower-challenge-announcements`, `tower-steam-announcements`, `discord` (webhook), `notification-executor-booster`, `notifications`, `notifications.web-push`, `team-recruiters-rules`.
  - 0 test « skipped » dans ces 24 fichiers.
- NON lancés : `notification-executor.integration.test.ts`, `notification-delivery.integration.test.ts`, `scripts/queue-load.benchmark.ts`. Ils exigent une base Postgres 127.0.0.1 (`queue-load.benchmark.ts:5-13`). Ce benchmark ne mesure de toute façon qu'une file VIDE (`it("file vide…")`, ligne 9).
- Aucun test existant ne couvre le plafond de 25 livraisons par passage : `maxDeliveries` n'apparaît que dans `notification-executor.ts` (grep `maxDeliveries|DEFAULT_MAX_DELIVERIES_PER_RUN` sur `src`).

## 1. Préférences par défaut d'un joueur qui vient de se connecter

### 1.1 Où c'est décidé (LU)

- Aucune ligne de préférence n'est créée à la connexion. Les seuls écrivains de `userNotificationPreference` / `userNotificationChannelPreference` sont des actions volontaires du joueur : `src/app/profil/actions.ts:62`, `notification-preferences.ts:94`, `notification-channel-preferences.ts:131`.
- Défaut de catégorie, sans ligne : `isPersonalNotificationEnabled` renvoie `category === "REWARD" || !user.silenceReminders` (`notification-preferences.ts:50-57`). `silenceReminders` vaut `false` par défaut (`prisma/schema.prisma:182`). Toutes les catégories sont donc ACTIVES.
- Défaut de canal, sans ligne : `channelPreference?.enabled ?? true` (`notification-channel-preferences.ts:42`). Le modèle a aussi `enabled @default(true)` (`schema.prisma:2886-2895`).
- Canaux réellement proposés par catégorie (`notification-channel-preferences.ts:8-13`) : SESSION = IN_APP, WEB_PUSH, DISCORD_DM, DISCORD_MENTION ; ROULETTE = IN_APP, WEB_PUSH, DISCORD_DM ; TOURNAMENT = DISCORD_DM, DISCORD_MENTION ; INSTANT_SESSION = IN_APP, DISCORD_DM ; REWARD = IN_APP.
- Interface : `src/app/profil/parametres/page.tsx:154-170` (lecture), `:425-470` (bloc « Notifications personnelles ») ; `NotificationChannelPreferences.tsx:30` (« Chaque canal reste activé par défaut ») et `:47` (`?? true`).
- Web Push : opt-in par appareil, `Notification.requestPermission()` déclenché par un clic (`WebPushSettings.tsx:41-43`) ; 5 appareils maximum (`api/push/subscription/route.ts:39-40`) ; exige `WEB_PUSH_ENABLED=true` et VAPID (`web-push-config.ts:34`) ; désactivé en Preview (`notifications.ts:27`).
- Notifications SANS `personalCategory` : elles ne passent par aucune préférence (`notifications.ts:87`). Il s'agit de LEVEL_UP, BADGE, SUPERLATIVE_AWARD, DEBT, REVANCHE, WISHLIST_PRICE_DROP, etc. (`xp-actions.ts:87`, `badges.ts:149`). Elles sont écrites in-app pour tout le monde, et poussées en Web Push aux appareils abonnés.
- `NOTIFICATION_CENTER_ENABLED` ne gouverne que la page `/notifications` et l'opt-in de jeu (`game-ping-optin.ts:11`, `Header.tsx:84`). La cloche et les écritures in-app ne dépendent pas de lui.

### 1.2 Tableau événement × canal × défaut (joueur sans aucune ligne)

« Pref » = valeur lue sans ligne. « Effectif » = ce qui part réellement. Les interrupteurs d'environnement sont tous OFF par défaut (CLAUDE.md, « Tous OFF par défaut ») : leur état réel en Production est NON VÉRIFIABLE EN LOCAL.

| Événement (catégorie) | In-app | Web Push | MP Discord | Mention dans le fil |
|---|---|---|---|---|
| Soirée : création, résultat, rappel (SESSION) | Pref ON, effectif ON (`session-announce.ts:1310-1320`, `discord-announce.ts:86`) | Pref ON ; effectif seulement si WEB_PUSH_ENABLED et appareil abonné | Pref ON ; exige `DISCORD_DM_SESSION_ENABLED` + `DISCORD_BOT_SESSION_ANNOUNCE_ENABLED` + executor + jeton (`session-announce.ts:1283-1284`) | Pref ON ; exige le chemin bot (fil privé) |
| Roulette : création, rappel, résultat (ROULETTE) | Pref ON, effectif ON (`discord-roulette.ts:53-60`, `:98-106`) | Pref ON ; effectif si WEB_PUSH_ENABLED et appareil abonné | Pref ON ; exige `DISCORD_DM_ROULETTE_ENABLED` (`roulette-dm.ts:41,63`) | Jamais de mention (`roulette-dm.ts:86`, `session-announce.ts:1279`) |
| Tournoi : ouverture des inscriptions (TOURNAMENT) | Aucune notification in-app (`tournament-announce.ts:115-120`, `notification-channel-preferences.ts:11`) | Canal non proposé | Pref ON ; exige `DISCORD_DM_TOURNAMENT_ENABLED` (`tournament-announce.ts:1143`) | Pref ON ; mention dans le fil `thread-invite`, uniquement si le créateur t'a sélectionné (`tournament-announce.ts:1160`) |
| Jouer maintenant : invitation (INSTANT_SESSION) | Pref ON, effectif ON (`instant-session-announce.ts:139-150`) | Canal non proposé | Pref ON ; exige `DISCORD_BOT_INSTANT_SESSION_INVITE_ENABLED` (`instant-session-announce.ts:247`) | Aucune (`:76`) |
| Récompense de pari ou de pronostic (REWARD) | Pref toujours ON, effectif ON (`reward-notifications.ts:51-57`) | Canal non proposé | Aucun | Aucune |
| Level-up, badge, awards, dette, revanche, wishlist (sans catégorie) | ON, pas de réglage | ON si appareil abonné | Aucun | Aucune |
| MP « Bienvenue » (hors catégorie) | n/a | n/a | ON si `NOTIFICATION_EXECUTOR_ENABLED` + jeton du bot ; seul `silenceReminders` peut l'éteindre (`onboarding-reminder.ts:11,21,38`) | n/a |
| Candidature d'équipe, tournoi d'équipes, défi Tower validé | n/a | n/a | Hors préférences : aucun réglage joueur (`team-application-notify.ts`, `tournament-team-notify.ts`, `tower-steam-announcements.ts`), voir §4 | Aucune |

Constat : le joueur n'a aucune préférence « MP de bienvenue » ni « MP de candidature ». Seule la bascule SESSION (`silenceReminders`) coupe le MP de bienvenue.

Preuves exécutées :
- TESTÉ (`notification-preferences > sans ligne catégorielle, conserve exactement silenceReminders`).
- TESTÉ (`notification-preferences > conserve les récompenses personnelles par défaut même si les rappels legacy sont silencieux`).
- TESTÉ (`notification-channel-preferences > garde le comportement historique quand aucune préférence de canal n'existe`).
- TESTÉ (`notification-channel-preferences > un refus catégoriel ne peut pas être réactivé par un canal activé`).
- TESTÉ (`notifications.web-push > n'interroge pas les préférences Web Push quand le canal est désactivé`).

## 2. Opt-in des pings de rôle de jeu

- **S'abonner** (LU) : page `/notifications` (`notifications/page.tsx:114-140`), bouton « + jeu » → `toggleGamePingAction` (`notifications/actions.ts:23-36`) → `setOwnGamePingOptIn` (`game-ping-optin.ts:28-47`). Seuls les jeux de la bibliothèque du joueur (`owned: true`, 100 maximum) sont proposés (`page.tsx:48-53`).
- **Contrôles** : `NOTIFICATION_CENTER_ENABLED` exactement `true` (`game-ping-optin.ts:11,29`), membre ACTIF de la communauté (`:20-22`, `:30-31`), jeu existant (`:37`), plafond `MAX_GAME_PING_OPT_INS = 50` (`:15,40`), limite de débit 10/min (`actions.ts:26`, défaut `rate-limit.ts:35-36`).
- Aucune ligne n'est créée sans appel volontaire (commentaire `game-ping-optin.ts:24-27`). Table `GamePingOptIn` : aucune ligne par défaut (`schema.prisma:4337-4352`). Désabonnement : suppression de la ligne (`game-ping-optin.ts:33-36`).
- **Sans abonné** : `buildGameRolePing` renvoie `null`, donc aucun ping (`notification-policy.ts:56`). Même résultat s'il n'y a pas exactement un rôle du même nom (`:58`), si le rôle est sensible (`:57`, `discord-guild-roles.ts:79-81` : managé, position ≤ 0, nom ou permissions sensibles).
- **Rôle mentionné** : le seul rôle dont le nom normalisé égale le nom du jeu (`exactRoleMatches`, `discord-guild-roles.ts:114-118`). Contenu `<@&id>` avec `allowedMentions { parse: [], roles: [id] }` (`notification-policy.ts:60`).
- TESTÉ (`notification-policy > aucun ping sans abonné opt-in`).
- TESTÉ (`notification-policy > mentionne uniquement le rôle précis, jamais en parse`).
- TESTÉ (`notification-policy > refuse en cas d'ambiguïté`).
- TESTÉ (`notification-policy > refuse un rôle sensible même s'il porte le nom du jeu`).
- TESTÉ (`game-ping-optin > plafond de jeux suivis`).
- TESTÉ (`game-ping-optin > in-app uniquement, vers les abonnés actifs hors auteur`).
- **Jamais de MP ni de mention sans opt-in : vrai trivialement, car rien n'appelle ces fonctions.**
  - `grep buildGameRolePing|notifyGamePingOptIns|countGamePingOptIns|setOwnGamePingOptIn` hors tests : seuls `notifications/actions.ts:8,30` appellent `setOwnGamePingOptIn`.
  - `buildGameRolePing`, `notifyGamePingOptIns` et `countGamePingOptIns` n'ont AUCUN appelant. `docs/CENTRE_NOTIFICATIONS.md:19` le dit : « Le ping de rôle n'est PAS branché… prêts pour les contextes publics… à brancher par un lot suivant ».
  - Conséquence : l'opt-in est enregistré mais n'a aucun effet. Or `/notifications` affiche « tu reçois une notification dans l'app quand ce jeu est mis en avant… et tu peux prendre le rôle du jeu avec /role pour être pingé dans les salons » (`page.tsx:104-107`). Aucun code ne pingue ce rôle.
- `notifyGamePingOptIns`, si elle était branchée : in-app uniquement (type `SESSION_CREATED`), membres ACTIFS, auteur exclu (`game-ping-optin.ts:70-98`), jamais de MP.

## 3. @everyone / @here : preuve qu'aucun chemin n'en émet

### 3.1 Les barrières (LU + TESTÉ)

1. **Client REST bot** : tout envoi de contenu passe par `buildMessageBody`, qui impose `allowed_mentions: toDiscordAllowedMentions(...)` (`discord-rest.ts:549-551`). Cette fonction applique `parse: stripEveryoneParse(input.parse)` (`:125-131`), qui retire la valeur `everyone` (`notification-policy.ts:32-34`). `sendChannelMessage` (`:561-585`) et `editChannelMessage` (`:951-969`) l'utilisent ; `sendThreadMessage`, `sendDirectMessage` et les variantes `_verified` passent `input.allowedMentions` (`:930-939`, `:1029-1038`, `:1125-1134`, `:1307-1316`).
   - TESTÉ (`discord-rest > contrôle explicite des mentions > ne transmet JAMAIS parse=everyone, même demandé par l'appelant`).
   - TESTÉ (`… > NO_MENTIONS supprime tous les pings`).
   - TESTÉ (`… > transmet aussi allowed_mentions lors d'une ÉDITION`).
2. **Webhook legacy et outbox des gains** : `postToDiscord` envoie `allowed_mentions: webhookAllowedMentions(content)` (`discord.ts:92`). Cette fonction renvoie `{ parse: [] }`, plus les seuls `<@id>` présents dans le contenu, 100 au plus (`discord.ts:52-65`). `sendRewardWebhook` passe aussi par `buildMessageBody` (`discord-rest.ts:536-543`).
   - TESTÉ (`discord > postToDiscord — allowed_mentions explicite > @everyone, @here et rôles ne pingent jamais`).
   - TESTÉ (`… > jamais plus de 100 utilisateurs`).
3. **Executor** : le type `ResolvedMessageContent.allowedMentions` est REQUIS (`notification-executor.ts:116-122`). Les 6 actions d'envoi ou d'édition le transmettent (`:477,493,509,529,560,610`).
4. **Interactions Discord** (réponses aux commandes et boutons) : toutes les réponses de type 4 portent `allowed_mentions: { parse: [] }` (`discord-interactions.ts:79`, `discord-role-command.ts:128`, `discord-team-command.ts:29`, `discord-tower-admin.ts:51`, `discord-tournament-commands.ts:71`, `discord-session-commands.ts:87`, `discord-player-commands.ts:82`, `discord-community-commands.ts:45`, `discord-project-command.ts:68`, `discord-tower-challenges.ts:36,43`). Les réponses différées de type 5 sont éditées par `editSetupResponse` avec `allowed_mentions: { parse: [] }` (`discord-rest.ts:744`). Toutes les réponses sont éphémères (flags 64).
5. **Panneau Tower** : `allowedMentions: { parse: [] }` (`tower-onboarding-panel.ts:18`).

### 3.2 Grep exhaustif des chaînes construites à la main (hors tests)

Motifs : `@everyone`, `@here`, `<@&`, `<@`. Les chaînes avec parenthèse de fermeture `>` sont listées une par une.

| Occurrence | Rôle | Neutralisée par allowed_mentions ? |
|---|---|---|
| `notification-policy.ts:60` `<@&${role.id}>` | Ping de rôle de jeu | Non appelée aujourd'hui. Si appelée : `parse: [], roles: [id]` n'autorise que ce rôle. |
| `session-announce.ts:1175` `<@${discordId}>` (mentionContent) | Mention des invités dans le fil privé | Oui : `users: userIds` explicite (`:1327`), `parse: []` |
| `session-announce.ts:1573` | Mention de secours du créateur (MP fermé) | Oui : `users: [id]` (`:1574`) |
| `tournament-announce.ts:874`, `:882` | Mention de secours créateur ; mentions des joueurs dans `thread-invite` | Oui : `users: [id]` (`:875`), `users: userIds` (`:902`) |
| `discord-level-up.ts:33`, `discord-badge-unlocked.ts:26`, `discord-session-awards.ts:40` | Variables de gabarit `{user}` / `{gagnants}` dans le CONTENU du message | Seuls les `<@id>` du contenu sont autorisés (`webhookAllowedMentions`, `community-announce.ts:108`). Ces mentions PINGUENT réellement : voir §7. |
| `seasons.ts:166`, `xp-bets.ts:112`, `pronostics.ts:89` | `<@id>` dans la DESCRIPTION d'un embed | Un embed ne notifie pas ; la charge utile n'a pas de `content` (`reward-notifications.ts:46-48`) : aucun ping. |
| `discord-player-listing-rsvp.ts:62` | `<@auteur>` dans une réponse éphémère | Réponse éphémère + `parse: []` (`discord-player-commands.ts:82`) : aucun ping. |
| `discord-report-command.ts:254-255` | `<@auteur>`, `<@signaleur>` dans les champs d'un embed du ticket staff | `allowedMentions: NO_MENTIONS` (`:261`) et embed : aucun ping. |
| `team-application-notify.ts`, `tournament-team-notify.ts`, `tower-*`, `onboarding-reminder.ts` | Aucune mention construite | `parse: []` partout |
| `notifications/page.tsx:66` et commentaires | Texte de l'interface / commentaires | Sans objet |

- Aucune occurrence de `@everyone` ni de `@here` dans une chaîne envoyée à Discord. Les seules occurrences sont des commentaires, des libellés de permissions (`@everyone` sans VIEW_CHANNEL) et l'interface. Idem dans `prisma/`, `scripts/` et les `.json`. Les routes admin Tower (`tower-archive`, `tower-layout`, `tower-preflight`, `tower-content-audit`) n'envoient aucun message (`/messages` apparaît uniquement en lecture GET dans `tower-content-audit/route.ts:71`).
- Texte libre : un `@everyone` tapé par un joueur, un admin ou venu d'une source externe (nom de jeu, titre d'offre GamerPower, gabarit) ne pingue pas, car `parse` n'a jamais `everyone`. `neutralizeEveryoneText` n'est utilisée nulle part (`notification-policy.ts:37`) : la protection ne repose que sur `parse`.
- Limite assumée : `webhookAllowedMentions` extrait les `<@id>` du contenu (`discord.ts:59-65`). Un texte libre qui contiendrait `<@id>` y serait autorisé. Aujourd'hui le contenu est composé de gabarits admin et de `{user}`, pas de texte joueur.
- TESTÉ (`notification-policy > jamais @everyone > retire everyone de parse`, `neutralise @everyone et @here dans le texte`).
- NON VÉRIFIABLE EN LOCAL : le comportement réel de Discord pour une édition qui ajoute une mention (le commentaire `session-announce.ts` (commentaire de `enqueueSessionValidated`, ~l.562) affirme qu'une édition ne notifie personne).

## 4. Liste EXHAUSTIVE des cas où un MP Discord peut partir

Méthode : grep `kind: "send_direct_message"` (8 producteurs) et `channel: "DISCORD_DM"` hors tests. Tous passent par `performDiscordAction` → `sendDirectMessage` (`notification-executor.ts:519-535`, `discord-rest.ts:1117-1135`). Il n'y a pas d'autre appelant : `openDmChannel` n'est appelée que par `sendDirectMessage`.

Prérequis communs : `NOTIFICATION_EXECUTOR_ENABLED=true`, `DISCORD_BOT_TOKEN`, Preview bloquée (`notification-executor.ts:778`, `discord-rest.ts:306`).

| # | MP | Destinataires | Interrupteurs requis | Type de la politique | Lignes |
|---|---|---|---|---|---|
| 1 | Soirée, création (`announce`) | Invités éligibles + CRÉATEUR | `DISCORD_DM_SESSION_ENABLED` + `DISCORD_BOT_SESSION_ANNOUNCE_ENABLED`, préférence SESSION/ROULETTE canal DM | INVITATION : conforme | `session-announce.ts:1283-1297`, `:229-262`, `discord-bot-config.ts:100` |
| 2 | Soirée, « Soirée validée » (`validated`) | Idem | Idem | Hors liste (ÉCART) | `:1804-1820`, `:205` |
| 3 | Soirée, changement de date (`date:`) | Seulement ceux qui ont déjà reçu le MP d'annonce | Idem | Hors liste (ÉCART) | `:243-246`, `:1841-1860` |
| 4 | Soirée, rappels 24 h et 2 h (`reminder:`) | Invités ou places confirmées + créateur | Idem | Hors liste (ÉCART) | `:1962-2012`, `reminder-timings.ts:27` |
| 5 | Soirée, promotion de liste d'attente (`promotion:`) | Le joueur promu | `DISCORD_DM_SESSION_ENABLED` (ou ROULETTE) | Personnel (accepté comme INVITATION) | `:274-277`, `:1501-1503` |
| 6 | Soirée, édition du MP d'invitation (EDIT) | Ceux dont le MP est déjà SENT | `DISCORD_DM_SESSION_ENABLED` | Pas un nouveau MP | `:524-548` |
| 7 | Roulette, création (`created`) | Participants + créateur | `DISCORD_DM_ROULETTE_ENABLED`, préférence ROULETTE DM | INVITATION : conforme | `roulette-dm.ts:63-76`, `discord-roulette.ts:65` |
| 8 | Roulette, rappel (`reminder`) | Participants n'ayant pas proposé leurs 2 jeux | Idem | Hors liste (ÉCART) | `discord-roulette.ts:77`, `roulette-dm.ts:106-110` |
| 9 | Roulette, fin (EDIT du MP de création) | Ceux dont le MP est SENT | Idem | Pas un nouveau MP | `roulette-dm.ts:40-48` |
| 10 | Tournoi, ouverture (`announce`) | Joueurs sélectionnés + créateur | `DISCORD_DM_TOURNAMENT_ENABLED` + chemin bot tournoi | INVITATION : conforme | `tournament-announce.ts:1140-1156` |
| 11 | Tournoi, lancement, fin, annulation (EDIT) | Ceux dont le MP est SENT | `DISCORD_DM_TOURNAMENT_ENABLED` | Pas un nouveau MP | `:269-275` |
| 12 | Jouer maintenant, invitation | Les invités choisis par le créateur | `DISCORD_BOT_INSTANT_SESSION_INVITE_ENABLED`, préférence INSTANT_SESSION DM | INVITATION : conforme | `instant-session-announce.ts:118-145`, `:247`, `:285` |
| 13 | Jouer maintenant, changement de jeu ou fin (EDIT) | Invités déjà MP-és | Idem | Pas un nouveau MP | `:170-200` |
| 14 | Candidature d'équipe, nouvelle (`new`) et relance 48 h | UNIQUEMENT capitaine + recruteurs (2 max), jamais le candidat | `TEAM_RECRUITERS_ENABLED` + `TEAM_APPLICATIONS_ENABLED` + executor + jeton (`team-recruiters-rules.ts:13-16`) | APPLICATION : conforme | `team-application-notify.ts:34-50`, `:61-100` |
| 15 | Tournoi d'équipes : invitation, lancement, confirmation de résultat, relance 12 h, désaccord | Capitaine invité ; capitaines ; capitaine adverse ; organisateur | `TOURNAMENT_TEAMS_ENABLED` + executor + jeton (`tournament-team-notify.ts:24-26`) | Personnel (invitation/contestation) : conforme | `tournament-team-notify.ts:38-58`, `:134-135` |
| 16 | Défi Tower validé automatiquement (Steam) | Le joueur dont c'est le défi | `TOWER_CHALLENGES_ENABLED` + `TOWER_STEAM_AUTOVALIDATE_ENABLED` + `TOWER_DISCORD_ANNOUNCE_ENABLED` + executor (`tower-steam-announcements.ts:17-21`) | OWN_CHALLENGE : conforme | `:54-60`, `:96-103` |
| 17 | **« Bienvenue sur GameNight »** | Tout nouveau membre dont l'onboarding est incomplet | `NOTIFICATION_EXECUTOR_ENABLED` + jeton ; aucun drapeau dédié | **Hors liste (ÉCART)** | `layout.tsx:66-71`, `onboarding-reminder.ts:10-27`, `:30-55` |

Détails sur le MP de bienvenue (ligne 17, LU) :
- Déclencheur : tout rendu de `layout.tsx` d'un utilisateur connecté dont `missingOnboardingSteps` est non vide (Steam non lié et non refusé, disponibilités vides).
- Un seul MP par compte (clé d'événement `ONBOARDING_REMINDER`, `onboarding-reminder.ts:13,22`, verrou `FOR UPDATE`).
- Seul `silenceReminders` peut l'empêcher (`:21`, `:38`) ; aucune catégorie de préférence ne le gouverne.
- Pas de test unitaire : seul `onboarding.integration.test.ts` existe (non lancé).

Mentions de secours : un MP fermé (`discord:dm_unavailable`) n'est jamais retenté (`discord-dm.ts:73-84`) ; le créateur seul est alors mentionné dans le fil (`session-announce.ts:321-340`, `tournament-announce.ts:1024`). Détail en §7.

Vérification de la règle « MP seulement pour ce qui vise personnellement le joueur » :
- `isDirectMessageAllowed` n'est appelée par aucun code de production (`grep isDirectMessageAllowed` : définition `notification-policy.ts:21` uniquement). La règle est documentée, pas appliquée.
- `docs/CENTRE_NOTIFICATIONS.md:20` l'assume : « Les chemins MP existants ne sont pas modifiés ».
- Conformes aux 4 types : 1, 5, 7, 10, 12, 14, 15, 16. Écarts : 2, 3, 4, 8, 17.
- Contradiction interne : `CLAUDE.md` (règles de ping #116) impose « création, changement de date, Soirée validée, rappel = mention dans le fil ET MP ». Cela contredit le texte du 18/11 repris dans `notification-policy.ts:3-8` et `/notifications/page.tsx:62-66`.
- La « contestation » Tower n'a AUCUN MP : le délai de contestation démarre à l'annonce publique de refus (`tower-rejection-notice.ts:4-17`, `tower-challenge-announcements.ts:210-251`).

## 5. Limites de fréquence codées

| Mécanisme | Valeur | fichier:ligne |
|---|---|---|
| Limite d'actions utilisateur (par défaut) | 10 requêtes / 60 s, par `action:userId`, fenêtre glissante, mémoire du process (par instance, remise à zéro à chaque cold start) | `rate-limit.ts:35-36,55-79` |
| Création de soirée, tournoi, roulette, Jouer maintenant | limite par défaut (10/min) | `session-lifecycle.ts:71`, `tournois/actions.ts:63`, `roulette/actions.ts:144`, `jouer-maintenant/actions.ts:51` |
| Opt-in jeu et lecture de notification | 10/min | `notifications/actions.ts:14,26` |
| Préférences de notification | 10/min | `profil/actions.ts:80`, `notification-channel-actions.ts:18` |
| Opt-in de jeu suivi | 50 jeux maximum par joueur | `game-ping-optin.ts:15,40` |
| Appareils Web Push | 5 par compte ; TTL 60 s, urgence normale | `api/push/subscription/route.ts:39-40`, `web-push-delivery.ts:26` |
| Forcer la reconnexion (admin) | 1 / 10 min | `admin/reglages/actions.ts:32` |
| RSVP Discord (soirée, annonce, Jouer maintenant) | 12 / min | `discord-session-rsvp.ts:9`, `discord-player-listing-rsvp.ts:37`, `discord-instant-session-rsvp.ts:12` |
| `/projet` | 5 / min / compte Discord | `discord-project-command.ts:239` |
| Signalement (clic droit) | 5 / heure / membre, compté en base ; un seul signalement par message et par membre ; extrait de 500 car. | `discord-report-command.ts:23-25,136-146` |
| Création de rôle de jeu | 1 demande / joueur / 7 jours ; demande PENDING abandonnée après 2 h ; plafond 200 rôles par serveur (max 250) ; alerte à 80 % | `discord-role-autocreate.ts:42,44,45`, `discord-guild-roles.ts:48`, `discord-team-spaces.ts:46` |
| Espaces Discord d'équipe | 5 par communauté (défaut, max 200) ; 50 membres par espace | `discord-team-spaces.ts:19-22` |
| Propositions de défi Tower | 2 / 24 h, 5 en attente | `tower-challenge-proposal-rules.ts:17-19` |
| Candidature d'équipe | relance unique à 48 h, expiration à 7 j ; 2 recruteurs | `team-recruiters-rules.ts:19,23,25,47-48` |
| Tournoi d'équipes, relance de résultat | 12 h, une fois ; lots de 100 / 25 | `tournament-teams-rules.ts:15`, `tournament-teams.ts:400,414` |
| Rappels de soirée (défaut) | 24 h et 2 h avant ; occurrence = palier + génération | `reminder-timings.ts:27`, `reminders.ts:29`, `session-announce.ts:648` |
| Mentions dans un message webhook | 100 utilisateurs au plus | `discord.ts:52,59-65` (TESTÉ `jamais plus de 100 utilisateurs`) |
| **Executor : livraisons par passage** | **25** | `notification-executor.ts:106` |
| Executor : budget de temps par passage | 50 s (route `maxDuration` 60) | `notification-executor.ts:113`, `api/cron/notification-executor/route.ts:16` |
| Executor : traitement | une livraison à la fois, jamais de lot réservé d'avance | `notification-executor.ts:1021-1050` |
| Bail de réservation | 30 s ; marge de finalisation 5 s | `notification-delivery.ts:77,100` |
| Timeout HTTP Discord | min(budget restant, 10 s) ; refus sous 1 s | `discord-rest.ts:57,62,331` |
| Candidats examinés par claim | 20 | `notification-delivery.ts:346` |
| Tentatives maximum | 8 (livraison et expiration de bail) | `notification-executor.ts:84`, `notification-delivery.ts:353` |
| Backoff sans délai Discord | 60 s × 2^(n-1), plafonné à 30 min | `notification-executor.ts:91-92,365-366` |
| Backoff de dépendance | 2 min | `notification-executor.ts:99` |
| 429 Discord | `retry_after` (corps) sinon `Retry-After` (en-tête) ; `retryable: true` ; sert de `nextAttemptAt` | `discord-rest.ts:244-266,396-397`, `notification-executor.ts:406-409` |
| Kick de l'executor | un seul passage planifié par instance toutes les 60 s | `notification-executor-kick.ts:31-37` (TESTÉ `planifie un seul passage pour une rafale d'enqueue`) |
| Nettoyage de fils | 25 actions par passage | `discord-thread-cleanup.ts:44` |
| Steam autovalidation | 25 lectures par passage, relecture après 10 min | `docs/CRONS.md:44` |
| Jeux gratuits | 3 offres par boutique | `gamerpower-free-games.ts:9-10` |
| Dédoublonnage d'événement | unique `(category, eventType, sourceId, occurrence)` | `notification-delivery.ts:194-224` |
| Dédoublonnage de livraison | unique `[eventId, channel, recipientKey, operation, targetSlot]`, `ON CONFLICT DO NOTHING` | `notification-delivery.ts:250-290` |
| MP fermé mémorisé | aucun nouveau MP de la même source après `dm_unavailable` | `discord-dm.ts:73-84`, `session-announce.ts:236-247` |
| Édition périmée | la plus ancienne PENDING/FAILED est SKIPPED si une plus récente existe | `notification-delivery.ts:290-335` |
| MP de bienvenue | 1 par compte | `onboarding-reminder.ts:13,22` |

Non codés (absences constatées) :
- aucune lecture des en-têtes `X-RateLimit-*` (grep vide dans `src`) ;
- aucun plafond global de MP par heure ou par jour et par joueur ;
- aucun plafond du nombre d'invités (`validations.ts:73` `z.array(idSchema)` sans `.max`).

## 6. Scénario « 100 joueurs reçoivent la même annonce »

Chemin commun (LU) : le producteur appelle `createNotificationEvent` puis `enqueueDelivery` (`notification-delivery.ts:194,250`). Chaque insertion de livraison appelle `kickNotificationExecutor()` : un passage `runExecutorBatch` est planifié via `after()` après la réponse (`notification-executor-kick.ts:34-48`). Un passage réclame une livraison à la fois (`FOR UPDATE SKIP LOCKED`, `ORDER BY sequence`, `notification-delivery.ts:466`), la résout « juste à temps » (`notification-executor.ts:810`), fait UN appel Discord hors transaction, puis finalise. Le cron `/api/cron/notification-executor` répond 202 et traite dans `after()` (`route.ts:112`). Sa cadence est externe : NON VÉRIFIABLE EN LOCAL (`docs/CRONS.md:5` ; le commentaire `notification-executor-kick.ts:7` parle d'un « cron de 1 min » ; `docs/MISSION-20261019.md:125` propose 15 min).

### 6.a Annonce publique dans un salon avec ping de rôle de jeu

- **Aujourd'hui, ce cas n'existe pas** : aucun producteur n'appelle `buildGameRolePing` (§2).
- Ce que ferait le chemin si on le branchait, par analogie avec `postToCommunity` (TESTÉ `community-announce > fige communauté et contenu, enqueue BOT/SEND, sans webhook ni réseau`) : 1 `NotificationEvent` + 1 `NotificationDelivery` (`community-announce.ts:44-52`) ; 1 passage de l'executor ; 2 appels REST (GET de vérification du salon `verifyChannelDestination` puis POST, `discord-rest.ts:920-939`). Un seul message avec `<@&role>` : Discord notifie les membres du rôle, aucune ligne par joueur.
- Délai : une seule livraison ; immédiat via le kick, sinon au prochain cron.
- Doublon : événement idempotent par `occurrence`, livraison par `targetSlot`. Risque résiduel d'un second message si Discord a accepté puis que la réponse est perdue (`network_uncertain`, `notification-executor.ts:381-390`). Pas d'exactly-once (`notification-delivery.ts:60-70`).
- 429 : voir ci-dessous.

### 6.b 100 MP individuels

Exemples : soirée à 100 invités, ou lancement de tournoi.

**Lignes créées**
- Soirée à 100 invités :
  - à la création, 1 événement `SESSION_CREATED` + 2 livraisons (fil et annonce) + 100 événements et 100 livraisons `SESSION_INVITE_SYNC` (`session-announce.ts:380-420`, `:752-784`, appelées par `session-creation.ts:40-41`) + 1 livraison pour le fil du créateur ;
  - puis, lors du traitement de l'annonce, +1 événement `SESSION_DM` et +100 livraisons MP (`enqueueSessionDirectMessages`, `:229-262`, appelée depuis `buildMessageContent` `:1293`) ;
  - total ≈ 203 livraisons et ≈ 102 événements, soit ≈ 301 appels REST en comptant 2 par MP. Ce total est un calcul, pas une mesure.
- Tournoi à 100 sélectionnés : 1 événement `TOURNAMENT_DM` + 100 livraisons MP (`discord-dm.ts:86-96`, boucle séquentielle d'`enqueueDelivery`), + 1 `thread-invite`. Le lancement, la fin et l'annulation ajoutent 1 événement + 100 livraisons EDIT (`discord-dm.ts:109-137`).
- Notifications in-app : 100 lignes par `createMany` (`session-announce.ts:1310-1320`, `notifications.ts:99-113`). Web Push : envoi séquentiel, un par abonné (`notifications.ts:76`).

**Ce qui est groupé ou non**
- Les mentions des invités sont groupées dans UN message du fil (`session-announce.ts:1175,1327`).
- Les MP ne sont jamais groupés : une livraison, un `targetSlot` (`discord-dm.ts:26-28`), un `openDmChannel` + un `POST` par destinataire (`discord-rest.ts:1117-1135`).

**Livraisons par passage**
- 25 au plus, sans compter le fait que les échecs comptent aussi (`notification-executor.ts:1021-1025`).
- 100 MP = 4 passages si le budget de 50 s tient (25 × 2 appels). Le plafond de 25 est le facteur limitant tant qu'un appel prend moins de 1 s ; sinon le budget de 50 s coupe avant (« budget_exhausted »).
- Un seul passage est lancé par le kick ; il ne se relance pas en fin de passage si du travail reste. Les 75 MP suivants attendent le cron, ou un nouvel enqueue.
- Délai total ≈ (N/25 − 1) × cadence du cron. À 1 min : ≈ 3 min. À 15 min : ≈ 45 min. Cadence NON VÉRIFIABLE EN LOCAL. La latence réelle d'un appel Discord est NON VÉRIFIABLE EN LOCAL.
- Plusieurs passages peuvent tourner en parallèle (kick + cron) sans doublon d'envoi grâce à `SKIP LOCKED` et à l'exclusivité par cible. Le débit vers Discord est alors doublé.

**Au 429**
- `classifyRateLimit` lit `retry_after` du corps, sinon `Retry-After` (`discord-rest.ts:244-266`). La livraison repasse PENDING avec `nextAttemptAt = now + retry_after` (`notification-executor.ts:406-415`).
- La tentative est consommée dès le claim (`notification-delivery.ts:566`) et jamais remboursée pour un 429 (`refundAttempt` n'existe que pour `configuration_unavailable`, `notification-executor.ts:424`). Après 8 tentatives : `FAILED` avec `discord:rate_limited:max_attempts_exceeded` (`:397-400`).
- Aucune pause globale : la boucle enchaîne sur la livraison suivante (`:1024-1050`). Un 429 global peut donc consommer jusqu'à 25 tentatives en un passage, puis le passage s'arrête (plafond de 25).
- Les en-têtes `X-RateLimit-*` ne sont pas lus.
- TESTÉ (`discord-rest > 429 avec retry_after dans le corps → retryAfterMs dérivé du corps`, `429 sans corps exploitable → … Retry-After`). Le test intégration `rate limit (429) : nextAttemptAt respecte exactement le Retry-After` existe (`notification-executor.integration.test.ts:448`) mais n'a pas été lancé.

**Risques de doublon et idempotence**
- Idempotent : événement et livraison par clés uniques ; `targetSlot` par destinataire ; rejouer l'enqueue ne crée rien.
- Doublons résiduels documentés : SEND avec réponse réseau perdue ; bail expiré après un envoi réussi (`notification-delivery.ts:60-70`, `notification-executor.ts:381-390`).
- **Doublon non documenté** (LU) : `buildMessageContent` écrit les notifications in-app (`createMany` sans `skipDuplicates`) et envoie les Web Push à chaque exécution du résolveur de l'annonce `SEND` (`session-announce.ts:1310-1320`). Si le POST Discord échoue ensuite de façon retryable (429, 5xx, réseau), le résolveur est rejoué à la tentative suivante et réécrit 100 notifications et 100 pushes, jusqu'à 8 fois. Les MP, eux, restent idempotents (`dmSlot`). NON TESTÉ ici.
- **Limites de taille non traitées** (LU) : `notifyUserIds` n'est pas plafonné (`validations.ts:73`) ; la liste `users` de `allowedMentions` n'est ni bornée ni découpée (`session-announce.ts:1327`, `tournament-announce.ts:902`). Le contenu d'un message avec ~100 mentions mesure environ 2 300 caractères (≈ 23 caractères par `<@id> `). Discord limite le contenu à 2 000 caractères et `allowed_mentions.users` à 100 (la seconde limite figure dans le code, `discord.ts:52`) : le premier chiffre est NON VÉRIFIABLE EN LOCAL (connaissance Discord, non reproduite). Le POST serait alors rejeté en 400, classé `invalid_request`, non retryable (`discord-rest.ts`, statut 4xx) : le message du fil (annonce, validation, rappel) passerait en FAILED sans mention.
- Mesure de charge : `scripts/queue-load.benchmark.ts` ne couvre qu'une file vide (SQL du passage, sans réseau). Aucun test, unitaire ou d'intégration, ne simule 100 livraisons.

## 7. Tous les cas où le bot peut mentionner quelqu'un

Mention = `<@id>` utilisateur ou `<@&id>` rôle dans le `content` d'un message de salon, de fil ou d'une réponse. Ne sont pas comptés : les `<@id>` dans un embed, qui ne notifient pas, et les MP, où une mention serait vide de sens. Le créateur n'est jamais mentionné dans le fil, sauf mention de secours (CLAUDE.md, règles de ping #116).

| Événement | Mention | Destinataire | Interrupteur | Condition | fichier:ligne |
|---|---|---|---|---|---|
| Soirée : création, validée, changement de date, rappels (message du fil PRIVÉ) | `<@id>` utilisateurs | Invités éligibles (créateur exclu) | `DISCORD_BOT_SESSION_ANNOUNCE_ENABLED` + executor ; préférence SESSION canal DISCORD_MENTION | Soirée non issue de roulette ; invitation ACTIVE ; MP envoyé EN PLUS (double ping voulu) | `session-announce.ts:1275-1303,1327`, `:1804`, `:1841`, `:1962` |
| Soirée : mention de secours | `<@id>` du créateur | Créateur seulement | Idem + MP fermé (`dm_unavailable`) + `DISCORD_MENTION` actif | Une fois, dans le fil privé | `session-announce.ts:321-340`, `:1546-1580`, `:1299-1302` |
| Soirée issue d'une roulette | Aucune | n/a | n/a | `createdViaRoulette ? []` | `session-announce.ts:1279` |
| Soirée : annonce et édition | Aucune mention visible en public | n/a | n/a | Annonce DANS le fil privé ; le texte de mention y figure mais l'édition ne notifie pas (NON VÉRIFIABLE EN LOCAL) | `session-announce.ts:1615-1700` |
| Tournoi : ouverture | `<@id>` dans le FIL (`thread-invite`) | Joueurs sélectionnés par le créateur, créateur exclu | `DISCORD_BOT_TOURNAMENT_ANNOUNCE_ENABLED` + salon ; préférence TOURNAMENT canal MENTION | Le fil existe, tournoi en REGISTRATION | `tournament-announce.ts:1048-1060,882,902` |
| Tournoi : annonce du salon | Aucune | n/a | n/a | `NO_MENTIONS` (`parse: []`) | `tournament-announce.ts:178,890` |
| Tournoi : mention de secours | `<@id>` du créateur | Créateur | MP fermé | Dans le fil | `tournament-announce.ts:852-880` |
| Tournoi : lancement, fin, annulation, résumé de fil | Aucune | n/a | n/a | `NO_MENTIONS` | `tournament-announce.ts:1430,1451` |
| Roulette (MP, pas de fil, pas d'annonce) | Jamais | n/a | n/a | | `roulette-dm.ts:86,167` |
| Jouer maintenant : annonce publique et MP | Aucune | n/a | n/a | `NO_MENTIONS_PARSE` | `instant-session-announce.ts:76,234,241,344` |
| Level-up | `<@id>` du joueur | Le joueur qui monte, en PUBLIC dans le salon des soirées | `DISCORD_BOT_SESSION_ANNOUNCE_ENABLED` (file) ou webhook legacy de la communauté `default` | À CHAQUE niveau ; `rankChanged` ne change que le titre | `xp-actions.ts:86`, `discord-level-up.ts:30-52`, `community-announce.ts:14-52` |
| Badge débloqué | `<@id>` | Le joueur, en PUBLIC | Idem | Tous les badges, COMMUN compris | `badges.ts:148`, `discord-badge-unlocked.ts:26,41` |
| Awards de soirée | `<@id>` de chaque gagnant | Les gagnants, en PUBLIC (100 au plus) | Idem | À la clôture des superlatifs | `superlative-voting.ts:248`, `discord-session-awards.ts:40,55` |
| Fin de saison (champion) | `<@id>` dans l'embed | Champion | Idem | Embed sans `content` : aucun ping | `seasons.ts:164-170` |
| Pari ou pronostic gagné | `<@id>` dans l'embed | Le parieur | Idem | Embed sans `content` : aucun ping, annonce publique | `xp-bets.ts:112`, `pronostics.ts:88-89`, `reward-notifications.ts:43-66` |
| Succès de groupe, recap mensuel, fin de tournoi (voie webhook) | Aucune | n/a | Idem | Embed seul | `discord-group-achievement.ts:40`, `monthly-recap.ts:171`, `tournaments.ts:613` |
| Annonces Tower (preuve, refus, réussite, validation Steam) | Aucune ; pseudo en texte brut échappé | n/a | `TOWER_DISCORD_ANNOUNCE_ENABLED` etc. | `allowedMentions: { parse: [] }` | `tower-challenge-announcements.ts:165,259`, `tower-steam-announcements.ts:101,111,122` (TESTÉ `annonce un refus… sans texte privé ni mention`) |
| Votes de preuves Tower | Aucune | n/a | `TOWER_DISCORD_VOTES_ENABLED` | Messages édités, `parse: []` | `tower-challenge-announcements.ts:165` |
| Signalement (ticket staff) | Aucune mention déclenchée ; `<@auteur>` et `<@signaleur>` dans les champs d'embed | n/a | `DISCORD_REPORT_COMMAND_ENABLED` + `DISCORD_REPORT_STAFF_CHANNEL_ID` | `NO_MENTIONS` | `discord-report-command.ts:243-262` |
| Boosters, équipes, projets, espaces de soirée | Aucune : rôles et salons seulement ; introduction de fil projet sans mention | n/a | `DISCORD_BOOSTERS_ENABLED`, `DISCORD_TEAM_SPACES_ENABLED`, `PROJECT_ORGANIZER_ENABLED`, `SESSION_VISIBILITY_ENABLED` | `NO_MENTIONS` | `project-space-api.ts:30` ; aucun `<@` dans `booster-support-runner.ts`, `discord-team-space-runner.ts` |
| Jeux gratuits | Aucune | n/a | `DISCORD_BOT_FREE_GAME_ANNOUNCE_ENABLED` + `FREE_GAME_FEED_ENABLED` | `NO_MENTIONS` pour `FREE_GAMES` | `community-announce.ts:108`, `free-game-discord.ts:50` |
| Panneau d'accueil Tower, réponses de commandes | Aucune | n/a | Éphémères | `parse: []` | `tower-onboarding-panel.ts:18`, §3.1 |
| Ping de rôle de jeu | `<@&id>` | Membres du rôle | Opt-in `GamePingOptIn` | **Aucun appelant : jamais émis** | `notification-policy.ts:60` |

- Règle « le créateur n'est jamais mentionné » : LU `candidateMentions.filter(user => user.id !== session.createdById)` (`session-announce.ts:1276`) et `.filter((u) => u.id !== tournament.createdById)` (`tournament-announce.ts:1048-1052`). TESTÉ (`session-announce.pure > exclut toujours le créateur`). Seule exception : la mention de secours du créateur lorsque son MP est fermé.
- Un MP fermé d'un INVITÉ ne produit pas de secours : l'invité est déjà mentionné (`session-announce.ts:330-340`).
- TESTÉ (`session-announce.channel > refuse le fallback dans le fil dès que DISCORD_MENTION est désactivé`).
- TESTÉ (`tournament-announce.channel > ne transforme pas un MP fermé en mention après désactivation de DISCORD_MENTION`).

## 8. Écarts et risques (contre la décision du 18/11)

Décision : MP seulement pour ce qui vise personnellement le joueur (invitation, candidature, son défi, contestation), jamais @everyone, annonces publiques seulement pour les moments marquants (NEW_RANKER, NEW_HIGH_RANKER, TOURNAMENT_WIN, RECORD ; `notification-policy.ts:14,18`). Les efforts sont des ESTIMATIONS (jours de travail), pas des mesures.

### Gravité haute

| # | Écart | Preuve | Correction proposée | Effort |
|---|---|---|---|---|
| H1 | MP « Bienvenue » automatique à chaque nouveau membre, hors des 4 types, sans interrupteur dédié ni préférence utilisateur ; part dès qu'executor et jeton sont actifs | `layout.tsx:66-71`, `onboarding-reminder.ts:10-27,30-55` | Interrupteur `ONBOARDING_DM_ENABLED` OFF par défaut, ou remplacer par une carte in-app sur `/bienvenue` ; ajouter un test unitaire | 0,5 j |
| H2 | MP de rappel, de validation, de date et de rappel de roulette (+ mention dans le fil) hors des 4 types ; la politique n'est appliquée par aucun code. Contradiction entre `CLAUDE.md` (#116, double ping voulu) et le texte du 18/11 | `session-announce.ts:1283-1297`, `discord-roulette.ts:77`, `notification-policy.ts:21` (jamais appelée) | Trancher : (a) aligner la décision écrite sur le double ping, ou (b) basculer rappel, validée et date en in-app + Web Push et ne garder en MP que l'invitation. Quel que soit le choix, appeler `isDirectMessageAllowed` dans l'enqueue des MP, avec un test de non-régression | (a) 0,5 j ; (b) 2 à 3 j |
| H3 | Annonces publiques non marquantes avec mention `<@id>` : chaque level-up, chaque badge (COMMUN compris), awards de soirée | `xp-actions.ts:86`, `badges.ts:148`, `superlative-voting.ts:248`, `discord-level-up.ts:30-52` | Ne publier le level-up qu'à un changement de rang (`rankChanged` existe déjà), les badges qu'à partir d'EPIC, sans `{user}` mentionné ; ou router vers la file `isPublicAnnouncementAllowed` | 1 j |
| H4 | Scénario 100 invités : aucun plafond du nombre d'invités, mentions non bornées ni découpées (contenu probablement > 2 000 car., `allowed_mentions.users` > 100) : message du fil rejeté en 400 non retryable | `validations.ts:73`, `session-announce.ts:1327`, `tournament-announce.ts:902` | Plafonner `notifyUserIds` (par ex. 50), ou découper les mentions en messages de ≤ 80 ids ; test sur 101 invités | 1 j |

### Gravité moyenne

| # | Écart | Preuve | Correction proposée | Effort |
|---|---|---|---|---|
| M1 | Promesse non tenue : l'opt-in « Jeux que je veux suivre » annonce une notification et un ping, mais `notifyGamePingOptIns` et `buildGameRolePing` n'ont aucun appelant | `notifications/page.tsx:104-107`, `docs/CENTRE_NOTIFICATIONS.md:19` | Brancher sur un déclencheur public défini (tournoi public, jeux gratuits), ou corriger le texte de la page | 1 à 2 j (brancher) ; 0,25 j (texte) |
| M2 | Texte affiché « Un MP n'est envoyé que pour ce qui te vise… » alors que les MP de rappel, validation et date existent (H2) | `notifications/page.tsx:62-66` | Aligner le texte sur la décision finale de H2 | 0,25 j |
| M3 | Doublon in-app et Web Push à chaque rejeu du résolveur d'annonce de soirée | `session-announce.ts:1310-1320`, `notifications.ts:99-113` | Écrire in-app et push une seule fois (clé d'idempotence liée à l'événement, ou seulement à la 1re tentative) ; test | 0,5 à 1 j |
| M4 | Un 429 ne met pas le passage en pause, consomme une tentative sur 8, `X-RateLimit-*` ignorés ; kick et cron peuvent tourner en parallèle | `notification-executor.ts:1021-1050`, `:406-409`, `notification-delivery.ts:566` | Arrêter le passage au premier `rate_limited` (stoppedReason dédié) ; rembourser la tentative sur 429 global | 1 à 1,5 j |
| M5 | Le drain d'un backlog dépend du cron externe : le kick ne lance qu'un passage de 25 | `notification-executor-kick.ts:31-62`, `notification-executor.ts:1021-1025` | Relancer un passage en fin de run si `stoppedReason = max_deliveries_reached` ; documenter la cadence du cron | 0,5 j |
| M6 | Annonce publique de refus Tower avec pseudo du joueur sans consentement (la réussite en exige un) ; la « contestation » n'a pas de MP, son délai démarre à l'annonce publique | `tower-challenge-announcements.ts:210-251`, `tower-rejection-notice.ts:4-17` | MP au joueur concerné (type CONTESTATION) et annonce publique anonymisée | 1 j |
| M7 | Politique non appliquée : seul `stripEveryoneParse` est effectif ; `isDirectMessageAllowed`, `isPublicAnnouncementAllowed` et `neutralizeEveryoneText` ne sont appelées par aucun code de production | grep §4, `notification-policy.ts:21,25,37` | Test de garde (comme `use-server-exports.test.ts`) : chaque producteur `send_direct_message` déclare un `PersonalDmKind` | 1 j |

### Gravité basse

| # | Écart | Preuve | Correction proposée | Effort |
|---|---|---|---|---|
| B1 | Candidature d'équipe, tournoi d'équipes et défi Tower : MP conformes à la politique, mais sans aucun réglage joueur (hors catégories) | `team-application-notify.ts`, `tournament-team-notify.ts`, `tower-steam-announcements.ts` | Ajouter une catégorie ou un canal « MP personnels » (optionnel) | 1 j |
| B2 | Annonces publiques de création de tournoi et de « Jouer maintenant » : hors « moments marquants » au sens strict, mais sans mention | `tournament-announce.ts:178`, `instant-session-announce.ts:82-90` | Les inscrire dans la politique comme exceptions assumées | 0,25 j |
| B3 | Level-up, badge, dette, wishlist : in-app et push sans réglage joueur (pas de `personalCategory`) | `notifications.ts:87`, `xp-actions.ts:87` | Ajouter des catégories si un opt-out est voulu | 1 j |
| B4 | `webhookAllowedMentions` autorise tout `<@id>` présent dans le contenu : un texte joueur injecté dans un contenu pourrait pinguer une personne précise (aucun cas actuel) | `discord.ts:59-65`, `community-announce.ts:36` | Passer les ids autorisés explicitement plutôt que les extraire du texte | 0,5 j |
| B5 | Le MP ou la mention n'est pas bloquée si `NOTIFICATION_CENTER_ENABLED` est éteint : cette variable ne gouverne que l'opt-in de jeu et la page `/notifications` | `game-ping-optin.ts:11`, `Header.tsx:84` | Documenter que la politique est indépendante de ce drapeau | 0,1 j |

### Ce qui est conforme (pour le dossier)

- Aucun `@everyone` ni `@here` n'est émissible : barrière `parse` unique côté REST (`discord-rest.ts:125-131`), webhook (`discord.ts:59-65`), 100 % des réponses d'interaction en `parse: []`.
- Aucun ping de rôle n'est émis aujourd'hui.
- Un MP fermé n'est jamais retenté et ne déclenche une mention de secours que pour le créateur.
- Aucune ligne de préférence ni d'opt-in n'est créée par défaut ; Web Push par appareil avec permission navigateur.
- Les MP de candidature vont uniquement au capitaine et aux recruteurs, jamais au candidat (TESTÉ `team-application-notify > refuse un destinataire qui n'est ni capitaine ni recruteur (membre ordinaire, candidat)`).
- Preview bloquée pour tout envoi (`notification-executor.ts:778`, TESTÉ `notification-executor.preview > does not claim work when called directly in Preview`).
