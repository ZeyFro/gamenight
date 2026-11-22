# Fiche de l'application GameNight

> Pour le propriétaire. Relevé du 22 novembre 2026 (code de `main` et lecture des variables de Production dans Vercel, sans rien modifier). Les mots techniques sont expliqués la première fois.

**En deux phrases.** GameNight est un site web qui aide les membres d'un serveur Discord à organiser leurs soirées jeux : choisir un jeu, voter, faire des tournois, des équipes et les défis de The Tower. On s'y connecte uniquement avec son compte Discord, et seuls les membres d'un serveur relié peuvent entrer.

---

## 1. À quoi sert chaque page

Adresse du site : `https://gamenight-zeyfro.vercel.app`. Une page « éteinte » répond « page introuvable » (404) tant que son interrupteur n'est pas allumé (voir section 3).

### Pages ouvertes à tout le monde (sans connexion)

| Page | À quoi elle sert |
| --- | --- |
| `/` | Page de connexion (bouton Discord). Une fois connecté : l'accueil. |
| `/bienvenue` | Premier passage d'un nouveau membre : il choisit ses jeux et ses préférences. |
| `/mentions-legales`, `/confidentialite`, `/conditions` | Textes légaux. **Allumées** en Production. |

### Le quotidien du membre

| Page | À quoi elle sert |
| --- | --- |
| `/accueil-v2` | Nouvelle page d'accueil (éteinte). |
| `/sessions` | Liste des soirées ; créer une soirée. |
| `/sessions/[id]` | Une soirée : invités, vote du jeu, chat, galerie de photos, résultats. |
| `/sessions/[id]/invites`, `/resultats`, `/vote-superlatifs` | Gérer les invités, noter le résultat, voter les « superlatifs » (le plus drôle, etc.). |
| `/sessions/sondages`, `/sessions/sondages/nouveau`, `/sessions/sondages/[id]` | Sondages de date pour trouver un soir commun. |
| `/disponibilites` | Indiquer ses jours libres de la semaine. |
| `/calendrier` | Agenda des soirées ; abonnement privé pour son téléphone (si allumé). |
| `/ce-soir` | « Qui joue ce soir ? » : se déclarer disponible (éteint). |
| `/jouer-maintenant`, `/jouer-maintenant/[id]` | Lancer une partie tout de suite avec ceux qui sont là. |
| `/roulette`, `/roulette/[id]` | Tirer un jeu au sort. |
| `/tournois`, `/tournois/creer`, `/tournois/[id]` | Tournois entre joueurs : inscription, tableau, résultats. |
| `/tournois/equipes`, `/tournois/equipes/[id]` | Tournois entre équipes (éteint). |
| `/equipes`, `/equipes/gestion`, `/equipes/candidatures`, `/equipes/[id]/rivalites` | Équipes : rejoindre, gérer, candidater, défier une autre équipe. |
| `/projets`, `/projets/[id]` | Projets de groupe avec un organisateur (éteint). |
| `/joueurs` | Chercher un joueur pour un jeu (petites annonces). |
| `/potes`, `/potes/[id]` et ses sous-pages | La liste des membres et la fiche de chacun (badges, bibliothèque, superlatifs, classement de jeux). |
| `/bibliotheque` et ses sous-pages | Les jeux possédés par chacun et par le groupe ; ajouter un jeu ; plateformes ; suggestions. |
| `/jeux/[id]` | Fiche d'un jeu (description, bande-annonce, joueurs). |
| `/jeux-gratuits` | Jeux gratuits du moment. |
| `/wishlist` | Jeux que le groupe aimerait acheter, avec votes. |
| `/tierlist` | Classement des jeux du groupe. |
| `/classement`, `/saisons`, `/recap/[année]/[mois]` | Classements d'XP (points d'expérience), saisons mensuelles, récapitulatif du mois. |
| `/ascension` | Progression par étages liée à l'XP. |
| `/notifications` | Centre de notifications (éteint). |
| `/serveurs` | Choisir son serveur quand on en a plusieurs. |
| `/soutiens` | Mur des membres qui boostent le serveur (éteint). |
| `/guide`, `/charte` | Mode d'emploi et règles de fair-play. |

### The Tower (les défis)

| Page | À quoi elle sert |
| --- | --- |
| `/tower` | Ses défis en cours, déposer une preuve, voter. **Allumée** en Production. |
| `/tower/palmares` | Palmarès de la saison. |
| `/tower/forums` | Discussions liées aux défis. |
| `/tower/propositions` | Les Ranker et High Ranker proposent des défis (éteint). |

### Le profil

| Page | À quoi elle sert |
| --- | --- |
| `/profil` | Son profil. |
| `/profil/parametres` | Réglages : pseudo des plateformes, liaison Steam, notifications, niveaux de jeu. |
| `/profil/compte` | Exporter ses données ou supprimer son compte. **Allumée.** |
| `/profil/badges`, `/historique`, `/saisons`, `/superlatifs`, `/tierlist` | Ses badges, son historique, ses saisons, ses superlatifs, son classement de jeux. |
| `/profil/boutique`, `/profil/personnalisation` | Dépenser son XP en décorations de profil (personnalisation éteinte). |
| `/profil/lore` et ses sous-pages | La mémoire du serveur : chroniques, cimetière des jeux, expressions, musée, sondages éclair, jeu « devine le jeu » (la plupart éteintes). |

### Administration (réservée)

| Page | À quoi elle sert |
| --- | --- |
| `/admin` | Tableau de bord des administrateurs de l'application : messages, badges, jeux, joueurs, communautés, nettoyage, réglages. |
| `/admin/tableau-de-bord` | Vue de surveillance en lecture seule (éteinte). |
| `/admin/sante` | État technique. |
| `/admin/discord-commands` | Enregistrer les commandes du bot (éteinte en Production, voir le risque n° 1). |
| `/admin/tower-*` | Contestations, grade Irregular, propositions, palmarès, archive, mise en page et contrôle du contenu de The Tower. |
| `/admin/voice-presence` | Temps passé en vocal pendant les soirées (éteint). |
| `/admin/jeux-gratuits`, `/admin/jeux-stats`, `/admin/messages`, `/admin/superlatifs` | Gérer ces contenus. |

---

## 2. Qui peut faire quoi

| Qui | Ce qu'il peut faire |
| --- | --- |
| **Visiteur** (pas connecté) | Voir la page de connexion et les pages légales. Rien d'autre. |
| **Compte Discord hors serveur** | Il est **refusé à la connexion** : seuls les membres d'un serveur Discord relié entrent. |
| **Nouveau membre** | Se connecter, passer par `/bienvenue`, puis tout le quotidien. |
| **Membre** (« Régulars » dans The Tower) | Soirées, votes, tournois, équipes, bibliothèque, profil, défis The Tower. Voter sur les preuves des autres après 7 jours de présence. |
| **Ranker** (au moins 30 étages) | Comme un membre. En plus, proposer des défis si l'interrupteur est allumé (éteint aujourd'hui). |
| **High Ranker** (au moins 100 étages et 5 défis validés dans la saison) | Comme un Ranker. Le grade est honorifique. |
| **Irregular** | Grade de prestige donné à la main par l'équipe. **Aucun droit en plus.** |
| **Modérateur** | **N'existe pas dans l'application.** La modération se fait sur Discord. Une personne avec le droit Discord « Gérer le serveur » peut utiliser `/tower-admin` et `/gamenight setup` dans Discord. |
| **Admin ou propriétaire du serveur** (rôle ADMIN / OWNER dans GameNight) | Trancher les contestations de défis, donner le grade Irregular, gérer le cimetière, les expressions et le contenu du serveur. |
| **Admin de l'application** (liste `ADMIN_DISCORD_IDS` dans Vercel) | Toutes les pages `/admin`. Peut se connecter même sans être membre, mais ne voit pas pour autant les données d'un serveur dont il n'est pas membre. |

---

## 3. Les interrupteurs (`*_ENABLED`)

Un interrupteur est une variable dans Vercel. Il n'est allumé que si sa valeur est **exactement** `true`. Absent = éteint.

**Ce que j'ai pu lire en Production.** Certaines variables sont rangées en « Sensible » dans Vercel : leur valeur est cachée, même en lecture. Pour celles-là, je sais seulement qu'elles existent. Leur état est noté « présent (valeur cachée) » : à vérifier toi-même dans Vercel.

### Allumés (lu en clair)

| Interrupteur | Ce que ça change pour un membre |
| --- | --- |
| `TOWER_CHALLENGES_ENABLED` | Les défis de The Tower sont ouverts. |
| `TOWER_DISCORD_ANNOUNCE_ENABLED` | Les preuves (avec accord) et les réussites sont annoncées dans Discord. |
| `ACCOUNT_DELETION_ENABLED` | Chacun peut exporter ses données et supprimer son compte. |
| `LEGAL_PAGES_ENABLED` | Les pages légales sont en ligne, avec un lien en bas de chaque page. |
| `SKIP_LINK_ENABLED` | Un lien « Aller au contenu » pour la navigation au clavier. |

### Présents, valeur cachée (à vérifier dans Vercel)

| Interrupteur | Ce que ça change s'il vaut `true` |
| --- | --- |
| `NOTIFICATION_EXECUTOR_ENABLED` | **Indispensable** : sans lui, aucun message Discord ne part (annonces, MP, votes). |
| `DISCORD_BOT_SESSION_ANNOUNCE_ENABLED`, `DISCORD_BOT_TOURNAMENT_ANNOUNCE_ENABLED` | Le bot annonce les soirées et les tournois dans leur salon. |
| `DISCORD_DM_SESSION_ENABLED`, `DISCORD_DM_TOURNAMENT_ENABLED`, `DISCORD_DM_ROULETTE_ENABLED` | Le bot envoie des messages privés d'invitation. |
| `COMMUNITY_CHANNELS_ENABLED` | Chaque serveur a ses propres salons d'annonce. |
| `COMMUNITY_ISOLATION_ENABLED` | Chaque serveur ne voit que ses propres données (filtres renforcés). |
| `COMMUNITY_PICKER_ENABLED` | La page `/serveurs` pour choisir son serveur. |
| `COMMUNITY_AUTO_CREATE_ENABLED`, `COMMUNITY_SETUP_COMMAND_ENABLED` | Un nouveau serveur Discord peut s'ajouter tout seul, puis s'activer avec `/gamenight setup`. |
| `STEAM_NOW_PLAYING_ENABLED` | Indicateur « En jeu » sur `/potes`. |
| `DISCORD_THREAD_CLEANUP_ENABLED` (+ `_MODE`), `DISCORD_THREAD_CLOSE_ON_END_ENABLED` | Archivage automatique des fils Discord des soirées finies. |
| `AUTH_REQUIRE_GUILD_MEMBER` | **Sans effet** aujourd'hui (la connexion est toujours réservée aux membres). |

### Éteints (absents de Production)

Tous les autres sont éteints. Les plus visibles pour un membre :

| Interrupteur | Si on l'allume |
| --- | --- |
| `DISCORD_COMMAND_REGISTRATION_ENABLED` | Page `/admin/discord-commands` pour enregistrer les 13 commandes du bot. **Absent** : les commandes ne peuvent pas être enregistrées depuis le site. |
| `TOWER_TEAM_DAILY_ENABLED` | Un défi d'équipe chaque jour à 18 h. |
| `TOWER_DISCORD_VOTES_ENABLED` | Voter sur les preuves avec des boutons dans Discord. |
| `TOWER_STEAM_AUTOVALIDATE_ENABLED` | Validation automatique des défis mesurables par Steam. |
| `TOWER_SEASON_AWARDS_ENABLED`, `TOWER_CHALLENGE_PROPOSALS_ENABLED`, `TOWER_CHALLENGE_REPLACEMENT_ENABLED`, `TOWER_IRREGULAR_GRANTS_ENABLED`, `TOWER_ONBOARDING_PANEL_ENABLED`, `TOWER_DISCORD_PREFLIGHT_ENABLED` | Récompenses de fin de saison, propositions de défis, remplacement d'un défi, grade Irregular par page, panneau d'accueil Discord, inventaire des salons. |
| `NAV_TOWER_ENABLED` | Lien « The Tower » dans le menu. **Éteint : la Tour n'est pas dans le menu.** |
| `LAUNCH_TEXTS_ENABLED` | Phrase « réservé aux membres du serveur The Tower » et lien d'invitation sur la page de connexion. |
| `MEDIA_PRIVACY_ENABLED` | Bande-annonce YouTube seulement après un clic ; accord des personnes sur les photos. |
| `NOTIFICATION_CENTER_ENABLED`, `WEB_PUSH_ENABLED` | Centre de notifications ; notifications du navigateur. |
| `DISCORD_REPORT_COMMAND_ENABLED` | Clic droit « Signaler » sur un message Discord. |
| `RETENTION_CLEANUP_ENABLED` | Purge automatique (chat des soirées finies depuis 7 jours, etc.). **Éteint : rien n'est purgé.** |
| `VOICE_PRESENCE_ENABLED`, `DISCORD_BOOSTERS_ENABLED` | Temps en vocal ; soutiens Nitro. |
| `SESSION_VISIBILITY_ENABLED`, `SESSION_VIDEO_ENABLED`, `SESSION_CHRONICLES_ENABLED`, `SESSION_PREPARATION_ENABLED`, `SESSION_SERIES_CANCEL_ENABLED` | Soirées publiques ou sur candidature ; vidéos ; chroniques ; checklist de préparation ; annulation d'une série. |
| `TOURNAMENT_TEAMS_ENABLED`, `TOURNAMENT_SCORES_ENABLED`, `TOURNAMENT_PREDICTIONS_ENABLED` | Tournois par équipes ; scores ; pronostics. |
| `TEAM_APPLICATIONS_ENABLED`, `TEAM_RECRUITERS_ENABLED`, `TEAM_RECRUITMENT_CRITERIA_ENABLED`, `TEAM_RIVALRIES_ENABLED`, `TEAM_CAPTAIN_HANDOVER_ENABLED`, `DISCORD_TEAM_SPACES_ENABLED` | Candidatures, recruteurs, critères, rivalités, passation de capitaine, salons Discord d'équipe. |
| `PROFILE_CUSTOMIZATION_ENABLED`, `PROFILE_VISIBILITY_ENABLED`, `GAME_LEVELS_ENABLED`, `GAME_LEVELS_MATCHMAKING_ENABLED`, `GAME_PLATFORMS_ENABLED`, `DISCORD_CONNECTIONS_SCOPE_ENABLED` | Décoration du profil, profil masqué, niveaux par jeu, plateformes et crossplay, import des comptes liés. |
| `COMMUNITY_QUICK_POLLS_ENABLED`, `COMMUNITY_GAME_GRAVEYARD_ENABLED`, `COMMUNITY_EXPRESSIONS_ENABLED`, `COMMUNITY_HIGHLIGHTS_ENABLED`, `COMMUNITY_ADMIN_ENABLED` | Sondages éclair, cimetière, expressions, exploits, onglet Communautés de l'admin. |
| `PROJECT_ORGANIZER_ENABLED`, `WHO_PLAYS_TONIGHT_ENABLED`, `CALENDAR_SUBSCRIPTIONS_ENABLED`, `FREE_GAME_FEED_ENABLED`, `DISCORD_BOT_FREE_GAME_ANNOUNCE_ENABLED`, `DISCORD_BOT_INSTANT_SESSION_INVITE_ENABLED` | Projets, « Qui joue ce soir », agenda sur téléphone, jeux gratuits automatiques et leur annonce, invitation « Jouer maintenant » par MP. |
| `VOTE_VETO_ENABLED`, `ROULETTE_PLAYER_FILTER_ENABLED`, `GAME_PREPARATION_TIME_ENABLED` | Veto au vote, roulette selon le nombre de joueurs, temps d'installation d'un jeu. |
| Commandes Discord `DISCORD_*_COMMAND_ENABLED` et `*_WRITE_ENABLED` (`/role`, `/profil`, `/boost`, `/projet`, `/soiree`, `/tournoi`, `/joueurs`) | Ces commandes répondent dans Discord. |
| `HOME_V2_ENABLED`, `GUIDE_V2_ENABLED`, `PAGE_TITLES_ENABLED`, `PAGE_TITLES_DYNAMIC_ENABLED`, `ADMIN_DASHBOARD_V2_ENABLED`, `CSP_REPORT_ENABLED` | Nouvel accueil, guide complet, titres d'onglet, tableau de bord staff, rapport des alertes de sécurité du navigateur. |

---

## 4. Les données stockées

Toutes les données sont dans une base PostgreSQL chez **Neon**, à Francfort. Une « table » est un tableau de la base. Les photos et bannières sont chez **Vercel Blob** (stockage de fichiers).

### Comptes et profils

| Table | Ce qu'elle contient |
| --- | --- |
| `User` | Le compte : identifiant, pseudo et avatar Discord, jetons de connexion chiffrés, pseudos de plateformes, couleur, XP. |
| `Membership` | Le lien entre un compte et un serveur, avec son rôle (membre, admin, propriétaire) et son statut. |
| `Community` | Un serveur Discord relié à GameNight. |
| `CommunityChannelConfig` | Les salons Discord où annoncer, par serveur. |
| `CommunityDate` | Dates du serveur (anniversaires jour et mois, événements). |
| `UserProfileVisibility` | Le choix de masquer son profil. |
| `ProfileCustomization`, `ProfileEntitlement`, `UserProfileEffectsPreference` | Décorations du profil, décorations obtenues, choix de couper les effets animés. |
| `PlatformConnectionSuggestion` | Pseudos de plateformes proposés depuis les comptes liés Discord, en attente d'accord. |
| `UserGameLevel` | Niveau déclaré par jeu. |
| `UserTag`, `Tag` | Étiquettes de profil. |
| `UserNotificationPreference`, `UserNotificationChannelPreference` | Réglages de notification. |
| `WebPushSubscription` | Abonnements aux notifications du navigateur. |
| `CalendarFeedToken` | Liens privés d'agenda (jeton stocké sous forme brouillée). |
| `GamePingOptIn` | Jeux pour lesquels on veut être prévenu. |
| `CommunityMemberCosmetic`, `CommunityMemberStats` | Décorations et statistiques d'un membre dans un serveur. |
| `UserLifetimeStats`, `GameStyleProfile` | Statistiques cumulées ; profil de style de jeu (tryharder, ambianceur, stratège, chaos). |
| `BoosterSupport`, `BoosterSupportSpace` | Membres qui boostent le serveur, et salons créés pour eux. |
| `AccountDeletionLog` | Journal des suppressions de compte, sans donnée personnelle. |

### Jeux

| Table | Ce qu'elle contient |
| --- | --- |
| `Game`, `GameNews`, `GameStatType` | Les jeux (venant d'IGDB et de Steam), leurs actualités, les types de statistiques. |
| `UserGame`, `UserGameRefusal` | Jeux possédés par chacun ; jeux qu'il refuse de jouer. |
| `GameWishlist`, `GameWishlistVote` | Liste d'envies du groupe et ses votes. |
| `TierlistEntry` | Classement personnel des jeux. |
| `FreeGameOffer` | Offres de jeux gratuits. |
| `CommunityGameEpitaph` | Cimetière des jeux abandonnés. |
| `GroupGameStat` | Statistiques de jeu du groupe. |

### Soirées

| Table | Ce qu'elle contient |
| --- | --- |
| `Session`, `SessionInvite`, `SessionSeat`, `SessionApplication` | Une soirée, ses invités, ses places, les candidatures. |
| `Proposal`, `Vote`, `SessionVeto` | Les jeux proposés, les votes, les vetos. |
| `SessionResult`, `SessionAttendance`, `SessionRating` | Le résultat, qui était là, les notes. |
| `ChatMessage`, `ChatReaction` | Le chat de la soirée et ses réactions. |
| `SessionGalleryMedia` | Photos et vidéos de la soirée. |
| `SessionDiscordSpace` | Fil et vocal Discord temporaires de la soirée. |
| `SessionPreparation` | Checklist de préparation de chacun. |
| `SessionVoicePresenceInterval`, `…Consent`, `…Control`, `…Gap` | Temps passé en vocal, accord et réglages de collecte (éteint). |
| `SessionAvailabilityPoll`, `…Participant`, `…Slot`, `…Response` | Sondages de date. |
| `WeeklyAvailability`, `AvailabilityOverride` | Jours libres habituels et exceptions. |
| `Pronostic`, `XpBet` | Pronostics et paris d'XP sur une soirée. |
| `Superlative`, `SuperlativeCategory`, `SuperlativeVote`, `SuperlativeAward` | Les superlatifs, leurs votes et leurs gagnants. |
| `MessageTemplate` | Modèles de message des admins. |
| `CreationIntent` | Reçu d'une tentative de création (soirée, vote…), gardé même après la purge. |
| `InstantSession`, `InstantSessionPresenceInterval`, `InstantSessionInterest` | Parties « Jouer maintenant », présence, intéressés. |
| `Roulette`, `RouletteEntry`, `RouletteVeto` | Roulettes, leurs jeux, leurs vetos. |
| `PlayerClassified` | Petites annonces « cherche joueur ». |

### Tournois et équipes

| Table | Ce qu'elle contient |
| --- | --- |
| `Tournament`, `TournamentParticipant`, `TournamentMatch`, `TournamentPrediction` | Tournoi, inscrits, matchs, pronostics. |
| `TournamentTeam`, `TournamentTeamMember`, `TournamentTeamSettings`, `TournamentTeamEntry`, `TournamentMatchReport` | Tournois par équipes : équipes, membres, réglages, inscriptions, résultats déclarés. |
| `CommunityTeam`, `CommunityTeamMember`, `CommunityTeamRecruiter` | Équipes du serveur, leurs membres, leurs recruteurs. |
| `TeamApplication`, `TeamRecruitmentCriteria`, `TeamTournamentGuest` | Candidatures, critères de recrutement, invités de tournoi. |
| `DiscordTeamSpace` | Salons Discord d'équipe. |
| `Project`, `ProjectEntry` | Projets et participations. |

### The Tower

| Table | Ce qu'elle contient |
| --- | --- |
| `TowerChallengeDefinition` | Le catalogue des défis. |
| `TowerChallengeAttempt`, `TowerChallengeAttemptParticipant` | Un défi attribué et ses participants. |
| `TowerChallengeProgress` | Les étages gagnés par chacun et la date de son dernier défi solo. |
| `TowerChallengeVote`, `TowerChallengeAppeal` | Votes sur les preuves ; contestations. |
| `TowerChallengeProposal`, `TowerChallengeReplacement` | Défis proposés par les joueurs ; défis remplacés. |
| `TowerIrregularGrant`, `TowerIrregularLog` | Grades Irregular donnés et leur journal. |
| `TowerSeasonAward`, `TowerSeasonVote`, `TowerSeasonVoteBallot` | Récompenses et votes de saison. |
| `TowerArbiterConfigurationChange` | Journal des changements d'arbitre. |

### XP, badges, saisons, groupe

| Table | Ce qu'elle contient |
| --- | --- |
| `XpEvent`, `XpAdjustment`, `LevelUpEvent` | Gains d'XP, corrections, passages de niveau. |
| `Badge`, `UserBadge` | Badges et badges gagnés. |
| `Season`, `SeasonSnapshot`, `MonthlyRecap` | Saisons d'XP, photo des classements, récapitulatif mensuel. |
| `TeamChallenge`, `WeeklyChallenge`, `GroupAchievement` | Défis collectifs et succès du groupe. |
| `GroupSessionStats`, `GroupActiveWeek` | Statistiques des soirées et semaines actives. |
| `Debt` | Gages entre membres (le perdant d'un pari doit un gage) ; une dette non soldée bloque la purge de sa soirée. |

### Communauté et modération

| Table | Ce qu'elle contient |
| --- | --- |
| `CommunityQuickPoll`, `CommunityQuickPollVote` | Sondages éclair et réponses. |
| `CommunityExpression`, `CommunityHighlight` | Expressions et exploits du serveur. |
| `ModerationReport` | Signalements de messages Discord (extrait de 500 caractères au plus). |
| `DiscordRoleRequest` | Demandes de création de rôle de jeu. |

### Fonctionnement interne

| Table | Ce qu'elle contient |
| --- | --- |
| `Notification` | Notifications affichées dans le site. |
| `NotificationEvent`, `NotificationDelivery` | La file des messages Discord à envoyer, et l'état de chaque envoi. |
| `CronLock` | Verrou qui empêche une tâche automatique de tourner deux fois en même temps. |

### Services externes

| Service | À quoi il sert |
| --- | --- |
| **Vercel** | Héberge le site (à Francfort) et les fichiers (bannières, photos). |
| **Neon** | La base de données (à Francfort). |
| **Discord** | Connexion, bot, annonces, messages privés. |
| **Steam (Valve)** | Liaison facultative : jeux possédés, temps de jeu. |
| **IGDB (Twitch)** | Fiches des jeux. |
| **DeepL** | Traduction des descriptions de jeux. Aucun texte de membre n'y est envoyé. |
| **GamerPower** | Offres de jeux gratuits (si allumé). |
| **YouTube (Google)** | Bandes-annonces sur les fiches de jeu. |
| **GitHub** | Le code, les vérifications automatiques (CI) et l'application des migrations. |
| **cron-job.org** (prévu par les docs) | Appelle régulièrement les tâches automatiques. Configuration hors du code. |

---

## 5. Les tâches automatiques

Une tâche automatique (« cron ») est une adresse du site qu'un service extérieur appelle à heure fixe. Toutes exigent un mot de passe technique (`CRON_SECRET`, présent en Production) : sans lui, elles répondent « refusé ». **Le code ne crée aucun horaire.** Les horaires sont réglés à part, sur cron-job.org ; je ne peux pas les voir d'ici. Seul le défi d'équipe quotidien est planifié dans GitHub.

| Tâche | Ce qu'elle fait | État |
| --- | --- | --- |
| `notification-executor` | Envoie les messages Discord en attente ; clôt les défis et les votes. **La plus importante.** | Dépend de `NOTIFICATION_EXECUTOR_ENABLED` (valeur cachée) et de cron-job.org (non vérifiable). |
| `reminders` | Rappels de soirée ; clôture des projets ; espaces de soirée. | Horaire non vérifiable. |
| `close-sessions` | Termine les soirées passées. | Horaire non vérifiable. |
| `monthly-tasks` | Saison d'XP du mois, récapitulatif. | Horaire non vérifiable. |
| `refresh-discord-profiles` | Met à jour pseudos et avatars. | Horaire non vérifiable. |
| `steam-library-sync`, `steam-library-full-sync` | Synchronise les bibliothèques Steam. | Horaire non vérifiable. |
| `community-guild-sync` | Repère les nouveaux serveurs Discord. | Horaire non vérifiable. |
| `discord-thread-cleanup` | Archive les fils des soirées finies. | Interrupteur présent (valeur cachée). |
| `retention-cleanup` | Purge les anciennes données. | **Éteint.** |
| `tower-team-daily` | Défi d'équipe quotidien (GitHub, vers 18 h, heure de Paris). | **Éteint** (interrupteur absent). |
| `tower-steam-autovalidate`, `booster-sync`, `free-game-discord`, `team-applications`, `team-captain-handover`, `tournament-teams` | Validation Steam, boosters, jeux gratuits, candidatures, capitaines, tournois par équipes. | **Éteints** (interrupteurs absents). |
| `backfill/*` | Rattrapages ponctuels (jeux, actualités, Steam). | À la demande. |
| Migrations | Appliquées automatiquement après chaque fusion dans `main` qui en contient une (GitHub, « Migrations Production »). | 27 exécutions, toutes réussies. |

---

## 6. Limites des offres gratuites à surveiller

| Service | Limite qui peut gêner | Pourquoi c'est un risque |
| --- | --- | --- |
| **Vercel (offre Hobby)** | Usage non commercial seulement. Journaux d'exécution gardés **1 heure**. Quotas mensuels de calcul et de bande passante. | Une panne de la nuit est invisible le matin. Un afflux à l'ouverture peut atteindre les quotas. |
| **Vercel Blob** | Quota de stockage et de transfert. | Les photos et bannières remplissent vite le quota. La galerie n'est d'ailleurs pas configurée (pas de `SESSION_MEDIA_BLOB_TOKEN`). |
| **Neon (offre gratuite)** | Espace de stockage limité et temps de calcul mensuel limité. | Sans purge (`RETENTION_CLEANUP` éteint), la base grossit sans fin. |
| **Discord** | 250 rôles et 500 salons par serveur ; nombre d'appels par seconde limité. | Les salons d'équipe ou de soirée peuvent saturer le serveur ; une rafale d'annonces est ralentie. |
| **GitHub Actions** | Minutes de calcul limitées si le dépôt est privé. | Chaque vérification d'une PR dure environ 20 à 25 minutes. |
| **cron-job.org** | Coupe un appel au bout de 30 secondes. | Prévu dans le code (les longues tâches répondent tout de suite et continuent après). |

Les chiffres exacts changent avec les offres : vérifie-les sur chaque console avant l'ouverture.

---

## 7. Les 10 risques les plus importants pour l'ouverture publique

1. **Les commandes Discord ne peuvent pas être enregistrées depuis le site.** `DISCORD_COMMAND_REGISTRATION_ENABLED` et son secret ne figurent pas dans les variables de Production lues le 22/11, et `/admin/discord-commands` répond 404. Sans les commandes, pas de `/aide`, pas de `/tower-admin`, pas de « Signaler ».
2. **Les messages Discord peuvent ne pas partir.** Tout dépend de `NOTIFICATION_EXECUTOR_ENABLED` (valeur cachée) et des appels réguliers de cron-job.org (non vérifiables d'ici). Si l'un manque, les annonces, MP et votes restent bloqués, et les défis ne sont pas clos.
3. **Le catalogue de défis était vide** au relevé du 20/11. Avec la Tour ouverte, un membre peut n'avoir aucun défi.
4. **Le bot a le droit Administrateur** sur Discord (rôles Workshop et AppBot). En cas de fuite du jeton du bot, tout le serveur est exposé.
5. **La Tour n'est pas dans le menu** (`NAV_TOWER_ENABLED` éteint), et la page de connexion n'explique pas que l'accès est réservé (`LAUNCH_TEXTS_ENABLED` éteint) : risque de confusion et de demandes d'aide.
6. **Aucune surveillance de disponibilité** n'est prouvée, et les journaux ne durent qu'une heure. Une panne peut passer inaperçue.
7. **Rien n'est purgé** (`RETENTION_CLEANUP_ENABLED` éteint) : la base Neon gratuite peut se remplir. Le chat des soirées n'est pas effacé, alors que la politique de confidentialité parle d'une purge « lorsqu'elle est active ».
8. **Protection anti-abus limitée** : les limites de débit sont gardées en mémoire, une par serveur. Plusieurs serveurs Vercel en parallèle peuvent les contourner. La politique de sécurité du navigateur (CSP) n'est qu'en mode « observation ».
9. **Une seule personne fait tout.** Un seul propriétaire, une seule adresse de contact, publiée sur les pages légales (risque de spam), et aucun modérateur prévu dans l'application.
10. **Chaque fusion dans `main` redéploie la Production**, même pour de la documentation, et les 5 mises à jour Dependabot attendent (dont #501, rouge). Une fusion pendant la semaine d'ouverture peut casser le site.
