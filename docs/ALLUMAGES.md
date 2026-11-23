# Plan d'allumage des interrupteurs — par lots, pour ChatGPT

> Relevé du 23 novembre 2026. Objectif : **un seul lancement, cahier entièrement terminé** (voir [CAHIER_FINAL.md](CAHIER_FINAL.md)). Les allumages se font **par ChatGPT dans Vercel**, guidé par ce document. Claude Code n'écrit jamais dans Vercel.

## Règles pour chaque lot

1. **Un lot à la fois.** Le lot suivant ne commence que lorsque **toutes** les vérifications du lot précédent sont cochées.
2. **Où** : Vercel → projet `gamenight` → Settings → Environment Variables → **Production seulement**. Pas Preview, pas Development.
3. **Comment** : pour chaque variable du lot, « Add New », nom exact, valeur exacte `true`. Type « Plain » (ce ne sont pas des secrets). Si la variable existe déjà en « Sensitive » avec une valeur cachée, la **remplacer** par `true`.
4. Puis **un seul Redeploy** du dernier déploiement de Production. Attendre « Ready ».
5. **Juste avant** chaque lot qui écrit en base ou dans Discord (lots B, E, G, H) : créer une **branche de sauvegarde Neon** (Console Neon → Branches → Create branch depuis `production`, nom `avant-lot-X-AAAAMMJJ`). Neon gratuit ne garde que 6 h d'historique.
6. **Vérifier** pendant 30 minutes : les contrôles du lot, et Vercel → Logs (aucune erreur 500).
7. **Retour arrière** (identique pour tous les lots) : supprimer les variables du lot (ou mettre `false`), puis Redeploy. Aucune donnée n'est perdue : une fonction éteinte garde ses données en base.

## Avant le lot A1 (prérequis communs)

| # | Geste | Qui | Fait ? |
| --- | --- | --- | --- |
| P1 | Lire en clair les variables « Sensitive » `NOTIFICATION_EXECUTOR_ENABLED`, `DISCORD_BOT_SESSION_ANNOUNCE_ENABLED`, `DISCORD_BOT_TOURNAMENT_ANNOUNCE_ENABLED`, `DISCORD_DM_*`, `COMMUNITY_*`. Si l'une n'est pas `true`, décider avec Maxime avant de continuer. | Maxime | ☐ |
| P2 | Enregistrer les 13 commandes Discord (`/admin/discord-commands`, reprise automatique depuis #518), puis retirer `DISCORD_COMMAND_REGISTRATION_ENABLED` et son secret | ChatGPT | ☐ |
| P3 | Importer le catalogue : `/tower-admin importer` (89 défis solo une fois #525 fusionnée, 86 avant), puis `/tower-admin importer-equipe` après le lot A2 (30 défis d'équipe, exige les équipes activées sur le serveur) | ChatGPT | ☐ |
| P4 | Plan [PERMISSIONS_BOTS.md](PERMISSIONS_BOTS.md) appliqué (plus aucun bot Administrateur) | ChatGPT | ☐ |
| P5 | Décision de capacité prise ([CAPACITE.md](CAPACITE.md)) | Maxime | ☐ |
| P6 | Migrations des PR #525, #526 et #527 appliquées (le run « Migrations Production » s’exécute automatiquement à la fusion, sans approbation ; vérifier qu’il est vert) | Maxime | ☐ |

---

## Lot A1 — PREMIER LOT, prêt à allumer (7 variables, affichage seulement)

> **Pourquoi celui-là d’abord** : chaque variable est déjà codée et testée (tests Vitest indiqués), **aucune n’écrit dans la base ni dans Discord**, aucune migration n’est nécessaire, et éteinte, chacune rend exactement l’ancien affichage. Les 7 se posent ensemble puis **un seul Redeploy**.

| # | Variable (nom exact) | Valeur | Ce qui change | Testée par |
| --- | --- | --- | --- | --- |
| 1 | `LAUNCH_TEXTS_ENABLED` | `true` | Page de connexion : « L’accès est réservé aux membres du serveur Discord The Tower » (+ lien « Rejoindre le serveur » si `DISCORD_INVITE_URL` est une adresse valide) ; phrase sur les étages sur `/tower` et `/ascension` ; `/sessions/[id]` ne montre plus la présence vocale ni la galerie quand elles ne sont pas configurées | `LoginLanding.launch.test.tsx`, `tower/page.launch.test.tsx`, `ascension/page.test.tsx` |
| 2 | `NAV_TOWER_ENABLED` | `true` | Lien « The Tower » dans le menu (ordinateur et tiroir mobile) | `Sidebar.test.tsx`, `launch-texts.test.ts` |
| 3 | `PAGE_TITLES_ENABLED` | `true` | Titre d’onglet « Nom de la page · GameNight » | `page-title.test.ts`, `page-metadata-coverage.test.ts` |
| 4 | `PAGE_TITLES_DYNAMIC_ENABLED` | `true` | Titre dynamique avec le nom du jeu (`/jeux/[id]`) ou du pote (`/potes/[id]`) ; **exige le n° 3** ; le nom n’est lu que pour une session valide (un visiteur déconnecté voit le titre générique) | `dynamic-page-title.test.ts`, `s0-access-controls.integration.test.ts` |
| 5 | `GUIDE_V2_ENABLED` | `true` | `/guide` : sections « Jouer maintenant » et « Tournois » | `guide-sections.test.ts` |
| 6 | `MEDIA_PRIVACY_ENABLED` | `true` | Bande-annonce YouTube chargée seulement après « Afficher la vidéo » (aucune requête vers YouTube avant) ; case « accord des personnes reconnaissables » dans la galerie | `GameTrailer.test.tsx`, `SessionGallery.test.tsx`, `sessions/actions/gallery.test.ts` |
| 7 | `ADMIN_DASHBOARD_V2_ENABLED` | `true` | `/admin/tableau-de-bord` (lecture seule, admins) : candidatures, envois Discord échoués, contestations, rôles et salons contre les limites 250 / 500 (lit Discord, n’y écrit jamais) | `admin-dashboard-v2.test.ts`, `tableau-de-bord/page.test.tsx` |

**Comment** : règles ci-dessus (Production seulement, type « Plain », valeur exacte `true`, **un seul Redeploy**, attendre « Ready »). Pas de branche de sauvegarde Neon nécessaire (aucune écriture).

**À vérifier après le redéploiement (30 minutes)**
1. Déconnecté, sur la page de connexion : la phrase « L’accès est réservé aux membres du serveur Discord The Tower » est présente ; le lien « Rejoindre le serveur » apparaît seulement si `DISCORD_INVITE_URL` est valide.
2. Connecté, ordinateur et téléphone (tiroir) : « The Tower » est dans le menu.
3. L’onglet du navigateur affiche « Soirées · GameNight » (nom de la page + « · GameNight ») sur `/sessions`, et le nom du jeu sur une fiche `/jeux/[id]`.
4. `/guide` : les sections « Jouer maintenant » et « Tournois » sont là.
5. Fiche d’un jeu avec bande-annonce : le texte « Cette vidéo vient de YouTube (Google) ; ton adresse IP lui sera transmise » et le bouton « Afficher la vidéo » remplacent la vidéo ; elle ne se charge qu’après le clic.
6. `/tower` et `/ascension` : la phrase « Ton niveau, ton étage XP et ton rang XP sont conservés ; tes étages Tower repartent de zéro » est affichée.
7. `/admin/tableau-de-bord` s’ouvre avec un compte administrateur et affiche les rôles et salons du serveur ; avec un compte non administrateur : redirection vers l’accueil.
8. Vercel → Logs : aucune erreur 500 pendant 30 minutes.

**Retour arrière** : supprimer les 7 variables (ou mettre `false`), puis **Redeploy**. Aucune donnée n’est touchée : l’ancien affichage revient. Pour un seul défaut : ne retirer que la variable concernée (en retirant le n° 3, retirer aussi le n° 4).

---

## Lot A2 — Administration des communautés (écrit en base, via l’interface)

**Variables (2)** : `COMMUNITY_ADMIN_ENABLED`, `HOME_V2_ENABLED` (page de comparaison `/accueil-v2`, non liée : facultative).

**Vérifier après le redéploiement**
- `/admin` montre l’onglet « Communautés ». `/accueil-v2` s’ouvre si `HOME_V2_ENABLED` est posée (404 sinon).
- Dans `/admin` → Communautés : activer pour The Tower les **équipes**, les **petites annonces de joueurs** et les **jeux gratuits** (prérequis des lots C, E et F). Ne **pas** activer la galerie (Q6 : pas de galerie dans l’application, voir lot H).

**Retour arrière** : supprimer les 2 variables, Redeploy (les réglages activés restent en base et sans effet).

---

## Lot B — The Tower complète

**Prérequis** : P2, P3 faits ; salon des preuves configuré (`TOWER_DISCORD_CHANNEL_ID`, déjà présent).

**Variables (7)** : `TOWER_DISCORD_VOTES_ENABLED`, `TOWER_SEASON_AWARDS_ENABLED`, `TOWER_CHALLENGE_PROPOSALS_ENABLED`, `TOWER_CHALLENGE_REPLACEMENT_ENABLED`, `TOWER_IRREGULAR_GRANTS_ENABLED`, `TOWER_STEAM_AUTOVALIDATE_ENABLED`, `TOWER_TEAM_DAILY_ENABLED`.

**Hors Vercel** : `TOWER_TEAM_DAILY_ENABLED` est aussi lu par le workflow GitHub `tower-team-daily.yml`. Dans GitHub → Settings → Secrets and variables → Actions → **Variables** : `TOWER_TEAM_DAILY_ENABLED` = `true` et `GAMENIGHT_CRON_BASE_URL` = adresse du site (le secret `CRON_SECRET` doit exister côté GitHub). Ajouter aussi sur cron-job.org un appel toutes les 10 min à `/api/cron/tower-steam-autovalidate` (en-tête `Authorization: Bearer <CRON_SECRET>`).

**Vérifier**
- Une preuve déposée arrive dans le salon des preuves avec les boutons ✅/❌ et un fil. Un vote d'un compte présent depuis au moins 3 jours compte.
- `/tower/propositions` s'ouvre pour un Ranker et est refusée sous 30 étages. `/admin/tower-propositions` liste la proposition.
- Sur `/tower`, le bouton « Remplacer » apparaît pour un défi dont le jeu n'est pas possédé.
- `/admin/tower-irregular` permet de donner et retirer le grade.
- Le lendemain à 18 h (heure de Paris) : un défi d'équipe est attribué (GitHub → Actions → « tower-team-daily » vert).
- Un défi « mesurable Steam » se valide seul pour un profil Steam public.

**Retour arrière** : supprimer les 7 variables (et la variable GitHub), Redeploy.

---

## Lot C — Profil et joueurs

**Variables (10)** : `PROFILE_VISIBILITY_ENABLED`, `GAME_LEVELS_ENABLED`, `GAME_LEVELS_MATCHMAKING_ENABLED`, `GAME_PLATFORMS_ENABLED`, `DISCORD_CONNECTIONS_SCOPE_ENABLED`, `PROFILE_CUSTOMIZATION_ENABLED`, `WHO_PLAYS_TONIGHT_ENABLED`, `NOTIFICATION_CENTER_ENABLED`, `PLAYER_MATCHING_ENABLED` (après P6), `POTES_FRIENDS_ENABLED` (migration `friendships` appliquée, PR Code 7).

**Vérifier**
- `/profil/parametres` : masquer son profil. Un autre compte ne le voit plus dans `/potes`, mais le voit toujours dans les soirées communes.
- Déclarer un niveau sur un jeu, le voir sur `/potes/[id]` et filtrer `/joueurs` par niveau.
- `/bibliotheque/plateformes` s'ouvre ; une fiche de jeu affiche plateformes et crossplay.
- « Importer mes comptes liés » demande d'abord un accord ; les valeurs arrivent en suggestions.
- `/profil/personnalisation` : acheter une couleur avec de l'XP, la voir sur `/profil`.
- `/ce-soir` : se déclarer dispo pour 1 à 3 jeux.
- `/notifications` s'ouvre et liste les notifications.
- **« Jouer maintenant »** (`NOTIFICATION_CENTER_ENABLED` allumé) : `/jouer-maintenant` affiche « Prévenir qui ? (0/N) » avec **personne de coché** et la phrase « Personne n’est prévenu tant que tu ne coches pas des potes » ; cocher un pote puis Démarrer n’envoie le MP qu’à lui. (Éteint : tous cochés, comme avant.)
- **Potes = amis** (`POTES_FRIENDS_ENABLED`) : `/potes` ne montre plus que les amis (au début : « Tu n’as pas encore d’ami »). Chercher un pseudo (2 lettres minimum) : un membre du serveur apparaît avec « Demander en ami » ; un profil masqué n’apparaît jamais. Avec un second compte : « Demandes reçues » → Accepter ; les deux se voient alors dans `/potes` et ouvrent leurs fiches. Un non-ami ouvert par lien (`/potes/[id]`) montre une fiche réduite (pseudo, bouton, soirées « publique » ou « privée, sur invitation » sans détail), jamais son niveau, ses badges ni sa bibliothèque.
- `/profil/parametres` : remplir « Pour trouver des partenaires » ; `/potes` : filtrer par langue, et voir « Partenaires compatibles » (jamais un profil masqué).

**Retour arrière** : supprimer les 9 variables, Redeploy.

---

## Lot D — Soirées

**Variables (8)** : `SESSION_PREPARATION_ENABLED`, `SESSION_SERIES_CANCEL_ENABLED`, `SESSION_CHRONICLES_ENABLED`, `VOTE_VETO_ENABLED`, `ROULETTE_PLAYER_FILTER_ENABLED`, `GAME_PREPARATION_TIME_ENABLED`, `CALENDAR_SUBSCRIPTIONS_ENABLED`, `DISCORD_BOT_INSTANT_SESSION_INVITE_ENABLED`.

**Vérifier**
- Une soirée planifiée montre la checklist de préparation.
- Une série récurrente peut être annulée pour les dates à venir, après confirmation.
- Une soirée terminée accepte une chronique de son créateur.
- Le veto d'un jeu au vote marche (un par personne).
- La roulette ne tire que des jeux adaptés au nombre d'inscrits.
- Une fiche de jeu accepte une durée de préparation.
- `/calendrier` donne un lien d'abonnement privé, et le révoquer le coupe.
- « Jouer maintenant » envoie un MP d'invitation.

**Retour arrière** : supprimer les 8 variables, Redeploy.

---

## Lot E — Équipes et tournois

**Prérequis** : équipes activées pour le serveur (lot A2).

**Variables (8)** : `TEAM_APPLICATIONS_ENABLED`, `TEAM_RECRUITMENT_CRITERIA_ENABLED`, `TEAM_RECRUITERS_ENABLED`, `TEAM_RIVALRIES_ENABLED`, `TOURNAMENT_SCORES_ENABLED`, `TOURNAMENT_PREDICTIONS_ENABLED`, `TOURNAMENT_TEAMS_ENABLED`, `TEAM_CAPTAIN_HANDOVER_ENABLED`. Plus `TEAM_CAPTAIN_HANDOVER_MODE` **laissé vide** (simulation) la première semaine.

**Hors Vercel** : sur cron-job.org, ajouter `/api/cron/team-applications`, `/api/cron/tournament-teams` et `/api/cron/team-captain-handover`, une fois par heure.

**Vérifier**
- `/equipes/candidatures` : candidater, puis accepter (capitaine ou recruteur). Un MP arrive au capitaine.
- `/equipes/gestion` : enregistrer des critères de recrutement.
- `/equipes/[id]/rivalites` : proposer un défi, l'accepter, déclarer et confirmer un résultat.
- Un tournoi accepte la saisie d'un score et des pronostics avant le lancement.
- `/tournois/equipes` : créer un tournoi par équipes à 2 équipes et confirmer un résultat des deux côtés.

**Retour arrière** : supprimer les 8 variables, Redeploy.

---

## Lot F — Mémoire du serveur, jeux gratuits, projets

**Prérequis** : petites annonces et jeux gratuits activés pour le serveur (lot A2) ; un salon d'annonces des jeux gratuits choisi dans `/admin` → Communautés.

**Variables (7)** : `COMMUNITY_QUICK_POLLS_ENABLED`, `COMMUNITY_GAME_GRAVEYARD_ENABLED`, `COMMUNITY_EXPRESSIONS_ENABLED`, `COMMUNITY_HIGHLIGHTS_ENABLED`, `FREE_GAME_FEED_ENABLED`, `DISCORD_BOT_FREE_GAME_ANNOUNCE_ENABLED`, `PROJECT_ORGANIZER_ENABLED`.

**Vérifier**
- `/profil/lore` : un sondage éclair, une épitaphe (admin), une expression (admin) et un exploit.
- `/jeux-gratuits` affiche des offres GamerPower, et une annonce part dans le salon choisi.
- `/projets` : créer un projet, valider une entrée ; un fil public et un fil privé apparaissent dans Discord.

**Retour arrière** : supprimer les 7 variables, Redeploy.

---

## Lot G — Écritures Discord (rôles, salons, signalement)

**Prérequis** : P4 (plus aucun bot Administrateur, GameNight avec ses 13 permissions, dont « Mentionner @everyone, @here et tous les rôles ») ; **suppression des 134 rôles « Étage »** confirmée (déjà faite le 20/11) ; un salon staff privé pour les signalements.

**Variables (10)** : `DISCORD_REPORT_COMMAND_ENABLED`, `DISCORD_ROLE_COMMAND_ENABLED`, `DISCORD_ROLE_AUTOCREATE_ENABLED`, `DISCORD_PROFILE_COMMAND_ENABLED`, `DISCORD_PROJECT_COMMAND_ENABLED`, `DISCORD_PROJECT_WRITE_ENABLED`, `DISCORD_TEAM_SPACES_ENABLED`, `SESSION_VISIBILITY_ENABLED`, `DISCORD_BOOSTERS_ENABLED`, `TOWER_ONBOARDING_PANEL_ENABLED`. Plus deux identifiants non secrets : `DISCORD_REPORT_STAFF_CHANNEL_ID` (salon staff) et `TOWER_DISCORD_WELCOME_CHANNEL_ID` (salon d'accueil).

**Hors Vercel** : sur cron-job.org, ajouter `/api/cron/booster-sync` une fois par heure.

**Vérifier**
- Clic droit sur un message → « Signaler » : un ticket arrive dans le salon staff, sans mention.
- `/role` donne un rôle de jeu existant ; un rôle absent est créé (sans permission) dans la minute.
- `/profil` répond en privé.
- Une nouvelle équipe reçoit un salon texte et un vocal privés.
- Une soirée « publique » apparaît dans « Soirées ouvertes » ; son fil et son vocal privés sont créés 30 min avant.
- Un booster reçoit le rôle « Soutien de la Tour » ; `/soutiens` le liste.

**Retour arrière** : supprimer les 10 variables, Redeploy. Les rôles et salons déjà créés restent : les supprimer à la main si besoin, rien n'est supprimé automatiquement.

### Lot G2 — Autres commandes Discord (7)

`DISCORD_SESSION_COMMAND_ENABLED`, `DISCORD_SESSION_WRITE_ENABLED`, `DISCORD_TOURNAMENT_COMMAND_ENABLED`, `DISCORD_TOURNAMENT_WRITE_ENABLED`, `DISCORD_PLAYER_COMMAND_ENABLED`, `DISCORD_PLAYER_WRITE_ENABLED`, `DISCORD_BOOSTER_ENABLED`.

**Vérifier** : `/soiree`, `/tournoi`, `/joueurs` et `/boost` répondent en privé ; les commandes d'écriture créent bien l'objet sur le site.

**Retour arrière** : supprimer les 7 variables, Redeploy.

---

## Lot H — Données et médias (chacun demande une décision, voir [QUESTIONS_MAXIME.md](QUESTIONS_MAXIME.md))

| Variable | Prérequis | Vérifier | Retour arrière |
| --- | --- | --- | --- |
| `RETENTION_CLEANUP_ENABLED` + `RETENTION_CLEANUP_MODE` | Q5 : **oui** (23/11). **D'abord une semaine sans `MODE`** (simulation), puis `MODE=execute` | `/api/cron/retention-cleanup` rapporte ce qu'il **aurait** supprimé ; relire avant de passer en `execute` | Retirer `MODE` (retour à la simulation) |
| `WEB_PUSH_ENABLED` + `WEB_PUSH_VAPID_SUBJECT`, `WEB_PUSH_VAPID_PUBLIC_KEY`, `WEB_PUSH_VAPID_PRIVATE_KEY` | Q7 : **oui** (23/11). Suivre [WEB_PUSH_VAPID.md](WEB_PUSH_VAPID.md) ; la clé privée en **Sensitive** | S'abonner sur un appareil, recevoir une notification de test | Supprimer les 4 variables |
| ~~`SESSION_VIDEO_ENABLED`~~ | Q6 : **NE PAS ALLUMER** (23/11). Les photos vont sur Discord : poser `DISCORD_PHOTOS_CHANNEL_ID` (salon 📸・photos-soirées) pour afficher le lien sur la page d'une soirée | La page d'une soirée montre « Photos de la soirée sur Discord » | Supprimer `DISCORD_PHOTOS_CHANNEL_ID` |
| `VOICE_PRESENCE_ENABLED` | Q8 : **oui** (23/11), avec les 4 migrations du vocal (déjà appliquées en Production : 151/151 au relevé du 22/11, à revérifier). Consentement de chacun, durée 30 jours | Soirée de test configurée : durées visibles par le créateur seulement | Supprimer la variable (la purge des données continue) |
| `RETENTION`… et `CSP_REPORT_ENABLED` | Après la PR sécurité (CSP bloquante) | `/api/csp-report` reçoit des rapports | Supprimer la variable |

---

## Lot I — Surveillance de l'hébergement (alerte avant saturation)

**Variable (1)** : `HOSTING_ALERT_ENABLED` = `true` (Production). Facultatif : `HOSTING_STORAGE_LIMIT_BYTES` (défaut 1 Go = 1073741824).

**Hors Vercel** : sur cron-job.org, **un appel par jour** à `GET /api/cron/hosting-usage` avec l'en-tête `Authorization: Bearer <CRON_SECRET>` et la **notification d'échec par e-mail activée** (le service traite tout code hors 2xx comme un échec).

**Vérifier**
- Appel manuel avec le bon secret : HTTP **200** et un corps `{"status":"ok","level":"ok",...}` avec la taille de la base (22 Mo ≈ 2 % le 22/11). Sans secret : 401.
- Le corps rappelle « Temps de calcul Neon du mois : à relever à la main » : **relever Neon → Billing chaque semaine**, alerte à 70 h sur 100 h.
- Pour tester l'alerte sans rien casser : `HOSTING_STORAGE_LIMIT_BYTES` à `20000000` (20 Mo), appel manuel : HTTP **503** `{"status":"alert"}` et e-mail du moniteur ; remettre la valeur d'origine.

**Retour arrière** : supprimer `HOSTING_ALERT_ENABLED` (et l'appel du moniteur), Redeploy. Aucune donnée n'est écrite.

---

## Pour ChatGPT

Étapes exactes, à faire dans cet ordre, **sans jamais écrire une valeur de secret dans le dépôt, un commentaire de PR ou une conversation** (la valeur reste dans Vercel et dans le coffre de mots de passe de Maxime). Production : `https://gamenight-zeyfro.vercel.app`.

### (a) Nouveau secret `FORCE_RELOGIN_SECRET` (route `POST /api/admin/force-relogin`)

Pourquoi : avant, cette route (déconnexion de tous les membres) s'ouvrait avec `CRON_SECRET`, partagé avec tous les jobs cron-job.org ; la fuite d'un seul job permettait de déconnecter tout le monde. Depuis la PR « secret dédié », **`CRON_SECRET` n'ouvre plus cette route** et, sans `FORCE_RELOGIN_SECRET`, elle répond **503 (désactivée)**. Le bouton « Forcer la reconnexion » de `/admin?tab=reglages` ne dépend pas de ce secret.

1. **Nom exact de la variable** : `FORCE_RELOGIN_SECRET`.
2. **Générer la valeur** (sur un poste de confiance, jamais dans une conversation) : `openssl rand -base64 48`. La valeur doit être **différente** de `CRON_SECRET`, `AUTH_SECRET` et de tout autre secret.
3. **Vercel → Project gamenight → Settings → Environment Variables → Add** : nom `FORCE_RELOGIN_SECRET`, valeur générée, environnement **Production uniquement** (pas Preview : la route est de toute façon bloquée sur Preview), marquer **Sensitive** si proposé.
4. **Redéployer la production** (Deployments → dernier déploiement de `main` → Redeploy) : une variable ajoutée n'agit qu'au déploiement suivant.
5. **Vérifier** (la commande ne doit RIEN déconnecter, donc ne la lancer qu'avec un faux secret) :
   - `curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Authorization: Bearer faux' https://gamenight-zeyfro.vercel.app/api/admin/force-relogin` → **401** (secret configuré, mauvais en-tête). Un **503** veut dire que la variable n'est pas prise en compte (pas redéployé, mauvais environnement ou mauvais nom).
   - Ne PAS tester avec le vrai secret : cela déconnecterait tous les membres.
6. **Ailleurs** : rien d'autre à changer (aucun script, workflow ni job cron-job.org n'appelle cette route ; vérifié dans le dépôt). Noter dans le journal ci-dessous la date, sans la valeur. **Rotation** : refaire les étapes 2 à 4 (la nouvelle valeur remplace l'ancienne) ; à faire si le secret a pu fuir.

### (b) Tâches cron-job.org (à créer ou à vérifier)

Le dépôt ne déclare **aucune** tâche planifiée dans `vercel.json` : tout le travail de fond (livraison des MP, rappels, clôtures) dépend de cron-job.org. Sans ces tâches : plus de MP, plus de rappels, plus de clôtures.

**Réglages communs à CHAQUE tâche**
- Adresse : `https://gamenight-zeyfro.vercel.app` + le chemin du tableau.
- En-tête de requête : `Authorization` = `Bearer ` suivi de la valeur de `CRON_SECRET` (la même que dans Vercel Production). Aucune autre en-tête.
- Fuseau horaire de la tâche : **Europe/Paris**. Délai d'attente (timeout) : **30 s** (les routes longues répondent 202 et travaillent en arrière-plan, voir `docs/CRONS.md`).
- Notifications : **e-mail en cas d'échec** activé pour chaque tâche ; activer aussi « désactivation automatique après échecs » seulement si on veut être prévenu avant, jamais en silence.
- Réponse attendue : **200** ou **202**. **401** = mauvais secret. **503** = `CRON_SECRET` absent de Vercel (ou Preview). Une route dont l'interrupteur est éteint n'est pas une erreur : elle répond sans rien faire (à constater au premier appel manuel avec « Tester l'exécution »).
- Après création : cliquer **Tester l'exécution** sur chaque tâche et lire le statut ; puis provoquer UN échec volontaire (mauvais secret sur une tâche de test) pour vérifier que l'e-mail arrive.

**Tâches à créer** (méthode GET sauf indication). « Documenté » = cadence écrite dans le dépôt ; « Proposition » = à confirmer par Maxime.

| # | Chemin | Horaire (Europe/Paris) | Source de la cadence | Indispensable |
|---|---|---|---|---|
| 1 | `/api/cron/notification-executor` | toutes les minutes | Proposition (livraison des MP et éditions différées, retries ; `docs/RUNBOOK.md` § 175) | **Oui** |
| 2 | `/api/cron/reminders` | toutes les 5 minutes | Proposition (rappels de soirée à la minute près, clôture des projets) | **Oui** |
| 3 | `/api/cron/close-sessions` | toutes les 5 minutes | Proposition | **Oui** |
| 4 | `/api/health` | toutes les 5 minutes, **e-mail à Maxime en cas d'échec** | Proposition (alerte de panne, réveil de la base : `docs/audit/02-bot-cron-sauvegarde.md`) | **Oui** |
| 5 | `/api/cron/hosting-usage` | 1 fois par jour à 08:00 | Proposition (lot I, `HOSTING_ALERT_ENABLED` ; répond 503 `alert` au-delà de 70 % : l'e-mail d'échec sert d'alerte) | Si lot I allumé |
| 6 | `/api/cron/monthly-tasks` | 1 fois par jour à 03:00 | Documenté (« un seul cron quotidien », commentaire de la route) | Oui |
| 7 | `/api/cron/refresh-discord-profiles` | toutes les heures | Documenté (commentaire de la route : « externe toutes les heures ») | Oui |
| 8 | `/api/cron/steam-library-sync` | toutes les 15 minutes | Documenté (`docs/CAPACITE.md` : « toutes les 10 à 15 minutes ») | Si Steam utilisé |
| 9 | `/api/cron/steam-library-full-sync` | toutes les 2 heures | Documenté (« recommandé : toutes les ~2 h », commentaire de la route) | Si Steam utilisé |
| 10 | `/api/cron/community-guild-sync` | toutes les 15 minutes | Proposition | Si multi-serveurs |
| 11 | `/api/cron/discord-thread-cleanup` | toutes les 15 minutes | Proposition (dry-run tant que `DISCORD_THREAD_CLEANUP_MODE` ≠ `execute`) | Si nettoyage allumé |
| 12 | `/api/cron/retention-cleanup` | 1 fois par jour à 04:00 | Proposition (dry-run tant que `RETENTION_CLEANUP_MODE` ≠ `execute`) | Si rétention allumée |
| 13 | `/api/cron/free-game-discord` | toutes les 6 heures | Proposition | Si jeux gratuits allumés |
| 14 | `/api/cron/booster-sync` | toutes les 30 minutes | Documenté (`docs/BOOSTERS_NITRO.md`) | Si `DISCORD_BOOSTERS_ENABLED` |
| 15 | `/api/cron/tower-steam-autovalidate` | toutes les 10 minutes | Proposition (une tentative n'est pas relue avant 10 minutes : `docs/TOWER_STEAM_AUTOVALIDATE.md`) ; GET ou POST | Si défis Steam allumés |
| 16 | `/api/cron/tournament-teams` | toutes les 15 minutes | Proposition | Si `TOURNAMENT_TEAMS_ENABLED` |
| 17 | `/api/cron/team-applications` | toutes les heures | Proposition | Si `TEAM_RECRUITERS_ENABLED` |
| 18 | `/api/cron/team-captain-handover` | 1 fois par jour à 05:00 | Proposition (simulation tant que le mode n'est pas `execute`) | Si passation allumée |
| 19 | `/api/cron/tower-team-daily` | **18:00 Europe/Paris** (jamais avant) | Décision du 17/11/2026 ; déjà assuré par le workflow GitHub `tower-team-daily.yml` (créneaux 16 h et 17 h UTC, garde « heure ≥ 18 ») : **ne créer cette tâche que si on abandonne le workflow**, jamais les deux sans le savoir (le second appel du soir est sans effet : clé `team-<jour>`) | Si `TOWER_TEAM_DAILY_ENABLED` |

**À ne PAS planifier** : les routes `/api/backfill/*` (déclenchement manuel, une fois) et `/api/admin/force-relogin` (manuel, secret dédié du (a)).

**Contrôle de planification (à refaire après création)** : lister les 18 ou 19 tâches ; vérifier que chacune porte l'en-tête `Authorization`, le fuseau Europe/Paris et l'e-mail d'échec ; déclencher chacune à la main ; le lendemain du changement d'heure (29/03/2027 et 31/10/2027), vérifier qu'une seule ligne `team-<jour>` existe pour le défi de 18 h.

## Journal des allumages (à remplir par ChatGPT)

| Lot | Date et heure | Branche de sauvegarde | Vérifications OK | Retour arrière fait ? |
| --- | --- | --- | --- | --- |
| A1 | | — | ☐ | |
| A2 | | — | ☐ | |
| B | | | ☐ | |
| C | | — | ☐ | |
| D | | — | ☐ | |
| E | | | ☐ | |
| F | | — | ☐ | |
| G | | | ☐ | |
| G2 | | — | ☐ | |
| H | | | ☐ | |
| I | | — | ☐ | |
