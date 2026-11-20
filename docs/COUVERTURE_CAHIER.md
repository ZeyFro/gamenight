# Couverture du cahier des charges The Tower 2.0 — état réel de `main` au 20/11/2026

Méthode : chaque section de `docs/CAHIER_DES_CHARGES.md` et chaque décision de `docs/DECISIONS_TOWER.md` relues contre le code de `main` (`6c0b25b`, après la fusion des 33 PR du lot Tower 2.0 et du cahier v1.1). Cette page remplace la version du 17/11 (alors établie sur `23f58a8d`, avec des PR ouvertes). **Aucune PR de ce lot n'est plus ouverte.**

Statuts : **Livré** (sur `main`, actif sans interrupteur) · **Livré désactivé** (sur `main`, derrière un interrupteur OFF ; la migration éventuelle est dans `prisma/migrations/`) · **Partiel** · **Manquant** · **Non vérifié** (dépend de Discord, de Vercel ou de Neon, illisible depuis le dépôt) · **Hors périmètre v1**. « Livré désactivé » ne dit rien de l'état réel de la Production : aucun interrupteur n'est activé par ce dépôt ; l'ordre d'activation est dans [ACTIVATION_TOUR.md](ACTIVATION_TOUR.md).

Numérotation : le brief de tâche renvoie à des §6-7, §8.2-8.3, §9, §10 qui ne correspondent pas à ce cahier. Correspondance retenue : recherche de joueurs = §12, candidatures d'équipe = §11.1, projets = §11.3 (forum « Projets et aventures »), visibilité du profil = §12.3-12.4.

## Écarts code / décisions du 17/11 — tous résolus sur `main`

| Règle décidée | Code de `main` | Fichier |
| --- | --- | --- |
| High Ranker : ≥ 100 étages + ≥ 5 défis validés sur la saison en cours | Aligné | `src/lib/tower-ranks.ts` |
| Couleurs : Régulars gris, Irregular violet, Ranker or, High Ranker rouge | Aligné (`#6b7280`, `#8b5cf6`, `#f59e0b`, `#dc2626`) | `src/lib/tower-ranks.ts` |
| Irregular = attribution manuelle staff ; Régulars dès l'inscription | Aligné ; attribution stockée (`TowerIrregularGrant`), derrière `TOWER_IRREGULAR_GRANTS_ENABLED` | `src/lib/tower-ranks.ts`, migration `20261118122000_tower_irregular_grants` |
| S1 du 01/12/2026 au 31/03/2027, puis avril–juin, été juillet–août, septembre–novembre | Aligné : 4 périodes couvrant l'année, plus d'intersaison | `src/lib/tower-challenge-seasons.ts` |
| Défi d'équipe attribué à 18:00 Europe/Paris | Aligné : cron `0 16,17 * * *` avec contrôle de l'heure de Paris | `.github/workflows/tower-team-daily.yml`, `docs/TOWER_TEAM_DAILY_CRON.md` |
| Sans quorum à 24 h : prolongation unique de 24 h puis rejet sans pénalité, une resoumission | Aligné | `src/lib/tower-challenge-voting.ts`, migration `20261118120000_tower_vote_extension_resubmission` |
| Contestation ouverte 48 h après la décision | Aligné (`TOWER_CHALLENGE_APPEAL_WINDOW_MS` = 48 h) | `src/lib/tower-challenge-appeal-rules.ts` |
| Équipes 2 à 8, équipe unique, délai 7 jours | Aligné (`maxMembers` 2–8) | `src/lib/community-teams-rules.ts`, migration `20261104140000_tower_team_membership_policy` |
| Récompenses cosmétiques uniquement ; le top 1 propose un défi pour la saison suivante | Inchangé ; s'ajoutent les propositions des Ranker / High Ranker validées par le staff. **À confirmer par le propriétaire** | `src/lib/tower-season-proposal.ts`, `TOWER_CHALLENGE_PROPOSALS_ENABLED` |

## Par section du cahier

| § | Exigence | Statut | Fichiers / remarques |
| --- | --- | --- | --- |
| 3 | Organisation du serveur (gabarit, permissions) | Livré désactivé | `src/lib/tower-discord-layout.json`, `scripts/provision-tower-layout.mjs` (dry-run), `docs/TOWER_COMMANDES_GUILD.md` ; aucune écriture Discord réelle autorisée |
| 4 | Onboarding Discord d'abord, panneau 3 boutons | Livré désactivé | `src/lib/tower-onboarding-panel.ts`, `tower-onboarding-actions.ts` (`TOWER_ONBOARDING_PANEL_ENABLED`), `docs/TOWER_ONBOARDING_PANEL_SETUP.md` ; publication par workflow dédié |
| 5 | Identité visuelle | Partiel | thème existant ; harmonisation Discord hors dépôt |
| 6.1 | Grades Régulars / Irregular / Ranker / High Ranker | Livré | `tower-ranks.ts` (30 / 100 + 5 défis) ; Irregular manuel : Livré désactivé (`TOWER_IRREGULAR_GRANTS_ENABLED`) |
| 6.2 | Aucun droit de modération par grade | Livré | rangs cosmétiques ; les droits viennent de `Membership.role` |
| 6.3 | Remplacement des 134 rôles Étage | Livré désactivé / Non vérifié | inventaire en lecture seule `scripts/audit-tower-etage-roles.mjs`, `docs/TOWER_ROLE_REVIEW.md` ; suppression = action manuelle du propriétaire, non faite, **prérequis de `DISCORD_ROLE_AUTOCREATE_ENABLED`** |
| 7.1-7.4 | Ascension infinie, étages permanents, barème 1/2/3 | Livré désactivé | `tower-progression.ts`, `tower-personal-progress.ts`, `/ascension` (`TOWER_CHALLENGES_ENABLED` + drapeau communautaire) |
| 7.2 | Pas de double source avec Atlas | Partiel / Non vérifié | procédure `docs/TOWER_ATLAS_ARRET.md` ; arrêt effectif côté Discord à faire par le propriétaire |
| 8.2 | Défi solo : 1 attribution / 12 h, 48 h pour réaliser | Livré désactivé | `tower-challenge-rules.ts`, `tower-challenges.ts` |
| 8.3 | Défi d'équipe quotidien à 18:00 | Livré désactivé | `tower-team-daily.ts`, route `/api/cron/tower-team-daily`, workflow ; `TOWER_TEAM_DAILY_ENABLED` (Vercel **et** variable GitHub) |
| 8.4 | Max 2 réussites validées par jour | Livré désactivé | `canReceiveChallengeReward`, `remainingChallengeRewardsToday` |
| 8.5-8.6 | Variété, remplacement si jeu non possédé | Livré désactivé | catalogues de départ + S1 (`tower-s1-solo-catalogue.ts`, `tower-s1-team-catalogue.ts`) ; remplacement : `TOWER_CHALLENGE_REPLACEMENT_ENABLED`, migration `20261118122100_tower_challenge_replacement` ; `docs/TOWER_SAISON1_CATALOGUE_30.md` à relire (le code contient 116 défis) |
| 8.7 | Proposition de défis par les grades élevés | Livré désactivé | `TOWER_CHALLENGE_PROPOSALS_ENABLED`, migration `20261118122200_tower_rank_challenge_proposals` |
| 9.1 | Dépôt de preuve, consentement de publication, code de preuve | Livré désactivé | `tower-challenges.ts` (`publicationConsent`, `proofCode`) |
| 9.2 | Vote 24 h, 3 votants, majorité, pas d'auto-vote, égalité = non validé, prolongation unique | Livré désactivé | `tower-challenge-voting.ts` |
| 9.2 bis | Votes de preuves dans Discord (sujet B) | Livré désactivé | `TOWER_DISCORD_VOTES_ENABLED`, **sans migration** ; voir [TOWER_VOTES_DISCORD.md](TOWER_VOTES_DISCORD.md) |
| 9.3 | Contestations, arbitre fixe, 1 par défi, fenêtre 48 h | Livré désactivé | `TowerChallengeAppeal`, migration `20261106150000_tower_fixed_arbiter` |
| 9.4 | Aucune IA de validation | Livré | aucun appel IA dans le code (la validation Steam du sujet C est une mesure de données, pas une IA) |
| 10 | Annonces de réussites (consentement) | Livré désactivé | `tower-challenge-announcements.ts` (`TOWER_DISCORD_ANNOUNCE_ENABLED`) |
| 10.3 | Récapitulatifs hebdomadaires, mise en avant | Partiel | `/recap`, `/classement` ; pas de récap Tower dédié |
| 11.1 | Découvrir, créer, rejoindre une équipe | Livré | `/equipes`, `community-teams.ts` |
| 11.1 | Candidatures, recruteurs, invités d'équipe | Livré désactivé | `TEAM_APPLICATIONS_ENABLED` (migration `20261118103000_team_applications`), `TEAM_RECRUITERS_ENABLED` (sujet A, `20261118130000_team_recruiters_guest`) |
| 11.2 | Nom, présentation, capitaine, membres, jeux, critères de recrutement | Livré désactivé | critères : `TEAM_RECRUITMENT_CRITERIA_ENABLED`, migration `20261118123000_team_recruitment_criteria` |
| 11.3 | Forums, tags | Livré désactivé | `tower-forums.ts`, `/tower/forums`, `docs/TOWER_FORUM_TAGS.md` ; création sur Discord : Non vérifié |
| 11.3 | « Projets et aventures » | Livré désactivé | `/projet` (`DISCORD_PROJECT_COMMAND_ENABLED`, `DISCORD_PROJECT_WRITE_ENABLED`), `/projets` à organisateur (`PROJECT_ORGANIZER_ENABLED`, sujet G), espaces d'équipe (`DISCORD_TEAM_SPACES_ENABLED`) |
| 11.4 | Équipes : 2–8, équipe unique, délai 7 j, capitaine | Livré | `community-teams.ts`, `community-team-handover.ts` (passation à 30 jours d'inactivité : OFF et simulation par défaut) |
| 12.2-12.3 | Chercher un joueur par jeu, filtres plateforme / disponibilité / mode / micro | Livré désactivé | `/joueurs`, `player-classifieds.ts`, `player-classified-filters.ts` (`playerClassifiedsEnabled`) |
| 12.2 | Filtre niveau de jeu | Livré désactivé | `GAME_LEVELS_ENABLED` ; matchmaking : `GAME_LEVELS_MATCHMAKING_ENABLED` (sans migration) |
| 12.3 | « Qui joue ce soir ? » | Livré désactivé | `/ce-soir` (`WHO_PLAYS_TONIGHT_ENABLED`) |
| 12.3 | Respect de la visibilité du profil | Livré désactivé | `profile-visibility.ts`, `PROFILE_VISIBILITY_ENABLED`, migration `20261118103100_profile_visibility` ; ne couvre pas classements ni soirées |
| 12.4 | Profil : jeux favoris, plateformes, niveaux, disponibilités | Livré désactivé | plateformes : `GAME_PLATFORMS_ENABLED` ; niveaux : `GAME_LEVELS_ENABLED` ; personnalisation : `PROFILE_CUSTOMIZATION_ENABLED` |
| 13 | Soirées, calendrier, tournois, roulette | Livré | `/sessions`, `/calendrier`, `/tournois`, `/roulette` ; visibilité des soirées et tournois par équipes : Livré désactivé (sujets D et E) |
| 14.1-14.2 | Calendrier des saisons | Livré | `tower-challenge-seasons.ts` (S1 01/12 → 31/03, avril–juin, été, septembre–novembre) ; actif avec l'Ascension |
| 14.3 | Classements individuel, saisonnier, permanent | Livré désactivé | `tower-standings.ts`, `towerSeasonTotals` ; palmarès `/tower/palmares` |
| 14.3 | Classement d'équipes | Partiel | `/classement` ; pas de classement d'équipes Tower ; rivalités entre équipes : Livré désactivé (`TEAM_RIVALRIES_ENABLED`) |
| 14.4 | Réinitialisation saisonnière, étages conservés | Livré désactivé | `tower-season-rules.ts` |
| 15 | Récompenses cosmétiques, Hall of Fame | Livré désactivé / Partiel | titres et cadres saisonniers : `TOWER_SEASON_AWARDS_ENABLED`, migration `20261118122300_tower_season_awards` ; podium `tower-season-podium.ts` ; remise manuelle : `docs/TOWER_S1_REWARDS_MANUAL.md` |
| 16 | Le Sommet | Livré désactivé | `/tower/palmares` |
| 17 | Salons vocaux temporaires | Hors périmètre v1 le 17/11 ; repris en v1.1 | sujet D : fil privé et vocal temporaires des soirées, `SESSION_VISIBILITY_ENABLED` (Livré désactivé) |
| 18 | Bots historiques (YAGPDB, Atlas, Ticket Tool, Appy) | Partiel / Non vérifié | audits `docs/TOWER_TICKET_TOOL_AUDIT.md`, `TOWER_ATLAS_ARRET.md`, `AUDIT_DISCORD.md` ; actions Discord réelles réservées au propriétaire |
| 19 | Sécurité, isolation communautaire | Livré | `scopedDb`, gardes `community-isolation.ts`, connexion fermée S0, `docs/SECURITE_CLAUDE.md` |
| 20 | IA / Activities | Hors périmètre v1 | décision du 17/11 |
| 21-22 | Idempotence, tests critiques | Livré désactivé | `docs/TOWER_IDEMPOTENCE_AUDIT.md`, tests `tower-*.test.ts` et intégration |
| 23-25 | Phases, lancement, conditions de livraison | Partiel | `docs/TOWER_PHASE1_RECETTE_PUBLIQUE.md`, `TOWER_KIT_BETA_T19.md`, `PLAN-J14-20261201.md` ; vérifications réelles Discord à faire ([CONDITIONS_REUSSITE_LANCEMENT.md](CONDITIONS_REUSSITE_LANCEMENT.md)) |

## Cahier v1.1 — décisions du 18/11/2026 (`docs/CAHIER_DES_CHARGES.md` §27)

Les 15 sujets A à O sont **fusionnés sur `main`** (`main` = `6c0b25b`, 20/11/2026), tous derrière un interrupteur OFF. Aucun n'est activé, aucun n'est vérifié dans Discord. Chacune des 12 migrations fusionnées pendant la chaîne des 19-20/11 (colonne « Migration », de `130000` à `131300`, sauf `123100`) a eu un run « Migrations Production » vert ; l’état de la base de Production n’est pas relu ici.

| Sujet | Exigence | Statut | PR | Interrupteur | Migration |
| --- | --- | --- | --- | --- | --- |
| A | Équipes : recruteurs et invités (candidatures par capitaine ou ≤ 2 recruteurs, 8 max, invité d'équipe en tournoi) | Livré désactivé | #479 | `TEAM_RECRUITERS_ENABLED` | `20261118130000_team_recruiters_guest` |
| B | Votes de preuves dans Discord (vote public ✅/❌, fil par preuve) | Livré désactivé | #476 | `TOWER_DISCORD_VOTES_ENABLED` | aucune |
| C | Validation automatique Steam (défis mesurables, repli vote, « Signaler un doute », MP) | Livré désactivé | #484 | `TOWER_STEAM_AUTOVALIDATE_ENABLED` | `20261118130200_tower_challenge_measure` |
| D | Soirées : visibilité et liste d'attente (publique / candidature / privée, fil et vocal temporaires) | Livré désactivé | #480 | `SESSION_VISIBILITY_ENABLED` | `20261118130300_session_visibility_waitlist` |
| E | Tournois par équipes (score confirmé par les 2 capitaines, équilibrage par niveau) | Livré désactivé | #488 | `TOURNAMENT_TEAMS_ENABLED` | `20261118130400_tournament_teams` |
| F | `/role` : création automatique de rôles (sans permission, 1/joueur/semaine, alerte 80 % de 250) ; prérequis : 134 rôles Étage supprimés | Livré désactivé | #475 | `DISCORD_ROLE_AUTOCREATE_ENABLED` | `20261118130500_discord_role_requests` |
| G | `/projet` : organisateur et clôture (fil et espace privé, archivage 7 j) | Livré désactivé | #485 | `PROJECT_ORGANIZER_ENABLED` | `20261118130600_project_entries` |
| H | « Jouer maintenant » et rivalités d'équipes (Rejoindre / Intéressé, 2 h) | Livré désactivé | #487 | `TEAM_RIVALRIES_ENABLED` | `20261118130700_team_rivalries` |
| I | Notifications : MP ciblés, pings de rôle opt-in, centre in-app, jamais `@everyone` | Livré désactivé | #474 | `NOTIFICATION_CENTER_ENABLED` | `20261118130800_notification_center` |
| J | Console : connexions de plateformes et crossplay (scope OAuth `connections`, identifiants préremplis, pas de défi impossible) | Livré désactivé | #481 | `DISCORD_CONNECTIONS_SCOPE_ENABLED` et `GAME_PLATFORMS_ENABLED` | `20261118130900_platform_identities_crossplay` |
| K | Niveau par jeu et matchmaking (Débutant / Intermédiaire / Confirmé / Compétitif) | Livré désactivé | #468 (niveaux), #482 (matchmaking) | `GAME_LEVELS_ENABLED`, `GAME_LEVELS_MATCHMAKING_ENABLED` | `20261118123100_user_game_levels` (#468) ; matchmaking sans migration |
| L | Modération : commande contextuelle « Signaler », ticket privé staff, aucune sanction auto | Livré désactivé | #478 | `DISCORD_REPORT_COMMAND_ENABLED` | `20261118131100_moderation_reports` |
| M | Boosters : rôle « Soutien de la Tour » via `premium_since` (REST), mur des soutiens, salons boosters | Livré désactivé | #483 | `DISCORD_BOOSTERS_ENABLED` | `20261118131200_booster_support` |
| N | Personnalisation du profil (couleurs, thèmes, cadres, effets, vitrine de badges, entitlement sans paiement) | Livré désactivé | #477 | `PROFILE_CUSTOMIZATION_ENABLED` | `20261118131300_profile_customization` |
| O | Tableau de bord staff v2 (`/admin/tableau-de-bord`, lecture seule) | Livré désactivé | #486 | `ADMIN_DASHBOARD_V2_ENABLED` | aucune |
| V2 | Bot gateway permanent (activité, temps en vocal), rangs importés Riot / Hypixel | Prévu v2 (documentation seulement) | aucune | aucun | aucune |
| Plus tard | VIP payant cosmétique + confort, jamais étages, XP, priorité ni vote ; champ d'entitlement sans paiement | Prévu plus tard (documentation seulement) | aucune (l'entitlement est porté par le sujet N) | aucun | `20261118131300_profile_customization` (sujet N) |
| Rappel | Suppression des 134 rôles Étage avant la création auto de rôles (F) | Prévu v1.1 (prérequis, action manuelle du propriétaire) | aucune | aucun | aucune |

Corrections par rapport à la version du 17/11 :
- Le sujet B n'a **pas** de migration : le nom `20261118130100_tower_vote_messages`, cité dans des versions antérieures de ce tableau, n'existe pas dans `prisma/migrations/`.
- Le sujet K : l'énumération est bien `DEBUTANT / INTERMEDIAIRE / CONFIRME / COMPETITIF` (`prisma/schema.prisma`, `src/lib/game-levels-rules.ts`) ; le dossier `20261118123100_user_game_levels` n'existe qu'en une seule copie.

## Manques restants et points à confirmer

- **Actions Discord manuelles du propriétaire** (rien n'est fait par le dépôt) : enregistrement des commandes (`/tower`, `/tower-admin`, `/equipe`, `/projet`, `/role`, « Signaler »), panneau d'accueil, forums et tags, suppression des 134 rôles Étage, salons boosters et mur des soutiens, arrêt d'Atlas, déduplication Ticket Tool.
- Récapitulatif hebdomadaire Tower dédié et classement d'équipes Tower (Partiel).
- Le filtre de visibilité du profil ne couvre pas les classements ni les soirées.
- **À confirmer par le propriétaire** : propositions de défis par le top 1 et par les Ranker / High Ranker (récompenses « cosmétiques uniquement ») ; catalogue de 116 défis au lieu de 30 ; comportement de `DISCORD_ROLE_SELF_CREATION_ENABLED` (voir [ACTIVATION_TOUR.md](ACTIVATION_TOUR.md), « Point d'attention »).
- Plus tard (documentation seulement) : bot gateway permanent, rangs importés, VIP payant cosmétique.
