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

## Avant le lot A (prérequis communs)

| # | Geste | Qui | Fait ? |
| --- | --- | --- | --- |
| P1 | Lire en clair les variables « Sensitive » `NOTIFICATION_EXECUTOR_ENABLED`, `DISCORD_BOT_SESSION_ANNOUNCE_ENABLED`, `DISCORD_BOT_TOURNAMENT_ANNOUNCE_ENABLED`, `DISCORD_DM_*`, `COMMUNITY_*`. Si l'une n'est pas `true`, décider avec Maxime avant de continuer. | Maxime | ☐ |
| P2 | Enregistrer les 13 commandes Discord (`/admin/discord-commands`, reprise automatique depuis #518), puis retirer `DISCORD_COMMAND_REGISTRATION_ENABLED` et son secret | ChatGPT | ☐ |
| P3 | Importer le catalogue : `/tower-admin importer` (89 défis solo une fois #525 fusionnée, 86 avant), puis `/tower-admin importer-equipe` après le lot A (30 défis d'équipe, exige les équipes activées sur le serveur) | ChatGPT | ☐ |
| P4 | Plan [PERMISSIONS_BOTS.md](PERMISSIONS_BOTS.md) appliqué (plus aucun bot Administrateur) | ChatGPT | ☐ |
| P5 | Décision de capacité prise ([CAPACITE.md](CAPACITE.md)) | Maxime | ☐ |
| P6 | Migrations des PR #525, #526 et #527 appliquées (run « Migrations Production » vert et approuvé juste après chaque fusion) | Maxime | ☐ |

---

## Lot A — Affichage et administration (aucune écriture Discord)

**Variables (9)** : `LAUNCH_TEXTS_ENABLED`, `NAV_TOWER_ENABLED`, `PAGE_TITLES_ENABLED`, `PAGE_TITLES_DYNAMIC_ENABLED`, `GUIDE_V2_ENABLED`, `MEDIA_PRIVACY_ENABLED`, `HOME_V2_ENABLED`, `ADMIN_DASHBOARD_V2_ENABLED`, `COMMUNITY_ADMIN_ENABLED`.

**Vérifier après le redéploiement**
- Page de connexion, sans être connecté : la phrase « L'accès est réservé aux membres du serveur Discord The Tower » et le lien « Rejoindre le serveur » sont présents.
- Connecté : « The Tower » apparaît dans le menu (ordinateur et tiroir mobile). L’onglet du navigateur affiche le nom de la page suivi de « · GameNight » (par exemple sur `/sessions`).
- `/guide` montre les sections « Jouer maintenant » et « Tournois ».
- Une fiche de jeu avec bande-annonce affiche « Afficher la vidéo » au lieu de la vidéo.
- `/admin/tableau-de-bord` s'ouvre (admin). `/admin` montre l'onglet « Communautés ».
- Dans `/admin` → Communautés : activer pour The Tower les **équipes**, les **petites annonces de joueurs** et les **jeux gratuits** (prérequis des lots C, E et F). Ne **pas** activer la galerie (pas de stockage configuré, voir lot H).

**Retour arrière** : supprimer les 9 variables, Redeploy.

---

## Lot B — The Tower complète

**Prérequis** : P2, P3 faits ; salon des preuves configuré (`TOWER_DISCORD_CHANNEL_ID`, déjà présent).

**Variables (7)** : `TOWER_DISCORD_VOTES_ENABLED`, `TOWER_SEASON_AWARDS_ENABLED`, `TOWER_CHALLENGE_PROPOSALS_ENABLED`, `TOWER_CHALLENGE_REPLACEMENT_ENABLED`, `TOWER_IRREGULAR_GRANTS_ENABLED`, `TOWER_STEAM_AUTOVALIDATE_ENABLED`, `TOWER_TEAM_DAILY_ENABLED`.

**Hors Vercel** : `TOWER_TEAM_DAILY_ENABLED` est aussi lu par le workflow GitHub `tower-team-daily.yml`. Dans GitHub → Settings → Secrets and variables → Actions → **Variables** : `TOWER_TEAM_DAILY_ENABLED` = `true` et `GAMENIGHT_CRON_BASE_URL` = adresse du site (le secret `CRON_SECRET` doit exister côté GitHub). Ajouter aussi sur cron-job.org un appel toutes les 10 min à `/api/cron/tower-steam-autovalidate` (en-tête `Authorization: Bearer <CRON_SECRET>`).

**Vérifier**
- Une preuve déposée arrive dans le salon des preuves avec les boutons ✅/❌ et un fil. Un vote d'un compte présent depuis au moins 7 jours compte.
- `/tower/propositions` s'ouvre pour un Ranker et est refusée sous 30 étages. `/admin/tower-propositions` liste la proposition.
- Sur `/tower`, le bouton « Remplacer » apparaît pour un défi dont le jeu n'est pas possédé.
- `/admin/tower-irregular` permet de donner et retirer le grade.
- Le lendemain à 18 h (heure de Paris) : un défi d'équipe est attribué (GitHub → Actions → « tower-team-daily » vert).
- Un défi « mesurable Steam » se valide seul pour un profil Steam public.

**Retour arrière** : supprimer les 7 variables (et la variable GitHub), Redeploy.

---

## Lot C — Profil et joueurs

**Variables (9)** : `PROFILE_VISIBILITY_ENABLED`, `GAME_LEVELS_ENABLED`, `GAME_LEVELS_MATCHMAKING_ENABLED`, `GAME_PLATFORMS_ENABLED`, `DISCORD_CONNECTIONS_SCOPE_ENABLED`, `PROFILE_CUSTOMIZATION_ENABLED`, `WHO_PLAYS_TONIGHT_ENABLED`, `NOTIFICATION_CENTER_ENABLED`, `PLAYER_MATCHING_ENABLED` (après P6).

**Vérifier**
- `/profil/parametres` : masquer son profil. Un autre compte ne le voit plus dans `/potes`, mais le voit toujours dans les soirées communes.
- Déclarer un niveau sur un jeu, le voir sur `/potes/[id]` et filtrer `/joueurs` par niveau.
- `/bibliotheque/plateformes` s'ouvre ; une fiche de jeu affiche plateformes et crossplay.
- « Importer mes comptes liés » demande d'abord un accord ; les valeurs arrivent en suggestions.
- `/profil/personnalisation` : acheter une couleur avec de l'XP, la voir sur `/profil`.
- `/ce-soir` : se déclarer dispo pour 1 à 3 jeux.
- `/notifications` s'ouvre et liste les notifications.
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

**Prérequis** : équipes activées pour le serveur (lot A).

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

**Prérequis** : petites annonces et jeux gratuits activés pour le serveur (lot A) ; un salon d'annonces des jeux gratuits choisi dans `/admin` → Communautés.

**Variables (7)** : `COMMUNITY_QUICK_POLLS_ENABLED`, `COMMUNITY_GAME_GRAVEYARD_ENABLED`, `COMMUNITY_EXPRESSIONS_ENABLED`, `COMMUNITY_HIGHLIGHTS_ENABLED`, `FREE_GAME_FEED_ENABLED`, `DISCORD_BOT_FREE_GAME_ANNOUNCE_ENABLED`, `PROJECT_ORGANIZER_ENABLED`.

**Vérifier**
- `/profil/lore` : un sondage éclair, une épitaphe (admin), une expression (admin) et un exploit.
- `/jeux-gratuits` affiche des offres GamerPower, et une annonce part dans le salon choisi.
- `/projets` : créer un projet, valider une entrée ; un fil public et un fil privé apparaissent dans Discord.

**Retour arrière** : supprimer les 7 variables, Redeploy.

---

## Lot G — Écritures Discord (rôles, salons, signalement)

**Prérequis** : P4 (plus aucun bot Administrateur, GameNight avec ses 12 permissions) ; **suppression des 134 rôles « Étage »** confirmée (déjà faite le 20/11) ; un salon staff privé pour les signalements.

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
| `RETENTION_CLEANUP_ENABLED` + `RETENTION_CLEANUP_MODE` | Q5. **D'abord une semaine sans `MODE`** (simulation), puis `MODE=execute` | `/api/cron/retention-cleanup` rapporte ce qu'il **aurait** supprimé ; relire avant de passer en `execute` | Retirer `MODE` (retour à la simulation) |
| `WEB_PUSH_ENABLED` + `WEB_PUSH_VAPID_SUBJECT`, `WEB_PUSH_VAPID_PUBLIC_KEY`, `WEB_PUSH_VAPID_PRIVATE_KEY` | Q7. Les clés sont des **secrets** : Maxime les génère et les colle lui-même (Sensitive) | S'abonner sur un appareil, recevoir une notification de test | Supprimer les 4 variables |
| `SESSION_VIDEO_ENABLED` + `SESSION_MEDIA_BLOB_TOKEN` + galerie du serveur | Q6. Créer un magasin Blob **privé** ; jeton en Sensitive | Ajouter une photo, puis une vidéo de 4 Mo au plus, à une soirée | Supprimer les variables ; désactiver la galerie dans `/admin` |
| `VOICE_PRESENCE_ENABLED` | Q8. Décision de consentement et de durée (30 jours) | Soirée de test configurée : durées visibles par le créateur seulement | Supprimer la variable (la purge des données continue) |
| `RETENTION`… et `CSP_REPORT_ENABLED` | Après la PR sécurité (CSP bloquante) | `/api/csp-report` reçoit des rapports | Supprimer la variable |

---

## Journal des allumages (à remplir par ChatGPT)

| Lot | Date et heure | Branche de sauvegarde | Vérifications OK | Retour arrière fait ? |
| --- | --- | --- | --- | --- |
| A | | — | ☐ | |
| B | | | ☐ | |
| C | | — | ☐ | |
| D | | — | ☐ | |
| E | | | ☐ | |
| F | | — | ☐ | |
| G | | | ☐ | |
| G2 | | — | ☐ | |
| H | | | ☐ | |
